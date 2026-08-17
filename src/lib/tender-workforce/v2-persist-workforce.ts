/**
 * T5-P1 Segment 2 — Workforce 侧 canonical V2 持久化（AgentRun RunFence 防栅栏）
 *
 * 与 legacy 的差别只有**凭什么能写**：
 *   legacy      TenderAnalysisRun.leaseOwner 租约（persistV2Fenced）
 *   workforce   AgentRun RunFence（本文件）——Workforce Job 的执行权真相
 *
 * 写什么完全共用 persistV2CanonicalTx（DUPLICATE_V2_PERSIST_LOGIC = 0）。
 *
 * 原子边界（§5/§11）：
 *   RunFence.guard 事务
 *     ├─ AgentRun 行锁 + fencing token 断言（token 变化 → LostLeaseError）
 *     ├─ TenderAnalysisRun 条件更新（org/project/analysisVersion/status/idempotencyKey）
 *     │   ——同一事务内取域行锁并断言归属，杜绝 findFirst→解锁→稍后写 的 TOCTOU
 *     └─ persistV2CanonicalTx（全部 canonical 写）
 *   任一断言失败 → 抛错 → 事务回滚 → ZERO canonical 写。
 *
 * 本函数**不**改 TenderAnalysisRun.status（Segment 2 不终态化，§12/§17）。
 */

import {
  persistV2CanonicalTx,
  type PersistV2Result,
  type V2PersistTx,
} from "@/lib/tender-auto-analysis/v2-persist-core";
import type { V2MappedResult } from "@/lib/tender-auto-analysis/v2-map";
import type { RunFence } from "@/lib/agent-runtime/lease";
import {
  buildWorkforceTenderIdempotencyKey,
  TENDER_AGENT_RUN_STATUS,
  TENDER_WORKFORCE_ANALYSIS_VERSION,
} from "./analysis-run-service";

/** canonical V2 package 落库实测所需事务参数（与 legacy defaultRunTx 一致） */
export const WORKFORCE_V2_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 120_000,
} as const;

/** Workforce 域归属断言失败（stale/错配 run）——零 canonical 写。 */
export class WorkforceTenderDomainOwnershipError extends Error {
  readonly code = "WORKFORCE_TENDER_DOMAIN_OWNERSHIP_FAILED" as const;
  constructor(analysisRunId: string) {
    super(
      `WORKFORCE_TENDER_DOMAIN_OWNERSHIP_FAILED: 分析记录 ${analysisRunId} 不属于当前 Workforce Job（组织/项目/版本/状态/幂等键不匹配），拒绝写入 canonical 结果`,
    );
    this.name = "WorkforceTenderDomainOwnershipError";
  }
}

export type PersistV2ForWorkforceArgs = {
  orgId: string;
  projectId: string;
  analysisRunId: string;
  jobId: string;
  mapped: V2MappedResult;
  model: string | null;
  parentRunId?: string | null;
  runFence: RunFence;
};

/** 域归属标识（canonical persist 与 cursor checkpoint 共用同一条件） */
export type WorkforceTenderOwnership = {
  orgId: string;
  projectId: string;
  analysisRunId: string;
  jobId: string;
};

/**
 * T5-P1.1 §10 —— **唯一**一份 Workforce 域归属判定。
 *
 * canonical 持久化与 cursor checkpoint 都必须用它：两处各写一份 where 条件
 * 以后必然漂移（改了一处忘另一处 = 一条写路径失去守卫）。
 *
 * 语义：同事务内条件更新取行锁并断言归属（no-op data 只为加锁），
 * 命中 0 行即抛 —— 调用方事务回滚，ZERO 写入。
 */
export async function assertWorkforceTenderOwnership(
  tx: V2PersistTx,
  own: WorkforceTenderOwnership,
): Promise<void> {
  const owned = await tx.tenderAnalysisRun.updateMany({
    where: {
      id: own.analysisRunId,
      orgId: own.orgId,
      projectId: own.projectId,
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
      status: TENDER_AGENT_RUN_STATUS.running,
      idempotencyKey: buildWorkforceTenderIdempotencyKey(own.jobId),
    },
    data: { status: TENDER_AGENT_RUN_STATUS.running },
  });
  if (owned.count === 0) {
    throw new WorkforceTenderDomainOwnershipError(own.analysisRunId);
  }
}

/**
 * T5-P1.1 §9 —— cursor checkpoint（fenced）。
 *
 * 每次 checkpoint 都要过 AgentRun RunFence + 同一份域归属断言：
 * stale worker / 错 org / 错 project / 错 job / 非 AGENT_ANALYZING → ZERO cursor 写。
 * 返回 false 表示"没写成"（advanceV2Analysis 会据此 fail-closed 停止推进）。
 */
export async function saveWorkforceV2Cursor(args: {
  own: WorkforceTenderOwnership;
  runFence: RunFence;
  cursor: unknown;
}): Promise<boolean> {
  try {
    await args.runFence.guard(async (client) => {
      const tx = client as unknown as V2PersistTx;
      await assertWorkforceTenderOwnership(tx, args.own);
      await tx.tenderAnalysisRun.update({
        where: { id: args.own.analysisRunId },
        data: { workerCursor: args.cursor as object },
      });
    }, WORKFORCE_V2_TX_OPTIONS);
    return true;
  } catch {
    // fence 丢失 / 归属不符：不抛给引擎，返回 false 让它按"租约丢失"收尾
    return false;
  }
}

export async function persistV2ForWorkforce(
  args: PersistV2ForWorkforceArgs,
): Promise<PersistV2Result> {
  return args.runFence.guard(async (client) => {
    const tx = client as unknown as V2PersistTx;

    // §10：与 cursor checkpoint 共用同一份归属判定（唯一实现）
    await assertWorkforceTenderOwnership(tx, {
      orgId: args.orgId,
      projectId: args.projectId,
      analysisRunId: args.analysisRunId,
      jobId: args.jobId,
    });

    return persistV2CanonicalTx(tx, {
      runId: args.analysisRunId,
      projectId: args.projectId,
      parentRunId: args.parentRunId ?? null,
      mapped: args.mapped,
      model: args.model,
    });
  }, WORKFORCE_V2_TX_OPTIONS);
}
