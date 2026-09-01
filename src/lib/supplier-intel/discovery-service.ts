/**
 * executeSupplierSearchRun（M1-S2，任务书 §12/§19–§21/§35–§36/§44–§47/§50）
 *
 * Phase A（短事务）：裁决 RUNNING → 持久化查询计划（queriesJson，对象化快照）→ commit。
 * Phase B（零 DB 行锁）：内部源 adapter（优先级 1–3，直接入候选池、originSource 留痕；
 *   每次候选写入自身短事务锁内裁决）→ 外部层 B（§19 双门 + §T7 策略门；网络调用期间
 *   **绝不持有 Run 行锁**——S2 新纪律 §46）。
 * Phase C（短事务/条）：信号落库逐条锁内裁决——Run 若已被并发 CANCELLED/COMPLETED，
 *   晚到 provider 结果被拒并**丢弃**（§47），不写入终态 Run。
 * 收尾：statusDetailJson 写每源执行档（PLANNED/SUCCESS/EMPTY/DISABLED/FAILED，§20
 *   防静默 no-op）；finalize 策略（§44）：任一源 SUCCESS/EMPTY → COMPLETED；
 *   全部执行源 FAILED → FAILED；Run 已终态 → 跳过收尾。
 *
 * Egress（§50）：外发查询逐条过 china-supplier-brief 的敏感词闸——命中即丢弃并记数，
 * 机密（内部价格/毛利/VENDOR_CONFIDENTIAL 记忆内容）永不进外部查询。
 */

import { containsSensitiveSupplierBriefText } from "@/lib/bid-workflow/china-supplier-brief";
import { logAudit } from "@/lib/audit/logger";
import type { SupplierIntelActor } from "./actor";
import {
  DEFAULT_DISCOVERY_ADAPTERS,
  type AdapterSourceStatus,
  type DiscoveredSignalDraft,
  type PlannedQuery,
  type SupplierDiscoveryAdapter,
} from "./adapters";
import { SupplierIntelError, isSupplierIntelError } from "./errors";
import { createSupplierCandidate } from "./evaluation-service";
import {
  INTERNAL_SOURCE_ADAPTERS,
  type SupplierSourceAdapter,
  type SupplierSourceResult,
} from "./internal-adapters";
import {
  assertProviderEnabled,
  createTavilySearchEngineProvider,
  type DiscoveryProvider,
} from "./providers";
import {
  completeSearchRun,
  failSearchRun,
  getSearchRun,
  updateRunWorkingData,
} from "./run-service";
import type { SupplierSearchBrief } from "./search-brief";
import { createDiscoveredSignal } from "./signal-service";

/** §36 外部请求预算：防 runaway cost / provider abuse */
export const EXTERNAL_BUDGET = {
  MAX_QUERIES_PER_RUN: 12,
  MAX_RESULTS_PER_QUERY: 5,
  MAX_TOTAL_RESULTS: 60,
} as const;

const INTERNAL_PRIORITY: Record<SupplierSourceResult["sourceType"], number> = {
  MEMORY: 1,
  HISTORICAL_SUCCESS: 2,
  SAVED: 3,
};

export interface SourceExecutionStatus {
  status: "PLANNED" | "SUCCESS" | "EMPTY" | "DISABLED" | "FAILED";
  count?: number;
  reason?: string | null;
  queries?: number;
  noiseFiltered?: number;
  dedupedExisting?: number;
  providerStatuses?: string[];
  note?: string | null;
}

export interface DiscoveryRunOptions {
  provider?: DiscoveryProvider;
  adapters?: SupplierDiscoveryAdapter[];
  internalAdapters?: SupplierSourceAdapter[];
  includeInternalPool?: boolean;
  internalPoolLimit?: number;
  /** 默认 true：按 §44 策略 COMPLETED/FAILED 收口；S4 组合编排时可传 false 保持 RUNNING */
  finalize?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface DiscoveryRunResult {
  runStatus: "COMPLETED" | "FAILED" | "RUNNING" | "TERMINAL_RACE";
  sources: Record<string, SourceExecutionStatus>;
  externalSkippedReason: string | null;
  queriesPlanned: PlannedQuery[];
  egressDroppedQueries: number;
  budgetTrimmedQueries: number;
  signalsCreated: number;
  signalsDeduped: number;
  lateResultsDiscarded: number;
  candidatesCreated: number;
  candidatesDeduped: number;
}

/** 计划期：外部查询计划（预算 + egress 过滤），纯函数便于测试 */
export function buildExternalQueryPlan(
  brief: SupplierSearchBrief,
  adapters: SupplierDiscoveryAdapter[],
): { plans: Map<string, PlannedQuery[]>; egressDropped: number; budgetTrimmed: number } {
  const plans = new Map<string, PlannedQuery[]>();
  let egressDropped = 0;
  let budgetTrimmed = 0;
  let total = 0;
  for (const adapter of adapters) {
    const raw = adapter.buildQueryPlan(brief);
    const safe: PlannedQuery[] = [];
    for (const q of raw) {
      // §50：外发查询绝不携带敏感内部信息（复用全库唯一 egress 分级器的词闸）
      if (containsSensitiveSupplierBriefText(q.query)) {
        egressDropped += 1;
        continue;
      }
      if (total >= EXTERNAL_BUDGET.MAX_QUERIES_PER_RUN) {
        budgetTrimmed += 1;
        continue;
      }
      safe.push(q);
      total += 1;
    }
    plans.set(adapter.platform, safe);
  }
  return { plans, egressDropped, budgetTrimmed };
}

export async function executeSupplierSearchRun(
  actor: SupplierIntelActor,
  runId: string,
  opts?: DiscoveryRunOptions,
): Promise<DiscoveryRunResult> {
  const run = await getSearchRun(actor, runId);
  if (!run) throw new SupplierIntelError("NOT_FOUND", "搜索运行不存在");
  if (run.status !== "RUNNING") {
    throw new SupplierIntelError(
      "RUN_NOT_RUNNING",
      `发现只能在 RUNNING 的 Run 中执行（当前 ${run.status}）`,
    );
  }
  const brief = run.briefSnapshotJson as unknown as SupplierSearchBrief;
  const env = opts?.env ?? process.env;
  const provider = opts?.provider ?? createTavilySearchEngineProvider({ env });
  const adapters = opts?.adapters ?? DEFAULT_DISCOVERY_ADAPTERS;
  const internalAdapters = opts?.internalAdapters ?? INTERNAL_SOURCE_ADAPTERS;

  const sources: Record<string, SourceExecutionStatus> = {};
  const result: DiscoveryRunResult = {
    runStatus: "RUNNING",
    sources,
    externalSkippedReason: null,
    queriesPlanned: [],
    egressDroppedQueries: 0,
    budgetTrimmedQueries: 0,
    signalsCreated: 0,
    signalsDeduped: 0,
    lateResultsDiscarded: 0,
    candidatesCreated: 0,
    candidatesDeduped: 0,
  };

  // ── Phase A：计划 + 快照（短事务；不做任何网络）─────────────
  const externalAvailable = provider.isAvailable(env);
  if (externalAvailable) assertProviderEnabled(provider); // T7 fail-closed：策略不合规=硬错
  const { plans, egressDropped, budgetTrimmed } = buildExternalQueryPlan(brief, adapters);
  result.egressDroppedQueries = egressDropped;
  result.budgetTrimmedQueries = budgetTrimmed;
  result.queriesPlanned = [...plans.values()].flat();
  if (!externalAvailable) {
    result.externalSkippedReason =
      "externalSearch=DISABLED（TENDER_EXTERNAL_INTEL_ENABLED + TAVILY_API_KEY 双门未开）——零出站，仅内部源";
  }
  for (const a of internalAdapters) sources[a.id] = { status: "PLANNED" };
  for (const a of adapters) {
    sources[a.platform] = externalAvailable
      ? { status: "PLANNED", queries: plans.get(a.platform)?.length ?? 0 }
      : { status: "DISABLED", reason: "TENDER_EXTERNAL_INTEL_ENABLED=false 或缺 TAVILY_API_KEY" };
  }
  await updateRunWorkingData(actor, runId, { queries: result.queriesPlanned });
  await logAudit({
    userId: actor.userId,
    orgId: actor.orgId,
    projectId: run.projectId,
    action: "supplier_intel.search.plan_created",
    targetType: "supplier_search_run",
    targetId: runId,
    afterData: {
      queries: result.queriesPlanned.length,
      egressDropped,
      budgetTrimmed,
      externalAvailable,
    },
  });

  // ── Phase B-1：内部源（优先级 1–3；候选写入=各自短事务锁内裁决）──
  if (opts?.includeInternalPool !== false) {
    const seenSuppliers = new Map<string, SupplierSourceResult>();
    for (const adapter of internalAdapters) {
      try {
        const found = await adapter.search(brief, { actor, limit: opts?.internalPoolLimit });
        for (const r of found) {
          const prev = seenSuppliers.get(r.supplierId);
          if (!prev || INTERNAL_PRIORITY[r.sourceType] < INTERNAL_PRIORITY[prev.sourceType]) {
            seenSuppliers.set(r.supplierId, r);
          }
        }
        sources[adapter.id] = { status: found.length > 0 ? "SUCCESS" : "EMPTY", count: found.length };
      } catch (err) {
        sources[adapter.id] = {
          status: "FAILED",
          reason: err instanceof Error ? err.message.slice(0, 300) : String(err),
        };
      }
    }
    for (const r of seenSuppliers.values()) {
      try {
        await createSupplierCandidate(actor, {
          searchRunId: runId,
          supplierId: r.supplierId,
          originSource: r.sourceType,
        });
        result.candidatesCreated += 1;
      } catch (err) {
        if (isSupplierIntelError(err, "DUPLICATE_CANDIDATE")) {
          result.candidatesDeduped += 1;
          continue;
        }
        if (isSupplierIntelError(err, "RUN_NOT_RUNNING") || isSupplierIntelError(err, "RUN_IMMUTABLE")) {
          result.runStatus = "TERMINAL_RACE"; // 并发终态：停止写入（§47）
          result.lateResultsDiscarded += 1;
          break;
        }
        throw err;
      }
    }
  }

  // ── Phase B-2：外部层 B（网络期间零 DB 行锁，§46）─────────────
  const externalOutcomes: Array<{ platform: string; drafts: DiscoveredSignalDraft[] }> = [];
  if (externalAvailable && result.runStatus !== "TERMINAL_RACE") {
    let totalResults = 0;
    for (const adapter of adapters) {
      const plan = plans.get(adapter.platform) ?? [];
      const planAdapter: SupplierDiscoveryAdapter = {
        platform: adapter.platform,
        buildQueryPlan: () => plan,
        discover: adapter.discover,
      };
      const outcome = await planAdapter.discover(brief, provider);
      if (!outcome.ok) {
        sources[adapter.platform] = { status: "FAILED", reason: `${outcome.code}: ${outcome.message}` };
        continue;
      }
      let drafts = outcome.drafts;
      if (totalResults + drafts.length > EXTERNAL_BUDGET.MAX_TOTAL_RESULTS) {
        drafts = drafts.slice(0, Math.max(0, EXTERNAL_BUDGET.MAX_TOTAL_RESULTS - totalResults));
      }
      totalResults += drafts.length;
      externalOutcomes.push({ platform: adapter.platform, drafts });
      sources[adapter.platform] = {
        status: outcome.sourceStatus as AdapterSourceStatus,
        count: drafts.length,
        queries: outcome.plan.length,
        noiseFiltered: outcome.noiseFiltered,
        providerStatuses: outcome.providerStatuses,
        reason: outcome.failureReason,
        note: outcome.note,
      };
    }
  }

  // ── Phase C：晚到结果落库（逐条短事务锁内裁决；终态即丢弃，§47）──
  for (const { platform, drafts } of externalOutcomes) {
    if (result.runStatus === "TERMINAL_RACE") {
      result.lateResultsDiscarded += drafts.length;
      continue;
    }
    let deduped = 0;
    for (let i = 0; i < drafts.length; i++) {
      try {
        const res = await createDiscoveredSignal(actor, {
          searchRunId: runId,
          platform: drafts[i].platform,
          contentUrl: drafts[i].contentUrl,
          title: drafts[i].title,
          description: drafts[i].description,
          sourceQuery: drafts[i].sourceQuery,
        });
        if (res.created) result.signalsCreated += 1;
        else {
          result.signalsDeduped += 1;
          deduped += 1;
        }
      } catch (err) {
        if (isSupplierIntelError(err, "RUN_IMMUTABLE") || isSupplierIntelError(err, "NOT_FOUND")) {
          result.runStatus = "TERMINAL_RACE";
          result.lateResultsDiscarded += drafts.length - i;
          break;
        }
        throw err;
      }
    }
    const cur = sources[platform];
    if (cur) cur.dedupedExisting = deduped;
  }

  // ── 收尾：状态档 + finalize（§20/§44）────────────────────────
  const statusDetail = {
    status: result.externalSkippedReason ? "ran_internal_only" : "ran",
    reason: result.externalSkippedReason,
    sources,
    egressDroppedQueries: result.egressDroppedQueries,
    budgetTrimmedQueries: result.budgetTrimmedQueries,
    lateResultsDiscarded: result.lateResultsDiscarded,
    at: new Date().toISOString(),
  };
  if (result.runStatus === "TERMINAL_RACE") {
    return result; // Run 已被并发收口：不写终态 Run 的任何字段（含状态档）
  }
  try {
    await updateRunWorkingData(actor, runId, { statusDetail });
  } catch (err) {
    if (isSupplierIntelError(err, "RUN_IMMUTABLE")) {
      result.runStatus = "TERMINAL_RACE";
      return result;
    }
    throw err;
  }

  const failedSources = Object.entries(sources).filter(([, s]) => s.status === "FAILED");
  for (const [name, s] of failedSources) {
    await logAudit({
      userId: actor.userId,
      orgId: actor.orgId,
      projectId: run.projectId,
      action: "supplier_intel.search.source_failed",
      targetType: "supplier_search_run",
      targetId: runId,
      afterData: { source: name, reason: s.reason ?? null },
    });
  }

  if (opts?.finalize === false) {
    result.runStatus = "RUNNING";
    return result;
  }
  const executed = Object.values(sources).filter((s) => s.status !== "DISABLED" && s.status !== "PLANNED");
  const allFailed = executed.length > 0 && executed.every((s) => s.status === "FAILED");
  try {
    if (allFailed) {
      await failSearchRun(actor, runId, "全部已执行源 FAILED", statusDetail);
      result.runStatus = "FAILED";
    } else {
      await completeSearchRun(actor, runId, statusDetail);
      result.runStatus = "COMPLETED";
    }
  } catch (err) {
    if (isSupplierIntelError(err, "INVALID_RUN_TRANSITION")) {
      result.runStatus = "TERMINAL_RACE"; // 收口竞态：对方已终态
      return result;
    }
    throw err;
  }
  return result;
}
