/**
 * 销售期间汇总口径（纯函数，零 IO）——KPI-1 / OpenSpec change sales-period-summary。
 *
 * 口径（spec sales/period-summary）：
 *   成单 = status ∈ {signed, accepted} 且 signedAt ∈ 期间；每份已签报价各计一份（同商机多份已签 = 多张合同）。
 *   报价 = sentAt ∈ 期间且 status ≠ draft；按商机分组：已签的每份都计，未签的只计 sentAt 最新一份（修订版）。
 *   在手未签 = 报价所计集合中 signedAt 为空、status ∈ {sent, viewed}；其中 sentAt 距 now 超过 14 天为 stale。
 *   定金 = depositCollectedAt ∈ 期间的 depositAmount 之和（按行）。
 *   只汇总 CAD；非 CAD 行数计入 nonCadExcludedCount。归档客户在取数层排除。
 *
 * 日期一律是组织当地的 YYYY-MM-DD 日历日；时区只在 zonedLocalToUtc 一步介入。
 */
import { nextDay, zonedLocalToUtc } from "@/lib/revenue-spine/business-days";
import { getLocalTimeParts } from "@/lib/automation/local-time";
import type {
  LocalPeriod,
  PeriodCompareKind,
  PeriodComparison,
  PeriodDelta,
  PeriodInfo,
  PeriodQuoteRow,
  PeriodRepRow,
  PeriodScope,
  PeriodSummary,
  PeriodTotals,
} from "./types";

export const MAX_PERIOD_DAYS = 366;
export const STALE_OPEN_DAYS = 14;
export const PERIOD_FETCH_CAP = 20_000;

const DAY_MS = 86_400_000;
const SIGNED_STATUSES = new Set(["signed", "accepted"]);
const OPEN_STATUSES = new Set(["sent", "viewed"]);
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── 日历日运算（不涉及时区） ─────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

function ymdParts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

function fromUtcDate(t: Date): string {
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 合法的 YYYY-MM-DD（含闰年 / 月天数校验） */
export function isValidYmd(day: unknown): day is string {
  if (typeof day !== "string" || !YMD_RE.test(day)) return false;
  const [y, m, d] = ymdParts(day);
  if (m < 1 || m > 12 || d < 1) return false;
  return fromUtcDate(new Date(Date.UTC(y, m - 1, d))) === day;
}

export function addDaysYmd(day: string, n: number): string {
  const [y, m, d] = ymdParts(day);
  return fromUtcDate(new Date(Date.UTC(y, m - 1, d + n)));
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function monthStartYmd(day: string): string {
  const [y, m] = ymdParts(day);
  return `${y}-${pad(m)}-01`;
}

/** 日历日差 to − from（天） */
export function diffDaysYmd(from: string, to: string): number {
  const [y1, m1, d1] = ymdParts(from);
  const [y2, m2, d2] = ymdParts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

/** 所在周的周一（STAT-1，Q9：一周从周一开始） */
export function weekStartYmd(day: string): string {
  const [y, m, d] = ymdParts(day);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = 周日
  return addDaysYmd(day, -((dow + 6) % 7));
}

/** 面板周预设：本周 = 本周一至今天；上周 = 上周一至上周日 */
export function weekPresetRange(today: string, which: "this_week" | "last_week"): { from: string; to: string } {
  const monday = weekStartYmd(today);
  if (which === "this_week") return { from: monday, to: today };
  return { from: addDaysYmd(monday, -7), to: addDaysYmd(monday, -1) };
}

/** 上一个自然月的同日号；日号超过该月天数时截到月末 */
export function sameDayPrevMonth(day: string): string {
  const [y, m, d] = ymdParts(day);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${pad(pm)}-${pad(Math.min(d, daysInMonth(py, pm)))}`;
}

// ── 期间 ─────────────────────────────────────────────────

export type PeriodRangeProblem = "format" | "order" | "span";

/** 期间参数校验（网页与 Muse 契约共用）：null = 合法 */
export function checkPeriodRange(from: unknown, to: unknown): PeriodRangeProblem | null {
  if (!isValidYmd(from) || !isValidYmd(to)) return "format";
  const diff = diffDaysYmd(from, to);
  if (diff < 0) return "order";
  if (diff + 1 > MAX_PERIOD_DAYS) return "span";
  return null;
}

/** 组织当地 [from, to] → UTC [start, end)；调用方须先过 checkPeriodRange */
export function periodBounds(from: string, to: string, timezone: string): LocalPeriod {
  return {
    from,
    to,
    days: diffDaysYmd(from, to) + 1,
    timezone,
    start: zonedLocalToUtc(from, 0, timezone),
    end: zonedLocalToUtc(nextDay(to), 0, timezone),
  };
}

/** 缺省期间：组织当地本月 1 日至今天 */
export function defaultPeriod(now: Date, timezone: string): LocalPeriod {
  const today = getLocalTimeParts(now, timezone).date;
  return periodBounds(monthStartYmd(today), today, timezone);
}

/** 对比期：prev_period = 紧邻之前同样天数；prev_month = 两端各退一个自然月（截到月末） */
export function comparisonPeriod(period: LocalPeriod, kind: PeriodCompareKind): LocalPeriod {
  if (kind === "prev_month") {
    return periodBounds(sameDayPrevMonth(period.from), sameDayPrevMonth(period.to), period.timezone);
  }
  return periodBounds(addDaysYmd(period.from, -period.days), addDaysYmd(period.from, -1), period.timezone);
}

export function isPeriodCompareKind(v: unknown): v is PeriodCompareKind {
  return v === "prev_period" || v === "prev_month";
}

// ── 汇总 ─────────────────────────────────────────────────

const inRange = (t: Date | null, p: LocalPeriod) => !!t && t.getTime() >= p.start.getTime() && t.getTime() < p.end.getTime();
const isCad = (row: PeriodQuoteRow) => (row.currency ?? "CAD").trim().toUpperCase() === "CAD";
const isSigned = (row: PeriodQuoteRow) => SIGNED_STATUSES.has(row.status);
const money = (n: number | null | undefined) => (Number.isFinite(n) ? (n as number) : 0);
/** 金额按分四舍五入，避免浮点累加尾差 */
const cents = (n: number) => Math.round(n * 100) / 100;
const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

/** 未签修订版里谁是"最新一份"：sentAt 大者；并列取 updatedAt 大者；再并列取 id 字典序大者 */
function newerQuote(a: PeriodQuoteRow, b: PeriodQuoteRow): PeriodQuoteRow {
  const sa = a.sentAt?.getTime() ?? 0;
  const sb = b.sentAt?.getTime() ?? 0;
  if (sa !== sb) return sa > sb ? a : b;
  const ua = a.updatedAt.getTime();
  const ub = b.updatedAt.getTime();
  if (ua !== ub) return ua > ub ? a : b;
  return a.id > b.id ? a : b;
}

interface Classified {
  won: PeriodQuoteRow[];
  quoted: PeriodQuoteRow[];
  deposits: PeriodQuoteRow[];
  nonCadExcludedCount: number;
}

function classify(rows: readonly PeriodQuoteRow[], period: LocalPeriod): Classified {
  const won: PeriodQuoteRow[] = [];
  const quoted: PeriodQuoteRow[] = [];
  const deposits: PeriodQuoteRow[] = [];
  const latestUnsigned = new Map<string, PeriodQuoteRow>();
  let nonCadExcludedCount = 0;

  for (const row of rows) {
    if (row.status === "draft") continue;
    const touches = inRange(row.signedAt, period) || inRange(row.sentAt, period) || inRange(row.depositCollectedAt, period);
    if (!touches) continue;
    if (!isCad(row)) {
      nonCadExcludedCount++;
      continue;
    }
    if (isSigned(row) && inRange(row.signedAt, period)) won.push(row);
    if (inRange(row.depositCollectedAt, period) && money(row.depositAmount) !== 0) deposits.push(row);
    if (inRange(row.sentAt, period)) {
      if (isSigned(row) || !row.opportunityId) {
        quoted.push(row);
      } else {
        const prev = latestUnsigned.get(row.opportunityId);
        latestUnsigned.set(row.opportunityId, prev ? newerQuote(prev, row) : row);
      }
    }
  }
  quoted.push(...latestUnsigned.values());
  return { won, quoted, deposits, nonCadExcludedCount };
}

function totalsOf(c: Classified, now: Date): PeriodTotals {
  const sum = (rows: PeriodQuoteRow[], pick: (r: PeriodQuoteRow) => number | null) =>
    cents(rows.reduce((s, r) => s + money(pick(r)), 0));
  const open = c.quoted.filter((r) => !r.signedAt && OPEN_STATUSES.has(r.status));
  const staleBefore = now.getTime() - STALE_OPEN_DAYS * DAY_MS;
  const stale = open.filter((r) => (r.sentAt?.getTime() ?? Infinity) < staleBefore);
  const noDeposit = c.won.filter((r) => !r.depositCollectedAt);
  return {
    wonCount: c.won.length,
    wonAmount: sum(c.won, (r) => r.grandTotal),
    wonPreTax: sum(c.won, (r) => r.preTaxTotal),
    quotedCount: c.quoted.length,
    quotedAmount: sum(c.quoted, (r) => r.grandTotal),
    conversionRate: ratio(c.won.length, c.quoted.length),
    openQuotedCount: open.length,
    openQuotedAmount: sum(open, (r) => r.grandTotal),
    staleOpenCount: stale.length,
    staleOpenAmount: sum(stale, (r) => r.grandTotal),
    depositAmount: sum(c.deposits, (r) => r.depositAmount),
    wonWithoutDepositCount: noDeposit.length,
    wonWithoutDepositAmount: sum(noDeposit, (r) => r.grandTotal),
    nonCadExcludedCount: c.nonCadExcludedCount,
  };
}

export function deltaOf(cur: PeriodTotals, prev: PeriodTotals): PeriodDelta {
  const out = {} as PeriodDelta;
  for (const key of Object.keys(cur) as (keyof PeriodTotals)[]) {
    const a = cur[key];
    const b = prev[key];
    out[key] = a === null || b === null || b === 0 ? null : (a - b) / b;
  }
  return out;
}

function byRepOf(c: Classified, scope: PeriodScope, names: ReadonlyMap<string, string>): PeriodRepRow[] {
  const reps = new Map<string, PeriodRepRow>();
  const rep = (userId: string) => {
    let r = reps.get(userId);
    if (!r) {
      r = { userId, name: names.get(userId) ?? "（已移除用户）", wonCount: 0, wonAmount: 0, quotedCount: 0, quotedAmount: 0, conversionRate: null };
      reps.set(userId, r);
    }
    return r;
  };
  if (scope.kind === "own") rep(scope.userId);
  for (const r of c.won) {
    const x = rep(r.createdById);
    x.wonCount++;
    x.wonAmount += money(r.grandTotal);
  }
  for (const r of c.quoted) {
    const x = rep(r.createdById);
    x.quotedCount++;
    x.quotedAmount += money(r.grandTotal);
  }
  return [...reps.values()]
    .map((r) => ({ ...r, wonAmount: cents(r.wonAmount), quotedAmount: cents(r.quotedAmount), conversionRate: ratio(r.wonCount, r.quotedCount) }))
    .sort((a, b) => b.wonAmount - a.wonAmount || b.quotedAmount - a.quotedAmount || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/**
 * STAT-1：某位报价创建人在期间内计入成单 / 报价的报价行（与 byRep 同一 classify，合计必然一致）。
 * 调用方负责授权；rows 可以含其他人的行（这里先按创建人过滤）。
 */
export function periodRepQuotes(
  rows: readonly PeriodQuoteRow[],
  period: LocalPeriod,
  repId: string,
): { won: PeriodQuoteRow[]; quoted: PeriodQuoteRow[] } {
  const c = classify(
    rows.filter((r) => r.createdById === repId),
    period,
  );
  return { won: c.won, quoted: c.quoted };
}

const infoOf = (p: LocalPeriod): PeriodInfo => ({ from: p.from, to: p.to, days: p.days, timezone: p.timezone });

export interface SummarizeInput {
  rows: readonly PeriodQuoteRow[];
  period: LocalPeriod;
  compare: PeriodCompareKind;
  scope: PeriodScope;
  now: Date;
  /** userId → 姓名（byRep 用） */
  names?: ReadonlyMap<string, string>;
  truncated?: boolean;
}

export interface PeriodComputation {
  summary: PeriodSummary;
  /** 上一期按人（洞察 I5 用；不进入 API 响应） */
  prevByRep: PeriodRepRow[];
}

export function summarizeSalesPeriod(input: SummarizeInput): PeriodSummary {
  return computeSalesPeriod(input).summary;
}

export function computeSalesPeriod(input: SummarizeInput): PeriodComputation {
  const names = input.names ?? new Map<string, string>();
  const scoped =
    input.scope.kind === "own" ? input.rows.filter((r) => r.createdById === (input.scope as { userId: string }).userId) : input.rows;
  const cur = classify(scoped, input.period);
  const cmpPeriod = comparisonPeriod(input.period, input.compare);
  const prev = classify(scoped, cmpPeriod);
  const totals = totalsOf(cur, input.now);
  const prevTotals = totalsOf(prev, input.now);
  const comparison: PeriodComparison = {
    kind: input.compare,
    period: infoOf(cmpPeriod),
    totals: prevTotals,
    delta: deltaOf(totals, prevTotals),
  };
  return {
    summary: {
      period: infoOf(input.period),
      scope: input.scope.kind,
      totals,
      comparison,
      byRep: byRepOf(cur, input.scope, names),
      truncated: input.truncated ?? false,
    },
    prevByRep: byRepOf(prev, input.scope, names),
  };
}

/** 销售范围（决定 B）剔除金额键：所有以 Amount 或 PreTax 结尾的键 */
export function stripAmountKeys<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/(Amount|PreTax)$/.test(k)) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}
