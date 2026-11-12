/**
 * FLOW-H1c 阶段记录跟着事实自动前进
 *
 * 三个事实触发：分析产出可审核的结果 → 项目解读；一轮询价至少发出一家 → 供应商询价；
 * 询价项第一次录入报价 → 供应商报价。
 *
 * 只做：该段时间为空、且写入会让阶段记录变靠后时写入；收建阶段任务（stage-tasks）；写一条审计。
 * 写入不会让阶段记录变靠后（项目已在更靠后的阶段，或阶段只由招投标状态得出）时什么也不写。
 * 不做：改招投标状态、BidToGo 状态回调、讨论区消息、成员通知（这些只在人确认的
 * advanceProjectStage 里发生）。不调模型。开关关闭时直接返回。
 */
import { db } from "@/lib/db";
import { AUDIT_TARGETS, writeAuditLog } from "@/lib/audit/logger";
import { TERMINAL_TENDER_STATUSES } from "@/lib/projects/review";
import { recordedStageOf, type StageRecord } from "./stage";
import { STAGE_ORDER, STAGE_TO_TIMESTAMP } from "./stage-transition";
import { onStageAdvancedTasks } from "./stage-tasks";
import { isStageAutoAdvanceEnabledForOrg, isStageAutoAdvanceSwitchedOn } from "./stage-auto-flags";
import type { TenderStage } from "./types";

export type AutoStage = "interpretation" | "supplier_inquiry" | "supplier_quote";
export type AutoTrigger = "analysis_ready" | "rfq_sent" | "rfq_marked_sent" | "quote_recorded";

export const AUTO_ADVANCE_AUDIT_ACTION = "tender.stage.auto_advance";

const TRIGGER_STAGE: Record<AutoTrigger, AutoStage> = {
  analysis_ready: "interpretation",
  rfq_sent: "supplier_inquiry",
  rfq_marked_sent: "supplier_inquiry",
  quote_recorded: "supplier_quote",
};

export type AutoAdvanceProject = StageRecord & {
  workDomain: string | null;
  status: string | null;
  awardDate?: Date | string | null;
};

export type AutoAdvanceSkip = "not_tender" | "not_active" | "has_result" | "already_reached" | "not_forward";

/** 能不能为这个项目写入这一段的时间（纯函数）。null = 可以 */
export function autoAdvanceSkipReason(project: AutoAdvanceProject, stage: AutoStage): AutoAdvanceSkip | null {
  if ((project.workDomain ?? "").toLowerCase() !== "tender") return "not_tender";
  if (project.status !== "active") return "not_active";
  // 已有结果（已中标、未中标、不投标、已放弃投标、已取消……）；「已提交」不算结果
  if (TERMINAL_TENDER_STATUSES.has((project.tenderStatus ?? "").toLowerCase()) || project.awardDate) return "has_result";
  const field = STAGE_TO_TIMESTAMP[stage] as keyof StageRecord;
  if (project[field]) return "already_reached";
  // 写进去也不会让阶段记录变靠后（已在更靠后的阶段；或阶段只由招投标状态得出，写了反而往回退）：不写
  if (!stageMovesForward(recordedStageOf(project), recordedStageOf({ ...project, [field]: new Date() }))) return "not_forward";
  return null;
}

/** 写入之后阶段记录是否变靠后（纯函数） */
export function stageMovesForward(before: TenderStage, after: TenderStage): boolean {
  return STAGE_ORDER.indexOf(after) > STAGE_ORDER.indexOf(before);
}

export type AutoAdvanceResult =
  | { written: false; reason: AutoAdvanceSkip | "flag_off" | "not_found" | "lost_race" }
  | { written: true; from: TenderStage; to: TenderStage };

/** 这一段之后各段的时间字段：写入时要求它们仍为空（读之后有人推进到更靠后的阶段，就不写） */
function laterFields(stage: AutoStage): string[] {
  return STAGE_ORDER.slice(STAGE_ORDER.indexOf(stage) + 1).map((s) => STAGE_TO_TIMESTAMP[s]).filter((f): f is string => !!f);
}

/**
 * 某个事实发生了：让阶段记录到达对应的阶段。调用方 SHALL 把它当 best-effort（失败不影响原流程）。
 * actorId：触发的人；不知道是谁时传 null，任务与审计记在项目负责人名下。
 */
export async function recordStageReached(input: {
  projectId: string;
  trigger: AutoTrigger;
  actorId: string | null;
  now?: Date;
}): Promise<AutoAdvanceResult> {
  const stage = TRIGGER_STAGE[input.trigger];
  const field = STAGE_TO_TIMESTAMP[stage]!;
  const now = input.now ?? new Date();
  if (!isStageAutoAdvanceSwitchedOn()) return { written: false, reason: "flag_off" };

  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: {
      orgId: true, ownerId: true, workDomain: true, status: true, tenderStatus: true, intakeStatus: true, awardDate: true,
      distributedAt: true, dispatchedAt: true, interpretedAt: true, supplierInquiredAt: true, supplierQuotedAt: true, submittedAt: true,
    },
  });
  if (!project) return { written: false, reason: "not_found" };
  if (!isStageAutoAdvanceEnabledForOrg(project.orgId)) return { written: false, reason: "flag_off" };
  const skip = autoAdvanceSkipReason(project, stage);
  if (skip) return { written: false, reason: skip };

  // 时间为空才写：同时两家报价进来，只有一个写成功。条件里带上读到的状态与更靠后各段仍为空：
  // 读之后被放弃、记了结果、记了授标日期或被人推进到更靠后的阶段，就不写
  const wrote = await db.project.updateMany({
    where: {
      id: input.projectId, [field]: null, status: "active", tenderStatus: project.tenderStatus, awardDate: null,
      ...Object.fromEntries(laterFields(stage).map((f) => [f, null])),
    },
    data: { [field]: now },
  });
  if (wrote.count === 0) return { written: false, reason: "lost_race" };

  const from = recordedStageOf(project);
  const to = recordedStageOf({ ...project, [field]: now });
  const actorId = input.actorId ?? project.ownerId;

  await onStageAdvancedTasks(input.projectId, from, to, actorId).catch((err) =>
    console.error("[StageAuto] tasks failed:", err),
  );

  await writeAuditLog(db, {
    userId: actorId,
    orgId: project.orgId,
    projectId: input.projectId,
    action: AUTO_ADVANCE_AUDIT_ACTION,
    targetType: AUDIT_TARGETS.PROJECT,
    targetId: input.projectId,
    beforeData: { stage: from },
    afterData: { stage: to, field, trigger: input.trigger, actorKnown: input.actorId !== null },
  }).catch((err) => console.error("[StageAuto] audit failed:", err));

  return { written: true, from, to };
}
