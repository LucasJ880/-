/**
 * Muse Bridge — 命令路由（DB 侧）
 *
 * 职责边界：
 *   - 只调用青砚既有服务（ApprovalPort / tender stage / 分析上下文），不新造业务逻辑；
 *   - 幂等：同 requestId 在 24h 内重放 → 直接返回首次响应（AuditLog 作账本，零 schema）；
 *   - 所有格式化走 router-pure.ts；本文件只做取数与编排。
 *   - Phase 0 只实现 status / ask / approve / reject；其余意图由 gateIntent 诚实拒绝。
 */

import { db } from "@/lib/db";
import { logAudit, writeAuditLog } from "@/lib/audit/logger";
import { approveApprovalItem, rejectApprovalItem, listApprovalInbox } from "@/lib/approval/port";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import { buildTenderPackageContext } from "@/lib/tender-auto-analysis/chat-context";
import { museCommandResponseSchema, type MuseCommandEnvelope, type MuseCommandResponse } from "./contract";
import { enabledMuseIntents } from "./flags";
import type { MuseIdentity } from "./binding-pure";
import {
  errResponse,
  formatApprovalOutcome,
  formatStatusMessage,
  gateIntent,
  okResponse,
  type StatusProjectRow,
} from "./router-pure";

const LEDGER_TARGET_TYPE = "muse_bridge_request" as const;
const LEDGER_WINDOW_MS = 24 * 60 * 60 * 1000;

const TERMINAL_TENDER_STATUSES = ["won", "lost", "passed", "archived"];

// ── 入口 ────────────────────────────────────────────────────────

export async function handleMuseCommand(
  envelope: MuseCommandEnvelope,
  identity: MuseIdentity,
): Promise<MuseCommandResponse> {
  const { requestId, command } = envelope;

  // 1. 幂等账本
  const replay = await findLedgerResponse(requestId, identity);
  if (replay) return replay;

  // 2. 意图门
  const gated = gateIntent(requestId, command, enabledMuseIntents());
  if (gated) return await ledger(envelope, identity, gated);

  // 3. 分发
  let response: MuseCommandResponse;
  try {
    switch (command.intent) {
      case "status":
        response = await handleStatus(requestId, identity, command.projectId);
        break;
      case "ask":
        response = await handleAsk(requestId, identity, command.projectId, command.question);
        break;
      case "approve": {
        const outcome = await approveApprovalItem("pending_action", command.approvalId, {
          userId: identity.userId,
          role: identity.role,
          orgId: identity.orgId,
          note: command.note,
          acceptedWithRisk: command.acceptedWithRisk,
        });
        response = formatApprovalOutcome(requestId, "approve", outcome);
        break;
      }
      case "reject": {
        const outcome = await rejectApprovalItem("pending_action", command.approvalId, {
          userId: identity.userId,
          role: identity.role,
          orgId: identity.orgId,
          note: command.reason,
        });
        response = formatApprovalOutcome(requestId, "reject", outcome);
        break;
      }
      default:
        // gateIntent 已拦；此处仅类型兜底
        response = errResponse(requestId, "INTENT_NOT_ENABLED", "该动作尚未开放。");
    }
  } catch (err) {
    console.error("[muse-bridge] command failed:", err);
    response = errResponse(requestId, "INTERNAL", "青砚处理这条指令时出错了，已记录；请稍后再试或在青砚内操作。");
  }

  return await ledger(envelope, identity, response);
}

// ── 幂等账本（AuditLog） ─────────────────────────────────────────

async function findLedgerResponse(requestId: string, identity: MuseIdentity): Promise<MuseCommandResponse | null> {
  const row = await db.auditLog.findFirst({
    where: {
      targetType: LEDGER_TARGET_TYPE,
      targetId: requestId,
      orgId: identity.orgId,
      createdAt: { gt: new Date(Date.now() - LEDGER_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { afterData: true },
  });
  if (!row?.afterData) return null;
  try {
    const parsed = museCommandResponseSchema.safeParse(JSON.parse(row.afterData));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function ledger(
  envelope: MuseCommandEnvelope,
  identity: MuseIdentity,
  response: MuseCommandResponse,
): Promise<MuseCommandResponse> {
  try {
    await writeAuditLog(db, {
      userId: identity.userId,
      orgId: identity.orgId,
      projectId: "projectId" in envelope.command ? envelope.command.projectId ?? null : null,
      action: `muse:${envelope.command.intent}`,
      targetType: LEDGER_TARGET_TYPE,
      targetId: envelope.requestId,
      beforeData: { museUserRef: envelope.museUserRef, command: envelope.command, utterance: envelope.utterance ?? null },
      afterData: response,
    });
  } catch (err) {
    // 账本失败不影响回复，但要留痕
    console.error("[muse-bridge] ledger write failed:", err);
    void logAudit({ userId: identity.userId, orgId: identity.orgId, action: "muse:ledger_failed", targetType: LEDGER_TARGET_TYPE, targetId: envelope.requestId });
  }
  return response;
}

// ── status ──────────────────────────────────────────────────────

async function handleStatus(requestId: string, identity: MuseIdentity, projectId?: string): Promise<MuseCommandResponse> {
  const projects = await db.project.findMany({
    where: {
      orgId: identity.orgId,
      workDomain: "tender",
      ...(projectId ? { id: projectId } : { OR: [{ tenderStatus: null }, { tenderStatus: { notIn: TERMINAL_TENDER_STATUSES } }] }),
    },
    orderBy: { closeDate: "asc" },
    take: 50,
    select: {
      id: true,
      name: true,
      createdAt: true,
      tenderStatus: true,
      publicDate: true,
      questionCloseDate: true,
      closeDate: true,
      dueDate: true,
      distributedAt: true,
      dispatchedAt: true,
      interpretedAt: true,
      supplierInquiredAt: true,
      supplierQuotedAt: true,
      submittedAt: true,
      awardDate: true,
      intakeStatus: true,
      sourceMetadataJson: true,
      tenderAnalysisRuns: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
    },
  });
  if (projectId && projects.length === 0) {
    return errResponse(requestId, "PROJECT_NOT_FOUND", "没找到这个项目，或它不属于你的组织。");
  }

  const inbox = await listApprovalInbox(identity.userId);
  const pendingByProject = new Map<string, number>();
  for (const item of inbox) {
    const pid = item.source.projectId;
    if (pid) pendingByProject.set(pid, (pendingByProject.get(pid) ?? 0) + 1);
  }

  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const rows: StatusProjectRow[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: iso(p.createdAt),
    tenderStatus: p.tenderStatus,
    publicDate: iso(p.publicDate),
    questionCloseDate: iso(p.questionCloseDate),
    closeDate: iso(p.closeDate),
    dueDate: iso(p.dueDate),
    distributedAt: iso(p.distributedAt),
    dispatchedAt: iso(p.dispatchedAt),
    interpretedAt: iso(p.interpretedAt),
    supplierInquiredAt: iso(p.supplierInquiredAt),
    supplierQuotedAt: iso(p.supplierQuotedAt),
    submittedAt: iso(p.submittedAt),
    awardDate: iso(p.awardDate),
    intakeStatus: p.intakeStatus,
    sourceMetadataJson: p.sourceMetadataJson,
    analysisStatus: p.tenderAnalysisRuns[0]?.status ?? null,
    pendingApprovals: pendingByProject.get(p.id) ?? 0,
  }));

  const { message, suggestedActions } = formatStatusMessage(rows, new Date());
  return okResponse(requestId, message, {
    data: { projects: rows.map((r) => ({ id: r.id, name: r.name, closeDate: r.closeDate, analysisStatus: r.analysisStatus, pendingApprovals: r.pendingApprovals })) },
    suggestedActions,
  });
}

// ── ask（证据接地问答） ─────────────────────────────────────────

const ASK_SYSTEM = [
  "你是青砚投标助理，通过 Muse 通道回答用户关于一个投标项目的问题。",
  "硬规则：",
  "1. 只能依据下面给出的项目上下文作答；上下文没有写的信息一律回答「文档/分析里没有这一项」，绝不推测、绝不编造。",
  "2. 涉及是否合规、是否满足强制要求的结论，必须指出依据来自哪条要求或哪页；没有依据就说「无证据，需人工确认」。",
  "3. 不输出任何内部成本、毛利、估值、预算类信息。",
  "4. 回答控制在 6 句以内，先给结论，再给依据，最后给一个最该做的下一步。用中文。",
].join("\n");

async function handleAsk(
  requestId: string,
  identity: MuseIdentity,
  projectId: string,
  question: string,
): Promise<MuseCommandResponse> {
  const project = await db.project.findFirst({
    where: { id: projectId, orgId: identity.orgId },
    select: { id: true, name: true, workDomain: true },
  });
  if (!project) return errResponse(requestId, "PROJECT_NOT_FOUND", "没找到这个项目，或它不属于你的组织。");

  const context = (await buildTenderPackageContext(projectId)) ?? (await fallbackContext(projectId));
  if (!context) {
    return okResponse(requestId, `「${project.name}」还没有可用的分析结果，先上传招标文件并等分析完成，再来问我。`, {
      suggestedActions: [{ label: "看整体状态", command: { intent: "status" } }],
    });
  }
  if (!isAIConfigured()) {
    return errResponse(requestId, "INTERNAL", "AI 未配置，暂时无法回答；分析结果可在青砚项目页查看。");
  }

  const answer = await createCompletion({
    systemPrompt: `${ASK_SYSTEM}\n\n【项目】${project.name}\n【上下文】\n${context.slice(0, 24_000)}`,
    userPrompt: question,
    orgId: identity.orgId,
    userId: identity.userId,
    temperature: 0.2,
    maxTokens: 700,
    workflow: "muse_bridge_ask",
  });

  return okResponse(requestId, answer.trim(), {
    suggestedActions: [
      { label: "还有什么要批", command: { intent: "status" } },
      { label: "再问一个", command: { intent: "ask", projectId, question: "这个标最大的废标风险是什么？" } },
    ],
  });
}

/** EXPERIENCE 开关关闭时的最小上下文：最新分析 summaryText + 强制要求列表（仍是 canonical 数据）。 */
async function fallbackContext(projectId: string): Promise<string | null> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      summaryText: true,
      requirements: {
        take: 60,
        orderBy: { createdAt: "asc" },
        select: { originalRequirement: true, mandatory: true, complianceStatus: true },
      },
    },
  });
  if (!run) return null;
  const reqs = run.requirements
    .map((r, i) => `${i + 1}. [${r.mandatory ? "强制" : "评分"}|${r.complianceStatus}] ${r.originalRequirement.slice(0, 240)}`)
    .join("\n");
  return [`分析状态：${run.status}`, run.summaryText ? `摘要：\n${run.summaryText}` : "摘要：无", reqs ? `要求：\n${reqs}` : "要求：无"].join("\n\n");
}
