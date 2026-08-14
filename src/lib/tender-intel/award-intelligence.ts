/**
 * T4 — 确定性、证据感知的组织授标情报投影（read model）。
 *
 * 输入 = canonical AwardRecord 行集（读路径已 org 隔离）；输出 = 七个高价值领域投影。
 * 铁律：
 * - 数字（金额/周期/次数）只能来自 evidence-backed 记录（HUMAN_CONFIRMED / SYSTEM_VERIFIED）；
 *   AI 可以在展示层解释数字，但绝不是数字的 source of truth。
 * - 样本不足 → UNKNOWN / INSUFFICIENT_SAMPLES，绝不因两个点就说「每年固定采购」。
 * - 不同币种绝不机械合并（NOT_COMPARABLE 纪律：按币种分组，各自统计）。
 * - 竞争对手：confirmed 仅来自 evidence-backed 记录的中标方；AI_EXTRACTED / NEEDS_REVIEW
 *   只算「竞争线索」。
 * - 没有可靠数据源的领域诚实返回 UNKNOWN / NOT_ENOUGH_DATA（禁止七域全绿造数据）。
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

export type AwardIntelligenceProjection = {
  generatedAt: string;
  basis: {
    totalRecords: number;
    evidenceBacked: number;
    aiOnly: number;
    needsReview: number;
  };
  /** 1. 历史授标（全部非撤回记录，带各自 verificationStatus，展示层据此分层） */
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
  /** 2. 买家采购模式（按买家分组的确定性计数） */
  buyerPattern: {
    status: AwardDomainStatus;
    buyers: Array<{
      buyerName: string;
      totalAwards: number;
      evidenceBacked: number;
      winners: string[];
      firstAwardDate: string | null;
      lastAwardDate: string | null;
    }>;
  };
  /** 3. 采购周期（evidence-backed 日期序列；样本 < 3 → UNKNOWN） */
  procurementCycle: {
    status: AwardDomainStatus | "LOW_CONFIDENCE";
    reason: string | null;
    sampleSize: number;
    medianIntervalDays: number | null;
    minIntervalDays: number | null;
    maxIntervalDays: number | null;
  };
  /** 4. 竞争对手信号（confirmed vs 线索，永不混淆） */
  competitorSignals: {
    status: AwardDomainStatus;
    confirmed: Array<{ name: string; awardCount: number; lastAwardDate: string | null }>;
    signals: Array<{ name: string; mentionCount: number }>;
  };
  /** 5. 价格历史（evidence-backed only；按币种分组，绝不跨币种合并） */
  pricingHistory: {
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

/**
 * 纯函数：AwardRecord 行集 → 七域投影。确定性（同输入必同输出；generatedAt 由调用方注入可选）。
 */
export function deriveAwardIntelligence(
  rows: AwardRecordRow[],
  opts?: { now?: Date },
): AwardIntelligenceProjection {
  const records = rows.filter((r) => r.status !== "RETRACTED");
  const evidence = records.filter((r) => EVIDENCE_BACKED.has(r.verificationStatus));
  const aiOnly = records.filter((r) => !EVIDENCE_BACKED.has(r.verificationStatus));

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
        contractAmount: EVIDENCE_BACKED.has(r.verificationStatus)
          ? toAmountNumber(r.contractAmount)
          : null, // 未经确认的金额不进入数字层（展示层可看原始候选，但投影不背书）
        currency: r.currency,
        scopeSummary: r.scopeSummary,
        verificationStatus: r.verificationStatus,
        recordStatus: r.status,
      })),
  };

  /* 2. 买家采购模式 */
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
          evidenceBacked: list.filter((r) => EVIDENCE_BACKED.has(r.verificationStatus)).length,
          winners: [...new Set(list.map((r) => r.winnerName))],
          firstAwardDate: iso(dates[0] ?? null),
          lastAwardDate: iso(dates[dates.length - 1] ?? null),
        };
      })
      .sort((a, b) => b.totalAwards - a.totalAwards),
  };

  /* 3. 采购周期 — evidence-backed 日期序列；确定性优先 */
  const cycleDates = evidence
    .map((r) => r.awardDate)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());
  let procurementCycle: AwardIntelligenceProjection["procurementCycle"];
  if (cycleDates.length < CYCLE_MIN_SAMPLES) {
    procurementCycle = {
      status: "UNKNOWN",
      reason: `INSUFFICIENT_SAMPLES（evidence-backed 授标日期样本 ${cycleDates.length} < ${CYCLE_MIN_SAMPLES}）`,
      sampleSize: cycleDates.length,
      medianIntervalDays: null,
      minIntervalDays: null,
      maxIntervalDays: null,
    };
  } else {
    const intervals: number[] = [];
    for (let i = 1; i < cycleDates.length; i++) {
      intervals.push(
        Math.round((cycleDates[i].getTime() - cycleDates[i - 1].getTime()) / 86_400_000),
      );
    }
    intervals.sort((a, b) => a - b);
    procurementCycle = {
      status: cycleDates.length < CYCLE_MIN_SAMPLES + 2 ? "LOW_CONFIDENCE" : "SUPPORTED",
      reason: null,
      sampleSize: cycleDates.length,
      medianIntervalDays: median(intervals),
      minIntervalDays: intervals[0],
      maxIntervalDays: intervals[intervals.length - 1],
    };
  }

  /* 4. 竞争对手：confirmed 只来自 evidence-backed */
  const confirmedByName = new Map<string, { name: string; count: number; last: Date | null }>();
  for (const r of evidence) {
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
  for (const r of aiOnly) {
    if (confirmedByName.has(r.winnerNameNormalized)) continue; // 已 confirmed 不再算线索
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

  /* 5. 价格历史 — evidence-backed only；按币种分组 */
  const priced = evidence.filter((r) => toAmountNumber(r.contractAmount) != null);
  const byCurrency = new Map<string, AwardRecordRow[]>();
  for (const r of priced) {
    const cur = r.currency?.trim() || "UNSPECIFIED";
    const list = byCurrency.get(cur) ?? [];
    list.push(r);
    byCurrency.set(cur, list);
  }
  const pricingHistory = {
    status: priced.length > 0 ? domainStatusOf(priced) : ("UNKNOWN" as AwardDomainStatus),
    reason: priced.length > 0 ? null : "NOT_ENOUGH_DATA（无 evidence-backed 金额记录）",
    byCurrency: [...byCurrency.entries()]
      .map(([currency, list]) => {
        const amounts = list
          .map((r) => toAmountNumber(r.contractAmount))
          .filter((n): n is number => n != null)
          .sort((a, b) => a - b);
        const dates = list
          .map((r) => r.awardDate)
          .filter((d): d is Date => d != null)
          .sort((a, b) => a.getTime() - b.getTime());
        return {
          currency,
          sampleSize: amounts.length,
          min: amounts[0],
          max: amounts[amounts.length - 1],
          median: median(amounts),
          from: iso(dates[0] ?? null),
          to: iso(dates[dates.length - 1] ?? null),
        };
      })
      .sort((a, b) => b.sampleSize - a.sampleSize),
  };

  return {
    generatedAt: (opts?.now ?? new Date()).toISOString(),
    basis: {
      totalRecords: records.length,
      evidenceBacked: evidence.length,
      aiOnly: aiOnly.length,
      needsReview: records.filter((r) => r.status === "NEEDS_REVIEW").length,
    },
    historicalAwards,
    buyerPattern,
    procurementCycle,
    competitorSignals,
    pricingHistory,
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
