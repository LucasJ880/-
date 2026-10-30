/**
 * PERM-5a：会计视图查询（只读；显式 select，不取成本明细与客户个人资料）
 */

import { db } from "@/lib/db";
import { loadDiscountsDto } from "@/lib/blinds/discount-settings";
import { isFinancialControlEnabled } from "@/lib/project-finance/flags";
import { getTenderFinancialSummary } from "@/lib/project-finance/profitability";
import { groupCommissionBySales, summarizeCommission, type SalesCommissionRow } from "./commission";
import type { Period } from "./period";

// ── 成交与提成 ──────────────────────────────────────────────

export type SalesSummaryRow = SalesCommissionRow & { salesName: string };

export async function loadSalesSummary(orgId: string, month: Period) {
  const [settings, quotes] = await Promise.all([
    loadDiscountsDto(orgId),
    db.salesQuote.findMany({
      where: { orgId, status: "signed", signedAt: { gte: month.start, lt: month.end } },
      select: { createdById: true, grandTotal: true, items: { select: { price: true, costPrice: true } } },
    }),
  ]);
  const rate = settings.commissionRate;
  const groups = groupCommissionBySales(quotes, rate);
  const names = await userNames(groups.map((g) => g.salesUserId));
  const bySales: SalesSummaryRow[] = groups.map((g) => ({ ...g, salesName: names.get(g.salesUserId) ?? "（已移除用户）" }));
  return { month: month.label, commissionRate: rate, totals: summarizeCommission(quotes, rate), bySales };
}

// ── 报价过程 ────────────────────────────────────────────────

export const QUOTE_LIST_LIMIT = 500;

export async function loadQuoteProcess(orgId: string, month: Period, filter: { salesId?: string | null; status?: string | null }) {
  const rows = await db.salesQuote.findMany({
    where: {
      orgId,
      createdAt: { gte: month.start, lt: month.end },
      ...(filter.salesId ? { createdById: filter.salesId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: QUOTE_LIST_LIMIT,
    select: {
      id: true,
      version: true,
      status: true,
      createdById: true,
      preTaxTotal: true,
      grandTotal: true,
      totalMsrp: true,
      finalDiscountPct: true,
      specialPromotion: true,
      currency: true,
      promotionApprovalStatus: true,
      promotionApprovalRatio: true,
      promotionApprovalMaxPct: true,
      promotionApprovalRequestedAt: true,
      promotionApprovedAt: true,
      promotionApprovedById: true,
      promotionRejectedAt: true,
      promotionRejectedById: true,
      signedAt: true,
      createdAt: true,
      customer: { select: { name: true } },
    },
  });
  const names = await userNames(
    rows.flatMap((r) => [r.createdById, r.promotionApprovedById, r.promotionRejectedById]).filter((x): x is string => !!x),
  );
  return {
    month: month.label,
    limit: QUOTE_LIST_LIMIT,
    quotes: rows.map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      customerName: r.customer?.name ?? null,
      salesUserId: r.createdById,
      salesName: names.get(r.createdById) ?? null,
      preTaxTotal: r.preTaxTotal,
      grandTotal: r.grandTotal,
      totalMsrp: r.totalMsrp,
      finalDiscountPct: r.finalDiscountPct,
      specialPromotion: r.specialPromotion,
      currency: r.currency,
      approval: {
        status: r.promotionApprovalStatus,
        ratio: r.promotionApprovalRatio,
        maxPct: r.promotionApprovalMaxPct,
        requestedAt: r.promotionApprovalRequestedAt,
        approvedAt: r.promotionApprovedAt,
        approvedByName: r.promotionApprovedById ? names.get(r.promotionApprovedById) ?? null : null,
        rejectedAt: r.promotionRejectedAt,
        rejectedByName: r.promotionRejectedById ? names.get(r.promotionRejectedById) ?? null : null,
      },
      signedAt: r.signedAt,
      createdAt: r.createdAt,
    })),
  };
}

// ── 项目结算 ────────────────────────────────────────────────

export const PROJECT_LIST_LIMIT = 100;

export async function loadProjectSettlements(
  orgId: string,
  scope: "ORG" | "ASSIGNED",
  userId: string,
  quarter: Period | null,
) {
  if (!isFinancialControlEnabled()) {
    return { available: false as const, reason: "项目财务控制未启用", quarter: quarter?.label ?? null, projects: [] };
  }
  const window = quarter ? { gte: quarter.start, lt: quarter.end } : null;
  const projects = await db.project.findMany({
    where: {
      orgId,
      intakeStatus: "dispatched",
      ...(scope === "ASSIGNED"
        ? { OR: [{ ownerId: userId }, { members: { some: { userId, status: "active" } } }] }
        : {}),
      ...(window
        ? { AND: [{ OR: [{ submittedAt: window }, { submittedAt: null, createdAt: window }] }] }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: PROJECT_LIST_LIMIT,
    select: { id: true },
  });
  const out = [];
  for (const p of projects) {
    const s = await getTenderFinancialSummary(orgId, p.id);
    // 只取汇总字段：不出逐笔费用 / 收据 / 付款 / 供应商明细（拍板 3）
    out.push({
      id: s.project.id,
      name: s.project.name,
      outcome: s.outcome,
      currency: s.currency,
      totalCostCad: s.totalCostCad,
      contractRevenueCad: s.revenueAvailable ? s.contractRevenueCad : null,
      recognizedRevenueCad: s.revenueAvailable ? s.recognizedRevenueCad : null,
      outstandingPayablesCad: s.settlementAvailable ? s.outstandingPayablesCad : null,
      outstandingReimbursementCad: s.settlementAvailable ? s.outstandingReimbursementCad : null,
      settlementStatus: s.settlementStatus,
      forecastProfitCad: s.forecastProfitCad,
      finalProfitCad: s.finalProfitCad,
      revenueAvailable: s.revenueAvailable,
      settlementAvailable: s.settlementAvailable,
    });
  }
  return { available: true as const, quarter: quarter?.label ?? null, limit: PROJECT_LIST_LIMIT, projects: out };
}

async function userNames(ids: readonly string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}
