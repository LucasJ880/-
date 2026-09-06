/**
 * 询盘设计段规则纯函数测试
 * 运行：npx tsx src/lib/trade/__tests__/inquiry-design-rules.test.ts
 */

import assert from "node:assert/strict";
import { normalizeExtraction, redFlags, complianceHints } from "../inquiry-rules";
import {
  buildQuoteSuggestion,
  buildReplyBrief,
  decideSampleAdvice,
  matchProduct,
  parseQuantity,
  type ProductCandidate,
} from "../inquiry-design-rules";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("inquiry-design-rules");

const catalog: ProductCandidate[] = [
  {
    sku: "MX-BR-001",
    name: "珊瑚绒浴袍",
    nameEn: "Coral Fleece Bathrobe",
    category: "bathrobe",
    facts: { fabric_composition: "100% polyester coral fleece", gsm: "280", size: "S/M/L/XL", moq: "500 pcs", lead_time: "30-35 days", fob_price: "USD 8.50", packaging_type: "1 pc/polybag" },
  },
  {
    sku: "MX-BL-010",
    name: "羊羔绒毯",
    nameEn: "Sherpa Fleece Throw Blanket",
    category: "blanket",
    facts: { fabric_composition: "100% polyester", gsm: "320", size: "50x60 in", moq: "300 pcs", lead_time: "4 weeks" },
  },
];

ok("parseQuantity：500 pcs / 2k / 1万 / 无", () => {
  assert.equal(parseQuantity("500 pcs"), 500);
  assert.equal(parseQuantity("2k pieces"), 2000);
  assert.equal(parseQuantity("1万件"), 10000);
  assert.equal(parseQuantity(null), 0);
});

ok("matchProduct：按词重叠匹配到浴袍货号，无关描述不匹配", () => {
  const m = matchProduct("coral fleece bathrobe", catalog);
  assert.equal(m?.product.sku, "MX-BR-001");
  assert.equal(matchProduct("stainless steel bottle", catalog), null);
});

ok("报价建议：匹配货号带出 FOB 价/MOQ/交期；无匹配则占位且价格 null", () => {
  const x = normalizeExtraction({ products: ["coral fleece bathrobe", "silk pillowcase"], quantity: "500 pcs", specs: { gsm: "280" }, incotermHint: "fob", targetPrice: "$8" });
  const q = buildQuoteSuggestion(x, catalog);
  assert.equal(q.items.length, 2);
  assert.equal(q.items[0].matchedSku, "MX-BR-001");
  assert.equal(q.items[0].unitPriceSuggested, 8.5);
  assert.equal(q.items[0].quantity, 500);
  assert.match(q.items[0].specification, /280 GSM/);
  assert.equal(q.items[1].matchedSku, null);
  assert.equal(q.items[1].unitPriceSuggested, null);
  assert.equal(q.moq, "500 pcs");
  assert.equal(q.leadTimeDays, 35);
  assert.equal(q.incoterm, "FOB");
  assert.match(q.notes, /目标价/);
});

ok("报价建议：交期按周换算；未给数量提示按 MOQ 阶梯", () => {
  const x = normalizeExtraction({ products: ["sherpa throw blanket"] });
  const q = buildQuoteSuggestion(x, catalog);
  assert.equal(q.items[0].matchedSku, "MX-BL-010");
  assert.equal(q.leadTimeDays, 28);
  assert.equal(q.items[0].quantity, 0);
  assert.match(q.notes, /MOQ/);
});

ok("寄样：明确要样 + 进口商 + 无红旗 → 推荐，样品费首单抵扣", () => {
  const x = normalizeExtraction({ intent: "sample", buyerType: "importer", products: ["bathrobe"] });
  const s = decideSampleAdvice(x, []);
  assert.equal(s.recommend, true);
  assert.equal(s.mode, "paid_deductible");
});

ok("寄样：高风险红旗 → 不寄", () => {
  const x = normalizeExtraction({ intent: "rfq", buyerType: "importer" });
  const flags = redFlags(x, { email: "x@gmail.com", companyName: "Big Corp", freeText: "pay registration fee first" });
  const s = decideSampleAdvice(x, flags);
  assert.equal(s.recommend, false);
  assert.equal(s.mode, "decline");
});

ok("寄样：信息不足 → 先追问，按实收", () => {
  const x = normalizeExtraction({ intent: "info", buyerType: "unknown" });
  const s = decideSampleAdvice(x, []);
  assert.equal(s.recommend, false);
  assert.equal(s.mode, "paid");
});

ok("回复要点：缺数量/目的国自动进追问；critical 合规进提醒；下一步随寄样建议", () => {
  const x = normalizeExtraction({ products: ["kids bathrobe"], intent: "rfq", buyerType: "brand", isChildren: true, destinationCountry: "USA" });
  const hints = complianceHints(x, "kids bathrobe");
  const quote = buildQuoteSuggestion(x, catalog);
  const sample = decideSampleAdvice(x, []);
  const brief = buildReplyBrief(x, hints, sample, quote);
  assert.ok(brief.ask.some((a) => a.includes("数量")));
  assert.ok(!brief.ask.some((a) => a.includes("目的国")));
  assert.ok(brief.mention.some((m) => m.includes("睡衣阻燃")));
  assert.equal(typeof brief.nextStep, "string");
  assert.equal(brief.language, "en");
});

console.log(`\ninquiry-design-rules: ${pass} 通过`);
