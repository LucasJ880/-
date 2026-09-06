/**
 * Revenue Spine — RFQ 抽取 / 缺失信息 / 语言 纯函数测试（无 LLM）
 * 运行：npx tsx src/lib/revenue-spine/__tests__/rfq-extract.test.ts
 */
import assert from "node:assert/strict";
import { DEFAULT_PRODUCT_KEYWORDS } from "../policy";
import { extractRfqHeuristic } from "../rfq/heuristic-extractor";
import { parseLlmRfqOutput } from "../rfq/llm-extractor";
import { mergeRfqExtractions } from "../rfq/extract";
import { buildClarifyingQuestions, computeMissingFields, computeMissingRequiredFields, rfqStatusFor } from "../rfq/missing-info";
import { detectLanguage } from "../normalize";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}
console.log("revenue-spine/rfq-extract");
const opts = { productKeywords: DEFAULT_PRODUCT_KEYWORDS, now: new Date("2026-09-06T00:00:00Z") };

const ACCEPTANCE =
  "We are a hotel supplier in Canada and are looking for 3,000 blackout curtains for an upcoming hotel project. Please advise MOQ, pricing and delivery time.";

ok("验收询盘：产品 / 数量 / 市场 / 买家类型 + 每个字段带证据", () => {
  const r = extractRfqHeuristic(ACCEPTANCE, opts);
  assert.equal(r.fields.productCategory, "curtain");
  assert.match(r.fields.productName!, /blackout curtains/i);
  assert.equal(r.fields.quantity, 3000);
  assert.equal(r.fields.destinationCountry, "Canada");
  assert.equal(r.fields.buyerType, "hotel_supplier");
  assert.equal(r.fields.application, "hospitality");
  assert.equal(r.language, "en");
  for (const e of r.evidence) {
    assert.ok(e.evidenceText.length > 0, e.field);
    assert.ok(ACCEPTANCE.replace(/\s+/g, " ").includes(e.evidenceText.replace(/\s+/g, " ")), `${e.field} evidence must come from source`);
    assert.ok(e.confidence > 0 && e.confidence <= 1);
  }
  const qty = r.evidence.find((e) => e.field === "quantity")!;
  assert.ok(qty.confidence >= 0.85);
});

ok("验收询盘：缺失 = size, material, destinationCity, requiredDeliveryDate（按优先级）", () => {
  const r = extractRfqHeuristic(ACCEPTANCE, opts);
  const missing = computeMissingRequiredFields(r.fields);
  assert.deepEqual(missing, ["size", "material", "destinationCity", "requiredDeliveryDate"]);
  assert.equal(rfqStatusFor(r.fields), "partial");
  const qs = buildClarifyingQuestions(computeMissingFields(r.fields), "en", 4);
  assert.equal(qs.length, 4);
  assert.deepEqual(qs.map((q) => q.field), ["size", "material", "destinationCity", "requiredDeliveryDate"]);
  assert.equal(qs[0].tier, "feasibility");
});

ok("完整 RFQ：材质 / 尺寸 / 成分 / 颜色 / 目标价 / 贸易术语 / 交期 / 认证 / 样品 / 包装 全部识别", () => {
  const text =
    "Hi, we are a distributor based in Toronto, Canada. Need 5000 pcs coral fleece bathrobes, 100% polyester 280GSM, size 120x140cm, navy color, with embroidered logo, individual poly bag packaging, OEKO-TEX certified. Target price USD 8.5/pc, FOB Shanghai, delivery by 2026-11-15. Please send samples first.";
  const r = extractRfqHeuristic(text, opts);
  const f = r.fields;
  assert.equal(f.productCategory, "bathrobe");
  assert.equal(f.quantity, 5000);
  assert.equal(f.unit, "pcs");
  assert.match(f.material!, /coral fleece/i);
  assert.match(f.composition!, /100% polyester/i);
  assert.match(f.composition!, /280GSM/i);
  assert.match(f.size!, /120\s*x\s*140\s*cm/i);
  assert.equal(f.color, "navy");
  assert.equal(f.customLogo, true);
  assert.ok(f.packaging);
  assert.match(f.certification!, /oeko-tex/i);
  assert.equal(f.sampleRequired, true);
  assert.equal(f.targetPrice, 8.5);
  assert.equal(f.currency, "USD");
  assert.equal(f.incoterm, "FOB");
  assert.equal(f.destinationCountry, "Canada");
  assert.match(f.destinationCity!, /toronto/i);
  assert.equal(f.requiredDeliveryDate?.toISOString().slice(0, 10), "2026-11-15");
  assert.equal(f.buyerType, "distributor");
  assert.equal(rfqStatusFor(f), "complete");
  assert.deepEqual(computeMissingRequiredFields(f), []);
});

ok("中文询盘：数量 / 产品 / 材质 / 国家 / 语言 zh", () => {
  const text = "你好，我们是加拿大的酒店用品供应商，需要3000条遮光窗帘，纯棉，用于酒店项目，请报价并告知起订量和交期。";
  const r = extractRfqHeuristic(text, opts);
  assert.equal(r.language, "zh");
  assert.equal(r.fields.productCategory, "curtain");
  assert.equal(r.fields.quantity, 3000);
  assert.equal(r.fields.unit, "条");
  assert.equal(r.fields.material, "纯棉");
  assert.equal(r.fields.destinationCountry, "Canada");
  assert.equal(r.fields.buyerType, "hotel_supplier");
  const qs = buildClarifyingQuestions(computeMissingFields(r.fields), "zh", 3);
  assert.equal(qs.length, 3);
  assert.ok(qs.every((q) => /[一-鿿]/.test(q.question)));
});

ok("混合语言询盘：识别为 mixed，数量与产品照常抽取", () => {
  const text = "Hello 我们需要 2k bathrobes 浴袍 for our spa in Dubai, 白色, 请报 FOB 价格。";
  const r = extractRfqHeuristic(text, opts);
  assert.equal(r.language, "mixed");
  assert.equal(r.fields.quantity, 2000);
  assert.equal(r.fields.productCategory, "bathrobe");
  assert.equal(r.fields.destinationCountry, "United Arab Emirates");
  assert.equal(r.fields.incoterm, "FOB");
  assert.equal(r.fields.color, "白色");
});

ok("部分 RFQ：只有产品无数量 → quantity 缺失且不臆造", () => {
  const r = extractRfqHeuristic("Interested in your blankets. What is the price?", opts);
  assert.equal(r.fields.productCategory, "blanket");
  assert.equal(r.fields.quantity, null);
  assert.ok(computeMissingRequiredFields(r.fields).includes("quantity"));
  assert.equal(rfqStatusFor(r.fields), "draft");
});

ok("尺寸/克重/价格里的数字不会被当成数量", () => {
  const r = extractRfqHeuristic("Towel 70x140cm 500GSM, budget $3.2 each, quantity 1,200 pcs", opts);
  assert.equal(r.fields.quantity, 1200);
  assert.equal(r.fields.targetPrice, 3.2);
});

ok("相对交期按今日推算并记 note", () => {
  const r = extractRfqHeuristic("Need 800 pcs blankets within 6 weeks", opts);
  assert.equal(r.fields.requiredDeliveryDate?.toISOString().slice(0, 10), "2026-10-18");
  assert.ok(r.notes.some((n) => n.includes("相对交期")));
});

ok("LLM 输出解析：证据接地则采纳，证据不在源文本 → 置信度封顶 0.4", () => {
  const src = "Need 3,000 blackout curtains for a hotel in Canada.";
  const raw = JSON.stringify({
    fields: {
      quantity: { value: 3000, confidence: 0.95, evidence: "3,000 blackout curtains" },
      material: { value: "polyester", confidence: 0.9, evidence: "made of polyester" },
    },
  });
  const r = parseLlmRfqOutput(raw, src, "en")!;
  assert.equal(r.fields.quantity, 3000);
  const mat = r.evidence.find((e) => e.field === "material")!;
  assert.equal(mat.confidence, 0.4);
});

ok("合并：启发式为底，LLM 只在证据接地且更可信时覆盖 / 补缺", () => {
  const h = extractRfqHeuristic("Need 3,000 blackout curtains for a hotel in Canada.", opts);
  const llm = parseLlmRfqOutput(
    JSON.stringify({
      fields: {
        material: { value: "polyester", confidence: 0.9, evidence: "not in text" },
        size: { value: "140x260cm", confidence: 0.8, evidence: "hotel in Canada" },
      },
    }),
    "Need 3,000 blackout curtains for a hotel in Canada.",
    "en",
  );
  const m = mergeRfqExtractions(h, llm);
  assert.equal(m.method, "merged");
  assert.equal(m.fields.material, null, "ungrounded LLM material must not be adopted");
  assert.equal(m.fields.size, "140x260cm");
  assert.equal(m.fields.quantity, 3000);
});

ok("语言识别", () => {
  assert.equal(detectLanguage("Hello world"), "en");
  assert.equal(detectLanguage("你好世界"), "zh");
  assert.equal(detectLanguage("Hello 你好 world 世界 again"), "mixed");
});

console.log(`\n${pass} passed`);
