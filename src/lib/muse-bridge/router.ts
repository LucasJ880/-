/**
 * Muse Bridge — 命令路由（DB 侧）
 *
 * 职责边界：
 *   - 只调用青砚既有服务（ApprovalPort / tender stage / 分析上下文），不新造业务逻辑；
 *   - 幂等：同 requestId 在 24h 内重放 → 直接返回首次响应（AuditLog 作账本，零 schema）；
 *   - 所有格式化走 router-pure.ts；本文件只做取数与编排。
 *   - Phase 0：status / ask / approve / reject / next_step / preferences / set_preference（P1-8）；
 *     Phase 1：rfq（P1-2）、chase（P1-7）、compare / price_scenario（P1-6）；未在 MUSE_BRIDGE_INTENTS 放行的意图由 gateIntent 诚实拒绝。
 *   - P1-8：所有 ok 回复都是 Advisory（结论 → 理由 → 下一步），经 respond() 出站；
 *     建议里指向未放行意图的按钮一律去掉（gateAdvisory），不建议点了就被拒的动作。
 */

import { db } from "@/lib/db";
import { logAudit, writeAuditLog } from "@/lib/audit/logger";
import { approveApprovalItem, rejectApprovalItem, listApprovalInbox } from "@/lib/approval/port";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import { buildTenderPackageContext } from "@/lib/tender-auto-analysis/chat-context";
import { museCommandResponseSchema, type MuseCommandArgs, type MuseCommandEnvelope, type MuseCommandResponse } from "./contract";
import { enabledMuseIntents } from "./flags";
import type { MuseIdentity } from "./binding-pure";
import { advisoryResponse, gateAdvisory, type Advisory } from "./advisory";
import { countUnknownCriticalFacts, decideNextStep } from "./next-step";
import { loadUserPrefs, saveUserPrefs } from "./prefs";
import { applyPreference } from "./prefs-pure";
import { resolveCloseDate } from "@/lib/tender/stage";
import { parseRfqThreadId } from "@/lib/tender-rfq/inbound-contract";
import { parseChaseNotes, resolveChaseAfterDays } from "@/lib/tender-rfq/chase-pure";
import {
  ASK_OUTPUT_INSTRUCTIONS,
  askAdvisory,
  chaseAdvisory,
  askNoContextAdvisory,
  compareAdvisory,
  errResponse,
  formatApprovalOutcome,
  gateIntent,
  preferencesAdvisory,
  priceScenarioAdvisory,
  rfqCandidatesAdvisory,
  rfqDraftAdvisory,
  setPreferenceAdvisory,
  statusAdvisory,
  type StatusProjectRow,
} from "./router-pure";

const LEDGER_TARGET_TYPE = "muse_bridge_request" as const;
const LEDGER_WINDOW_MS = 24 * 60 * 60 * 1000;

const TERMINAL_TENDER_STATUSES = ["won", "lost", "passed", "archived"];

/** ok 回复唯一出口：去掉未放行意图的建议，再按 Advisory 渲染 */
function respond(requestId: string, a: Advisory, extra?: { data?: unknown; strict?: boolean }): MuseCommandResponse {
  return advisoryResponse(requestId, gateAdvisory(a, enabledMuseIntents()), extra);
}

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
      case "rfq":
        response = await handleRfq(requestId, identity, command);
        break;
      case "chase":
        response = await handleChase(requestId, identity, command);
        break;
      case "compare":
        response = await handleCompare(requestId, identity, command);
        break;
      case "price_scenario":
        response = await handlePriceScenario(requestId, identity, command);
        break;
      case "next_step":
        response = await handleNextStep(requestId, identity, command.projectId);
        break;
      case "preferences":
        response = await handlePreferences(requestId, identity);
        break;
      case "set_preference":
        response = await handleSetPreference(requestId, identity, command);
        break;
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

/** status / next_step 共用的项目取数（同一份字段，不另写查询层） */
async function loadStatusRows(identity: MuseIdentity, projectId?: string): Promise<StatusProjectRow[]> {
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

  const inbox = await listApprovalInbox(identity.userId);
  const pendingByProject = new Map<string, number>();
  for (const item of inbox) {
    const pid = item.source.projectId;
    if (pid) pendingByProject.set(pid, (pendingByProject.get(pid) ?? 0) + 1);
  }

  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  return projects.map((p) => ({
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
}

async function handleStatus(requestId: string, identity: MuseIdentity, projectId?: string): Promise<MuseCommandResponse> {
  const rows = await loadStatusRows(identity, projectId);
  if (projectId && rows.length === 0) {
    return errResponse(requestId, "PROJECT_NOT_FOUND", "没找到这个项目，或它不属于你的组织。");
  }
  if (projectId) rows[0].manualChase = await countManualChase(identity, projectId);
  return respond(requestId, statusAdvisory(rows, new Date(), { singleProject: !!projectId }), {
    data: { projects: rows.map((r) => ({ id: r.id, name: r.name, closeDate: r.closeDate, analysisStatus: r.analysisStatus, pendingApprovals: r.pendingApprovals })) },
  });
}

/** P1-7：最新一轮里超期没回、但没有邮件线程（P1-3 之前 / 青砚外发的）——只能手工催 */
async function countManualChase(identity: MuseIdentity, projectId: string): Promise<number> {
  const round = await db.projectInquiry.findFirst({
    where: { projectId },
    orderBy: { roundNumber: "desc" },
    select: { items: { where: { status: "sent" }, select: { sentAt: true, contactNotes: true } } },
  });
  if (!round?.items.length) return 0;
  const days = await chaseDaysFor(identity);
  const now = Date.now();
  return round.items.filter((i) => i.sentAt && now - i.sentAt.getTime() >= days * 86_400_000 && !parseRfqThreadId(i.contactNotes)).length;
}

/** 催单天数：本人偏好 > 组织 tenderRfq.chaseAfterDays > 3（与催单扫描同一套） */
async function chaseDaysFor(identity: MuseIdentity, prefDays?: number | null): Promise<number> {
  const org = await db.organization.findUnique({ where: { id: identity.orgId }, select: { settingsJson: true } });
  const days = prefDays !== undefined ? prefDays : (await loadUserPrefs(identity.orgId, identity.userId)).chaseAfterDays;
  return resolveChaseAfterDays(days, org?.settingsJson);
}

/** 该用户可见、属于该项目的待批 PendingAction（approve 意图只认 pending_action） */
async function pendingActionsForProject(userId: string, projectId: string) {
  const inbox = await listApprovalInbox(userId);
  return inbox
    .filter((i) => i.kind === "pending_action" && i.source.projectId === projectId)
    .map((i) => ({ id: i.id, title: i.title, createdAt: i.createdAt }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

// ── ask（证据接地问答） ─────────────────────────────────────────

const ASK_SYSTEM = [
  "你是青砚投标助理，通过 Muse 通道回答用户关于一个投标项目的问题。",
  "硬规则：",
  "1. 只能依据下面给出的项目上下文作答；上下文没有写的信息一律回答「文档/分析里没有这一项」，绝不推测、绝不编造。",
  "2. 涉及是否合规、是否满足强制要求的结论，必须指出依据来自哪条要求或哪页；没有依据就说「无证据，需人工确认」。",
  "3. 不输出任何内部成本、毛利、估值、预算类信息。",
  "4. 结论一句话；依据最多 3 条，带要求编号或页码；下一步只能从给定的提示词里选，没有合适的就留空。用中文。",
  "",
  ASK_OUTPUT_INSTRUCTIONS,
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
  if (!context) return respond(requestId, askNoContextAdvisory(projectId, project.name));
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

  // LLM 只给结论 / 理由 / 提示词；下一步由代码按 §2.1 查表映射，映射不到就没有
  const earliest = (await pendingActionsForProject(identity.userId, projectId))[0]?.id ?? null;
  return respond(requestId, askAdvisory(answer, { projectId, earliestApprovalId: earliest }));
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

// ── rfq（P1-2：准备一轮询价 → 审批卡） ──────────────────────────

async function handleRfq(
  requestId: string,
  identity: MuseIdentity,
  command: Extract<MuseCommandArgs, { intent: "rfq" }>,
): Promise<MuseCommandResponse> {
  const { prepareRfqRound } = await import("@/lib/tender-rfq/service");
  const r = await prepareRfqRound({
    projectId: command.projectId,
    orgId: identity.orgId,
    userId: identity.userId,
    supplierIds: command.supplierIds,
    supplierHint: command.supplierHint ?? null,
    scopeNote: command.scope ?? null,
  });

  if (!r.ok) {
    if (r.errorCode === "NO_SUPPLIERS" && r.candidates?.length) {
      return respond(requestId, rfqCandidatesAdvisory(command.projectId, r.candidates), { data: { candidates: r.candidates } });
    }
    const code = r.errorCode === "PROJECT_NOT_FOUND" ? "PROJECT_NOT_FOUND" : r.errorCode === "ROUND_LOCKED" ? "APPROVAL_FAILED" : "VALIDATION_FAILED";
    return errResponse(requestId, code, r.message, {
      suggestedActions: [{ label: "看这个标的状态", command: { intent: "status", projectId: command.projectId } }],
    });
  }

  return respond(requestId, rfqDraftAdvisory({ ...r, projectId: command.projectId }), {
    data: { actionId: r.actionId, inquiryId: r.inquiryId, suppliers: r.suppliers, blockedSuppliers: r.blockedSuppliers, supplierSource: r.supplierSource },
  });
}

// ── chase（P1-7：催单 / 缺字段追问 → 一家一张审批卡） ────────────────

async function handleChase(
  requestId: string,
  identity: MuseIdentity,
  command: Extract<MuseCommandArgs, { intent: "chase" }>,
): Promise<MuseCommandResponse> {
  const { draftChasesForProject } = await import("@/lib/tender-rfq/chase-service");
  const r = await draftChasesForProject({
    orgId: identity.orgId,
    userId: identity.userId,
    projectId: command.projectId,
    inquiryId: command.inquiryId,
    itemIds: command.itemIds,
  });
  if (!r.ok) {
    return errResponse(requestId, r.errorCode === "PROJECT_NOT_FOUND" ? "PROJECT_NOT_FOUND" : "VALIDATION_FAILED", r.message, {
      suggestedActions: [{ label: "看这个标的状态", command: { intent: "status", projectId: command.projectId } }],
    });
  }
  return respond(requestId, chaseAdvisory(command.projectId, r.run), {
    data: {
      drafted: r.run.drafted.map((d) => ({ itemId: d.itemId, supplierName: d.supplierName, actionId: d.actionId, kind: d.kind, chaseIndex: d.chaseIndex })),
      skipped: r.run.skipped,
      failed: r.run.failed,
    },
  });
}

// ── compare / price_scenario（P1-6：落地价比价 → 定价情景） ──────────

async function handleCompare(
  requestId: string,
  identity: MuseIdentity,
  command: Extract<MuseCommandArgs, { intent: "compare" }>,
): Promise<MuseCommandResponse> {
  const { loadCompareMatrix } = await import("@/lib/tender-rfq/compare-service");
  const r = await loadCompareMatrix({ projectId: command.projectId, orgId: identity.orgId, inquiryId: command.inquiryId ?? null });
  if (!r.ok) {
    if (r.errorCode === "NO_QUOTES") return respond(requestId, noQuotesAdvisory(r.message, command.projectId));
    return errResponse(requestId, r.errorCode === "PROJECT_NOT_FOUND" ? "PROJECT_NOT_FOUND" : "VALIDATION_FAILED", r.message);
  }
  return respond(requestId, compareAdvisory({ projectId: r.projectId, roundNumber: r.roundNumber, matrix: r.matrix }), {
    strict: true,
    data: { inquiryId: r.inquiryId, roundNumber: r.roundNumber, matrix: r.matrix },
  });
}

function noQuotesAdvisory(message: string, projectId: string): Advisory {
  return {
    conclusion: message,
    reasons: ["供应商回信后会自动入表，我会推送提醒"],
    nextStep: { label: "看这个标的状态", command: { intent: "status", projectId } },
  };
}

async function handlePriceScenario(
  requestId: string,
  identity: MuseIdentity,
  command: Extract<MuseCommandArgs, { intent: "price_scenario" }>,
): Promise<MuseCommandResponse> {
  const { loadCompareMatrix } = await import("@/lib/tender-rfq/compare-service");
  const r = await loadCompareMatrix({ projectId: command.projectId, orgId: identity.orgId });
  if (!r.ok) {
    if (r.errorCode === "NO_QUOTES") return respond(requestId, noQuotesAdvisory(`${r.message}有报价后再算情景。`, command.projectId));
    return errResponse(requestId, r.errorCode === "PROJECT_NOT_FOUND" ? "PROJECT_NOT_FOUND" : "VALIDATION_FAILED", r.message);
  }

  // 选哪家：指定的 > 推荐的 > 最便宜的
  const pickId = command.supplierItemId ?? r.matrix.recommendedItemId ?? r.matrix.cheapestItemId;
  const row = r.matrix.rows.find((x) => x.itemId === pickId);
  if (!row) {
    return errResponse(requestId, "VALIDATION_FAILED", command.supplierItemId ? "这家供应商不在最新一轮比价里。" : "最新一轮里还没有能换算出落地价的报价。", {
      suggestedActions: [{ label: "看比价", command: { intent: "compare", projectId: command.projectId } }],
    });
  }
  if (row.landedCad.total == null) {
    return errResponse(requestId, "VALIDATION_FAILED", `「${row.supplierName}」的落地价还没换算出来：${row.blockers[0] ?? "参数不全"}。`, {
      suggestedActions: [{ label: "看比价", command: { intent: "compare", projectId: command.projectId } }],
    });
  }

  const { loadProjectPricingContext } = await import("@/lib/tender-pricing/project-context");
  const ctx = await loadProjectPricingContext(r.projectId);
  if (!ctx.model) {
    return errResponse(requestId, "VALIDATION_FAILED", "评分模型还没确定（招标文件里没抓到价格权重），请先在青砚报价表助手确认后再算情景。");
  }
  const competitorPriceCad = ctx.saved.competitorPriceCad ?? ctx.benchmark.median ?? null;
  const competitorSourceZh =
    ctx.saved.competitorPriceCad != null
      ? "人工假设"
      : ctx.benchmark.source === "incumbent_lead"
        ? "现任价格线索"
        : ctx.benchmark.source === "federal_contracts"
          ? "历史合同对标"
          : null;

  const { buildScenarios } = await import("@/lib/tender-pricing/calc");
  const { projectScenariosForMuse, scoreCandidatePrice } = await import("@/lib/tender-rfq/compare");
  // 决定 A：落地价可以出 Muse，毛利率不行——不传目标毛利，"成本 + 目标毛利"情景（价格 ÷ 落地价即可反推毛利率）不生成，
  // 成本线只出落地价本身
  const result = buildScenarios(ctx.model, {
    competitorPriceCad,
    ourCostCad: row.landedCad.total,
    targetMarginPct: null,
  });
  const candidate =
    command.candidatePrice != null && competitorPriceCad != null && competitorPriceCad > 0
      ? scoreCandidatePrice(ctx.model, command.candidatePrice, competitorPriceCad)
      : null;
  const view = projectScenariosForMuse(result, candidate, row.landedCad.total);
  return respond(
    requestId,
    priceScenarioAdvisory({ projectId: r.projectId, supplierName: row.supplierName, competitorPriceCad, competitorSourceZh, view }),
    {
      strict: true,
      data: {
        supplierItemId: row.itemId,
        supplierName: row.supplierName,
        competitorPriceCad,
        scenarios: view.scenarios,
        candidate: view.candidate,
        breakEvenPriceCad: view.breakEvenPriceCad,
        landedCostCad: view.landedCostCad,
      },
    },
  );
}

// ── next_step（P1-8：确定性查表，零 LLM） ────────────────────────

async function handleNextStep(requestId: string, identity: MuseIdentity, projectId: string): Promise<MuseCommandResponse> {
  const [row] = await loadStatusRows(identity, projectId);
  if (!row) return errResponse(requestId, "PROJECT_NOT_FOUND", "没找到这个项目，或它不属于你的组织。");

  const [run, latestRound, quoteCount, pending, prefs] = await Promise.all([
    db.tenderAnalysisRun.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        summaryJson: true,
        requirements: { where: { mandatory: true, complianceStatus: "NON_COMPLIANT" }, select: { id: true } },
      },
    }),
    db.projectInquiry.findFirst({
      where: { projectId },
      orderBy: { roundNumber: "desc" },
      select: { id: true, items: { select: { id: true, status: true, sentAt: true, isSelected: true, contactNotes: true, supplier: { select: { name: true } } } } },
    }),
    db.projectQuote.count({ where: { projectId } }),
    pendingActionsForProject(identity.userId, projectId),
    loadUserPrefs(identity.orgId, identity.userId),
  ]);

  const decision = decideNextStep({
    projectId,
    projectName: row.name,
    now: new Date(),
    closeDate: resolveCloseDate(row),
    submittedAt: row.submittedAt,
    analysisStatus: run?.status ?? null,
    unknownCriticalFacts: countUnknownCriticalFacts(run?.summaryJson ?? null),
    mandatoryNonCompliant: run?.requirements.length ?? 0,
    pendingApprovals: pending,
    latestRound: latestRound
      ? {
          inquiryId: latestRound.id,
          items: latestRound.items.map((i) => ({
            itemId: i.id,
            supplierName: i.supplier?.name ?? "供应商",
            status: i.status,
            sentAt: i.sentAt,
            isSelected: i.isSelected,
            hasThread: !!parseRfqThreadId(i.contactNotes),
            chasedAt: parseChaseNotes(i.contactNotes).filter((c) => c.kind === "no_reply").map((c) => c.at),
          })),
        }
      : null,
    hasProjectQuote: quoteCount > 0,
    prefs: { ...prefs, chaseAfterDays: await chaseDaysFor(identity, prefs.chaseAfterDays) },
  });
  return respond(requestId, decision.advisory, { data: { rule: decision.rule } });
}

// ── preferences / set_preference（P1-8：个人偏好，可查可改） ────────

async function supplierNamesOf(orgId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.supplier.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function handlePreferences(requestId: string, identity: MuseIdentity): Promise<MuseCommandResponse> {
  const prefs = await loadUserPrefs(identity.orgId, identity.userId);
  return respond(requestId, preferencesAdvisory(prefs, await supplierNamesOf(identity.orgId, prefs.defaultSupplierIds)), { data: { preferences: prefs } });
}

async function handleSetPreference(
  requestId: string,
  identity: MuseIdentity,
  command: Extract<MuseCommandArgs, { intent: "set_preference" }>,
): Promise<MuseCommandResponse> {
  const before = await loadUserPrefs(identity.orgId, identity.userId);
  const applied = applyPreference(before, command.key, command.value, new Date());
  if (!applied.ok) return errResponse(requestId, "VALIDATION_FAILED", applied.error);
  if (command.key === "defaultSupplierIds" && applied.prefs.defaultSupplierIds.length) {
    const names = await supplierNamesOf(identity.orgId, applied.prefs.defaultSupplierIds);
    if (names.size !== applied.prefs.defaultSupplierIds.length) {
      return errResponse(requestId, "VALIDATION_FAILED", "有供应商不在你的组织里，没有保存。");
    }
  }
  await saveUserPrefs(identity.orgId, identity.userId, applied.prefs);
  return respond(requestId, setPreferenceAdvisory(applied.summaryZh), { data: { preferences: applied.prefs } });
}
