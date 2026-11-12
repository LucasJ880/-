/**
 * FLOW-H4a 投标提交记录——读取与写入
 *
 * 写入有两条路：
 *   - 项目此前没到提交阶段（first）：走既有的阶段推进 advanceProjectStage——提交时间、招投标状态、讨论区消息、
 *     审计、成员通知、BidToGo 回调都沿用它；只是时间用人填的那个，且不为「项目提交」阶段建任务。
 *   - 项目已经在提交阶段（correction / backfill）：这不是阶段变化，只改提交时间这一个日期。
 * 每一次都追加一条记录（审计行），不覆盖之前的。组织只取自项目记录。
 */
import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { emitProjectPatchEvents } from "@/lib/project-discussion/system-events";
import { recordedStageOf } from "@/lib/tender/stage";
import { advanceProjectStage } from "@/lib/tender/stage-transition";
import {
  SUBMISSION_AUDIT_ACTION,
  SUBMISSION_AUDIT_TARGET,
  blockedReasonZh,
  classifySubmission,
  parseStoredRecord,
  toStoredRecord,
  type SubmissionInput,
  type SubmissionKind,
  type SubmissionRecordView,
} from "./contract";

type Actor = { id: string; name: string; email: string };

/** 找「与项目上的提交时间对得上的最新一条记录」时往回看多少条 */
const RECENT_RECORDS = 20;

const STAGE_SELECT = {
  id: true, orgId: true, status: true, tenderStatus: true, intakeStatus: true, sourceSystem: true,
  distributedAt: true, dispatchedAt: true, interpretedAt: true, supplierInquiredAt: true, supplierQuotedAt: true, submittedAt: true,
} as const;

/** 读取：项目上的提交时间、最新的一条记录、历次条数。只读。 */
export async function loadSubmissionRecordView(input: { projectId: string; orgId: string; canRecord: boolean }): Promise<SubmissionRecordView | null> {
  const where = { orgId: input.orgId, projectId: input.projectId, action: SUBMISSION_AUDIT_ACTION, targetType: SUBMISSION_AUDIT_TARGET, targetId: input.projectId };
  const [project, recent, count] = await Promise.all([
    db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: STAGE_SELECT }),
    db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: RECENT_RECORDS, select: { afterData: true, createdAt: true, user: { select: { name: true } } } }),
    db.auditLog.count({ where }),
  ]);
  if (!project) return null;
  const blockedZh = blockedReasonZh(project);
  // 显示的那条记录必须与项目上的提交时间对得上：取最新的、记的就是这个提交时间的那一条。
  // 两个人同时第一次记录、填的不一样时，后写进来的记录不一定是最后生效的那个时间——不能把 A 的回执配上 B 的时间。
  const submittedIso = project.submittedAt ? project.submittedAt.toISOString() : null;
  const latest = submittedIso ? recent.find((r) => parseStoredRecord(r.afterData)?.submittedAt === submittedIso) : undefined;
  const stored = parseStoredRecord(latest?.afterData);
  return {
    submittedAt: project.submittedAt ? project.submittedAt.toISOString() : null,
    nextKind: blockedZh ? null : classifySubmission({ recordedStage: recordedStageOf(project), submittedAt: project.submittedAt, tenderStatus: project.tenderStatus }),
    blockedZh,
    canRecord: input.canRecord,
    syncsToSource: !!project.sourceSystem,
    record: stored && latest ? { ...stored, recordedAt: latest.createdAt.toISOString(), recordedByName: latest.user?.name ?? null } : null,
    count,
  };
}

export type RecordSubmissionResult =
  | { ok: true; kind: SubmissionKind; submittedAt: string }
  | { ok: false; status: 404 | 409; error: string };

/**
 * 记录一次提交。调用方负责：登录、项目写权限、开关、是招投标项目、输入已校验。
 * 这里不发任何邮件，不碰任何门户。
 */
export async function recordSubmission(input: { projectId: string; orgId: string; actor: Actor; value: SubmissionInput; request?: NextRequest }): Promise<RecordSubmissionResult> {
  const { projectId, orgId, actor, value } = input;
  const project = await db.project.findFirst({ where: { id: projectId, orgId }, select: STAGE_SELECT });
  if (!project) return { ok: false, status: 404, error: "项目不存在" };
  const blocked = blockedReasonZh(project);
  if (blocked) return { ok: false, status: 409, error: blocked };

  const audit = (kind: SubmissionKind) => ({
    userId: actor.id, orgId, projectId, action: SUBMISSION_AUDIT_ACTION, targetType: SUBMISSION_AUDIT_TARGET, targetId: projectId,
    afterData: toStoredRecord(value, kind), request: input.request,
  });

  if (classifySubmission({ recordedStage: recordedStageOf(project), submittedAt: project.submittedAt, tenderStatus: project.tenderStatus }) === "first") {
    const advanced = await advanceProjectStage({
      projectId, targetStage: "submission", reason: "在项目页上记录提交", source: "manual", actor, humanConfirmed: true,
      occurredAt: value.submittedAt, skipStageTasks: true,
      // 从上面读到现在，别人可能刚记了投标结果或放弃了项目：那样就不推进（不把「已中标」冲成「已提交」），转到下面在锁里重新判断
      expected: { status: project.status, tenderStatus: project.tenderStatus },
    });
    if (!advanced.success) return { ok: false, status: 409, error: advanced.reason };
    if (advanced.decision !== "no_op") {
      // 提交时间已经由阶段推进写入（它有自己的事务）。这一行紧随其后；万一写不进去，项目是「已提交、没有回执记录」，页面上可以再补
      await writeAuditLog(db, audit("first"));
      return { ok: true, kind: "first", submittedAt: value.submittedAt.toISOString() };
    }
    // no_op：同一时刻别的请求已经把项目推进到了提交阶段（同时点了两次），或项目的状态刚变了 → 到下面在锁里重新判断
  }

  // 已在提交阶段：只改提交时间这一个日期，并追加记录——同一个事务
  return db.$transaction(async (tx: Prisma.TransactionClient): Promise<RecordSubmissionResult> => {
    // 锁住项目行：两次更正同时到达时依次执行，各自的「之前」都是对方写完之后的值
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR NO KEY UPDATE`;
    const fresh = await tx.project.findFirst({ where: { id: projectId, orgId } });
    if (!fresh) return { ok: false, status: 404, error: "项目不存在" };
    const blockedNow = blockedReasonZh(fresh);
    if (blockedNow) return { ok: false, status: 409, error: blockedNow };
    const kind = classifySubmission({ recordedStage: recordedStageOf(fresh), submittedAt: fresh.submittedAt, tenderStatus: fresh.tenderStatus });
    if (kind === "first") return { ok: false, status: 409, error: "项目的状态刚刚变了，请刷新后再试" };
    if (!fresh.submittedAt || fresh.submittedAt.getTime() !== value.submittedAt.getTime()) {
      await tx.project.update({ where: { id: projectId }, data: { submittedAt: value.submittedAt } });
      await emitProjectPatchEvents(
        projectId,
        fresh as unknown as Record<string, unknown>,
        { ...fresh, submittedAt: value.submittedAt } as unknown as Record<string, unknown>,
        { id: actor.id, name: actor.name },
        tx,
      );
    }
    await writeAuditLog(tx, { ...audit(kind), beforeData: { submittedAt: fresh.submittedAt ? fresh.submittedAt.toISOString() : null } });
    return { ok: true, kind, submittedAt: value.submittedAt.toISOString() };
  }, { timeout: 15000 });
}
