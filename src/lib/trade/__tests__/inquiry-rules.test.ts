/**
 * 询盘分析规则层纯函数测试
 * 运行：npx tsx src/lib/trade/__tests__/inquiry-rules.test.ts
 */

import assert from "node:assert/strict";
import {
  complianceHints,
  normalizeExtraction,
  redFlags,
  riskLevel,
} from "../inquiry-rules";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("inquiry-rules");

ok("normalizeExtraction：非法/缺失字段收敛为稳定结构", () => {
  const x = normalizeExtraction({
    products: ["Coral fleece bathrobe", 42, "  "],
    quantity: " 500 pcs ",
    specs: { gsm: "280", material: "100% polyester" },
    intent: "RFQ",
    buyerType: "Hotel",
    isChildren: "yes",
    missingInfo: ["尺码分布", "包装"],
  });
  assert.deepEqual(x.products, ["Coral fleece bathrobe"]);
  assert.equal(x.quantity, "500 pcs");
  assert.equal(x.specs.gsm, "280");
  assert.equal(x.intent, "rfq");
  assert.equal(x.buyerType, "hotel");
  assert.equal(x.isChildren, false);
  assert.deepEqual(x.missingInfo, ["尺码分布", "包装"]);
  const empty = normalizeExtraction(null);
  assert.equal(empty.intent, "unclear");
  assert.equal(empty.buyerType, "unknown");
  assert.deepEqual(empty.products, []);
});

ok("合规：美国成人浴袍 → 1610 + 标签 + OEKO-TEX，无儿童一票否决", () => {
  const x = normalizeExtraction({ products: ["coral fleece bathrobe"], destinationCountry: "USA", intent: "rfq" });
  const hints = complianceHints(x, "500 bathrobes for our US hotel chain");
  const codes = hints.map((h) => h.code);
  assert.ok(codes.includes("us_1610"));
  assert.ok(codes.includes("us_labels"));
  assert.ok(codes.includes("oeko_tex"));
  assert.ok(!codes.includes("child_sleepwear"));
});

ok("合规：儿童浴袍 → 睡衣阻燃 critical", () => {
  const x = normalizeExtraction({ products: ["kids bathrobe"], destinationCountry: "United States", isChildren: true });
  const hints = complianceHints(x, "kids bathrobe 300 pcs");
  const child = hints.find((h) => h.code === "child_sleepwear");
  assert.ok(child);
  assert.equal(child?.severity, "critical");
});

ok("合规：加拿大毯子 → 寝具阻燃 + 双语标签；不出美国 1610", () => {
  const x = normalizeExtraction({ products: ["sherpa blanket"], destinationCountry: "Canada" });
  const hints = complianceHints(x, "throw blankets for Toronto retailer");
  const codes = hints.map((h) => h.code);
  assert.ok(codes.includes("ca_blanket_bedding"));
  assert.ok(codes.includes("ca_bilingual_label"));
  assert.ok(!codes.includes("us_1610"));
});

ok("合规：加州目的地追加 Prop 65；美国填充寝具追加 Law Label", () => {
  const x = normalizeExtraction({ products: ["comforter"], destinationCountry: "California, USA" });
  const codes = complianceHints(x, "comforters to Los Angeles").map((h) => h.code);
  assert.ok(codes.includes("prop65"));
  assert.ok(codes.includes("us_law_label"));
});

ok("红旗：免费邮箱冒充公司 + 前置费用话术 → high", () => {
  const x = normalizeExtraction({ intent: "rfq" });
  const flags = redFlags(x, {
    email: "bigbuyer@gmail.com",
    companyName: "Walmart Sourcing Inc",
    freeText: "please pay the registration fee first, urgent",
  });
  const codes = flags.map((f) => f.code);
  assert.ok(codes.includes("free_mail_company"));
  assert.ok(codes.includes("fee_scam"));
  assert.ok(codes.includes("urgency_pressure"));
  assert.equal(riskLevel(flags), "high");
});

ok("红旗：首单巨大不提样品 → medium；正常询盘无红旗 → low", () => {
  const big = normalizeExtraction({ intent: "rfq", products: ["bathrobe"] });
  const f1 = redFlags(big, { email: "buyer@hotel-supply.com", companyName: "Hotel Supply", freeText: "we need 50,000 pcs bathrobes per month" });
  assert.ok(f1.some((f) => f.code === "big_order_no_sample"));
  assert.equal(riskLevel(f1), "medium");
  const normal = normalizeExtraction({ intent: "rfq", products: ["bathrobe"] });
  const f2 = redFlags(normal, { email: "buyer@hotel-supply.com", companyName: "Hotel Supply", freeText: "Please quote 500 pcs coral fleece bathrobe 280GSM, and send a sample first." });
  assert.equal(f2.length, 0);
  assert.equal(riskLevel(f2), "low");
});

ok("红旗：占位公司名（WhatsApp +1…）不算免费邮箱冒充；信息太少给 info 级提示", () => {
  const x = normalizeExtraction({ intent: "unclear" });
  const flags = redFlags(x, { email: null, companyName: "WhatsApp +15550100", freeText: "hi price?" });
  assert.ok(!flags.some((f) => f.code === "free_mail_company"));
  assert.ok(flags.some((f) => f.code === "too_thin"));
  assert.equal(riskLevel(flags), "low");
});

console.log(`\ninquiry-rules: ${pass} 通过`);
