/**
 * T5-P1 Segment 2 §9 — Workforce AgentRun 租约心跳（长 await 期间保活）
 *
 * 审计发现（本轮实证，非推测）：processor 只在**每个 V2 round 之前**续租一次
 * （processor.ts 的 renewRunLease）。一个 round 内部的
 * `executeRuntimeV2Tool()` / native synthesis 是单次长 await——canonical V2 推理
 * （多文档 grounding + Analyst 两遍合成）明显可能超过 WORKFORCE_LEASE_MS(180s)。
 * 租约在 await 中途过期后，另一 worker 可重新认领（reclaimableStatuses 含活跃态），
 * 本 worker 返回时 fence 断言失败 → 整轮工作作废。写安全（零双写），
 * 但长任务会永远跑不完。因此补齐同一 Runtime 的心跳。
 *
 * 纪律：
 *   - 复用既有 `renewRunLease()`（AgentRun 单一 lease system）；
 *   - 不新建 Tender 专用心跳、不新建第二套 lease；
 *   - 心跳与防栅栏写入**互斥**（见下方竞态说明）。
 *
 * 竞态（如果不互斥就会真的发生）：
 *   guard 读取 token T1 → 心跳把 DB token 推进到 T2 → guard 的条件更新
 *   `WHERE leaseExpiresAt = T1` 命中 0 行 → 明明持有租约却抛 LostLeaseError。
 *   解法：holder.runExclusive 串行化二者（Node 单线程 + promise 链即可），
 *   并在进入临界区时按 TTL 做「即时续租」，让长事务开始时总是拿到完整租约窗口。
 */

import {
  renewRunLease,
  type LeaseHolder,
  type RunLeaseHandle,
} from "@/lib/agent-runtime/lease";

/** 心跳周期 = 租约的 1/3（两次连续失败仍有一次窗口余量） */
export const LEASE_HEARTBEAT_DIVISOR = 3;
/** 进入防栅栏写入前，剩余 TTL 低于租约的该比例即先续租 */
export const LEASE_JIT_RENEW_RATIO = 0.5;

export type LeaseHeartbeat = {
  /** 传给 createRunFence 的 holder（携带互斥临界区） */
  holder: LeaseHolder;
  /** 停止心跳（必须在 slice 结束时调用；幂等） */
  stop: () => void;
  /** 续租是否已失败（租约被接管/离开活跃态） */
  lost: () => boolean;
  /** 成功续租次数（可观测/测试） */
  renewals: () => number;
  /** 手动触发一次心跳（纯测试用；生产由 timer 驱动） */
  tick: () => Promise<void>;
};

type RenewFn = typeof renewRunLease;

export function startLeaseHeartbeat(input: {
  lease: RunLeaseHandle;
  activeStatuses: string[];
  /** 默认 leaseMs / 3 */
  intervalMs?: number;
  /** 纯测试注入点（默认真实 renewRunLease） */
  renew?: RenewFn;
  /** 纯测试：不注册真实 timer */
  autoStart?: boolean;
  now?: () => number;
}): LeaseHeartbeat {
  const renew = input.renew ?? renewRunLease;
  const now = input.now ?? (() => Date.now());
  const intervalMs =
    input.intervalMs ?? Math.max(1_000, Math.floor(input.lease.leaseMs / LEASE_HEARTBEAT_DIVISOR));

  let lost = false;
  let renewals = 0;
  let stopped = false;

  const holder: LeaseHolder = { lease: input.lease };

  async function renewOnce(): Promise<void> {
    if (lost || stopped) return;
    const r = await renew({
      lease: holder.lease,
      activeStatuses: input.activeStatuses,
    });
    if (!r.ok) {
      // 租约已被接管或离开活跃态：不再尝试。holder.lease 保持旧 token，
      // 后续 fence.guard 会以 LostLeaseError 正确失败（不伪造成功）。
      lost = true;
      return;
    }
    holder.lease = r.lease;
    renewals += 1;
  }

  // —— 互斥临界区：心跳续租与防栅栏写入永不重叠 —— //
  let chain: Promise<unknown> = Promise.resolve();
  function lock<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  holder.runExclusive = <T>(fn: () => Promise<T>): Promise<T> =>
    lock(async () => {
      // 即时续租：长事务（V2 canonical 落库 timeout 120s）开始前补满租约窗口，
      // 避免"事务还没提交租约就到期"。TTL 充足时零额外写。
      const remaining = holder.lease.leaseExpiresAt.getTime() - now();
      if (remaining < holder.lease.leaseMs * LEASE_JIT_RENEW_RATIO) {
        await renewOnce();
      }
      return fn();
    });

  const timer =
    input.autoStart === false
      ? null
      : setInterval(() => {
          void lock(renewOnce);
        }, intervalMs);
  // 心跳不应阻止进程退出（cron/serverless 环境）
  (timer as unknown as { unref?: () => void } | null)?.unref?.();

  return {
    holder,
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    },
    lost: () => lost,
    renewals: () => renewals,
    tick: () => lock(renewOnce),
  };
}
