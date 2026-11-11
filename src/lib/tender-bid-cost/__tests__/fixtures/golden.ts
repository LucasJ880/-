/**
 * 金标输入：移植自 Skill 包 `assets/sample_cost_inputs.json`（合成数据，不是供应商报价）。
 * 数字出处：Skill 包 `scripts/cost_model.py` 对该文件的输出
 *（84.00 / 15.12 / 4.96 / 164.12 / 750.00 / 914.12 / 22.48 / 513.70 / 224.80 / 1,027.40 / 1,252.20）。
 */
import type { CostLineInput, CostScenarioInput } from "../../contract";

export const GOLDEN_IMPORT_LINE: CostLineInput = {
  line: { lineNo: 1, description: "Twin Mattress Cover", uom: "Each", quantity: 10 },
  sourcing: "IMPORT",
  quote: { unitPrice: "6.00", basis: "PER_PIECE", currency: "USD", evidenceKind: "SIGNED_QUOTE", sourceRef: "合成样例", asOf: "2026-11-01" },
  fx: { rateCadPerUnit: "1.40", source: "MANUAL", asOf: "2026-11-01" },
  duty: { ratePct: "18", hsCode: "6302.99", origin: "CN", sourceRef: "合成样例，非真实税则", asOf: "2026-11-01" },
  internationalFreightCad: "45.00",
  localDeliveryCad: "15.00",
  otherNonRecoverableCad: "5.00",
};

export const GOLDEN_DOMESTIC_LINE: CostLineInput = {
  line: { lineNo: 13, description: "Small Portable Thermal Treatment Chamber", uom: "Each", quantity: 2 },
  sourcing: "DOMESTIC",
  quote: { unitPrice: "320.00", basis: "PER_PIECE", currency: "CAD", evidenceKind: "SIGNED_QUOTE", sourceRef: "合成样例", asOf: "2026-11-01" },
  domesticFreightCad: "60.00",
  localDeliveryCad: "30.00",
  otherNonRecoverableCad: "20.00",
};

export const GOLDEN_SCENARIO: CostScenarioInput = {
  key: "golden",
  label: "金标（合成数据）",
  lines: [GOLDEN_IMPORT_LINE, GOLDEN_DOMESTIC_LINE],
  importGst: { ratePct: "5", itcEligible: true },
  reserves: [{ key: "contingency", label: "风险预备金", mode: "ON_SALE", ratePct: "2" }],
  pricing: { method: "MARGIN_ON_PRICE", targetMarginPct: "25" },
};
