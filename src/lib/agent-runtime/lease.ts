/**
 * AgentRun 通用租约原语（Workforce Runtime Phase 2A）
 *
 * 由 queue.ts 的 background_conversation CAS claim 模板泛化而来：
 * - claimRunLease  原子认领（DB conditional updateMany，两 worker 并发最多一个成功）
 * - renewRunLease  续租（fenced：只有持有当前租约的 worker 能续）
 * - fencedRunUpdate 完成/交还等生命周期写入的防栅栏（stale worker 写入失败）
 *
 * Fencing token（零迁移）：AgentRun 没有 leaseOwner 列，但 leaseExpiresAt
 * 在 claim/renew 时严格单调递增（重新认领只能发生在旧租约过期之后，
 * 新到期时间 = 认领时刻 + leaseMs > 旧到期时间；续租时刻晚于上次写入时刻，
 * 新到期时间同样严格增大）。因此「本 worker 最近一次写入的 leaseExpiresAt
 * 精确值」可充当 fencing token：所有生命周期写入用
 * `WHERE id = ? AND leaseExpiresAt = <token>` 的原子条件更新校验，
 * 一旦其他 worker 认领（token 变化），stale worker 的条件更新命中 0 行。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type RunLeaseHandle = {
  runId: string;
  /** fencing token：本 worker 最近一次写入 DB 的租约到期时间（精确值） */
  leaseExpiresAt: Date;
  leaseMs: number;
};

export type ClaimRunLeaseInput = {
  runId: string;
  /** 允许认领的 runType 白名单（防止误吃其它队列） */
  allowedRunTypes: string[];
  leaseMs: number;
  maxAttempts: number;
  /**
   * 除 queued 外，允许"租约已过期"重新认领（crash recovery）的状态集合。
   * background_conversation 为 ["running"]；workforce_job 为 v2 活跃状态集。
   */
  reclaimableStatuses?: string[];
  /** v1 background 兼容：认领时重置 startedAt（workforce 禁用，保留 Job.startedAt） */
  resetStartedAt?: boolean;
  /** v1 background 兼容：认领时清空 errorCode/errorMessage */
  clearError?: boolean;
  now?: Date;
};

export type ClaimRunLeaseResult =
  | { ok: true; lease: RunLeaseHandle }
  | { ok: false };

/**
 * 原子认领：条件 = runType ∈ allowed ∧ attempts < maxAttempts ∧
 * ( (queued ∧ nextAttemptAt≤now) ∨ (可回收状态 ∧ leaseExpiresAt≤now) )。
 * 成功即原子写 status=running / attempts+1 / leaseExpiresAt=now+lease /
 * nextAttemptAt=null。并发认领同一 run 时最多一个成功（单条 UPDATE 语义）。
 */
export async function claimRunLease(
  input: ClaimRunLeaseInput,
): Promise<ClaimRunLeaseResult> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
  const reclaimable = input.reclaimableStatuses ?? ["running"];

  const claimed = await db.agentRun.updateMany({
    where: {
      id: input.runId,
      runType: { in: input.allowedRunTypes },
      attempts: { lt: input.maxAttempts },
      OR: [
        {
          status: "queued",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        {
          status: { in: reclaimable },
          leaseExpiresAt: { lte: now },
        },
      ],
    },
    data: {
      status: "running",
      attempts: { increment: 1 },
      leaseExpiresAt,
      nextAttemptAt: null,
      ...(input.resetStartedAt ? { startedAt: now } : {}),
      ...(input.clearError ? { errorCode: null, errorMessage: null } : {}),
    },
  });

  if (claimed.count === 0) return { ok: false };
  return {
    ok: true,
    lease: { runId: input.runId, leaseExpiresAt, leaseMs: input.leaseMs },
  };
}

/**
 * 续租（fenced）：只有 leaseExpiresAt 仍等于本 worker token 时才允许延长。
 * 返回 ok=false 表示租约已被其他 worker 接管（或 run 已离开活跃状态），
 * 调用方必须立即停止执行且不得再做任何写入。
 */
export async function renewRunLease(input: {
  lease: RunLeaseHandle;
  /** 允许续租的状态集合（离开这些状态即视为不可续） */
  activeStatuses: string[];
  now?: Date;
}): Promise<{ ok: true; lease: RunLeaseHandle } | { ok: false }> {
  const now = input.now ?? new Date();
  // 严格单调递增：新 token 必须大于旧 token，保证 token 全局唯一
  const next = new Date(
    Math.max(
      now.getTime() + input.lease.leaseMs,
      input.lease.leaseExpiresAt.getTime() + 1,
    ),
  );
  const renewed = await db.agentRun.updateMany({
    where: {
      id: input.lease.runId,
      leaseExpiresAt: input.lease.leaseExpiresAt,
      status: { in: input.activeStatuses },
    },
    data: { leaseExpiresAt: next },
  });
  if (renewed.count === 0) return { ok: false };
  return {
    ok: true,
    lease: { ...input.lease, leaseExpiresAt: next },
  };
}

/**
 * 生命周期写入防栅栏：条件更新 `WHERE id AND leaseExpiresAt = token
 * (AND status ∈ allowedFromStatuses)`。stale worker（租约已被接管）的
 * 写入命中 0 行并返回 false，调用方据此放弃后续动作。
 */
export async function fencedRunUpdate(input: {
  lease: RunLeaseHandle;
  allowedFromStatuses?: string[];
  data: Prisma.AgentRunUpdateManyMutationInput;
}): Promise<boolean> {
  const updated = await db.agentRun.updateMany({
    where: {
      id: input.lease.runId,
      leaseExpiresAt: input.lease.leaseExpiresAt,
      ...(input.allowedFromStatuses
        ? { status: { in: input.allowedFromStatuses } }
        : {}),
    },
    data: input.data,
  });
  return updated.count > 0;
}

/** fence 丢失（租约被其他 worker 接管）。捕获后必须立即停止，禁止任何后续写入。 */
export class LostLeaseError extends Error {
  readonly code = "LOST_LEASE" as const;
  constructor(runId: string) {
    super(`LOST_LEASE: run ${runId} 的租约已被其他 worker 接管`);
    this.name = "LostLeaseError";
  }
}

/**
 * 运行时 fence（传入 Runtime V2 执行路径的可选防栅栏）。
 *
 * guard() 的原子性：在同一 DB 事务内先对 AgentRun 行做
 * `WHERE id AND leaseExpiresAt = token` 的条件 no-op 更新——该更新取得行锁
 * 并断言 token 未变，随后在同一事务内执行实际写入。若其他 worker 已 claim
 * （token 变化），断言命中 0 行 → 抛 LostLeaseError，写入不会发生；若并发
 * claim 与本事务竞争同一行锁，两者被 Postgres 串行化，不存在
 * "check 通过但写入落在新 worker 之后" 的窗口。
 */
/** guard 事务参数（可选；不传 = Prisma 默认，既有调用方行为逐字不变） */
export type FenceTxOptions = {
  maxWait?: number;
  timeout?: number;
};

export type RunFence = {
  runId: string;
  /** 轻量只读校验（长 await 后先行探测；最终写入仍必须走 guard） */
  check: () => Promise<boolean>;
  /**
   * 原子防栅栏写入；fence 丢失抛 LostLeaseError。
   *
   * options（T5-P1 Segment 2）：canonical V2 package 落库实测需要
   * maxWait 10s / timeout 120s（几十条 facts/requirements 逐行写 + Neon 往返，
   * 远超 Prisma 默认 5s interactive transaction 上限）。不传即默认，
   * 因此所有既有调用方行为完全不变。
   */
  guard: <T>(
    write: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: FenceTxOptions,
  ) => Promise<T>;
};

/**
 * lease 持有者。holder.lease 在每次 renew 后被调用方更新，fence 始终使用最新 token。
 *
 * runExclusive（可选）：把「续租」与「防栅栏写入」串行化的临界区。
 * 心跳续租会推进 DB 中的 token，若恰好落在 guard 读取 token 与 guard 发出
 * 条件更新之间，guard 会拿着旧 token 命中 0 行 → 明明还持有租约却抛
 * LostLeaseError。持有心跳的调用方（Workforce processor）传入该临界区即可消除
 * 该竞态；不传时行为与既有完全一致。
 */
export type LeaseHolder = {
  lease: RunLeaseHandle;
  runExclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
};

export function createRunFence(holder: LeaseHolder): RunFence {
  const runId = holder.lease.runId;
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> =>
    holder.runExclusive ? holder.runExclusive(fn) : fn();
  return {
    runId,
    check: async () => {
      const row = await db.agentRun.findUnique({
        where: { id: runId },
        select: { leaseExpiresAt: true },
      });
      return (
        row?.leaseExpiresAt?.getTime() ===
        holder.lease.leaseExpiresAt.getTime()
      );
    },
    guard: async (write, options) =>
      exclusive(() =>
        db.$transaction(async (tx) => {
          const asserted = await tx.agentRun.updateMany({
            where: {
              id: runId,
              leaseExpiresAt: holder.lease.leaseExpiresAt,
            },
            // no-op：仅为取得行锁并断言 token 未被其他 worker 覆盖
            data: { leaseExpiresAt: holder.lease.leaseExpiresAt },
          });
          if (asserted.count === 0) throw new LostLeaseError(runId);
          return write(tx);
        }, options),
      ),
  };
}

/**
 * fence 可选的写入包装：workforce_job 传入 fence（强制防栅栏）；
 * legacy runtime_v2 不传 fence 时直接写库，行为与 Phase 2A 之前完全一致。
 */
export async function fenceGuardedWrite<T>(
  fence: RunFence | undefined,
  write: (client: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!fence) return write(db as unknown as Prisma.TransactionClient);
  return fence.guard(write);
}
