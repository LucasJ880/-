/**
 * Muse Bridge — 跨助理询问与回复（TASKFLOW S2）：取数与写入
 *
 * 只做取数、权限判定与编排；文本、默认问题、视图在 inquiry-pure.ts。
 * Task 没有 orgId：组织归属一律通过关联商机（Task.sourceId）的 orgId 判定。
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getOpportunityStageLabel } from "@/lib/revenue-spine/opportunity-stage";
import type { Advisory } from "./advisory";
import type { MuseIdentity } from "./binding-pure";
import { emitMuseEvent } from "./events";
import {
  CLOSED_TASK_STATUSES,
  DEFAULT_REPLY_HOURS,
  INQUIRY_CLOSED_MESSAGE,
  INQUIRY_CREATED_ACTION,
  INQUIRY_NOT_FOUND_MESSAGE,
  INQUIRY_PERMISSION_MESSAGE,
  INQUIRY_REPLIED_ACTION,
  INQUIRY_REPLY_BY_MESSAGE,
  INQUIRY_SOURCE_TYPE,
  INQUIRY_UNASSIGNED_MESSAGE,
  askColleagueAdvisory,
  inquiryReceivedEventInput,
  inquiryRepliedEventInput,
  inquirySourceTemplateKey,
  inquiryTaskDescription,
  inquiryTaskTitle,
  normalizeQuestions,
  normalizeReply,
  parseDetail,
  replyCommentText,
  replyInquiryAdvisory,
  workflowIdFor,
  type InquiryCreatedDetail,
  type InquiryRecord,
  type InquiryReplyDetail,
} from "./inquiry-pure";
import { OPPORTUNITY_NOT_FOUND_MESSAGE, resolveSalesScope } from "./sales-pure";
import type { MuseInquiryNeed } from "./contract";

export type InquiryErrorCode =
  | "PERMISSION_DENIED"
  | "OPPORTUNITY_NOT_FOUND"
  | "OPPORTUNITY_UNASSIGNED"
  | "INQUIRY_NOT_FOUND"
  | "INQUIRY_CLOSED"
  | "VALIDATION_FAILED";

export type InquiryResult =
  | { ok: true; advisory: Advisory; data: Record<string, unknown> }
  | { ok: false; errorCode: InquiryErrorCode; message: string };

const fail = (errorCode: InquiryErrorCode, message: string): InquiryResult => ({ ok: false, errorCode, message });

const userName = async (id: string) =>
  (await db.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? "同事";

export async function askColleague(
  identity: MuseIdentity,
  args: { opportunityId: string; questions: string[]; replyBy?: string; note?: string },
  ctx: { requestId: string },
  now: Date = new Date(),
): Promise<InquiryResult> {
  const scope = resolveSalesScope(identity);
  if (scope?.kind !== "org") return fail("PERMISSION_DENIED", INQUIRY_PERMISSION_MESSAGE);

  const opp = await db.salesOpportunity.findFirst({
    where: { id: args.opportunityId, orgId: identity.orgId },
    select: {
      id: true,
      title: true,
      stage: true,
      updatedAt: true,
      assignedToId: true,
      assignedTo: { select: { id: true, name: true } },
      customer: { select: { name: true } },
    },
  });
  if (!opp) return fail("OPPORTUNITY_NOT_FOUND", OPPORTUNITY_NOT_FOUND_MESSAGE);
  if (!opp.assignedTo || opp.assignedTo.id === identity.userId) {
    return fail("OPPORTUNITY_UNASSIGNED", INQUIRY_UNASSIGNED_MESSAGE);
  }
  const member = await db.organizationMember.findFirst({
    where: { orgId: identity.orgId, userId: opp.assignedTo.id, status: "active" },
    select: { id: true },
  });
  if (!member) return fail("OPPORTUNITY_UNASSIGNED", INQUIRY_UNASSIGNED_MESSAGE);

  const dueAt = args.replyBy ? new Date(args.replyBy) : new Date(now.getTime() + DEFAULT_REPLY_HOURS * 3_600_000);
  if (dueAt.getTime() <= now.getTime()) return fail("VALIDATION_FAILED", INQUIRY_REPLY_BY_MESSAGE);
  const questions = normalizeQuestions(args.questions);
  if (questions.length === 0) return fail("VALIDATION_FAILED", "至少需要一个问题。");

  const askerName = await userName(identity.userId);
  const workflowId = workflowIdFor(ctx.requestId);
  const sourceTemplateKey = inquirySourceTemplateKey(ctx.requestId);
  const detail: InquiryCreatedDetail = {
    kind: INQUIRY_CREATED_ACTION,
    workflowId,
    requestId: ctx.requestId,
    opportunityId: opp.id,
    recordVersion: opp.updatedAt.toISOString(),
    questions,
    note: args.note ?? null,
  };

  let taskId: string;
  try {
    taskId = await db.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title: inquiryTaskTitle(opp.title),
          description: inquiryTaskDescription({
            askerName,
            opportunity: {
              id: opp.id,
              title: opp.title,
              customerName: opp.customer.name,
              stageLabel: getOpportunityStageLabel(opp.stage),
              updatedAt: opp.updatedAt,
            },
            questions,
            note: args.note,
          }),
          status: "waiting_internal",
          priority: "high",
          dueDate: dueAt,
          waitingOn: "reply",
          sourceType: INQUIRY_SOURCE_TYPE,
          sourceId: opp.id,
          sourceTemplateKey,
          sourceBatchKey: workflowId,
          creatorId: identity.userId,
          assigneeId: opp.assignedTo!.id,
        },
        select: { id: true },
      });
      await tx.taskActivity.create({
        data: { taskId: task.id, actorId: identity.userId, action: INQUIRY_CREATED_ACTION, detail: JSON.stringify(detail) },
      });
      return task.id;
    });
  } catch (err) {
    // 同一 requestId 的并发重试撞上 (sourceId, sourceTemplateKey) 唯一约束：返回已建的那条
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const existing = await db.task.findFirst({ where: { sourceId: opp.id, sourceTemplateKey }, select: { id: true } });
    if (!existing) throw err;
    taskId = existing.id;
  }

  await emitMuseEvent(
    inquiryReceivedEventInput({
      orgId: identity.orgId,
      assigneeUserId: opp.assignedTo.id,
      inquiryId: taskId,
      opportunityId: opp.id,
      opportunityTitle: opp.title,
      askerName,
      questionCount: questions.length,
      dueAt,
    }),
  );

  return {
    ok: true,
    advisory: askColleagueAdvisory({
      opportunityTitle: opp.title,
      assigneeName: opp.assignedTo.name,
      dueAt,
      questionCount: questions.length,
      opportunityId: opp.id,
    }),
    data: {
      inquiryId: taskId,
      workflowId,
      opportunityId: opp.id,
      assignee: opp.assignedTo,
      dueAt: dueAt.toISOString(),
      questions,
    },
  };
}

export type ReplyInput = {
  inquiryId: string;
  nextStep: string;
  customerFeedback?: string;
  lastContactAt?: string;
  nextStepDueAt?: string;
  needs?: MuseInquiryNeed[];
  note?: string;
};

/**
 * 回复：只有询问的负责人能回复，且只能回复一次。
 * `orgId` 为 null 时（网页入口）从商机取组织，并要求回复人是该组织的有效成员。
 */
export async function replyInquiry(
  replier: { userId: string; orgId: string | null },
  input: ReplyInput,
  channel: "muse" | "web",
  now: Date = new Date(),
): Promise<InquiryResult> {
  const task = await db.task.findFirst({
    where: { id: input.inquiryId, sourceType: INQUIRY_SOURCE_TYPE, assigneeId: replier.userId },
    select: { id: true, status: true, sourceId: true, creatorId: true, sourceBatchKey: true },
  });
  if (!task?.sourceId) return fail("INQUIRY_NOT_FOUND", INQUIRY_NOT_FOUND_MESSAGE);
  const opp = await db.salesOpportunity.findFirst({
    where: { id: task.sourceId, ...(replier.orgId ? { orgId: replier.orgId } : {}) },
    select: { id: true, orgId: true, title: true },
  });
  if (!opp) return fail("INQUIRY_NOT_FOUND", INQUIRY_NOT_FOUND_MESSAGE);
  if (!replier.orgId) {
    const member = await db.organizationMember.findFirst({
      where: { orgId: opp.orgId, userId: replier.userId, status: "active" },
      select: { id: true },
    });
    if (!member) return fail("INQUIRY_NOT_FOUND", INQUIRY_NOT_FOUND_MESSAGE);
  }
  if ((CLOSED_TASK_STATUSES as readonly string[]).includes(task.status)) {
    return fail("INQUIRY_CLOSED", INQUIRY_CLOSED_MESSAGE);
  }

  const reply = normalizeReply(input);
  if (!reply.nextStep) return fail("VALIDATION_FAILED", "请填写下一步。");
  const detail: InquiryReplyDetail = { kind: INQUIRY_REPLIED_ACTION, channel, ...reply };

  const closed = await db.$transaction(async (tx) => {
    // 条件更新：并发的两次回复只有一次能把询问从未结束改成 done
    const { count } = await tx.task.updateMany({
      where: { id: task.id, status: { notIn: [...CLOSED_TASK_STATUSES] } },
      data: { status: "done", completedAt: now, waitingOn: null },
    });
    if (count === 0) return false;
    await tx.taskComment.create({ data: { taskId: task.id, authorId: replier.userId, content: replyCommentText(reply) } });
    await tx.taskActivity.create({
      data: { taskId: task.id, actorId: replier.userId, action: INQUIRY_REPLIED_ACTION, detail: JSON.stringify(detail) },
    });
    return true;
  });
  if (!closed) return fail("INQUIRY_CLOSED", INQUIRY_CLOSED_MESSAGE);

  const [replierName, askerName] = await Promise.all([userName(replier.userId), userName(task.creatorId)]);
  await emitMuseEvent(
    inquiryRepliedEventInput({
      orgId: opp.orgId,
      askerUserId: task.creatorId,
      inquiryId: task.id,
      opportunityId: opp.id,
      opportunityTitle: opp.title,
      replierName,
      nextStep: reply.nextStep,
      nextStepDueAt: reply.nextStepDueAt,
    }),
  );

  return {
    ok: true,
    advisory: replyInquiryAdvisory({ opportunityTitle: opp.title, askerName, opportunityId: opp.id }),
    data: { inquiryId: task.id, workflowId: task.sourceBatchKey, opportunityId: opp.id, status: "done", channel },
  };
}

/** 商机状态用：该商机上的全部询问及其回复（组织已由调用方校验） */
export async function loadInquiries(opportunityId: string): Promise<InquiryRecord[]> {
  const tasks = await db.task.findMany({
    where: { sourceType: INQUIRY_SOURCE_TYPE, sourceId: opportunityId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 20,
    select: {
      id: true,
      status: true,
      dueDate: true,
      createdAt: true,
      creator: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      activities: {
        where: { action: { in: [INQUIRY_CREATED_ACTION, INQUIRY_REPLIED_ACTION] } },
        orderBy: { createdAt: "asc" },
        select: { action: true, detail: true, createdAt: true, actor: { select: { id: true, name: true } } },
      },
    },
  });
  return tasks.map((t) => {
    const created = t.activities.find((a) => a.action === INQUIRY_CREATED_ACTION);
    const replied = t.activities.find((a) => a.action === INQUIRY_REPLIED_ACTION);
    const replyDetail = replied ? parseDetail<InquiryReplyDetail>(replied.detail, INQUIRY_REPLIED_ACTION) : null;
    return {
      id: t.id,
      status: t.status,
      dueDate: t.dueDate,
      createdAt: t.createdAt,
      creator: t.creator,
      assignee: t.assignee,
      createdDetail: created ? parseDetail<InquiryCreatedDetail>(created.detail, INQUIRY_CREATED_ACTION) : null,
      reply: replied && replyDetail ? { at: replied.createdAt, by: replied.actor, detail: replyDetail } : null,
    };
  });
}

/** 网页入口读询问：只给负责人或发起人看，其余 404 */
export async function getInquiryForUser(userId: string, inquiryId: string) {
  const task = await db.task.findFirst({
    where: { id: inquiryId, sourceType: INQUIRY_SOURCE_TYPE, OR: [{ assigneeId: userId }, { creatorId: userId }] },
    select: {
      id: true,
      status: true,
      dueDate: true,
      sourceId: true,
      assigneeId: true,
      creator: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      activities: {
        where: { action: { in: [INQUIRY_CREATED_ACTION, INQUIRY_REPLIED_ACTION] } },
        orderBy: { createdAt: "asc" },
        select: { action: true, detail: true, createdAt: true },
      },
    },
  });
  if (!task?.sourceId) return null;
  const opp = await db.salesOpportunity.findFirst({
    where: { id: task.sourceId },
    select: { id: true, orgId: true, title: true, customer: { select: { name: true } } },
  });
  if (!opp) return null;
  const member = await db.organizationMember.findFirst({
    where: { orgId: opp.orgId, userId, status: "active" },
    select: { id: true },
  });
  if (!member) return null;
  const created = task.activities.find((a) => a.action === INQUIRY_CREATED_ACTION);
  const replied = task.activities.find((a) => a.action === INQUIRY_REPLIED_ACTION);
  const createdDetail = created ? parseDetail<InquiryCreatedDetail>(created.detail, INQUIRY_CREATED_ACTION) : null;
  const replyDetail = replied ? parseDetail<InquiryReplyDetail>(replied.detail, INQUIRY_REPLIED_ACTION) : null;
  return {
    id: task.id,
    status: task.status,
    canReply: task.assigneeId === userId && !(CLOSED_TASK_STATUSES as readonly string[]).includes(task.status),
    dueAt: task.dueDate?.toISOString() ?? null,
    opportunity: { id: opp.id, title: opp.title, customerName: opp.customer.name },
    askedBy: task.creator,
    assignee: task.assignee,
    questions: createdDetail?.questions ?? [],
    note: createdDetail?.note ?? null,
    reply: replyDetail ? { at: replied!.createdAt.toISOString(), ...replyDetail } : null,
  };
}
