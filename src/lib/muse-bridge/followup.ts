/**
 * Muse Bridge — 跟进（TASKFLOW S3）：SalesAction(source=muse_followup) 的创建、更新与读取
 *
 * 权限与状态规则在 followup-pure.ts；本文件只做 IO。零 schema。
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Advisory } from "./advisory";
import type { MuseIdentity } from "./binding-pure";
import type { MuseFollowupUpdateStatus } from "./contract";
import { emitMuseEvent } from "./events";
import {
  FOLLOWUP_ASSIGNEE_INVALID_MESSAGE,
  FOLLOWUP_CATEGORY,
  FOLLOWUP_DUE_PAST_MESSAGE,
  FOLLOWUP_INQUIRY_MESSAGE,
  FOLLOWUP_NOT_FOUND_MESSAGE,
  FOLLOWUP_SOURCE,
  createFollowupAdvisory,
  followupAssignedEventInput,
  followupSignalKey,
  followupUpdatedEventInput,
  planFollowupUpdate,
  resolveFollowupAssignee,
  updateFollowupAdvisory,
  workflowIdOf,
  type FollowupRecord,
} from "./followup-pure";
import { INQUIRY_SOURCE_TYPE, workflowIdFor } from "./inquiry-pure";
import { OPPORTUNITY_NOT_FOUND_MESSAGE, SALES_PERMISSION_DENIED_MESSAGE, resolveSalesScope } from "./sales-pure";

export type FollowupErrorCode =
  | "PERMISSION_DENIED"
  | "OPPORTUNITY_NOT_FOUND"
  | "OPPORTUNITY_UNASSIGNED"
  | "INQUIRY_NOT_FOUND"
  | "FOLLOWUP_NOT_FOUND"
  | "FOLLOWUP_CLOSED"
  | "VALIDATION_FAILED";

export type FollowupResult =
  | { ok: true; advisory: Advisory; data: Record<string, unknown> }
  | { ok: false; errorCode: FollowupErrorCode; message: string };

const fail = (errorCode: FollowupErrorCode, message: string): FollowupResult => ({ ok: false, errorCode, message });

const userName = async (id: string) =>
  (await db.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? "同事";

const isActiveMember = async (orgId: string, userId: string) =>
  !!(await db.organizationMember.findFirst({ where: { orgId, userId, status: "active" }, select: { id: true } }));

export const followupSelect = {
  id: true,
  orgId: true,
  title: true,
  status: true,
  dueAt: true,
  createdAt: true,
  completedAt: true,
  dismissedAt: true,
  resolutionNote: true,
  dismissedReason: true,
  inputContext: true,
  updatedAt: true,
  assignedToId: true,
  createdById: true,
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  opportunity: { select: { id: true, title: true } },
} satisfies Prisma.SalesActionSelect;

export type FollowupRow = Prisma.SalesActionGetPayload<{ select: typeof followupSelect }>;

function createdData(row: FollowupRow) {
  return {
    followupId: row.id,
    workflowId: workflowIdOf(row.inputContext),
    opportunityId: row.opportunity?.id ?? null,
    title: row.title,
    status: row.status,
    assignee: row.assignedTo,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
  };
}

/** 询问必须属于同一商机，且调用者是它的发起人或收件人；返回它的 workflowId */
async function inquiryWorkflow(inquiryId: string, opportunityId: string, userId: string): Promise<string | null | undefined> {
  const task = await db.task.findFirst({
    where: {
      id: inquiryId,
      sourceType: INQUIRY_SOURCE_TYPE,
      sourceId: opportunityId,
      OR: [{ creatorId: userId }, { assigneeId: userId }],
    },
    select: { sourceBatchKey: true },
  });
  return task ? task.sourceBatchKey : undefined;
}

export async function createFollowup(
  identity: MuseIdentity,
  args: { opportunityId: string; title: string; dueAt: string; fromInquiryId?: string; assigneeUserId?: string },
  ctx: { requestId: string },
  now: Date = new Date(),
): Promise<FollowupResult> {
  const scope = resolveSalesScope(identity);
  if (!scope) return fail("PERMISSION_DENIED", SALES_PERMISSION_DENIED_MESSAGE);

  const signalKey = followupSignalKey(ctx.requestId);
  // 重放（含 24 小时账本窗口之外、跟进已结束后）：按 signalKey 返回原跟进
  const replay = await db.salesAction.findFirst({
    where: { orgId: identity.orgId, source: FOLLOWUP_SOURCE, signalKey, createdById: identity.userId },
    select: followupSelect,
  });
  if (replay) return created(replay);

  const opp = await db.salesOpportunity.findFirst({
    where: { id: args.opportunityId, orgId: identity.orgId },
    select: { id: true, title: true, customerId: true, assignedToId: true },
  });
  if (!opp) return fail("OPPORTUNITY_NOT_FOUND", OPPORTUNITY_NOT_FOUND_MESSAGE);
  // 销售看不到别人的商机：与 S1 读范围同口径，按不存在处理
  if (scope.kind === "own" && opp.assignedToId !== identity.userId) {
    return fail("OPPORTUNITY_NOT_FOUND", OPPORTUNITY_NOT_FOUND_MESSAGE);
  }

  const assignee = resolveFollowupAssignee({
    scope,
    callerId: identity.userId,
    opportunityAssigneeId: opp.assignedToId,
    requested: args.assigneeUserId,
  });
  if (!assignee.ok) return fail(assignee.errorCode, assignee.message);
  if (!(await isActiveMember(identity.orgId, assignee.assigneeId))) {
    return args.assigneeUserId
      ? fail("VALIDATION_FAILED", FOLLOWUP_ASSIGNEE_INVALID_MESSAGE)
      : fail("OPPORTUNITY_UNASSIGNED", FOLLOWUP_ASSIGNEE_INVALID_MESSAGE);
  }

  const dueAt = new Date(args.dueAt);
  if (dueAt.getTime() <= now.getTime()) return fail("VALIDATION_FAILED", FOLLOWUP_DUE_PAST_MESSAGE);

  let workflowId = workflowIdFor(ctx.requestId);
  if (args.fromInquiryId) {
    const inquiryWorkflowId = await inquiryWorkflow(args.fromInquiryId, opp.id, identity.userId);
    if (inquiryWorkflowId === undefined) return fail("INQUIRY_NOT_FOUND", FOLLOWUP_INQUIRY_MESSAGE);
    if (inquiryWorkflowId) workflowId = inquiryWorkflowId;
  }

  let row: FollowupRow;
  try {
    row = await db.salesAction.create({
      data: {
        orgId: identity.orgId,
        customerId: opp.customerId,
        opportunityId: opp.id,
        source: FOLLOWUP_SOURCE,
        signalKey,
        activeKey: signalKey,
        category: FOLLOWUP_CATEGORY,
        title: args.title,
        priority: "high",
        status: "open",
        dueAt,
        lastObservedAt: now,
        assignedToId: assignee.assigneeId,
        createdById: identity.userId,
        inputContext: { workflowId, inquiryTaskId: args.fromInquiryId ?? null, requestId: ctx.requestId },
      },
      select: followupSelect,
    });
  } catch (err) {
    // 同一 requestId 的并发重试撞上 activeKey 唯一约束：返回已建的那条
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const existing = await db.salesAction.findFirst({
      where: { orgId: identity.orgId, source: FOLLOWUP_SOURCE, signalKey, createdById: identity.userId },
      select: followupSelect,
    });
    if (!existing) throw err;
    return created(existing);
  }

  if (row.assignedToId && row.assignedToId !== identity.userId) {
    await emitMuseEvent(
      followupAssignedEventInput({
        orgId: identity.orgId,
        followupId: row.id,
        opportunityId: opp.id,
        opportunityTitle: opp.title,
        title: row.title,
        dueAt,
        assigneeUserId: row.assignedToId,
        creatorName: await userName(identity.userId),
      }),
    );
  }
  return created(row);
}

function created(row: FollowupRow): FollowupResult {
  return {
    ok: true,
    advisory: createFollowupAdvisory({
      title: row.title,
      assigneeName: row.assignedTo?.name ?? "负责人",
      dueAt: row.dueAt ?? new Date(),
      opportunityId: row.opportunity?.id ?? "",
    }),
    data: createdData(row),
  };
}

/**
 * 状态变化后通知"另一方"：负责人改的通知创建人，创建人改的通知负责人；两者是同一人时不发。
 * Muse 与网页两个入口共用。`changedAt` 用落库后的 updatedAt，同一次变化重复调用只发一次。
 */
export async function notifyFollowupUpdated(row: FollowupRow, updaterId: string, note: string | null): Promise<void> {
  const recipientUserId = updaterId === row.createdById ? row.assignedToId : row.createdById;
  if (!row.opportunity || !recipientUserId || recipientUserId === updaterId) return;
  await emitMuseEvent(
    followupUpdatedEventInput({
      orgId: row.orgId,
      followupId: row.id,
      opportunityId: row.opportunity.id,
      opportunityTitle: row.opportunity.title,
      title: row.title,
      recipientUserId,
      updaterName: await userName(updaterId),
      status: row.status,
      note,
      changedAt: row.updatedAt,
    }),
  );
}

export async function updateFollowup(
  identity: MuseIdentity,
  args: { followupId: string; status: MuseFollowupUpdateStatus; evidence?: string; reason?: string },
  now: Date = new Date(),
): Promise<FollowupResult> {
  const current = await db.salesAction.findFirst({
    where: {
      id: args.followupId,
      orgId: identity.orgId,
      source: FOLLOWUP_SOURCE,
      OR: [{ assignedToId: identity.userId }, { createdById: identity.userId }],
    },
    select: followupSelect,
  });
  if (!current) return fail("FOLLOWUP_NOT_FOUND", FOLLOWUP_NOT_FOUND_MESSAGE);

  const plan = planFollowupUpdate({ current: current.status, next: args.status, evidence: args.evidence, reason: args.reason });
  if (!plan.ok) return fail(plan.errorCode, plan.message);

  let row = current;
  if (plan.changed) {
    const data: Prisma.SalesActionUncheckedUpdateManyInput =
      plan.status === "in_progress"
        ? { status: plan.status, startedAt: now }
        : plan.status === "completed"
          ? { status: plan.status, completedAt: now, completedById: identity.userId, resolutionNote: plan.evidence, activeKey: null }
          : { status: plan.status, dismissedAt: now, dismissedReason: plan.reason, activeKey: null };
    // 条件更新：并发的另一次更新已经把它结束时，这次不覆盖
    const updated = await db.salesAction.updateMany({ where: { id: current.id, status: current.status }, data });
    if (updated.count === 0) return fail("FOLLOWUP_CLOSED", "这条跟进刚被别人更新过，请重新查看后再操作。");
    row = await db.salesAction.findUniqueOrThrow({ where: { id: current.id }, select: followupSelect });
    await notifyFollowupUpdated(row, identity.userId, plan.evidence ?? plan.reason);
  }

  return {
    ok: true,
    advisory: updateFollowupAdvisory({ title: row.title, status: row.status, opportunityId: row.opportunity?.id ?? "" }),
    data: { ...createdData(row), evidence: row.resolutionNote, reason: row.dismissedReason },
  };
}

/** 商机状态与协作追踪用：该商机上的全部 Muse 跟进（组织已由调用方校验） */
export async function loadFollowups(opportunityId: string): Promise<FollowupRecord[]> {
  return db.salesAction.findMany({
    where: { opportunityId, source: FOLLOWUP_SOURCE },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 20,
    select: {
      id: true,
      title: true,
      status: true,
      dueAt: true,
      createdAt: true,
      completedAt: true,
      dismissedAt: true,
      resolutionNote: true,
      dismissedReason: true,
      inputContext: true,
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
}

