/**
 * FLOW-H4b 交付前检查清单——取数与标状态
 *
 * 清单在读取时现算（规则在 contract.ts）。状态存进这条要求在该次分析里的交付物行（TenderDeliverable.status）：
 * 分析时已经把提交类的强制要求逐条投影成交付物行、键由要求编号派生；分析时没被投影、后来才确认的要求，标状态时现建。
 * 组织只取自项目记录。
 *
 * 只用逐条带依据的分析（V2，见 isGroundedAnalysisSummary）。没有可用的分析、或可用的那份是旧的分析时，
 * 确定性清单不可用：「提交」页签与模型生成清单的接口都照旧。
 */
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import {
  SUBMISSION_CHECKLIST_AUDIT_ACTION,
  buildSubmissionChecklist,
  isGroundedAnalysisSummary,
  type ChecklistItemStatus,
  type SubmissionChecklistView,
} from "./contract";

/** 可用的分析：等待审核或已批准（与「下一步」取数用的同一组状态） */
const USABLE_RUN = ["REVIEW_REQUIRED", "APPROVED"];

type Client = Prisma.TransactionClient | typeof db;

const REQUIREMENT_SELECT = {
  requirementCode: true, category: true, mandatory: true, reviewStatus: true, complianceStatus: true,
  chineseTranslation: true, originalRequirement: true, sourcePage: true,
} as const;

/** 确定性清单为什么不可用：没有可用的分析 / 可用的那份是旧的分析（不逐条带依据） */
export type ChecklistUnavailableReason = "no_analysis" | "not_grounded";
export type ChecklistLoad =
  | { kind: "not_found" }
  | { kind: "unavailable"; reason: ChecklistUnavailableReason }
  | { kind: "ok"; view: SubmissionChecklistView; runId: string };

async function usableRunOf(client: Client, projectId: string, orgId: string) {
  return client.tenderAnalysisRun.findFirst({
    where: { projectId, orgId, status: { in: USABLE_RUN } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, summaryJson: true, createdAt: true },
  });
}

async function loadInClient(client: Client, input: { projectId: string; orgId: string; canEdit: boolean }): Promise<ChecklistLoad> {
  const project = await client.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { id: true, closeDate: true, questionCloseDate: true } });
  if (!project) return { kind: "not_found" };
  const run = await usableRunOf(client, input.projectId, input.orgId);
  if (!run) return { kind: "unavailable", reason: "no_analysis" };
  if (!isGroundedAnalysisSummary(run.summaryJson)) return { kind: "unavailable", reason: "not_grounded" };
  const [requirements, deliverables, newer] = await Promise.all([
    client.tenderExtractedRequirement.findMany({ where: { analysisRunId: run.id, projectId: input.projectId }, select: REQUIREMENT_SELECT }),
    client.tenderDeliverable.findMany({ where: { analysisRunId: run.id, projectId: input.projectId }, select: { deliverableKey: true, status: true } }),
    // 比这份更新的一次（还在进行 / 失败）：页面写明清单仍按这一份
    client.tenderAnalysisRun.findFirst({
      where: { projectId: input.projectId, orgId: input.orgId, createdAt: { gt: run.createdAt }, status: { notIn: [...USABLE_RUN, "SUPERSEDED"] } },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    }),
  ]);
  const summary = run.summaryJson as Record<string, unknown>;
  return {
    kind: "ok",
    runId: run.id,
    view: buildSubmissionChecklist({
      requirements,
      analysisStatus: run.status,
      analysisCreatedAt: run.createdAt,
      newerRunStatus: newer?.status ?? null,
      statusByKey: Object.fromEntries(deliverables.map((d) => [d.deliverableKey, d.status])),
      criticalFacts: summary.criticalFacts,
      closeDate: project.closeDate ?? null,
      questionCloseDate: project.questionCloseDate ?? null,
      canEdit: input.canEdit,
    }),
  };
}

/** 读取清单。只读。项目不在这个组织里 → not_found；没有能用来生成的分析 → unavailable */
export async function loadSubmissionChecklist(input: { projectId: string; orgId: string; canEdit: boolean }): Promise<ChecklistLoad> {
  return loadInClient(db, input);
}

/**
 * 模型生成的那份清单此刻是否已被取代：当前可用的那份分析逐条带依据。调用方负责开关与「是招投标项目」。
 * 与 loadSubmissionChecklist 用同一个判断，页面显示哪一份与模型接口拦不拦始终一致。
 */
export async function isDeterministicChecklistAvailable(input: { projectId: string; orgId: string }): Promise<boolean> {
  const run = await usableRunOf(db, input.projectId, input.orgId);
  return !!run && isGroundedAnalysisSummary(run.summaryJson);
}

export type SetItemStatusResult = { ok: true; view: SubmissionChecklistView } | { ok: false; status: 404; error: string };

/**
 * 把「要备齐的」里的一条标为待办 / 备好了 / 不适用。调用方负责：登录、项目写权限、开关、是招投标项目、状态值已校验。
 * 只有此刻清单里实际存在、可以单独标的条目才能标——还没确认的、别的项目的、编造的键都按「没有这一条」处理。
 */
export async function setChecklistItemStatus(input: { projectId: string; orgId: string; key: string; status: ChecklistItemStatus; actorId: string; request?: NextRequest }): Promise<SetItemStatusResult> {
  return db.$transaction(async (tx: Prisma.TransactionClient): Promise<SetItemStatusResult> => {
    const loaded = await loadInClient(tx, { projectId: input.projectId, orgId: input.orgId, canEdit: true });
    const item = loaded.kind === "ok" ? loaded.view.toPrepare.find((i) => i.key === input.key && i.tickable) : undefined;
    if (loaded.kind !== "ok" || !item) return { ok: false, status: 404, error: "清单里没有这一条" };
    const where = { analysisRunId_deliverableKey: { analysisRunId: loaded.runId, deliverableKey: item.key } };
    const before = await tx.tenderDeliverable.findUnique({ where, select: { status: true } });
    await tx.tenderDeliverable.upsert({
      where,
      create: { projectId: input.projectId, analysisRunId: loaded.runId, deliverableKey: item.key, title: item.textZh.slice(0, 200), mandatory: true, sourcePage: item.sourcePage, status: input.status },
      update: { status: input.status },
    });
    await writeAuditLog(tx, {
      userId: input.actorId, orgId: input.orgId, projectId: input.projectId,
      action: SUBMISSION_CHECKLIST_AUDIT_ACTION, targetType: "tender_deliverable", targetId: item.key,
      beforeData: { status: before?.status ?? null },
      afterData: { status: input.status, requirementCode: item.requirementCode, analysisRunId: loaded.runId },
      request: input.request,
    });
    const after = await loadInClient(tx, { projectId: input.projectId, orgId: input.orgId, canEdit: true });
    if (after.kind !== "ok") throw new Error("交付前检查清单在同一事务里读不回来");
    return { ok: true, view: after.view };
  }, { timeout: 15000 });
}
