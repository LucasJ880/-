export interface MarketingEconomicsInput {
  defaultGrossMarginRate?: unknown;
  targetRoas?: unknown;
  targetRoi?: unknown;
  attributionWindowDays?: unknown;
  currency?: unknown;
  productMargins?: unknown;
}

export interface ProductMargin {
  product: string;
  grossMarginRate: number;
}

function optionalNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("经济指标必须为非负数字");
  return number;
}

function marginRate(value: unknown): number | null {
  const number = optionalNonNegative(value);
  if (number === null) return null;
  if (number > 1) throw new Error("毛利率必须在 0% 到 100% 之间");
  return number;
}

export function normalizeMarketingEconomics(input: MarketingEconomicsInput) {
  const attributionWindowDays = Number(input.attributionWindowDays ?? 90);
  if (!Number.isInteger(attributionWindowDays) || attributionWindowDays < 1 || attributionWindowDays > 365) {
    throw new Error("归因周期必须为 1–365 天");
  }
  const currency = String(input.currency || "CAD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("币种必须为 3 位代码");
  const productMargins = Array.isArray(input.productMargins)
    ? input.productMargins.slice(0, 100).map((raw) => {
        const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const product = String(row.product || "").trim().slice(0, 120);
        if (!product) throw new Error("产品毛利率必须填写产品名称");
        const grossMarginRate = marginRate(row.grossMarginRate);
        if (grossMarginRate === null) throw new Error(`请填写 ${product} 的毛利率`);
        return { product, grossMarginRate } satisfies ProductMargin;
      })
    : [];
  return {
    defaultGrossMarginRate: marginRate(input.defaultGrossMarginRate),
    targetRoas: optionalNonNegative(input.targetRoas),
    targetRoi: optionalNonNegative(input.targetRoi),
    attributionWindowDays,
    currency,
    productMargins,
  };
}

export function calculateMarketingEconomics(input: {
  revenue: number;
  adSpend: number;
  otherMarketingCost?: number;
  grossMarginRate?: number | null;
}) {
  const revenue = Math.max(0, Number(input.revenue) || 0);
  const adSpend = Math.max(0, Number(input.adSpend) || 0);
  const otherMarketingCost = Math.max(0, Number(input.otherMarketingCost) || 0);
  const totalMarketingCost = adSpend + otherMarketingCost;
  const grossMarginRate = input.grossMarginRate == null
    ? null
    : Math.min(1, Math.max(0, Number(input.grossMarginRate) || 0));
  const attributedGrossProfit = grossMarginRate == null ? null : revenue * grossMarginRate;
  const roi = attributedGrossProfit == null || totalMarketingCost <= 0
    ? null
    : (attributedGrossProfit - totalMarketingCost) / totalMarketingCost;
  const breakEvenRoas = grossMarginRate && grossMarginRate > 0 ? 1 / grossMarginRate : null;
  return {
    revenue,
    adSpend,
    otherMarketingCost,
    totalMarketingCost,
    grossMarginRate,
    attributedGrossProfit,
    roi,
    roas: adSpend > 0 ? revenue / adSpend : null,
    breakEvenRoas,
  };
}
