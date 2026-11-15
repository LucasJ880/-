/**
 * FLOW-H4c 提交记录——给可投标判定用的只读取数
 *
 * 只依赖数据库与提交记录的规则（contract.ts），不碰写入路径（阶段推进、通知、回调）。
 * 投标工作区读取时调它，所以这里不能把写入那一串模块带进来。
 */
import { db } from "@/lib/db";
import { SUBMISSION_AUDIT_ACTION, SUBMISSION_AUDIT_TARGET, effectiveRecordOf } from "./contract";

/** 找「与项目当前提交时间对得上的那条记录」时往回看多少条（与提交记录卡片相同） */
export const RECENT_SUBMISSION_RECORDS = 20;

/**
 * 项目当前的提交时间，加上与它对得上的那条记录里的回执编号。只带这两样（判定只看「有没有回执编号」），
 * 不带方式与备注。项目没有提交时间 → null。不看提交记录的开关（design D2）。
 */
export async function loadSubmissionForReadiness(input: { projectId: string; orgId: string; submittedAt: Date | null }): Promise<{ submittedAt: string; receiptRef: string | null } | null> {
  if (!input.submittedAt) return null;
  const rows = await db.auditLog.findMany({
    where: { orgId: input.orgId, projectId: input.projectId, action: SUBMISSION_AUDIT_ACTION, targetType: SUBMISSION_AUDIT_TARGET, targetId: input.projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: RECENT_SUBMISSION_RECORDS,
    select: { afterData: true },
  });
  const effective = effectiveRecordOf(input.submittedAt, rows);
  return { submittedAt: input.submittedAt.toISOString(), receiptRef: effective?.record.receiptRef ?? null };
}
