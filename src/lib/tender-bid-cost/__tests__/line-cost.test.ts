/**
 * TI-2 逐行直接成本（纯逻辑）
 * 运行：npx tsx src/lib/tender-bid-cost/__tests__/line-cost.test.ts
 * 覆盖任务书验收项 A11（本地设备不计中国海运与关税）、A12（GST / ITC 不重复）。
 */
import assert from "node:assert/strict";
import type { CostLineInput, LineCost } from "../contract";
import { dutyBasisOf, finalizeLine, prepareLine } from "../line-cost";
import { GOLDEN_DOMESTIC_LINE, GOLDEN_IMPORT_LINE } from "./fixtures/golden";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const GST = { ratePct: "5", itcEligible: true };
const cost = (input: CostLineInput, gst = GST): LineCost => {
  const p = prepareLine(input);
  assert.ok(p.ok, "prepareLine 应通过");
  return finalizeLine(p.base, { importGst: gst });
};
const m = (v: { toFixed(n: number): string } | null) => (v ? v.toFixed(2) : null);
const codes = (c: LineCost) => c.blockers.map((b) => b.code);

console.log("tender-bid-cost line-cost");

{
  const c = cost(GOLDEN_IMPORT_LINE);
  ok("进口金标：货值 84.00", m(c.goodsCad) === "84.00");
  ok("进口金标：关税 15.12（已核实）", m(c.dutyCad) === "15.12" && c.dutyBasis === "VERIFIED");
  ok("进口金标：运费 45.00、本地配送 15.00、其它 5.00 各自单列", m(c.freightCad) === "45.00" && m(c.localDeliveryCad) === "15.00" && m(c.otherCad) === "5.00");
  ok("进口金标：直接成本 164.12", m(c.directCostCad) === "164.12" && c.complete);
  ok("可抵扣：进口 GST 现金流 4.96，不进成本", m(c.importGstCashCad) === "4.96" && m(c.nonRecoverableTaxCad) === "0.00");
  const noItc = cost(GOLDEN_IMPORT_LINE, { ratePct: "5", itcEligible: false });
  ok("不可抵扣：直接成本 169.08，现金流仍为 4.96", m(noItc.directCostCad) === "169.08" && m(noItc.importGstCashCad) === "4.96" && m(noItc.nonRecoverableTaxCad) === "4.96");
  const lineOverride = cost({ ...GOLDEN_IMPORT_LINE, importGstItcEligible: false });
  ok("行级不可抵扣覆盖情景设置", m(lineOverride.directCostCad) === "169.08");
}
{
  const c = cost(GOLDEN_DOMESTIC_LINE);
  ok("本地金标：货值 640.00，关税 0.00，进口 GST 0.00", m(c.goodsCad) === "640.00" && m(c.dutyCad) === "0.00" && m(c.importGstCashCad) === "0.00");
  ok("本地金标：直接成本 750.00", m(c.directCostCad) === "750.00");
  const withDuty = prepareLine({ ...GOLDEN_DOMESTIC_LINE, duty: { ratePct: "6.5" } });
  ok("本地行带关税率 → 拒绝", !withDuty.ok && withDuty.code === "DOMESTIC_HAS_IMPORT_CHARGES" && withDuty.lineNo === 13);
  const withOcean = prepareLine({ ...GOLDEN_DOMESTIC_LINE, internationalFreightCad: "200" });
  ok("本地行带海运费 → 拒绝", !withOcean.ok && withOcean.code === "DOMESTIC_HAS_IMPORT_CHARGES" && withOcean.messageZh.includes("本地采购"));
}
{
  const unverified = { ...GOLDEN_IMPORT_LINE, duty: { ratePct: "18" } };
  const c = cost(unverified);
  ok("未核实税率照常出数，但标为敏感性假设", m(c.dutyCad) === "15.12" && c.dutyBasis === "SENSITIVITY");
  ok("四项缺一即未核实", dutyBasisOf({ ratePct: "18", hsCode: "6302.99", origin: "CN", sourceRef: "x" }) === "SENSITIVITY");
  const noDuty = cost({ ...GOLDEN_IMPORT_LINE, duty: null });
  ok("进口行缺关税率 → 成本为空，不按零算", !noDuty.complete && noDuty.directCostCad === null && codes(noDuty).includes("MISSING_DUTY_RATE"));
  const zeroDuty = cost({ ...GOLDEN_IMPORT_LINE, duty: { ratePct: "0", hsCode: "9999.00", origin: "CN", sourceRef: "合成", asOf: "2026-11-01" } });
  ok("显式给 0% 税率 → 关税 0.00，可以出数", zeroDuty.complete && m(zeroDuty.dutyCad) === "0.00");
}
{
  const noDate = cost({ ...GOLDEN_IMPORT_LINE, fx: { rateCadPerUnit: "1.40", source: "MANUAL" } });
  ok("缺汇率日期 → 成本为空并列出原因", !noDate.complete && noDate.goodsCad === null && codes(noDate).includes("MISSING_FX_DATE") && noDate.blockers.some((b) => b.messageZh === "缺汇率日期"));
  const noFx = cost({ ...GOLDEN_IMPORT_LINE, fx: null });
  ok("缺汇率 → 列出汇率、来源、日期三项", ["MISSING_FX_RATE", "MISSING_FX_SOURCE", "MISSING_FX_DATE"].every((c) => codes(noFx).includes(c as never)));
  const noQuote = cost({ ...GOLDEN_IMPORT_LINE, quote: null });
  ok("缺报价 → 成本为空", !noQuote.complete && codes(noQuote).includes("MISSING_QUOTE") && noQuote.unitCostCad === null);
  const cad = cost({ ...GOLDEN_DOMESTIC_LINE, fx: null });
  ok("加元报价不需要汇率", cad.complete);
}
{
  const interceptors: CostLineInput = {
    line: { lineNo: 12, description: "Bed Bug Interceptors", uom: "Box", quantity: 436, packCount: 12 },
    sourcing: "IMPORT",
    quote: { unitPrice: "1.00", basis: "PER_PIECE", currency: "CAD", evidenceKind: "ESTIMATE", moqPieces: 6000, cartonPieces: 500 },
    duty: { ratePct: "0" },
  };
  const c = cost(interceptors);
  ok("起订量高于所需：采购 6,000 件，超购 768 件", c.requiredPieces?.toNumber() === 5232 && c.purchasePieces?.toNumber() === 6000 && c.excessPieces?.toNumber() === 768);
  ok("货值按采购件数计算（6,000.00），招标数量仍为 436 Box", m(c.goodsCad) === "6000.00" && c.quantity?.toNumber() === 436 && c.uom === "Box");
  const carton = cost({ line: { lineNo: 1, description: "x", uom: "Each", quantity: 105 }, sourcing: "DOMESTIC", quote: { unitPrice: "2", basis: "PER_PIECE", currency: "CAD", evidenceKind: "ESTIMATE", cartonPieces: 10 } });
  ok("向上取整到整箱：105 → 110，超购 5", carton.purchasePieces?.toNumber() === 110 && carton.excessPieces?.toNumber() === 5 && m(carton.goodsCad) === "220.00");
  const plain = cost({ line: { lineNo: 1, description: "x", uom: "Each", quantity: 105 }, sourcing: "DOMESTIC", quote: { unitPrice: "2", basis: "PER_PIECE", currency: "CAD", evidenceKind: "ESTIMATE" } });
  ok("没有起订量与整包装 → 采购件数等于所需", plain.purchasePieces?.toNumber() === 105 && plain.excessPieces?.toNumber() === 0);
  const badMoq = prepareLine({ ...interceptors, quote: { ...interceptors.quote!, moqPieces: 0 } });
  ok("起订量为 0 → 拒绝", !badMoq.ok && badMoq.code === "INVALID_PURCHASE_RULE");
  const pillow = cost({ line: { lineNo: 10, description: "Standard Pillow Covers", uom: "Pack", quantity: 2349, packCount: 2 }, sourcing: "DOMESTIC", quote: { unitPrice: "1.50", basis: "PER_PIECE", currency: "CAD", evidenceKind: "ESTIMATE" } });
  ok("每包 2 件：2,349 包 × 2 × 1.50 = 7,047.00", m(pillow.goodsCad) === "7047.00" && pillow.requiredPieces?.toNumber() === 4698);
  const perPack = cost({ line: { lineNo: 10, description: "Standard Pillow Covers", uom: "Pack", quantity: 2349, packCount: 2 }, sourcing: "DOMESTIC", quote: { unitPrice: "3.00", basis: "PER_TENDER_UOM", currency: "CAD", evidenceKind: "ESTIMATE" } });
  ok("按包报价 3.00 得到同一货值，不重复换算", m(perPack.goodsCad) === "7047.00");
  const noPack = cost({ line: { lineNo: 16, description: "Laundry Bags", uom: "Roll", quantity: 298 }, sourcing: "DOMESTIC", quote: { unitPrice: "0.12", basis: "PER_PIECE", currency: "CAD", evidenceKind: "ESTIMATE" } });
  ok("成组单位缺包装数且按件报价 → 成本为空", !noPack.complete && codes(noPack).includes("MISSING_PACK_COUNT"));
}

console.log(`\ntender-bid-cost line-cost: ${passed} passed`);
