/**
 * 销售期间汇总（KPI-1 · OpenSpec change sales-period-summary）的类型。
 *
 * 口径唯一事实源：summary-pure.ts。看板 API、Muse sales_overview、将来的 KPI-2 叙述只认它。
 */

export type PeriodCompareKind = "prev_period" | "prev_month";

/** 范围：org = 全企业；own = 只算本人创建的报价 */
export type PeriodScope = { kind: "org" } | { kind: "own"; userId: string };

/** 组织当地日期区间 [from, to]（含两端）及其 UTC 边界 [start, end) */
export interface LocalPeriod {
  from: string;
  to: string;
  days: number;
  timezone: string;
  start: Date;
  end: Date;
}

/** 取数层交给口径层的报价行（12 个标量） */
export interface PeriodQuoteRow {
  id: string;
  opportunityId: string | null;
  createdById: string;
  status: string;
  currency: string | null;
  sentAt: Date | null;
  signedAt: Date | null;
  grandTotal: number;
  preTaxTotal: number;
  depositAmount: number | null;
  depositCollectedAt: Date | null;
  updatedAt: Date;
}

export interface PeriodTotals {
  wonCount: number;
  wonAmount: number;
  wonPreTax: number;
  quotedCount: number;
  quotedAmount: number;
  /** 成单数 / 报价数；报价数为 0 时为 null。可能 > 1（同期口径，见报告已知限制） */
  conversionRate: number | null;
  openQuotedCount: number;
  openQuotedAmount: number;
  staleOpenCount: number;
  staleOpenAmount: number;
  depositAmount: number;
  /** 本期成单中未登记定金（depositCollectedAt 为空）的数量与金额（洞察 I7） */
  wonWithoutDepositCount: number;
  wonWithoutDepositAmount: number;
  /** 落在期间内、币种不是 CAD 的报价行数（不计入任何指标） */
  nonCadExcludedCount: number;
}

export type PeriodDelta = { [K in keyof PeriodTotals]: number | null };

export interface PeriodRepRow {
  userId: string;
  name: string;
  wonCount: number;
  wonAmount: number;
  quotedCount: number;
  quotedAmount: number;
  conversionRate: number | null;
}

export interface PeriodInfo {
  from: string;
  to: string;
  days: number;
  timezone: string;
}

export interface PeriodComparison {
  kind: PeriodCompareKind;
  period: PeriodInfo;
  totals: PeriodTotals;
  delta: PeriodDelta;
}

export interface PeriodSummary {
  period: PeriodInfo;
  scope: "org" | "own";
  totals: PeriodTotals;
  comparison: PeriodComparison;
  byRep: PeriodRepRow[];
  /** 取数命中上限（20,000 行）时为 true */
  truncated: boolean;
}

export type PeriodInsightSeverity = "info" | "warn";

export interface PeriodInsight {
  code: string;
  severity: PeriodInsightSeverity;
  text: string;
  evidence: Record<string, number | string | null>;
}

/** CAL-1：期间内新建日程的来源分布（按 Google 创建时间）；日历观察开启且为全企业范围时给出 */
export interface PeriodCalendarStats {
  bySource: { qingyan: number; member: number; website: number; unknown: number };
  /** 按成员的新建数（只列新建数 > 0 的成员，新建数降序） */
  byActor?: Array<{ userId: string; name: string; bucket: "management" | "sales" | "ops" | "other" | null; created: number }>;
  /** 账本取数命中上限 */
  truncated?: boolean;
}
