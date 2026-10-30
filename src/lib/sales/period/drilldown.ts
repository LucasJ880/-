/**
 * STAT-1：按人报价明细取数（spec sales/period-summary"按人报价明细"）。
 *
 * 分组用 summary-pure 的 periodRepQuotes（与 byRep 同一 classify），所以条数与金额小计必然等于按人表；
 * 取数复用 loadPeriodQuoteRows，范围限定为该创建人；展示字段（单号、客户、价表版本）另按 ID 查一次。
 * 调用方负责授权（本人范围只能查自己）。
 */
import { db } from "@/lib/db";
import { readPricelistVersion } from "@/lib/blinds/pricelist-version";
import { loadPeriodQuoteRows } from "./load";
import { periodRepQuotes } from "./summary-pure";
import type { LocalPeriod, PeriodInfo, PeriodQuoteRow } from "./types";

export const DRILLDOWN_ROW_CAP = 500;
export type DrilldownKind = "won" | "quoted";

export function isDrilldownKind(v: unknown): v is DrilldownKind {
  return v === "won" || v === "quoted";
}

export interface DrilldownQuote {
  quoteId: string;
  orderNumber: string | null;
  customerName: string;
  sentAt: string | null;
  signedAt: string | null;
  grandTotal: number;
  status: string;
  /** PRICE-1：报价表单记下的价表版本；老报价为 null */
  pricelistVersion: string | null;
}

export interface PeriodRepQuotesResponse {
  period: PeriodInfo;
  repId: string;
  name: string;
  /** kind 只要另一组时为 null */
  won: DrilldownQuote[] | null;
  quoted: DrilldownQuote[] | null;
  /** 与按人表同口径的全量小计（不受 500 行截断影响） */
  totals: { wonCount: number; wonAmount: number; quotedCount: number; quotedAmount: number };
  truncated: boolean;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const amount = (rows: PeriodQuoteRow[]) => cents(rows.reduce((s, r) => s + (Number.isFinite(r.grandTotal) ? r.grandTotal : 0), 0));
const time = (d: Date | null) => d?.getTime() ?? 0;

export async function loadPeriodRepQuotes(params: {
  orgId: string;
  repId: string;
  period: LocalPeriod;
  kind?: DrilldownKind | null;
}): Promise<PeriodRepQuotesResponse> {
  const { rows, truncated: fetchTruncated } = await loadPeriodQuoteRows({
    orgId: params.orgId,
    scope: { kind: "own", userId: params.repId },
    start: params.period.start,
    end: params.period.end,
  });
  const groups = periodRepQuotes(rows, params.period, params.repId);
  const won = [...groups.won].sort((a, b) => time(b.signedAt) - time(a.signedAt) || (a.id < b.id ? -1 : 1));
  const quoted = [...groups.quoted].sort((a, b) => time(b.sentAt) - time(a.sentAt) || (a.id < b.id ? -1 : 1));
  const wantWon = params.kind !== "quoted";
  const wantQuoted = params.kind !== "won";
  const shownWon = wantWon ? won.slice(0, DRILLDOWN_ROW_CAP) : [];
  const shownQuoted = wantQuoted ? quoted.slice(0, DRILLDOWN_ROW_CAP) : [];

  const ids = [...new Set([...shownWon, ...shownQuoted].map((r) => r.id))];
  const [details, user] = await Promise.all([
    ids.length
      ? db.salesQuote.findMany({
          where: { id: { in: ids }, orgId: params.orgId },
          select: { id: true, orderNumber: true, formDataJson: true, customer: { select: { name: true } } },
        })
      : Promise.resolve([]),
    db.user.findUnique({ where: { id: params.repId }, select: { name: true, email: true } }),
  ]);
  const byId = new Map(details.map((d) => [d.id, d]));
  const view = (r: PeriodQuoteRow): DrilldownQuote => {
    const d = byId.get(r.id);
    return {
      quoteId: r.id,
      orderNumber: d?.orderNumber ?? null,
      customerName: d?.customer?.name ?? "",
      sentAt: r.sentAt?.toISOString() ?? null,
      signedAt: r.signedAt?.toISOString() ?? null,
      grandTotal: r.grandTotal,
      status: r.status,
      pricelistVersion: readPricelistVersion(d?.formDataJson ?? null),
    };
  };

  return {
    period: { from: params.period.from, to: params.period.to, days: params.period.days, timezone: params.period.timezone },
    repId: params.repId,
    name: user?.name || user?.email || "（已移除用户）",
    won: wantWon ? shownWon.map(view) : null,
    quoted: wantQuoted ? shownQuoted.map(view) : null,
    totals: { wonCount: won.length, wonAmount: amount(won), quotedCount: quoted.length, quotedAmount: amount(quoted) },
    truncated:
      fetchTruncated || (wantWon && won.length > DRILLDOWN_ROW_CAP) || (wantQuoted && quoted.length > DRILLDOWN_ROW_CAP),
  };
}
