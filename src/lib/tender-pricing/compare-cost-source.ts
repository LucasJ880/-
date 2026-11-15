/**
 * FLOW-H2 报价表助手的成本来源：比价矩阵里人工选定那一家的落地价（纯函数 + 开关）
 *
 * - 只认人工「选定」（InquiryItem.isSelected），不用推荐或最低价代替（D1）。
 * - 只建议：按钮只把数字填进输入框，人保存才生效；读取永远按已保存的计算（D4）。
 * - 来源由服务端重新取数、重新换算核对，到分相同才记「来自比价矩阵」，否则记手填（D5）。
 * - 矩阵变了只提示，不自动改（D6）。
 * - 落地价不含 GST/HST（进口 GST/HST 可抵扣，不计入成本）；毛利率按售价，成本加成只做换算显示（D7）。
 */

import type { LandedBreakdown } from "@/lib/tender-rfq/landed-cost";

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * TENDER_PRICING_COMPARE_SOURCE_ENABLED：未设 / 为假 = 关。
 * TENDER_PRICING_COMPARE_SOURCE_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时报价表助手接口不返回 compareCost、保存时不看来源声明，卡片与原来相同。
 */
export function isPricingCompareSourceEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_PRICING_COMPARE_SOURCE_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_PRICING_COMPARE_SOURCE_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isPricingCompareSourceEnabledForOrg(orgId: string | null | undefined): boolean {
  return isPricingCompareSourceEnabledForOrgWithEnv(orgId, process.env);
}

/* ---------------------------------- 类型 ---------------------------------- */

export type QuantityBasis = { kind: "quoted_total" } | { kind: "first_tier"; qty: number } | { kind: "unknown" };

type SuggestionIdentity = {
  inquiryId: string;
  inquiryItemId: string;
  roundNumber: number;
  supplierName: string;
  /** 选定所在轮次之后、还没有选定的轮次 */
  laterUnselectedRounds: number[];
};

export type CompareCostSuggestion =
  | ({
      status: "ok";
      landedCadTotal: number;
      quantityBasis: QuantityBasis;
      breakdown: LandedBreakdown;
      assumptions: string[];
      warnings: string[];
    } & SuggestionIdentity)
  | ({ status: "unconvertible"; reasons: string[] } & SuggestionIdentity)
  | { status: "none_selected"; messageZh: string };

export type OurCostSource =
  | {
      kind: "rfq_compare";
      inquiryId: string;
      inquiryItemId: string;
      roundNumber: number;
      supplierName: string;
      landedCadTotal: number;
      quantityBasis: QuantityBasis;
      recordedAt: string;
    }
  | { kind: "manual"; recordedAt: string };

/** 保存请求里客户端能说的只有这一条：用的是哪一条报价。金额、轮次、组织一律由服务端重新取 */
export type OurCostSourceClaim = { kind: "rfq_compare"; inquiryItemId: string };

export const NONE_SELECTED_ZH = "比价矩阵里还没有选定供应商——在询价区给一家已报价的供应商点「选定」后，这里会给出它的落地价。";
export const GST_EXCLUDED_ZH = "不含 GST/HST（进口 GST/HST 可抵扣，不计入成本）";
export const FILL_BUTTON_ZH = "用这个作为我方成本";
export const MARGIN_ON_PRICE_ZH = "毛利率（按售价）";
export const TARGET_MARGIN_ON_PRICE_ZH = "目标毛利率 %（按售价）";

/** 到分相同 */
export const CENT_TOLERANCE = 0.005;
export const sameCents = (a: number, b: number) => Math.abs(a - b) < CENT_TOLERANCE;

/* ---------------------------------- 规则 ---------------------------------- */

export function quantityBasisOf(quotedTotalPrice: number | null, firstTierQty: number | null): QuantityBasis {
  if (quotedTotalPrice != null) return { kind: "quoted_total" };
  if (firstTierQty != null && firstTierQty > 0) return { kind: "first_tier", qty: firstTierQty };
  return { kind: "unknown" };
}

export function quantityBasisZh(b: QuantityBasis): string {
  if (b.kind === "quoted_total") return "按供应商报价总价";
  if (b.kind === "first_tier") return `按询价单首档数量 ${b.qty.toLocaleString("en-CA")}`;
  return "数量口径未知";
}

export function money2(n: number): string {
  return n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 逐项（只列加了的项）；DDP 写明已含在报价里 */
export function breakdownLinesZh(b: LandedBreakdown): string[] {
  const lines = [`货值 ${money2(b.goods)}`];
  if (b.feesIncludedInQuote) {
    lines.push("运费、关税等已含在供应商报价里（DDP）");
    return lines;
  }
  const items: Array<[keyof LandedBreakdown, string]> = [
    ["inland", "出口内陆运费"],
    ["freight", "海运（国际运费）"],
    ["insurance", "保险"],
    ["duty", "关税"],
    ["clearance", "进口清关"],
  ];
  for (const [k, label] of items) {
    const v = b[k];
    if (typeof v === "number") lines.push(`${label} ${money2(v)}`);
  }
  return lines;
}

/**
 * 服务端核对：声明的那一条必须正是当前建议的那一条（当前登录者有权访问的这个项目里、最近一轮有选定的那一条），
 * 且保存的成本与重新算出的落地价到分相同。否则 null（记为手填）。
 */
export function verifyCostSource(
  claim: OurCostSourceClaim | null | undefined,
  ourCostCad: number | null,
  suggestion: CompareCostSuggestion | null,
  now: Date,
): OurCostSource | null {
  if (!claim || claim.kind !== "rfq_compare" || typeof claim.inquiryItemId !== "string") return null;
  if (ourCostCad == null || !suggestion || suggestion.status !== "ok") return null;
  if (suggestion.inquiryItemId !== claim.inquiryItemId) return null;
  if (!sameCents(ourCostCad, suggestion.landedCadTotal)) return null;
  return {
    kind: "rfq_compare",
    inquiryId: suggestion.inquiryId,
    inquiryItemId: suggestion.inquiryItemId,
    roundNumber: suggestion.roundNumber,
    supplierName: suggestion.supplierName,
    landedCadTotal: suggestion.landedCadTotal,
    quantityBasis: suggestion.quantityBasis,
    recordedAt: now.toISOString(),
  };
}

/**
 * 保存时这一次的来源：
 * - 请求没改成本 → 保留原来的来源；
 * - 成本改成空 → 没有来源；
 * - 核对通过 → 来自比价矩阵；
 * - 成本数字没变、也没有新的声明 → 保留原来的来源（只改了毛利或对手价）；
 * - 其余 → 手填。
 * 开关关闭时不看声明；成本变了就去掉原来的来源（不写新的）。
 */
export function nextCostSource(input: {
  enabled: boolean;
  costInBody: boolean;
  ourCostCad: number | null;
  prevCostCad: number | null;
  prevSource: OurCostSource | null;
  claim: OurCostSourceClaim | null | undefined;
  suggestion: CompareCostSuggestion | null;
  now: Date;
}): OurCostSource | null {
  if (!input.costInBody) return input.prevSource;
  if (input.ourCostCad == null) return null;
  const unchanged = input.prevCostCad != null && sameCents(input.ourCostCad, input.prevCostCad);
  if (!input.enabled) return unchanged ? input.prevSource : null;
  const verified = verifyCostSource(input.claim, input.ourCostCad, input.suggestion, input.now);
  if (verified) return verified;
  if (unchanged && !input.claim) return input.prevSource;
  return { kind: "manual", recordedAt: input.now.toISOString() };
}

/** 已保存的成本来自比价矩阵、而现在的建议换了一条或落地价变了 → 一句提示；手填的不提示 */
export function staleNoteZh(source: OurCostSource | null, savedCostCad: number | null, suggestion: CompareCostSuggestion | null): string | null {
  if (!source || source.kind !== "rfq_compare" || savedCostCad == null || !suggestion) return null;
  const was = `已保存的我方成本 ${money2(savedCostCad)} CAD 是按 ${source.supplierName} 第 ${source.roundNumber} 轮的落地价记的`;
  if (suggestion.status === "ok") {
    if (suggestion.inquiryItemId === source.inquiryItemId && sameCents(suggestion.landedCadTotal, source.landedCadTotal)) return null;
    return `比价矩阵现在是 ${suggestion.supplierName} 第 ${suggestion.roundNumber} 轮 ${money2(suggestion.landedCadTotal)} CAD；${was}，没有自动更新。`;
  }
  if (suggestion.status === "unconvertible") {
    return `比价矩阵现在选定的 ${suggestion.supplierName} 第 ${suggestion.roundNumber} 轮换算不出落地价；${was}，没有自动更新。`;
  }
  return `比价矩阵现在没有选定的供应商；${was}，没有自动更新。`;
}

/** 毛利率（按售价）m% → 等价的成本加成率 m ÷ (1 − m)；只做换算显示 */
export function markupPctFromMarginPct(marginPct: number | null): number | null {
  if (marginPct == null || !Number.isFinite(marginPct) || marginPct < 0 || marginPct >= 100) return null;
  return Math.round((marginPct / (100 - marginPct)) * 1000) / 10;
}

export function markupHintZh(marginPct: number | null): string | null {
  const k = markupPctFromMarginPct(marginPct);
  return k == null ? null : `相当于成本加成 ${k}%`;
}

export function laterRoundsZh(rounds: number[]): string | null {
  if (rounds.length === 0) return null;
  return `之后还有第 ${rounds.join("、")} 轮，尚未选定`;
}

/** 读取 summaryJson.pricingInputs.ourCostSource（防御：形状不对就当没有） */
export function readCostSource(v: unknown): OurCostSource | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "manual" && typeof o.recordedAt === "string") return { kind: "manual", recordedAt: o.recordedAt };
  if (
    o.kind === "rfq_compare" &&
    typeof o.inquiryId === "string" &&
    typeof o.inquiryItemId === "string" &&
    typeof o.roundNumber === "number" &&
    typeof o.supplierName === "string" &&
    typeof o.landedCadTotal === "number" &&
    typeof o.recordedAt === "string"
  ) {
    const qb = o.quantityBasis as QuantityBasis | undefined;
    return {
      kind: "rfq_compare",
      inquiryId: o.inquiryId,
      inquiryItemId: o.inquiryItemId,
      roundNumber: o.roundNumber,
      supplierName: o.supplierName,
      landedCadTotal: o.landedCadTotal,
      quantityBasis: qb && typeof qb === "object" && "kind" in qb ? qb : { kind: "unknown" },
      recordedAt: o.recordedAt,
    };
  }
  return null;
}

export function readCostClaim(v: unknown): OurCostSourceClaim | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return o.kind === "rfq_compare" && typeof o.inquiryItemId === "string" && o.inquiryItemId.length > 0 && o.inquiryItemId.length <= 64
    ? { kind: "rfq_compare", inquiryItemId: o.inquiryItemId }
    : null;
}

/** 接口返回给卡片的那一项 */
export type CompareCostView = {
  suggestion: CompareCostSuggestion;
  source: OurCostSource | null;
  staleNoteZh: string | null;
};

/** 按钮：只改表单里的成本，并记下这次声明用的是哪一条；不保存 */
export function fillFromSuggestion<F extends { cost: string }>(
  form: F,
  suggestion: CompareCostSuggestion,
): { form: F; claim: OurCostSourceClaim } | null {
  if (suggestion.status !== "ok") return null;
  return {
    form: { ...form, cost: String(suggestion.landedCadTotal) },
    claim: { kind: "rfq_compare", inquiryItemId: suggestion.inquiryItemId },
  };
}
