/**
 * T4 — 确定性、证据感知的组织授标情报投影（read model）。
 *
 * 输入 = canonical AwardRecord 行集（读路径已 org 隔离）；输出 = 语义正确的领域投影。
 * 铁律：
 * - 权威数字层（authoritative aggregation）只允许：status=ACTIVE 且
 *   verificationStatus ∈ {HUMAN_CONFIRMED, SYSTEM_VERIFIED} 的记录。
 *   **status=NEEDS_REVIEW（疑似重复）一律排除**——身份未裁决前不进任何数字统计/确认竞争对手。
 * - 采购周期没有「组织级」概念：不同买家/不同采购范围不可共推周期。
 *   周期只属于「同一买家 + 可比采购范围组」；无可靠可比组 → UNKNOWN，绝不输出假周期。
 * - 可比性判定是确定性字面规则（normalizeScopeKey 严格相等），绝不 fuzzy/LLM 分类。
 * - 价格分两层：
 *     historicalValues = RAW_ORG_HISTORY（原始历史合同金额，NOT_COMPARABLE_FOR_BID，
 *       只是记录汇总，绝不表述为市场价/建议价/benchmark）；
 *     comparablePricing = 仅同买家+同可比范围+同币种、样本足够的组才允许统计。
 * - 币种绝不合并；样本不足 → UNKNOWN + 原因；没有数据源的领域诚实 UNKNOWN。
 *
 * 领域状态词表（投影层）：CONFIRMED | SUPPORTED | INFERRED | UNKNOWN
 * 映射：基础数据含 HUMAN_CONFIRMED → CONFIRMED；仅 SYSTEM_VERIFIED → SUPPORTED；
 *       仅 AI_EXTRACTED/NEEDS_REVIEW → INFERRED（且不产出数字）；无数据 → UNKNOWN。
 */

import type { AwardRecordRow } from "./awards";
import { toAmountNumber } from "./awards";

export type AwardDomainStatus = "CONFIRMED" | "SUPPORTED" | "INFERRED" | "UNKNOWN";

const EVIDENCE_BACKED = new Set(["HUMAN_CONFIRMED", "SYSTEM_VERIFIED"]);
const CYCLE_MIN_SAMPLES = 3;
const CYCLE_LOW_CONFIDENCE_BELOW = 5;
const PRICE_MIN_COMPARABLE_SAMPLES = 3;
const SCOPE_KEY_MIN_LENGTH = 4;

/**
 * 可比范围键：确定性字面规则（小写 + 非字母数字/汉字折叠为单空格 + trim）。
 * 只有字面同范围描述才会落入同组——规则稳定、可复现、零语义猜测。
 * 过短/缺失 → null（该记录不可比）。
 */
export function normalizeScopeKey(scopeSummary: string | null | undefined): string | null {
  const s = (scopeSummary ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim();
  return s.length >= SCOPE_KEY_MIN_LENGTH ? s : null;
}

export type BuyerCycleProjection = {
  status: "SUPPORTED" | "LOW_CONFIDENCE" | "UNKNOWN";
  reason: string | null;
  /** 参与计算的可比范围组键（展示层可据此说明口径）；UNKNOWN 时为 null */
  comparableScopeKey: string | null;
  sampleSize: number;
  medianIntervalDays: number | null;
  minIntervalDays: number | null;
  maxIntervalDays: number | null;
};

export type AwardIntelligenceProjection = {
  generatedAt: string;
  basis: {
    totalRecords: number;
    /** 权威数字层基数：ACTIVE + evidence-backed（NEEDS_REVIEW 已排除） */
    authoritative: number;
    aiOnly: number;
    needsReview: number;
  };
  /** 1. 历史授标（全部非撤回记录；仅权威记录金额进入数字层） */
  historicalAwards: {
    status: AwardDomainStatus;
    records: Array<{
      id: string;
      buyerName: string | null;
      winnerName: string;
      solicitationNumber: string | null;
      awardDate: string | null;
      contractAmount: number | null;
      currency: string | null;
      scopeSummary: string | null;
      verificationStatus: string;
      recordStatus: string;
    }>;
  };
  /** 2. 买家采购模式 + 每买家周期（周期只属于买家×可比范围组，绝无组织级周期） */
  buyerPattern: {
    status: AwardDomainStatus;
    buyers: Array<{
      buyerName: string;
      totalAwards: number;
      authoritative: number;
      winners: string[];
      firstAwardDate: string | null;
      lastAwardDate: string | null;
      cycle: BuyerCycleProjection;
    }>;
  };
  /** 3. 竞争对手信号（confirmed 仅来自权威记录；NEEDS_REVIEW/AI 均只算线索） */
  competitorSignals: {
    status: AwardDomainStatus;
    confirmed: Array<{ name: string; awardCount: number; lastAwardDate: string | null }>;
    signals: Array<{ name: string; mentionCount: number }>;
  };
  /** 4. 原始历史合同金额（RAW_ORG_HISTORY：记录汇总，绝非可对标价格） */
  historicalValues: {
    label: "RAW_ORG_HISTORY";
    comparability: "NOT_COMPARABLE_FOR_BID";
    status: AwardDomainStatus;
    reason: string | null;
    byCurrency: Array<{
      currency: string;
      sampleSize: number;
      min: number;
      max: number;
      median: number;
      from: string | null;
      to: string | null;
    }>;
  };
  /** 5. 可比价格（仅 买家×可比范围×币种 组内、样本≥3 才统计；否则 UNKNOWN） */
  comparablePricing: {
    status: AwardDomainStatus;
    reason: string | null;
    groups: Array<{
      buyerName: string;
      comparableScopeKey: string;
      currency: string;
      sampleSize: number;
      min: number;
      max: number;
      median: number;
      from: string | null;
      to: string | null;
    }>;
  };
  /** 6. 可比项目（本轮无可靠数据源 → 诚实 UNKNOWN） */
  comparableProjects: { status: "UNKNOWN"; reason: string };
  /** 7. 供应链（M3 未接 → 诚实 UNKNOWN） */
  supplyChain: { status: "UNKNOWN"; reason: string };
};

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function domainStatusOf(records: AwardRecordRow[]): AwardDomainStatus {
  if (records.length === 0) return "UNKNOWN";
  if (records.some((r) => r.verificationStatus === "HUMAN_CONFIRMED")) return "CONFIRMED";
  if (records.some((r) => r.verificationStatus === "SYSTEM_VERIFIED")) return "SUPPORTED";
  return "INFERRED";
}

/** 权威数字层过滤：ACTIVE + evidence-backed（NEEDS_REVIEW/RETRACTED/AI-only 全排除） */
function isAuthoritative(r: AwardRecordRow): boolean {
  return r.status === "ACTIVE" && EVIDENCE_BACKED.has(r.verificationStatus);
}

/** 买家×可比范围组的周期投影（确定性；无可靠组 → UNKNOWN） */
function deriveBuyerCycle(buyerRows: AwardRecordRow[]): BuyerCycleProjection {
  const unknown = (reason: string): BuyerCycleProjection => ({
    status: "UNKNOWN",
    reason,
    comparableScopeKey: null,
    sampleSize: 0,
    medianIntervalDays: null,
    minIntervalDays: null,
    maxIntervalDays: null,
  });
  const authoritative = buyerRows.filter(isAuthoritative);
  if (authoritative.length === 0) return unknown("INSUFFICIENT_COMPARABLE_DATA（无权威记录）");

  // 按可比范围组分桶（scopeKey 为 null 的记录不可比，不入任何组）
  const groups = new Map<string, AwardRecordRow[]>();
  for (const r of authoritative) {
    const key = normalizeScopeKey(r.scopeSummary);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  if (groups.size === 0) {
    return unknown("NOT_COMPARABLE（记录缺少可比范围描述，无法建立同类采购序列）");
  }

  // 取含日期最多的可比组；不足样本门槛 → UNKNOWN（宁可 UNKNOWN，不要假周期）
  let bestKey: string | null = null;
  let bestDates: Date[] = [];
  for (const [key, list] of groups) {
    const dates = list
      .map((r) => r.awardDate)
      .filter((d): d is Date => d != null)
      .sort((a, b) => a.getTime() - b.getTime());
    if (dates.length > bestDates.length) {
      bestKey = key;
      bestDates = dates;
    }
  }
  if (bestDates.length < CYCLE_MIN_SAMPLES) {
    return unknown(
      `INSUFFICIENT_COMPARABLE_DATA（最大可比组日期样本 ${bestDates.length} < ${CYCLE_MIN_SAMPLES}）`,
    );
  }
  const intervals: number[] = [];
  for (let i = 1; i < bestDates.length; i++) {
    intervals.push(Math.round((bestDates[i].getTime() - bestDates[i - 1].getTime()) / 86_400_000));
  }
  intervals.sort((a, b) => a - b);
  return {
    status: bestDates.length < CYCLE_LOW_CONFIDENCE_BELOW ? "LOW_CONFIDENCE" : "SUPPORTED",
    reason: null,
    comparableScopeKey: bestKey,
    sampleSize: bestDates.length,
    medianIntervalDays: median(intervals),
    minIntervalDays: intervals[0],
    maxIntervalDays: intervals[intervals.length - 1],
  };
}

/**
 * 纯函数：AwardRecord 行集 → 语义正确投影。确定性（同输入必同输出）。
 */
export function deriveAwardIntelligence(
  rows: AwardRecordRow[],
  opts?: { now?: Date },
): AwardIntelligenceProjection {
  const records = rows.filter((r) => r.status !== "RETRACTED");
  const authoritative = records.filter(isAuthoritative);
  const aiOnly = records.filter((r) => !EVIDENCE_BACKED.has(r.verificationStatus));
  const needsReview = records.filter((r) => r.status === "NEEDS_REVIEW");

  /* 1. 历史授标 */
  const historicalAwards = {
    status: domainStatusOf(records),
    records: [...records]
      .sort((a, b) => (b.awardDate?.getTime() ?? 0) - (a.awardDate?.getTime() ?? 0))
      .map((r) => ({
        id: r.id,
        buyerName: r.buyerNameRaw,
        winnerName: r.winnerName,
        solicitationNumber: r.solicitationNumber,
        awardDate: iso(r.awardDate),
        // 仅权威记录（ACTIVE + evidence-backed）的金额进入数字层；
        // NEEDS_REVIEW/AI-only 的金额不背书（展示层可看原始候选，投影不给数）
        contractAmount: isAuthoritative(r) ? toAmountNumber(r.contractAmount) : null,
        currency: r.currency,
        scopeSummary: r.scopeSummary,
        verificationStatus: r.verificationStatus,
        recordStatus: r.status,
      })),
  };

  /* 2. 买家采购模式 + 每买家周期 */
  const byBuyer = new Map<string, AwardRecordRow[]>();
  for (const r of records) {
    if (!r.buyerNameNormalized) continue;
    const list = byBuyer.get(r.buyerNameNormalized) ?? [];
    list.push(r);
    byBuyer.set(r.buyerNameNormalized, list);
  }
  const buyerPattern = {
    status: domainStatusOf(records.filter((r) => r.buyerNameNormalized)),
    buyers: [...byBuyer.values()]
      .map((list) => {
        const dates = list
          .map((r) => r.awardDate)
          .filter((d): d is Date => d != null)
          .sort((a, b) => a.getTime() - b.getTime());
        return {
          buyerName: list[0].buyerNameRaw ?? "",
          totalAwards: list.length,
          authoritative: list.filter(isAuthoritative).length,
          winners: [...new Set(list.map((r) => r.winnerName))],
          firstAwardDate: iso(dates[0] ?? null),
          lastAwardDate: iso(dates[dates.length - 1] ?? null),
          cycle: deriveBuyerCycle(list),
        };
      })
      .sort((a, b) => b.totalAwards - a.totalAwards),
  };

  /* 3. 竞争对手：confirmed 只来自权威记录；NEEDS_REVIEW 记录只算线索 */
  const confirmedByName = new Map<string, { name: string; count: number; last: Date | null }>();
  for (const r of authoritative) {
    const cur = confirmedByName.get(r.winnerNameNormalized) ?? {
      name: r.winnerName,
      count: 0,
      last: null,
    };
    cur.count += 1;
    if (r.awardDate && (!cur.last || r.awardDate > cur.last)) cur.last = r.awardDate;
    confirmedByName.set(r.winnerNameNormalized, cur);
  }
  const signalByName = new Map<string, { name: string; count: number }>();
  for (const r of records) {
    if (isAuthoritative(r)) continue;
    if (confirmedByName.has(r.winnerNameNormalized)) continue;
    const cur = signalByName.get(r.winnerNameNormalized) ?? { name: r.winnerName, count: 0 };
    cur.count += 1;
    signalByName.set(r.winnerNameNormalized, cur);
  }
  const competitorSignals = {
    status: domainStatusOf(records),
    confirmed: [...confirmedByName.values()]
      .map((v) => ({ name: v.name, awardCount: v.count, lastAwardDate: iso(v.last) }))
      .sort((a, b) => b.awardCount - a.awardCount),
    signals: [...signalByName.values()]
      .map((v) => ({ name: v.name, mentionCount: v.count }))
      .sort((a, b) => b.mentionCount - a.mentionCount),
  };

  /* 4. 原始历史金额（RAW_ORG_HISTORY；权威记录 only；币种分组；绝非可对标价格） */
  const priced = authoritative.filter((r) => toAmountNumber(r.contractAmount) != null);
  const byCurrency = new Map<string, AwardRecordRow[]>();
  for (const r of priced) {
    const cur = r.currency?.trim() || "UNSPECIFIED";
    const list = byCurrency.get(cur) ?? [];
    list.push(r);
    byCurrency.set(cur, list);
  }
  const currencyStats = (list: AwardRecordRow[]) => {
    const amounts = list
      .map((r) => toAmountNumber(r.contractAmount))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    const dates = list
      .map((r) => r.awardDate)
      .filter((d): d is Date => d != null)
      .sort((a, b) => a.getTime() - b.getTime());
    return {
      sampleSize: amounts.length,
      min: amounts[0],
      max: amounts[amounts.length - 1],
      median: median(amounts),
      from: iso(dates[0] ?? null),
      to: iso(dates[dates.length - 1] ?? null),
    };
  };
  const historicalValues = {
    label: "RAW_ORG_HISTORY" as const,
    comparability: "NOT_COMPARABLE_FOR_BID" as const,
    status: priced.length > 0 ? domainStatusOf(priced) : ("UNKNOWN" as AwardDomainStatus),
    reason: priced.length > 0 ? null : "NOT_ENOUGH_DATA（无权威金额记录）",
    byCurrency: [...byCurrency.entries()]
      .map(([currency, list]) => ({ currency, ...currencyStats(list) }))
      .sort((a, b) => b.sampleSize - a.sampleSize),
  };

  /* 5. 可比价格：买家×可比范围×币种 组内、样本≥门槛 才统计 */
  const priceGroups = new Map<string, { buyerName: string; scopeKey: string; currency: string; list: AwardRecordRow[] }>();
  for (const r of priced) {
    if (!r.buyerNameNormalized) continue;
    const scopeKey = normalizeScopeKey(r.scopeSummary);
    if (!scopeKey) continue;
    const currency = r.currency?.trim() || "UNSPECIFIED";
    const key = `${r.buyerNameNormalized} ${scopeKey} ${currency}`;
    const g = priceGroups.get(key) ?? {
      buyerName: r.buyerNameRaw ?? "",
      scopeKey,
      currency,
      list: [],
    };
    g.list.push(r);
    priceGroups.set(key, g);
  }
  const qualifiedGroups = [...priceGroups.values()]
    .filter((g) => g.list.length >= PRICE_MIN_COMPARABLE_SAMPLES)
    .map((g) => ({
      buyerName: g.buyerName,
      comparableScopeKey: g.scopeKey,
      currency: g.currency,
      ...currencyStats(g.list),
    }))
    .sort((a, b) => b.sampleSize - a.sampleSize);
  const comparablePricing = {
    status: qualifiedGroups.length > 0 ? domainStatusOf(priced) : ("UNKNOWN" as AwardDomainStatus),
    reason:
      qualifiedGroups.length > 0
        ? null
        : "INSUFFICIENT_COMPARABLE_DATA（无 买家×可比范围×币种 组达到样本门槛；历史金额仅作原始记录参考）",
    groups: qualifiedGroups,
  };

  return {
    generatedAt: (opts?.now ?? new Date()).toISOString(),
    basis: {
      totalRecords: records.length,
      authoritative: authoritative.length,
      aiOnly: aiOnly.length,
      needsReview: needsReview.length,
    },
    historicalAwards,
    buyerPattern,
    competitorSignals,
    historicalValues,
    comparablePricing,
    comparableProjects: {
      status: "UNKNOWN",
      reason: "NOT_ENOUGH_DATA（可比项目数据源本轮未接入；禁止编数据）",
    },
    supplyChain: {
      status: "UNKNOWN",
      reason: "NOT_ENOUGH_DATA（供应链/海关数据源 M3 未接入）",
    },
  };
}
