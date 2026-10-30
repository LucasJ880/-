/**
 * 期间汇总的确定性洞察（规则表，零 LLM）——KPI-1 / spec sales/period-summary"确定性洞察"。
 *
 * 只读期间汇总的数字；同样输入同样输出。阈值集中在下面，改阈值不改代码路径。
 * scope = "org" 的规则在销售本人范围永不出现（I5 / I6 含他人信息；I8 / I9 是企业级日程数据）。
 */
import { formatSalesMoney } from "@/lib/sales/home/formatters";
import type {
  PeriodCalendarStats,
  PeriodInsight,
  PeriodInsightSeverity,
  PeriodRepRow,
  PeriodSummary,
} from "./types";

export const INSIGHT_THRESHOLDS = {
  /** I1 / I2：环比变化达 ±20% */
  deltaRatio: 0.2,
  /** I3：超 14 天未签金额占在手 30% 以上，或条数达 5 */
  staleAmountShare: 0.3,
  staleCount: 5,
  /** I4：报价数达 10 且转化率低于 30% */
  lowConversionMinQuoted: 10,
  lowConversionRate: 0.3,
  /** I6：单人成单金额占全企业 60% 以上，且企业成单数达 5 */
  concentrationShare: 0.6,
  concentrationMinWon: 5,
  /** I7：已签未登记定金达 3 份 */
  missingDepositCount: 3,
  /** I9：网站预约占新建日程 40% 以上 */
  websiteShare: 0.4,
} as const;

const T = INSIGHT_THRESHOLDS;

export interface InsightInput {
  summary: PeriodSummary;
  /** 上一期按人（I5） */
  prevByRep: readonly PeriodRepRow[];
  /** CAL-1 交付前为 null */
  calendar: PeriodCalendarStats | null;
}

interface InsightRule {
  code: string;
  scope: "org" | "any";
  /** 命中时返回 { severity, text, evidence }，否则 null */
  evaluate(input: InsightInput): Omit<PeriodInsight, "code"> | null;
}

const pct = (r: number) => `${r >= 0 ? "+" : ""}${Math.round(r * 1000) / 10}%`;
const share = (r: number) => `${Math.round(r * 1000) / 10}%`;
const cmpLabel = (s: PeriodSummary) => (s.comparison.kind === "prev_month" ? "上月同期" : "上一期");
const sev = (up: boolean): PeriodInsightSeverity => (up ? "info" : "warn");

function deltaRule(code: string, field: "wonAmount" | "quotedAmount", label: string): InsightRule {
  return {
    code,
    scope: "any",
    evaluate({ summary }) {
      const cur = summary.totals[field];
      const prev = summary.comparison.totals[field];
      if (prev <= 0) return null;
      const r = (cur - prev) / prev;
      if (Math.abs(r) < T.deltaRatio) return null;
      return {
        severity: sev(r > 0),
        text: `本期${label} ${formatSalesMoney(cur)}，较${cmpLabel(summary)} ${pct(r)}`,
        evidence: { [field]: cur, [`prev${field[0].toUpperCase()}${field.slice(1)}`]: prev, ratio: r },
      };
    },
  };
}

export const INSIGHT_RULES: readonly InsightRule[] = [
  deltaRule("I1_WON_DELTA", "wonAmount", "成单"),
  deltaRule("I2_QUOTED_DELTA", "quotedAmount", "报出"),
  {
    code: "I3_STALE_OPEN",
    scope: "any",
    evaluate({ summary: { totals: t } }) {
      if (t.staleOpenCount === 0) return null;
      const amountShare = t.openQuotedAmount > 0 ? t.staleOpenAmount / t.openQuotedAmount : 0;
      if (amountShare < T.staleAmountShare && t.staleOpenCount < T.staleCount) return null;
      return {
        severity: "warn",
        text: `${t.staleOpenCount} 份报价报出超过 14 天未签，合计 ${formatSalesMoney(t.staleOpenAmount)}`,
        evidence: { staleOpenCount: t.staleOpenCount, staleOpenAmount: t.staleOpenAmount, openQuotedAmount: t.openQuotedAmount },
      };
    },
  },
  {
    code: "I4_LOW_CONVERSION",
    scope: "any",
    evaluate({ summary: { totals: t } }) {
      if (t.quotedCount < T.lowConversionMinQuoted || t.conversionRate === null || t.conversionRate >= T.lowConversionRate) return null;
      return {
        severity: "warn",
        text: `转化率 ${share(t.conversionRate)}（${t.wonCount}/${t.quotedCount}），低于 ${share(T.lowConversionRate)}`,
        evidence: { wonCount: t.wonCount, quotedCount: t.quotedCount, conversionRate: t.conversionRate },
      };
    },
  },
  {
    code: "I5_REP_SILENT",
    scope: "org",
    evaluate({ summary, prevByRep }) {
      const current = new Map(summary.byRep.map((r) => [r.userId, r.quotedCount]));
      const silent = prevByRep.filter((p) => p.quotedCount > 0 && (current.get(p.userId) ?? 0) === 0);
      if (silent.length === 0) return null;
      const list = silent.map((p) => `${p.name}（${cmpLabel(summary)} ${p.quotedCount} 份）`).join("、");
      return {
        severity: "warn",
        text: `${list} 本期没有报出报价`,
        evidence: { reps: silent.map((p) => p.userId).join(","), count: silent.length },
      };
    },
  },
  {
    code: "I6_REP_CONCENTRATION",
    scope: "org",
    evaluate({ summary: { totals: t, byRep } }) {
      if (t.wonCount < T.concentrationMinWon || t.wonAmount <= 0 || byRep.length === 0) return null;
      const top = byRep[0];
      const r = top.wonAmount / t.wonAmount;
      if (r < T.concentrationShare) return null;
      return {
        severity: "info",
        text: `成单金额 ${share(r)} 集中在 ${top.name}`,
        evidence: { userId: top.userId, repWonAmount: top.wonAmount, wonAmount: t.wonAmount, share: r },
      };
    },
  },
  {
    code: "I7_DEPOSIT_GAP",
    scope: "any",
    evaluate({ summary: { totals: t } }) {
      if (t.wonWithoutDepositCount < T.missingDepositCount) return null;
      return {
        severity: "warn",
        text: `${t.wonWithoutDepositCount} 份已签报价未登记定金，合计 ${formatSalesMoney(t.wonWithoutDepositAmount)}`,
        evidence: { wonWithoutDepositCount: t.wonWithoutDepositCount, wonWithoutDepositAmount: t.wonWithoutDepositAmount },
      };
    },
  },
  {
    code: "I8_CAL_UNKNOWN",
    scope: "org",
    evaluate({ calendar }) {
      const n = calendar?.bySource.unknown ?? 0;
      if (n <= 0) return null;
      return { severity: "info", text: `${n} 条日程来源不明，请补归因规则`, evidence: { unknown: n } };
    },
  },
  {
    code: "I9_CAL_WEBSITE_SHARE",
    scope: "org",
    evaluate({ calendar }) {
      if (!calendar) return null;
      const b = calendar.bySource;
      const total = b.qingyan + b.member + b.website + b.unknown;
      if (total <= 0) return null;
      const r = b.website / total;
      if (r < T.websiteShare) return null;
      return { severity: "info", text: `网站自主预约占新建日程 ${share(r)}，共 ${b.website} 条`, evidence: { website: b.website, total, share: r } };
    },
  },
];

/** 按规则表顺序产出洞察；销售本人范围跳过 scope = "org" 的规则 */
export function buildPeriodInsights(input: InsightInput): PeriodInsight[] {
  const own = input.summary.scope === "own";
  const out: PeriodInsight[] = [];
  for (const rule of INSIGHT_RULES) {
    if (own && rule.scope === "org") continue;
    const hit = rule.evaluate(input);
    if (hit) out.push({ code: rule.code, ...hit });
  }
  return out;
}
