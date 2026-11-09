/**
 * OPS-REV：运营中心的「全公司销售额」只读汇总（纯函数，无 DB）。
 *
 * 口径与销售期间汇总（KPI-1，summary-pure.ts）完全相同——同一份 computeSalesPeriod，范围固定全企业；
 * 只取三项：成单金额、成单数、报价金额（另带报价数与非 CAD 排除数供卡片注明口径）。
 * 结果里没有客户、报价 id、按销售员的明细：这是给运营看的「销售额」，不是销售分析。
 */

import { computeSalesPeriod, defaultPeriod, periodBounds, weekPresetRange } from "./summary-pure";
import { getLocalTimeParts } from "@/lib/automation/local-time";
import type { LocalPeriod, PeriodQuoteRow } from "./types";

export interface RevenueSummaryWindow {
  /** 组织当地日期 YYYY-MM-DD（含） */
  from: string;
  to: string;
  /** 成单金额（CAD，含税，按签约日计） */
  wonAmount: number;
  /** 成单数 */
  wonCount: number;
  /** 报价金额（CAD，按发出日计；同一商机未签的多版只算最新一版） */
  quotedAmount: number;
  quotedCount: number;
}

export interface OrgRevenueSummary {
  timezone: string;
  currency: "CAD";
  /** 本周一至今天 */
  thisWeek: RevenueSummaryWindow;
  /** 本月 1 日至今天 */
  monthToDate: RevenueSummaryWindow;
  /** 期间内币种不是 CAD、未计入金额的报价行数（取两窗口中较大者，即本月与本周的并集口径） */
  nonCadExcludedCount: number;
  /** 取数达到上限被截断（与销售期间汇总同一上限） */
  truncated: boolean;
}

/** 本周与本月至今两个窗口（组织当地日期） */
export function revenueSummaryWindows(now: Date, timezone: string): { thisWeek: LocalPeriod; monthToDate: LocalPeriod } {
  const today = getLocalTimeParts(now, timezone).date;
  const week = weekPresetRange(today, "this_week");
  return {
    thisWeek: periodBounds(week.from, week.to, timezone),
    monthToDate: defaultPeriod(now, timezone),
  };
}

/** 两个窗口合起来的取数区间 [start, end) */
export function revenueSummaryFetchRange(w: { thisWeek: LocalPeriod; monthToDate: LocalPeriod }): { start: Date; end: Date } {
  return {
    start: new Date(Math.min(w.thisWeek.start.getTime(), w.monthToDate.start.getTime())),
    end: new Date(Math.max(w.thisWeek.end.getTime(), w.monthToDate.end.getTime())),
  };
}

function windowOf(rows: readonly PeriodQuoteRow[], period: LocalPeriod, now: Date): RevenueSummaryWindow & { nonCad: number } {
  const { summary } = computeSalesPeriod({ rows, period, compare: "prev_period", scope: { kind: "org" }, now });
  const t = summary.totals;
  return {
    from: period.from,
    to: period.to,
    wonAmount: t.wonAmount,
    wonCount: t.wonCount,
    quotedAmount: t.quotedAmount,
    quotedCount: t.quotedCount,
    nonCad: t.nonCadExcludedCount,
  };
}

/** 由报价行组装运营用汇总；只输出白名单字段 */
export function buildOrgRevenueSummary(input: {
  rows: readonly PeriodQuoteRow[];
  now: Date;
  timezone: string;
  truncated: boolean;
}): OrgRevenueSummary {
  const w = revenueSummaryWindows(input.now, input.timezone);
  const { nonCad: weekNonCad, ...thisWeek } = windowOf(input.rows, w.thisWeek, input.now);
  const { nonCad: monthNonCad, ...monthToDate } = windowOf(input.rows, w.monthToDate, input.now);
  return {
    timezone: input.timezone,
    currency: "CAD",
    thisWeek,
    monthToDate,
    nonCadExcludedCount: Math.max(weekNonCad, monthNonCad),
    truncated: input.truncated,
  };
}
