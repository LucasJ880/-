/**
 * 期间汇总取数与组装（KPI-1）。网页 GET /api/sales/period-summary 与 Muse sales_overview 共用。
 *
 * 一次 findMany 覆盖本期 ∪ 对比期；口径全部在 summary-pure.ts，洞察在 insights.ts。
 * 排除草稿与已归档客户；own 范围只取本人创建的报价。
 */
import { db } from "@/lib/db";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { buildPeriodInsights } from "./insights";
import {
  PERIOD_FETCH_CAP,
  checkPeriodRange,
  comparisonPeriod,
  computeSalesPeriod,
  defaultPeriod,
  isPeriodCompareKind,
  periodBounds,
  type PeriodRangeProblem,
} from "./summary-pure";
import type {
  LocalPeriod,
  PeriodCalendarStats,
  PeriodCompareKind,
  PeriodComparison,
  PeriodInfo,
  PeriodInsight,
  PeriodQuoteRow,
  PeriodRepRow,
  PeriodScope,
  PeriodTotals,
} from "./types";

export interface PeriodSummaryResponse {
  period: PeriodInfo;
  scope: "org" | "own";
  totals: PeriodTotals;
  comparison: PeriodComparison;
  byRep: PeriodRepRow[];
  insights: PeriodInsight[];
  /** CAL-1 交付前固定为 null */
  calendar: PeriodCalendarStats | null;
  /** KPI-2 交付前固定为 null */
  narrative: null;
  truncated: boolean;
}

export type PeriodParamsResult =
  | { ok: true; period: LocalPeriod; compare: PeriodCompareKind }
  | { ok: false; problem: PeriodRangeProblem | "compare" };

/** 解析期间参数：from / to 都缺省 → 当地本月 1 日至今天；只给一个 → format 错误 */
export function resolvePeriodParams(
  input: { from?: string | null; to?: string | null; compare?: string | null },
  now: Date,
  timezone: string,
): PeriodParamsResult {
  const compare = input.compare ?? "prev_period";
  if (!isPeriodCompareKind(compare)) return { ok: false, problem: "compare" };
  const from = input.from || null;
  const to = input.to || null;
  if (!from && !to) return { ok: true, period: defaultPeriod(now, timezone), compare };
  const problem = checkPeriodRange(from, to);
  if (problem) return { ok: false, problem };
  return { ok: true, period: periodBounds(from as string, to as string, timezone), compare };
}

const quoteSelect = {
  id: true,
  opportunityId: true,
  createdById: true,
  status: true,
  currency: true,
  sentAt: true,
  signedAt: true,
  grandTotal: true,
  preTaxTotal: true,
  depositAmount: true,
  depositCollectedAt: true,
  updatedAt: true,
} as const;

/** 一次取出与 [start, end) 任一时间字段相交的报价行（12 个标量） */
export async function loadPeriodQuoteRows(params: {
  orgId: string;
  scope: PeriodScope;
  start: Date;
  end: Date;
}): Promise<{ rows: PeriodQuoteRow[]; truncated: boolean }> {
  const window = { gte: params.start, lt: params.end };
  const found = await db.salesQuote.findMany({
    where: {
      orgId: params.orgId,
      status: { not: "draft" },
      customer: { archivedAt: null },
      ...(params.scope.kind === "own" ? { createdById: params.scope.userId } : {}),
      OR: [{ signedAt: window }, { sentAt: window }, { depositCollectedAt: window }],
    },
    select: quoteSelect,
    orderBy: { id: "asc" },
    take: PERIOD_FETCH_CAP + 1,
  });
  return { rows: found.slice(0, PERIOD_FETCH_CAP), truncated: found.length > PERIOD_FETCH_CAP };
}

async function loadNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name || u.email]));
}

/** 组装完整期间汇总（取数 + 口径 + 洞察）。调用方负责授权与参数解析。 */
export async function buildSalesPeriodResponse(params: {
  orgId: string;
  scope: PeriodScope;
  period: LocalPeriod;
  compare: PeriodCompareKind;
  now?: Date;
}): Promise<PeriodSummaryResponse> {
  const now = params.now ?? new Date();
  const cmp = comparisonPeriod(params.period, params.compare);
  const start = new Date(Math.min(params.period.start.getTime(), cmp.start.getTime()));
  const end = new Date(Math.max(params.period.end.getTime(), cmp.end.getTime()));
  const { rows, truncated } = await loadPeriodQuoteRows({ orgId: params.orgId, scope: params.scope, start, end });
  const ids = params.scope.kind === "own" ? [params.scope.userId] : [...new Set(rows.map((r) => r.createdById))];
  const names = await loadNames(ids);
  const { summary, prevByRep } = computeSalesPeriod({
    rows,
    period: params.period,
    compare: params.compare,
    scope: params.scope,
    now,
    names,
    truncated,
  });
  const calendar: PeriodCalendarStats | null = null;
  return {
    period: summary.period,
    scope: summary.scope,
    totals: summary.totals,
    comparison: summary.comparison,
    byRep: summary.byRep,
    insights: buildPeriodInsights({ summary, prevByRep, calendar }),
    calendar,
    narrative: null,
    truncated: summary.truncated,
  };
}

/** 网页与 Muse 共用：按组织时区解析参数后组装 */
export async function loadSalesPeriodSummary(params: {
  orgId: string;
  scope: PeriodScope;
  from?: string | null;
  to?: string | null;
  compare?: string | null;
  now?: Date;
}): Promise<{ ok: true; data: PeriodSummaryResponse } | { ok: false; problem: PeriodRangeProblem | "compare" }> {
  const now = params.now ?? new Date();
  const timezone = await loadOrgTimezone(params.orgId);
  const parsed = resolvePeriodParams(params, now, timezone);
  if (!parsed.ok) return parsed;
  const data = await buildSalesPeriodResponse({ orgId: params.orgId, scope: params.scope, period: parsed.period, compare: parsed.compare, now });
  return { ok: true, data };
}
