/**
 * TI-1 单位换算与金额（纯逻辑）
 * 运行：npx tsx src/lib/tender-price-schedule/__tests__/unit-conversion.test.ts
 * 覆盖任务书验收项 A8（每包 2 件贯穿换算）、A10（换算与舍入对到分）。
 */
import assert from "node:assert/strict";
import { convertQuoteToTenderUom, piecesPerTenderUnit, priceLine, priceSchedule } from "../unit-conversion";
import type { PriceScheduleLine } from "../contract";
import { OTTAWA_18026_LINES } from "./fixtures/ottawa-18026";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const line = (n: number): PriceScheduleLine => ({ ...OTTAWA_18026_LINES[n - 1] });

console.log("tender-price-schedule unit-conversion");

{
  const before = JSON.stringify(line(10));
  const src = line(10);
  const r = convertQuoteToTenderUom(src, { unitPrice: "1.50", basis: "PER_PIECE" });
  ok("枕套：件价 1.50 → 每包 3.00", r.ok && r.tenderUnitPrice.toFixed(2) === "3.00");
  ok("枕套：数量仍为 2,349 包，单位仍为 Pack", r.ok && r.quantity.toNumber() === 2349 && r.uom === "Pack");
  ok("枕套：所需件数 4,698", r.ok && r.requiredPieces?.toNumber() === 4698 && r.piecesPerUnit === 2);
  ok("换算不改写行项", JSON.stringify(src) === before);
  const q = convertQuoteToTenderUom(line(11), { unitPrice: "1.50", basis: "PER_PIECE" });
  ok("Queen 枕套同为每包 2 件：554 包 → 1,108 件", q.ok && q.requiredPieces?.toNumber() === 1108);
}
{
  const box = convertQuoteToTenderUom(line(12), { unitPrice: "0.80", basis: "PER_PIECE" });
  ok("拦截器：件价 0.80 → 每盒 9.60（12 件）", box.ok && box.tenderUnitPrice.toFixed(2) === "9.60" && box.requiredPieces?.toNumber() === 5232);
  const roll = convertQuoteToTenderUom(line(16), { unitPrice: "0.12", basis: "PER_PIECE" });
  ok("洗衣袋：件价 0.12 → 每卷 3.00（25 件）", roll.ok && roll.tenderUnitPrice.toFixed(2) === "3.00" && roll.requiredPieces?.toNumber() === 7450);
  const each = convertQuoteToTenderUom(line(1), { unitPrice: "6.00", basis: "PER_PIECE" });
  ok("Each 行按件报价：单价不变，件数 = 数量", each.ok && each.tenderUnitPrice.toFixed(2) === "6.00" && each.requiredPieces?.toNumber() === 2367);
}
{
  const r = convertQuoteToTenderUom(line(10), { unitPrice: "3.00", basis: "PER_TENDER_UOM" });
  ok("已按每包报价 3.00 → 仍为 3.00，不是 6.00", r.ok && r.tenderUnitPrice.toFixed(2) === "3.00");
}
{
  const noPack: PriceScheduleLine = { lineNo: 16, description: "Laundry Bags", uom: "Roll", quantity: 298 };
  const r = convertQuoteToTenderUom(noPack, { unitPrice: "0.12", basis: "PER_PIECE" });
  ok("Roll 缺包装数且按件报价 → 拒绝换算", !r.ok && r.code === "PACK_COUNT_MISSING");
  const perUom = convertQuoteToTenderUom(noPack, { unitPrice: "3.00", basis: "PER_TENDER_UOM" });
  ok("Roll 缺包装数但已按卷报价 → 可用，件数未知", perUom.ok && perUom.requiredPieces === null);
  ok("非成组单位缺包装数 → 视为 1", (() => { const p = piecesPerTenderUnit({ lineNo: 1, uom: "Each" }); return p.ok && p.pieces === 1; })());
  const neg = convertQuoteToTenderUom(line(1), { unitPrice: "-1", basis: "PER_PIECE" });
  ok("负报价 → 拒绝", !neg.ok && neg.code === "PRICE_INVALID");
}
{
  const p = priceSchedule([
    { lineNo: 1, quantity: 2367, unitPrice: "22.4849" },
    { lineNo: 10, quantity: 2349, unitPrice: "3.335" },
    { lineNo: 16, quantity: 298, unitPrice: "0.125" },
  ]);
  ok("单价舍入到分：22.48 / 3.34 / 0.13", p.lines.map((l) => l.unitPrice.toFixed(2)).join("/") === "22.48/3.34/0.13");
  ok("行合计：53,210.16 / 7,845.66 / 38.74", p.lines.map((l) => l.extended.toFixed(2)).join("/") === "53210.16/7845.66/38.74");
  ok("总计 61,094.56 = 各行合计之和", p.total.toFixed(2) === "61094.56");
  const unrounded = 22.4849 * 2367 + 3.335 * 2349 + 0.125 * 298;
  ok("总计不由未舍入总额倒推（二者不同）", Math.abs(unrounded - 61094.56) > 0.01);
  ok("单行：舍入后的单价乘数量", priceLine({ lineNo: 1, quantity: 3, unitPrice: "0.335" }).extended.toFixed(2) === "1.02");
}

console.log(`\ntender-price-schedule unit-conversion: ${passed} passed`);
