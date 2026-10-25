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
  /** 计量口径，如 "style"（每款） */
  per?: string;
  note?: string;
}

export interface LeadTimeInfo {
  /** 现货样寄出天数 */
  sampleDays: number | null;
  /** 大货周期下限（天） */
  productionDays: number | null;
  /** 大货周期上限（天）；与下限相同 = 单值 */
  productionDaysMax?: number | null;
  /** 大货周期起算点，如 "pre-production sample approval" */
  productionStartsFrom?: string | null;
  customSampleDaysMin?: number | null;
  customSampleDaysMax?: number | null;
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

/**
 * MOQ：企业在 business_profile.commercialFacts.moq 里确认过参考值才 available；
 * 未配置 → unavailable（草稿写"需内部确认"）。
 */
export function getMOQ(category: string | null, policy?: RevenueSpinePolicy): KnowledgeResult<MoqInfo> {
  const moq = policy?.businessProfile.commercialFacts.moq ?? null;
  if (!moq) return unavailable("getMOQ", `MOQ 未配置（类目 ${category ?? "未知"}；revenue_spine.business_profile.commercialFacts.moq）`);
  return {
    status: "available",
    capability: "getMOQ",
    value: { quantity: moq.quantity, unit: moq.unit, per: moq.per, note: "reference value, confirmed per project" },
    source: "revenue_spine.business_profile.commercialFacts",
  };
}

/** 生产周期：大货周期区间配置过才 available；只有样品时效不算（样品时效走 samplePolicy） */
export function getLeadTime(category: string | null, policy?: RevenueSpinePolicy): KnowledgeResult<LeadTimeInfo> {
  const facts = policy?.businessProfile.commercialFacts;
  const prod = facts?.productionLeadTime ?? null;
  if (!prod) return unavailable("getLeadTime", `生产周期未配置（类目 ${category ?? "未知"}；revenue_spine.business_profile.commercialFacts.productionLeadTime）`);
  const sample = facts?.sampleLeadTime ?? null;
  return {
    status: "available",
    capability: "getLeadTime",
    value: {
      sampleDays: sample?.stockDays ?? null,
      productionDays: prod.daysMin,
      productionDaysMax: prod.daysMax,
      productionStartsFrom: prod.startsFrom,
      customSampleDaysMin: sample?.customDaysMin ?? null,
      customSampleDaysMax: sample?.customDaysMax ?? null,
      note: "reference value, confirmed per project",
    },
    source: "revenue_spine.business_profile.commercialFacts",
  };
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
    moq: getMOQ(ctx.productCategory, policy),
    leadTime: getLeadTime(ctx.productCategory, policy),
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
