/**
 * 企业级 Product Marketing Context
 *
 * - 按 orgId 隔离
 * - 已确认事实存 MarketingBrandProfile.productMarketingContextJson
 * - 无确认版本时，从 BrandProfile + MarketingBrandProfile 聚合只读视图
 * - AI 只能 propose 更新，approve 后才写入
 */

import { db } from "@/lib/db";

export const MARKETING_SKILLS_SOURCE = {
  methodologySource: "coreyhaines31/marketingskills",
  sourceCommit: "67264763cb107d61749f418d081c56e5bcbc0209",
  adaptedFor: "Qingyan AgentSkill",
  runtimeDependency: false,
} as const;

export interface ProductMarketingContext {
  company: {
    name: string;
    businessModel: string;
    geographies: string[];
    languages: string[];
    industry: string;
    businessStage: string;
  };
  products: Array<{
    name: string;
    category: string;
    description: string;
    primaryUseCases: string[];
    features: string[];
    verifiedBenefits: string[];
    pricingModel: string;
    deliveryModel: string;
    limitations: string[];
    certifications: string[];
    proofPoints: string[];
  }>;
  audiences: Array<{
    segmentName: string;
    buyerTypes: string[];
    decisionMakers: string[];
    influencers: string[];
    jobsToBeDone: string[];
    painPoints: string[];
    objections: string[];
    purchaseTriggers: string[];
    preferredChannels: string[];
  }>;
  positioning: {
    category: string;
    alternatives: string[];
    differentiators: string[];
    valueProposition: string;
    reasonsToBelieve: string[];
    claimsToAvoid: string[];
  };
  brand: {
    voice: string;
    tone: string;
    approvedTerms: string[];
    prohibitedTerms: string[];
    visualGuidelines: string;
    legalDisclaimers: string[];
  };
  competition: Array<{
    name: string;
    type: "direct" | "indirect" | "alternative" | string;
    strengths: string[];
    weaknesses: string[];
    evidence: string[];
    lastVerifiedAt: string;
  }>;
  channels: string[];
  goals: string[];
  sourceReferences: string[];
  missingInformation: string[];
  lastReviewedAt: string;
  /** inferred vs verified 分层（执行时可附加） */
  status?: "confirmed" | "aggregated" | "empty";
}

export type ProductContextCompleteness = {
  score: number;
  missing: string[];
  present: string[];
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

function emptyContext(orgName: string): ProductMarketingContext {
  return {
    company: {
      name: orgName,
      businessModel: "",
      geographies: [],
      languages: [],
      industry: "",
      businessStage: "",
    },
    products: [],
    audiences: [],
    positioning: {
      category: "",
      alternatives: [],
      differentiators: [],
      valueProposition: "",
      reasonsToBelieve: [],
      claimsToAvoid: [],
    },
    brand: {
      voice: "",
      tone: "",
      approvedTerms: [],
      prohibitedTerms: [],
      visualGuidelines: "",
      legalDisclaimers: [],
    },
    competition: [],
    channels: [],
    goals: [],
    sourceReferences: [],
    missingInformation: [
      "company.businessModel",
      "products",
      "audiences",
      "positioning.valueProposition",
      "brand.tone",
    ],
    lastReviewedAt: "",
    status: "empty",
  };
}

export function validateProductMarketingContext(
  ctx: ProductMarketingContext,
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!ctx.company?.name?.trim()) issues.push("company.name 缺失");
  if (!Array.isArray(ctx.products)) issues.push("products 必须是数组");
  if (!Array.isArray(ctx.audiences)) issues.push("audiences 必须是数组");
  if (!ctx.positioning) issues.push("positioning 缺失");
  if (!ctx.brand) issues.push("brand 缺失");
  return { ok: issues.length === 0, issues };
}

export function getProductContextCompleteness(
  ctx: ProductMarketingContext,
): ProductContextCompleteness {
  const checks: Array<[string, boolean]> = [
    ["company.name", Boolean(ctx.company?.name?.trim())],
    ["company.industry", Boolean(ctx.company?.industry?.trim())],
    ["company.geographies", (ctx.company?.geographies?.length ?? 0) > 0],
    ["products", (ctx.products?.length ?? 0) > 0],
    ["audiences", (ctx.audiences?.length ?? 0) > 0],
    [
      "positioning.valueProposition",
      Boolean(ctx.positioning?.valueProposition?.trim()),
    ],
    [
      "positioning.differentiators",
      (ctx.positioning?.differentiators?.length ?? 0) > 0,
    ],
    ["brand.tone", Boolean(ctx.brand?.tone?.trim())],
    ["brand.prohibitedTerms", (ctx.brand?.prohibitedTerms?.length ?? 0) > 0],
    ["competition", (ctx.competition?.length ?? 0) > 0],
    ["sourceReferences", (ctx.sourceReferences?.length ?? 0) > 0],
  ];
  const present = checks.filter(([, ok]) => ok).map(([k]) => k);
  const missing = checks.filter(([, ok]) => !ok).map(([k]) => k);
  const score = Math.round((present.length / checks.length) * 100);
  return { score, missing, present };
}

function normalizeContext(raw: unknown, fallbackName: string): ProductMarketingContext | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const base = emptyContext(fallbackName);
  return {
    ...base,
    ...(o as Partial<ProductMarketingContext>),
    company: { ...base.company, ...(o.company as object) },
    positioning: { ...base.positioning, ...(o.positioning as object) },
    brand: { ...base.brand, ...(o.brand as object) },
    products: Array.isArray(o.products) ? (o.products as ProductMarketingContext["products"]) : [],
    audiences: Array.isArray(o.audiences) ? (o.audiences as ProductMarketingContext["audiences"]) : [],
    competition: Array.isArray(o.competition)
      ? (o.competition as ProductMarketingContext["competition"])
      : [],
    channels: asStringArray(o.channels),
    goals: asStringArray(o.goals),
    sourceReferences: asStringArray(o.sourceReferences),
    missingInformation: asStringArray(o.missingInformation),
    lastReviewedAt: String(o.lastReviewedAt ?? ""),
    status: "confirmed",
  };
}

/** 从现有品牌模型聚合（未确认 PMC 时的只读视图） */
export async function buildProductMarketingContext(
  orgId: string,
): Promise<ProductMarketingContext> {
  const [org, mbp, bp] = await Promise.all([
    db.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    }),
    db.marketingBrandProfile.findUnique({ where: { orgId } }),
    db.brandProfile.findUnique({ where: { orgId } }),
  ]);

  const name = mbp?.brandName || bp?.brandName || org?.name || "";
  const ctx = emptyContext(name);
  ctx.status = "aggregated";
  ctx.company.name = name;
  ctx.company.industry = mbp?.industry || "";
  ctx.company.geographies = asStringArray(mbp?.serviceAreasJson);
  ctx.company.languages = ["zh-CN", "en"];

  const products = asStringArray(mbp?.productsJson);
  ctx.products = products.map((p) => ({
    name: p,
    category: "",
    description: "",
    primaryUseCases: [],
    features: [],
    verifiedBenefits: [],
    pricingModel: "",
    deliveryModel: "",
    limitations: [],
    certifications: [],
    proofPoints: [],
  }));

  const audiences = asStringArray(mbp?.targetAudiencesJson);
  ctx.audiences = audiences.map((a) => ({
    segmentName: a,
    buyerTypes: [],
    decisionMakers: [],
    influencers: [],
    jobsToBeDone: [],
    painPoints: [],
    objections: [],
    purchaseTriggers: [],
    preferredChannels: [],
  }));

  ctx.positioning.valueProposition = bp?.positioning || bp?.tagline || "";
  ctx.positioning.differentiators = (bp?.sellingPoints || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  ctx.positioning.claimsToAvoid = (bp?.forbiddenClaims || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  ctx.brand.tone = bp?.toneOfVoice || "";
  ctx.brand.prohibitedTerms = asStringArray(mbp?.forbiddenContextsJson);
  ctx.competition = asStringArray(mbp?.competitorsJson).map((c) => ({
    name: c,
    type: "direct",
    strengths: [],
    weaknesses: [],
    evidence: [],
    lastVerifiedAt: "",
  }));

  const completeness = getProductContextCompleteness(ctx);
  ctx.missingInformation = completeness.missing;
  ctx.sourceReferences = [
    mbp ? "MarketingBrandProfile" : "",
    bp ? "BrandProfile" : "",
  ].filter(Boolean);
  return ctx;
}

/** 优先返回已确认 PMC，否则聚合 */
export async function getProductMarketingContext(
  orgId: string,
): Promise<ProductMarketingContext> {
  const mbp = await db.marketingBrandProfile.findUnique({
    where: { orgId },
    select: {
      brandName: true,
      productMarketingContextJson: true,
    },
  });
  if (mbp?.productMarketingContextJson) {
    const normalized = normalizeContext(
      mbp.productMarketingContextJson,
      mbp.brandName,
    );
    if (normalized) {
      const completeness = getProductContextCompleteness(normalized);
      normalized.missingInformation = Array.from(
        new Set([
          ...normalized.missingInformation,
          ...completeness.missing,
        ]),
      );
      return normalized;
    }
  }
  return buildProductMarketingContext(orgId);
}

export function formatProductMarketingContextForPrompt(
  ctx: ProductMarketingContext,
): string {
  const completeness = getProductContextCompleteness(ctx);
  return [
    `# Product Marketing Context（${ctx.status ?? "unknown"}）`,
    `company: ${ctx.company.name} | industry: ${ctx.company.industry}`,
    `completeness: ${completeness.score}/100`,
    `missing: ${completeness.missing.join(", ") || "无"}`,
    `products: ${ctx.products.map((p) => p.name).join("; ") || "（无）"}`,
    `audiences: ${ctx.audiences.map((a) => a.segmentName).join("; ") || "（无）"}`,
    `valueProposition: ${ctx.positioning.valueProposition || "（无）"}`,
    `differentiators: ${ctx.positioning.differentiators.join("; ") || "（无）"}`,
    `claimsToAvoid: ${ctx.positioning.claimsToAvoid.join("; ") || "（无）"}`,
    `brand.tone: ${ctx.brand.tone || "（无）"}`,
    `prohibitedTerms: ${ctx.brand.prohibitedTerms.join("; ") || "（无）"}`,
    `competition: ${ctx.competition.map((c) => c.name).join("; ") || "（无）"}`,
    `sources: ${ctx.sourceReferences.join("; ") || "（无）"}`,
    "",
    "规则：缺少信息时标记 missingInformation，禁止编造已验证事实。推断须单独标注。",
  ].join("\n");
}

export async function loadMarketingFoundationContext(input: {
  orgId: string;
  skillSlug?: string;
  userId?: string;
}): Promise<{
  orgId: string;
  productMarketingContext: ProductMarketingContext;
  productMarketingContextText: string;
  completeness: ProductContextCompleteness;
}> {
  const productMarketingContext = await getProductMarketingContext(input.orgId);
  const completeness = getProductContextCompleteness(productMarketingContext);
  return {
    orgId: input.orgId,
    productMarketingContext,
    productMarketingContextText: formatProductMarketingContextForPrompt(
      productMarketingContext,
    ),
    completeness,
  };
}

/** 提议更新（不写库）；真正写入走 PendingAction 批准 */
export function proposeProductMarketingContextUpdate(input: {
  current: ProductMarketingContext;
  patch: Partial<ProductMarketingContext>;
  reason: string;
}): {
  proposal: ProductMarketingContext;
  reason: string;
  diffSummary: string[];
} {
  const proposal: ProductMarketingContext = {
    ...input.current,
    ...input.patch,
    company: { ...input.current.company, ...(input.patch.company || {}) },
    positioning: {
      ...input.current.positioning,
      ...(input.patch.positioning || {}),
    },
    brand: { ...input.current.brand, ...(input.patch.brand || {}) },
    products: input.patch.products ?? input.current.products,
    audiences: input.patch.audiences ?? input.current.audiences,
    competition: input.patch.competition ?? input.current.competition,
    status: "confirmed",
    lastReviewedAt: new Date().toISOString(),
  };
  const diffSummary: string[] = [];
  if (input.patch.company) diffSummary.push("更新 company");
  if (input.patch.products) diffSummary.push("更新 products");
  if (input.patch.audiences) diffSummary.push("更新 audiences");
  if (input.patch.positioning) diffSummary.push("更新 positioning");
  if (input.patch.brand) diffSummary.push("更新 brand");
  if (input.patch.competition) diffSummary.push("更新 competition");
  return { proposal, reason: input.reason, diffSummary };
}

/** 人工批准后写入已确认 PMC */
export async function approveProductMarketingContextUpdate(input: {
  orgId: string;
  userId: string;
  context: ProductMarketingContext;
}): Promise<ProductMarketingContext> {
  const validation = validateProductMarketingContext(input.context);
  if (!validation.ok) {
    throw new Error(`PMC 校验失败: ${validation.issues.join("; ")}`);
  }
  const toStore: ProductMarketingContext = {
    ...input.context,
    status: "confirmed",
    lastReviewedAt: new Date().toISOString(),
  };
  const existing = await db.marketingBrandProfile.findUnique({
    where: { orgId: input.orgId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error(
      "当前组织尚无 MarketingBrandProfile，请先在增长中心完善品牌档案后再批准 PMC",
    );
  }
  await db.marketingBrandProfile.update({
    where: { orgId: input.orgId },
    data: {
      productMarketingContextJson: toStore as object,
      updatedById: input.userId,
    },
  });
  return toStore;
}
