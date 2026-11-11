/**
 * 审批草稿「组织 + 幂等键」冲突的判定与有上限的整段重跑（纯函数，不引数据库）。
 * change：approval-draft-idempotency-race；能力 approvals/draft-idempotency。
 *
 * PostgreSQL 上唯一冲突会让整个交互式事务进入中止状态，之后在这个事务里执行任何语句都报
 * 25P02（current transaction is aborted）。所以冲突后不在原事务里接着查，而是用新事务把整批重跑一遍
 * ——与 agent-runtime/run.ts 的 withAgentRunEventSequenceRetry 同一做法。默认隔离级别 READ COMMITTED 下，
 * 唯一冲突只在先到方提交后才报出来，重跑时的前置查询一定能看到先到方那张卡并复用它。
 */

/** PendingAction(orgId, idempotencyKey) 唯一约束名（迁移 greenfield_baseline_pre_phase4） */
export const DRAFT_IDEMPOTENCY_CONSTRAINT = "PendingAction_orgId_idempotencyKey_key";

/** 首次加最多 2 次重跑 */
export const DRAFT_IDEMPOTENCY_MAX_ATTEMPTS = 3;

/**
 * 是否为「组织 + 幂等键」上的唯一冲突（Prisma P2002）。
 * 只认 PendingAction 这张表：AgentRunStep、ApprovalDecisionIdempotency 也有同名字段的唯一约束，不能混进来。
 * 其它唯一冲突、外键错误（P2003）、连接错误等一律不算。
 */
export function isDraftIdempotencyConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { code, meta } = err as { code?: unknown; meta?: unknown };
  if (code !== "P2002" || typeof meta !== "object" || meta === null) return false;
  const { modelName, target } = meta as { modelName?: unknown; target?: unknown };
  if (typeof target === "string") {
    return target === DRAFT_IDEMPOTENCY_CONSTRAINT && (modelName === undefined || modelName === "PendingAction");
  }
  if (Array.isArray(target)) {
    return (
      modelName === "PendingAction" &&
      target.length === 2 &&
      target.includes("orgId") &&
      target.includes("idempotencyKey")
    );
  }
  return false;
}

/**
 * 跑 work；遇到「组织 + 幂等键」冲突就整段重跑，最多跑 DRAFT_IDEMPOTENCY_MAX_ATTEMPTS 次。
 * 其它错误立即原样抛出；次数用完仍冲突，抛出最后一次的错误。
 * work 每次都必须开一个新事务。
 */
export async function withDraftIdempotencyRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      if (attempt < DRAFT_IDEMPOTENCY_MAX_ATTEMPTS && isDraftIdempotencyConflict(err)) continue;
      throw err;
    }
  }
}
