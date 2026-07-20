import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { buildStructuredDiff } from "./diff";
import {
  FEEDBACK_SCOPES,
  HUMAN_DECISIONS,
  REASON_CODES,
  type FeedbackScope,
  type HumanDecision,
  type ReasonCode,
} from "./types";
import { EmployeeAiAccessError } from "./access";

export interface CreateFeedbackInput {
  orgId: string;
  userId: string;
  taskType: string;
  humanDecision: HumanDecision;
  aiOutputRef: Record<string, unknown>;
  aiOutputSnapshot?: unknown;
  humanEditedOutput?: unknown;
  reasonCode?: string | null;
  reasonText?: string | null;
  feedbackScope?: FeedbackScope;
  consentConfirmed?: boolean;
  agentRunId?: string | null;
  skillExecutionId?: string | null;
  pendingActionId?: string | null;
  supervisorStepId?: string | null;
  workerType?: string | null;
  skillSlug?: string | null;
}

function assertDecision(v: string): asserts v is HumanDecision {
  if (!(HUMAN_DECISIONS as readonly string[]).includes(v)) {
    throw new EmployeeAiAccessError("无效的 humanDecision", 400);
  }
}

function assertScope(v: string): asserts v is FeedbackScope {
  if (!(FEEDBACK_SCOPES as readonly string[]).includes(v)) {
    throw new EmployeeAiAccessError("无效的 feedbackScope", 400);
  }
}

export async function createHumanFeedbackEvent(input: CreateFeedbackInput) {
  assertDecision(input.humanDecision);
  const scope = input.feedbackScope ?? "personal_only";
  assertScope(scope);

  if (
    input.humanDecision === "rejected" &&
    !input.reasonCode &&
    !input.reasonText
  ) {
    throw new EmployeeAiAccessError("拒绝操作需要选择简短原因", 400);
  }

  if (
    input.reasonCode &&
    !(REASON_CODES as readonly string[]).includes(input.reasonCode)
  ) {
    throw new EmployeeAiAccessError("无效的 reasonCode", 400);
  }

  // 不存不必要完整敏感正文：edited 时优先 diff + 截断快照
  let snapshot = input.aiOutputSnapshot;
  if (snapshot != null) {
    const raw = typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot);
    if (raw.length > 4000) {
      snapshot = { truncated: true, preview: raw.slice(0, 1500) };
    }
  }

  const diffSummary =
    input.humanDecision === "edited"
      ? buildStructuredDiff(input.aiOutputSnapshot ?? input.aiOutputRef, input.humanEditedOutput)
      : input.humanDecision === "accepted"
        ? { kind: "empty", changed: false, summary: "已接受" }
        : { kind: "empty", changed: false, summary: input.humanDecision };

  const event = await db.humanFeedbackEvent.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      taskType: input.taskType,
      humanDecision: input.humanDecision,
      aiOutputRef: input.aiOutputRef as object,
      aiOutputSnapshot: snapshot as object | undefined,
      humanEditedOutput: input.humanEditedOutput as object | undefined,
      diffSummary: diffSummary as object,
      reasonCode: (input.reasonCode as ReasonCode | null) ?? null,
      reasonText: input.reasonText ?? null,
      feedbackScope: scope,
      consentConfirmed: input.consentConfirmed !== false,
      agentRunId: input.agentRunId ?? null,
      skillExecutionId: input.skillExecutionId ?? null,
      pendingActionId: input.pendingActionId ?? null,
      supervisorStepId: input.supervisorStepId ?? null,
      workerType: input.workerType ?? null,
      skillSlug: input.skillSlug ?? null,
    },
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: "employee_ai.feedback.create",
    targetType: "HumanFeedbackEvent",
    targetId: event.id,
    afterData: {
      humanDecision: event.humanDecision,
      feedbackScope: event.feedbackScope,
      taskType: event.taskType,
    },
  });

  return event;
}

export async function updateHumanFeedbackEvent(input: {
  orgId: string;
  userId: string;
  id: string;
  patch: {
    feedbackScope?: FeedbackScope;
    reasonCode?: string | null;
    reasonText?: string | null;
    humanEditedOutput?: unknown;
  };
}) {
  const existing = await db.humanFeedbackEvent.findFirst({
    where: { id: input.id, orgId: input.orgId },
  });
  if (!existing) throw new EmployeeAiAccessError("反馈不存在", 404);
  if (existing.userId !== input.userId) {
    throw new EmployeeAiAccessError("只能修改自己的反馈", 403);
  }

  if (input.patch.feedbackScope) assertScope(input.patch.feedbackScope);

  const data: Record<string, unknown> = {};
  if (input.patch.feedbackScope) data.feedbackScope = input.patch.feedbackScope;
  if (input.patch.reasonCode !== undefined) data.reasonCode = input.patch.reasonCode;
  if (input.patch.reasonText !== undefined) data.reasonText = input.patch.reasonText;
  if (input.patch.humanEditedOutput !== undefined) {
    data.humanEditedOutput = input.patch.humanEditedOutput as object;
    data.diffSummary = buildStructuredDiff(
      existing.aiOutputSnapshot ?? existing.aiOutputRef,
      input.patch.humanEditedOutput,
    ) as object;
  }

  const updated = await db.humanFeedbackEvent.update({
    where: { id: existing.id },
    data,
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: "employee_ai.feedback.update",
    targetType: "HumanFeedbackEvent",
    targetId: updated.id,
    afterData: { feedbackScope: updated.feedbackScope },
  });

  return updated;
}

export async function listOwnFeedbackEvents(input: {
  orgId: string;
  userId: string;
  take?: number;
}) {
  return db.humanFeedbackEvent.findMany({
    where: { orgId: input.orgId, userId: input.userId },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 50,
  });
}

/** 学习样本过滤：排除 do_not_learn；team 挖掘仅用 team_candidate */
export function isLearnableForPersonal(scope: string): boolean {
  return scope === "personal_only" || scope === "team_candidate";
}

export function isLearnableForTeam(scope: string): boolean {
  return scope === "team_candidate";
}
