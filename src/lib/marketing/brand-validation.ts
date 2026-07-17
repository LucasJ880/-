export interface MarketingBrandTruthInput {
  legalName?: unknown;
  brandName?: unknown;
  website?: unknown;
  phone?: unknown;
  addressLine?: unknown;
  city?: unknown;
  region?: unknown;
  country?: unknown;
  postalCode?: unknown;
  timezone?: unknown;
  industry?: unknown;
  products?: unknown;
  serviceAreas?: unknown;
  targetAudiences?: unknown;
  competitors?: unknown;
  forbiddenContexts?: unknown;
}

export interface BrandValidationIssue {
  field: string;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface NormalizedBrandTruth {
  legalName: string;
  brandName: string;
  website: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  timezone: string;
  industry: string;
  products: string[];
  serviceAreas: string[];
  targetAudiences: string[];
  competitors: string[];
  forbiddenContexts: string[];
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function stringList(value: unknown, maxItems = 100): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/)
      : [];
  return [...new Set(items.map((item) => text(item, 200)).filter(Boolean))].slice(0, maxItems);
}

export function validateBrandTruth(input: MarketingBrandTruthInput): {
  value: NormalizedBrandTruth;
  issues: BrandValidationIssue[];
  score: number;
  status: "valid" | "needs_review";
} {
  const value: NormalizedBrandTruth = {
    legalName: text(input.legalName),
    brandName: text(input.brandName),
    website: text(input.website) || null,
    phone: text(input.phone) || null,
    addressLine: text(input.addressLine) || null,
    city: text(input.city) || null,
    region: text(input.region) || null,
    country: text(input.country) || null,
    postalCode: text(input.postalCode) || null,
    timezone: text(input.timezone) || "America/Toronto",
    industry: text(input.industry),
    products: stringList(input.products),
    serviceAreas: stringList(input.serviceAreas),
    targetAudiences: stringList(input.targetAudiences),
    competitors: stringList(input.competitors),
    forbiddenContexts: stringList(input.forbiddenContexts),
  };

  const issues: BrandValidationIssue[] = [];
  const required: Array<[keyof NormalizedBrandTruth, string]> = [
    ["legalName", "公司正式名称"],
    ["brandName", "品牌名称"],
    ["industry", "行业"],
    ["country", "国家"],
    ["city", "主要城市"],
  ];
  for (const [field, label] of required) {
    if (!value[field]) {
      issues.push({ field, code: "required", message: `请确认${label}`, severity: "error" });
    }
  }
  if (value.products.length === 0) {
    issues.push({ field: "products", code: "required", message: "至少确认一个产品或服务", severity: "error" });
  }
  if (value.serviceAreas.length === 0) {
    issues.push({ field: "serviceAreas", code: "required", message: "至少确认一个服务地区", severity: "error" });
  }
  if (value.targetAudiences.length === 0) {
    issues.push({ field: "targetAudiences", code: "recommended", message: "建议确认目标客户，避免检测偏离", severity: "warning" });
  }
  if (value.competitors.length === 0) {
    issues.push({ field: "competitors", code: "recommended", message: "竞争对手尚未人工确认", severity: "warning" });
  }
  if (!value.addressLine || !value.phone) {
    issues.push({ field: "canonicalNap", code: "incomplete", message: "标准名称、地址、电话（NAP）不完整", severity: "warning" });
  }
  if (value.website && !/^https?:\/\//i.test(value.website)) {
    issues.push({ field: "website", code: "invalid_url", message: "网站需以 http:// 或 https:// 开头", severity: "error" });
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const score = Math.max(0, 100 - errors * 15 - warnings * 5);
  return { value, issues, score, status: errors === 0 ? "valid" : "needs_review" };
}

export interface AuditContextInput {
  geography?: unknown;
  industry?: unknown;
  product?: unknown;
  competitors?: unknown;
  query?: unknown;
}

function containsKnown(candidate: string, known: string[]): boolean {
  const normalized = candidate.toLocaleLowerCase();
  return known.some((item) => {
    const expected = item.toLocaleLowerCase();
    return normalized.includes(expected) || expected.includes(normalized);
  });
}

export function validateAuditContext(
  profile: NormalizedBrandTruth,
  context: AuditContextInput,
): BrandValidationIssue[] {
  const issues: BrandValidationIssue[] = [];
  const geography = text(context.geography);
  const industry = text(context.industry);
  const product = text(context.product);
  const competitors = stringList(context.competitors);
  const query = text(context.query, 2000).toLocaleLowerCase();

  const allowedGeographies = [...profile.serviceAreas, profile.city ?? "", profile.region ?? "", profile.country ?? ""].filter(Boolean);
  if (geography && !containsKnown(geography, allowedGeographies)) {
    issues.push({ field: "geography", code: "geography_mismatch", message: `检测地域“${geography}”不在已确认服务地区内`, severity: "error" });
  }
  if (industry && !containsKnown(industry, [profile.industry])) {
    issues.push({ field: "industry", code: "industry_mismatch", message: `检测行业“${industry}”与企业事实不一致`, severity: "error" });
  }
  if (product && !containsKnown(product, profile.products)) {
    issues.push({ field: "product", code: "product_mismatch", message: `产品“${product}”未经企业事实中心确认`, severity: "error" });
  }
  const unknownCompetitors = competitors.filter((item) => !containsKnown(item, profile.competitors));
  if (unknownCompetitors.length > 0) {
    issues.push({ field: "competitors", code: "competitor_unconfirmed", message: `竞争对手需人工确认：${unknownCompetitors.join("、")}`, severity: "error" });
  }
  for (const forbidden of profile.forbiddenContexts) {
    if (query && query.includes(forbidden.toLocaleLowerCase())) {
      issues.push({ field: "query", code: "forbidden_context", message: `检测内容命中禁止场景：${forbidden}`, severity: "error" });
    }
  }
  return issues;
}
