/**
 * Revenue Spine — Factory Knowledge Interface（PART 13）
 *
 * 为下一阶段 Quotation FDE 定义 canonical capability；当前无数据源的能力返回 structured unavailable。
 * 禁止 AI 自行填值：回复草稿只引用 status === "available" 的事实。
 */

import { db } from "@/lib/db";
import type { RevenueSpinePolicy } from "./policy";

export type KnowledgeResult<T> =
  | { status: "available"; capability: string; value: T; source: string }
  | { status: "unavailable"; capability: string; reason: string };

export interface ProductCapability {
  category: string | null;
  canProduce: boolean | null;
  configuredCategories: string[];
}

export interface MoqInfo {
  quantity: number;
  unit: string;
  note?: string;
}

export interface LeadTimeInfo {
  sampleDays: number | null;
  productionDays: number | null;
  note?: string;
}

export interface CertificationInfo {
  certifications: string[];
}

export interface SamplePolicyInfo {
  available: boolean;
  note: string;
}

export interface HistoricalQuoteItem {
  source: "trade_quote" | "sales_quote";
  id: string;
  createdAt: Date;
  currency: string | null;
  total: number | null;
  status: string;
  summary: string;
}

export interface CostBasisInfo {
  unitCost: number;
  currency: string;
}

export interface FactoryKnowledgeBundle {
  productCapability: KnowledgeResult<ProductCapability>;
  moq: KnowledgeResult<MoqInfo>;
  leadTime: KnowledgeResult<LeadTimeInfo>;
  certification: KnowledgeResult<CertificationInfo>;
  samplePolicy: KnowledgeResult<SamplePolicyInfo>;
  historicalQuote: KnowledgeResult<HistoricalQuoteItem[]>;
  costBasis: KnowledgeResult<CostBasisInfo>;
}

function unavailable<T>(capability: string, reason: string): KnowledgeResult<T> {
  return { status: "unavailable", capability, reason };
}

export function getProductCapability(policy: RevenueSpinePolicy, category: string | null): KnowledgeResult<ProductCapability> {
  const configured = policy.businessProfile.productCategories;
  if (!configured.length) return unavailable("getProductCapability", "企业未配置产品类目（revenue_spine.business_profile.productCategories）");
  if (!category) {
    return {
      status: "available",
      capability: "getProductCapability",
      value: { category: null, canProduce: null, configuredCategories: configured },
      source: "revenue_spine.business_profile",
    };
  }
  return {
    status: "available",
    capability: "getProductCapability",
    value: { category, canProduce: configured.includes(category), configuredCategories: configured },
    source: "revenue_spine.business_profile",
  };
}

/** V1：无 MOQ 数据源 → unavailable（V2 Quotation Engineer 接工厂知识库） */
export function getMOQ(category: string | null): KnowledgeResult<MoqInfo> {
  return unavailable("getMOQ", `MOQ 数据源尚未接入（类目 ${category ?? "未知"}；V2 Factory Knowledge）`);
}

export function getLeadTime(category: string | null): KnowledgeResult<LeadTimeInfo> {
  return unavailable("getLeadTime", `生产周期数据源尚未接入（类目 ${category ?? "未知"}；V2 Factory Knowledge）`);
}

export function getCertification(): KnowledgeResult<CertificationInfo> {
  return unavailable("getCertification", "认证清单尚未录入（V2 Factory Knowledge）");
}

export function getSamplePolicy(policy: RevenueSpinePolicy): KnowledgeResult<SamplePolicyInfo> {
  const sp = policy.businessProfile.samplePolicy;
  if (sp.available === null) return unavailable("getSamplePolicy", "样品政策未配置（revenue_spine.business_profile.samplePolicy）");
  return {
    status: "available",
    capability: "getSamplePolicy",
    value: { available: sp.available, note: sp.note },
    source: "revenue_spine.business_profile",
  };
}

export function getCostBasis(category: string | null): KnowledgeResult<CostBasisInfo> {
  return unavailable("getCostBasis", `成本基础尚未接入（类目 ${category ?? "未知"}；V2 Cost / Margin）`);
}

/** 历史报价：TradeQuote（按线索邮箱）+ SalesQuote（按客户） */
export async function getHistoricalQuote(
  orgId: string,
  ctx: { customerId?: string | null; email?: string | null },
): Promise<KnowledgeResult<HistoricalQuoteItem[]>> {
  const items: HistoricalQuoteItem[] = [];
  if (ctx.email) {
    const tradeQuotes = await db.tradeQuote.findMany({
      where: { orgId, prospect: { contactEmail: { equals: ctx.email, mode: "insensitive" } } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, createdAt: true, currency: true, totalAmount: true, status: true, quoteNumber: true, contactName: true },
    });
    for (const q of tradeQuotes) {
      items.push({
        source: "trade_quote",
        id: q.id,
        createdAt: q.createdAt,
        currency: q.currency ?? null,
        total: q.totalAmount ?? null,
        status: q.status,
        summary: `${q.quoteNumber}${q.contactName ? " · " + q.contactName : ""}`,
      });
    }
  }
  if (ctx.customerId) {
    const salesQuotes = await db.salesQuote.findMany({
      where: { orgId, customerId: ctx.customerId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, createdAt: true, currency: true, grandTotal: true, status: true, orderNumber: true },
    });
    for (const q of salesQuotes) {
      items.push({
        source: "sales_quote",
        id: q.id,
        createdAt: q.createdAt,
        currency: q.currency,
        total: q.grandTotal,
        status: q.status,
        summary: q.orderNumber ?? "sales quote",
      });
    }
  }
  if (!items.length) return unavailable("getHistoricalQuote", "该客户无历史报价");
  return { status: "available", capability: "getHistoricalQuote", value: items, source: "TradeQuote/SalesQuote" };
}

export async function loadFactoryKnowledge(
  orgId: string,
  policy: RevenueSpinePolicy,
  ctx: { productCategory: string | null; customerId?: string | null; email?: string | null },
): Promise<FactoryKnowledgeBundle> {
  const historicalQuote = await getHistoricalQuote(orgId, { customerId: ctx.customerId, email: ctx.email }).catch(() =>
    unavailable<HistoricalQuoteItem[]>("getHistoricalQuote", "查询失败"),
  );
  return {
    productCapability: getProductCapability(policy, ctx.productCategory),
    moq: getMOQ(ctx.productCategory),
    leadTime: getLeadTime(ctx.productCategory),
    certification: getCertification(),
    samplePolicy: getSamplePolicy(policy),
    historicalQuote,
    costBasis: getCostBasis(ctx.productCategory),
  };
}

/** 供 AgentRun 事件 / 审计的紧凑摘要（不含大对象） */
export function summarizeKnowledge(b: FactoryKnowledgeBundle): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) {
    const r = v as KnowledgeResult<unknown>;
    out[k] = r.status === "available" ? `available:${r.source}` : `unavailable:${r.reason}`;
  }
  return out;
}
