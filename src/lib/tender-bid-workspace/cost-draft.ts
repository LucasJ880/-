/**
 * TI-4b 成本草稿（纯函数）
 *
 * 成本输入不落库（存储位置待定），界面把草稿存在浏览器本地；这里定义草稿的形状、
 * 本地存储键，以及把草稿组装成成本核算请求的规则：
 * - 没填报价的行不进请求（接口会把它们作为「缺供应商报价」显示在核算表里）；
 * - 非加元币种的汇率、来源、日期取自草稿的汇率表；
 * - 关税只对进口行带上；本地行不带关税与国际运费。
 */
import type { CostSheetRequest } from "./contract";

export const COST_DRAFT_VERSION = 1 as const;
export function costDraftStorageKey(projectId: string): string {
  return `qy.bidWorkspace.costDraft.${projectId}`;
}

export type CostDraftLine = {
  sourcing: "IMPORT" | "DOMESTIC";
  unitPrice: string;
  basis: "PER_PIECE" | "PER_TENDER_UOM";
  currency: string;
  evidenceKind: "SIGNED_QUOTE" | "PLATFORM_LISTED" | "RETAIL_PRICE" | "ESTIMATE";
  dutyRatePct: string;
  hsCode: string;
  origin: string;
  dutySourceRef: string;
  dutyAsOf: string;
  freightCad: string;
  localDeliveryCad: string;
  otherCad: string;
};

export type CostDraft = {
  version: typeof COST_DRAFT_VERSION;
  lines: Record<string, CostDraftLine>;
  /** 币种 → 汇率（1 单位该币种 = X 加元）、来源、日期 */
  fx: Record<string, { rate: string; source: string; asOf: string }>;
  importGstRatePct: string;
  importGstItcEligible: boolean;
  pricingMethod: "MARGIN_ON_PRICE" | "MARKUP_ON_COST";
  pricingRatePct: string;
  reserveOnSalePct: string;
};

export function emptyDraftLine(): CostDraftLine {
  return { sourcing: "IMPORT", unitPrice: "", basis: "PER_PIECE", currency: "CNY", evidenceKind: "ESTIMATE", dutyRatePct: "", hsCode: "", origin: "", dutySourceRef: "", dutyAsOf: "", freightCad: "", localDeliveryCad: "", otherCad: "" };
}

export function emptyCostDraft(): CostDraft {
  return { version: COST_DRAFT_VERSION, lines: {}, fx: {}, importGstRatePct: "5", importGstItcEligible: true, pricingMethod: "MARGIN_ON_PRICE", pricingRatePct: "25", reserveOnSalePct: "" };
}

/** 从本地存储读回；形状不对就给一份空草稿（不抛）。 */
export function parseCostDraft(raw: string | null | undefined): CostDraft {
  if (!raw) return emptyCostDraft();
  try {
    const v = JSON.parse(raw) as Partial<CostDraft>;
    if (v?.version !== COST_DRAFT_VERSION || typeof v.lines !== "object" || v.lines === null) return emptyCostDraft();
    return { ...emptyCostDraft(), ...v, lines: v.lines, fx: v.fx ?? {} } as CostDraft;
  } catch {
    return emptyCostDraft();
  }
}

const filled = (s: string | undefined | null) => typeof s === "string" && s.trim().length > 0;
const opt = (s: string) => (filled(s) ? s.trim() : null);

/** 草稿里出现过的非加元币种（用来提示要填哪些汇率）。 */
export function currenciesNeedingFx(draft: CostDraft): string[] {
  const set = new Set<string>();
  for (const l of Object.values(draft.lines)) {
    const c = l.currency.trim().toUpperCase();
    if (filled(l.unitPrice) && c && c !== "CAD") set.add(c);
  }
  return [...set].sort();
}

export function buildCostRequest(draft: CostDraft, lineNos: readonly number[], label?: string): CostSheetRequest {
  const lines: CostSheetRequest["lines"] = [];
  for (const lineNo of lineNos) {
    const l = draft.lines[String(lineNo)];
    if (!l || !filled(l.unitPrice)) continue;
    const currency = l.currency.trim().toUpperCase() || "CAD";
    const fx = draft.fx[currency];
    const isImport = l.sourcing === "IMPORT";
    lines.push({
      lineNo,
      sourcing: l.sourcing,
      quote: { unitPrice: l.unitPrice.trim(), basis: l.basis, currency, evidenceKind: l.evidenceKind },
      fx: currency === "CAD" ? null : { rateCadPerUnit: opt(fx?.rate ?? ""), source: opt(fx?.source ?? ""), asOf: opt(fx?.asOf ?? "") },
      duty: isImport && filled(l.dutyRatePct)
        ? { ratePct: l.dutyRatePct.trim(), hsCode: opt(l.hsCode), origin: opt(l.origin), sourceRef: opt(l.dutySourceRef), asOf: opt(l.dutyAsOf) }
        : null,
      internationalFreightCad: isImport ? opt(l.freightCad) : null,
      domesticFreightCad: isImport ? null : opt(l.freightCad),
      localDeliveryCad: opt(l.localDeliveryCad),
      otherNonRecoverableCad: opt(l.otherCad),
    });
  }
  return {
    ...(label ? { label } : {}),
    lines,
    importGst: { ratePct: filled(draft.importGstRatePct) ? draft.importGstRatePct.trim() : "0", itcEligible: draft.importGstItcEligible },
    reserves: filled(draft.reserveOnSalePct) ? [{ key: "contingency", label: "风险预备金", mode: "ON_SALE", ratePct: draft.reserveOnSalePct.trim() }] : [],
    pricing: draft.pricingMethod === "MARGIN_ON_PRICE"
      ? { method: "MARGIN_ON_PRICE", targetMarginPct: filled(draft.pricingRatePct) ? draft.pricingRatePct.trim() : "0" }
      : { method: "MARKUP_ON_COST", markupPct: filled(draft.pricingRatePct) ? draft.pricingRatePct.trim() : "0" },
  };
}
