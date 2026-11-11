/**
 * 渥太华 18 行 + 一组**合成**成本输入，用来演示完整的核算表。
 * 合成数据，不是报价：单价、汇率、税率、运费全部是为了让表好看而编的整数，
 * 不代表任何供应商、任何税则或任何一天的汇率。
 */
import type { CostLineInput, CostScenarioInput, QuoteEvidenceKind } from "../../contract";
import { OTTAWA_18026_LINES } from "@/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026";

const AS_OF = "2026-11-01";
/** 行号 → [件价（人民币）, 证据类别, 关税率 %] */
const IMPORT_INPUTS: Record<number, [string, QuoteEvidenceKind, string]> = {
  1: ["30.00", "ESTIMATE", "18"], 2: ["22.00", "ESTIMATE", "18"], 3: ["24.00", "ESTIMATE", "18"],
  4: ["38.00", "ESTIMATE", "18"], 5: ["28.00", "ESTIMATE", "18"], 6: ["44.00", "ESTIMATE", "18"],
  7: ["32.00", "ESTIMATE", "18"], 8: ["58.00", "ESTIMATE", "18"], 9: ["18.00", "ESTIMATE", "18"],
  10: ["6.50", "PLATFORM_LISTED", "18"], 11: ["7.20", "PLATFORM_LISTED", "18"],
  12: ["2.10", "PLATFORM_LISTED", "6.5"],
  16: ["0.45", "ESTIMATE", "6.5"], 17: ["0.55", "ESTIMATE", "6.5"], 18: ["0.70", "ESTIMATE", "6.5"],
};
/** 行号 → [单价（加元）, 境内运费] */
const DOMESTIC_INPUTS: Record<number, [string, string]> = { 13: ["650.00", "300.00"], 14: ["1400.00", "500.00"], 15: ["9800.00", "1800.00"] };

export const OTTAWA_SYNTHETIC_LINES: CostLineInput[] = OTTAWA_18026_LINES.map((line): CostLineInput => {
  const domestic = DOMESTIC_INPUTS[line.lineNo];
  if (domestic) {
    return {
      line, sourcing: "DOMESTIC",
      quote: { unitPrice: domestic[0], basis: "PER_PIECE", currency: "CAD", evidenceKind: "ESTIMATE", sourceRef: "合成数据", asOf: AS_OF },
      domesticFreightCad: domestic[1], localDeliveryCad: "400.00",
    };
  }
  const [price, evidenceKind, dutyPct] = IMPORT_INPUTS[line.lineNo];
  return {
    line, sourcing: "IMPORT",
    quote: {
      unitPrice: price, basis: "PER_PIECE", currency: "CNY", evidenceKind, sourceRef: "合成数据", asOf: AS_OF,
      ...(line.lineNo === 12 ? { moqPieces: 6000, cartonPieces: 500 } : {}),
    },
    fx: { rateCadPerUnit: "0.195", source: "MANUAL（合成）", asOf: AS_OF },
    // 故意不给 HS 编码与来源：演示「未核实的关税假设」标记
    duty: { ratePct: dutyPct },
    localDeliveryCad: "150.00",
  };
});

export const OTTAWA_SYNTHETIC_SCENARIO: CostScenarioInput = {
  key: "ottawa-synthetic-base",
  label: "渥太华 18026-93121-T01 · 合成数据基准情景",
  lines: OTTAWA_SYNTHETIC_LINES,
  importGst: { ratePct: "5", itcEligible: true },
  freight: {
    plans: [{
      key: "fcl", mode: "FCL", sourceRef: "合成数据", asOf: AS_OF,
      charges: [
        { label: "海运与目的港", amountCad: "6500.00", allocation: "BY_VALUE" },
        { label: "报关与清关", amountCad: "450.00", allocation: "BY_VALUE" },
      ],
    }],
  },
  reserves: [{ key: "contingency", label: "风险预备金", mode: "ON_SALE", ratePct: "2" }],
  pricing: { method: "MARGIN_ON_PRICE", targetMarginPct: "25" },
};

export const OTTAWA_SAMPLE_DOC_PATH = "docs/acceptance/ti-2/ottawa-sample-cost-sheet.md";
export const OTTAWA_SAMPLE_DOC_HEADER = [
  "> **合成数据，不是报价。** 单价、汇率、税率、运费都是编的，只用来展示核算表的版式；",
  "> 行项、数量与单位来自渥太华 18026-93121-T01 的公开招标事实（该标已于 2026-11-10 截标）。",
  "> 本文件由 `src/lib/tender-bid-cost/__tests__/sheet-view.test.ts` 生成并校验：",
  "> `UPDATE_SAMPLE=1 npx tsx src/lib/tender-bid-cost/__tests__/sheet-view.test.ts` 重新生成。",
  "",
  "",
].join("\n");
