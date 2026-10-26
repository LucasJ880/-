/**
 * Revenue Spine — 商务事实规则化抽取（B-2，openspec change fde-fact-proposals）表驱动测试，无 DB。
 *   六个字段的中英文 / 混排写法、价格 / 付款 / 百分比整行跳过、引用截断、买家域名与电话排除、规范键与中文展示
 * 运行：npx tsx src/lib/revenue-spine/__tests__/fact-extract.test.ts
 *
 * 公开仓库：只用虚构企业与域名。
 */
import assert from "node:assert/strict";
import { sectionedLines } from "../fde/draft-diff";
import {
  DEFAULT_PRODUCTION_STARTS_FROM,
  buyerDomain,
  canonicalPort,
  dayRange,
  extractFacts,
  factValueKey,
  factValueLabel,
  isPriceLine,
  stripQuotedReply,
  type ExtractOptions,
  type ExtractedFact,
  type FactField,
} from "../fact-extract";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

/** 一封回复 → 截引用 → 带段落类型的行 → 抽取 */
function extract(text: string, opts: ExtractOptions = {}): Partial<Record<FactField, ExtractedFact["value"]>> {
  const lines = sectionedLines(stripQuotedReply(text));
  return Object.fromEntries(extractFacts(lines, opts).map((f) => [f.field, f.value]));
}

/** 正文包一层问候与落款，模拟真实回复 */
const reply = (body: string, signature = "Best regards,\nLucy") => `Hi Mark,\n\n${body}\n\n${signature}`;

interface Case {
  name: string;
  text: string;
  expect: Partial<Record<FactField, unknown>>;
  /** 断言这些字段没抽到 */
  absent?: FactField[];
  opts?: ExtractOptions;
}

const CASES: Case[] = [
  // ── 起订量 ──
  { name: "MOQ 500 pcs per color", text: reply("MOQ is 500 pcs per color."), expect: { moq: { quantity: 500, unit: "pcs", per: "color" } } },
  { name: "MOQ 500pcs/colour（无空格、英式拼写）", text: reply("Our MOQ: 500pcs/colour"), expect: { moq: { quantity: 500, unit: "pcs", per: "color" } } },
  { name: "Minimum order quantity 1,000 pieces per design", text: reply("Minimum order quantity is 1,000 pieces per design."), expect: { moq: { quantity: 1000, unit: "pcs", per: "design" } } },
  { name: "中文：起订量 300 件/色", text: reply("起订量 300件/色。"), expect: { moq: { quantity: 300, unit: "pcs", per: "color" } } },
  { name: "中文：每款起订 200 套", text: reply("每款起订200套"), expect: { moq: { quantity: 200, unit: "sets", per: "style" } } },
  { name: "MOQ 无 per → order", text: reply("MOQ 2000 m for this fabric."), expect: { moq: { quantity: 2000, unit: "m", per: "order" } } },
  // ── 样品 ──
  { name: "定制样 7-10 天", text: reply("Samples can be ready in 7-10 days."), expect: { sampleLeadTime: { stockDays: null, customDaysMin: 7, customDaysMax: 10 } } },
  { name: "现货样 3 天", text: reply("Stock samples ship within 3 days."), expect: { sampleLeadTime: { stockDays: 3, customDaysMin: null, customDaysMax: null } } },
  { name: "中文：打样 5-7 个工作日", text: reply("打样需要5-7个工作日。"), expect: { sampleLeadTime: { stockDays: null, customDaysMin: 5, customDaysMax: 7 } } },
  // ── 大货 ──
  {
    name: "中英混排：大货周期 35-45 days after PP sample approval",
    text: reply("大货周期 35-45 days after PP sample approval"),
    expect: { productionLeadTime: { daysMin: 35, daysMax: 45, startsFrom: DEFAULT_PRODUCTION_STARTS_FROM } },
    absent: ["sampleLeadTime"],
  },
  {
    name: "Lead time 30-35 days after deposit",
    text: reply("Lead time for bulk orders is 30-35 days after deposit."),
    expect: { productionLeadTime: { daysMin: 30, daysMax: 35, startsFrom: "deposit received" } },
  },
  { name: "Delivery 4-5 weeks（周 ×7）", text: reply("Delivery: 4-5 weeks after order confirmation."), expect: { productionLeadTime: { daysMin: 28, daysMax: 35, startsFrom: "order confirmation" } } },
  {
    name: "同一行样品与大货分句",
    text: reply("样品7天，大货交期25-30天。"),
    expect: { sampleLeadTime: { stockDays: null, customDaysMin: 7, customDaysMax: 7 }, productionLeadTime: { daysMin: 25, daysMax: 30, startsFrom: DEFAULT_PRODUCTION_STARTS_FROM } },
  },
  // ── 装运港 ──
  { name: "FOB Ningbo or Shanghai（无价格）", text: reply("We ship FOB Ningbo or Shanghai."), expect: { loadingPorts: ["Ningbo", "Shanghai"] } },
  { name: "中文：装运港青岛", text: reply("装运港：青岛"), expect: { loadingPorts: ["Qingdao"] } },
  { name: "提到城市但不是港口语境 → 不抽", text: reply("Our factory is in Shanghai."), expect: {}, absent: ["loadingPorts"] },
  // ── 目录 ──
  { name: "目录链接", text: reply("Please find our catalog here: https://example-home.example/catalog.pdf."), expect: { catalogUrl: "https://example-home.example/catalog.pdf" } },
  { name: "中文：产品目录 www 链接", text: reply("产品目录：www.example-home.example/catalog"), expect: { catalogUrl: "www.example-home.example/catalog" } },
  // ── 落款 ──
  {
    name: "落款：职位 / WhatsApp / 网站",
    text: reply("Thanks for your inquiry.", "Best regards,\nLucy Wang\nSales Manager\nWhatsApp: +86 138 0013 8000\nwww.example-home.example"),
    expect: { signature: { title: "Sales Manager", whatsapp: "+86 138 0013 8000", website: "www.example-home.example" } },
  },
  {
    name: "落款里邮箱行与电话行不当网站 / 职位",
    text: reply("Noted.", "Kind regards,\nTom\nEmail: tom@example-home.example\nTel: +86 574 8888 0000"),
    expect: {},
    absent: ["signature"],
  },
  // ── 价格 / 条款整行跳过 ──
  { name: "含价格的句子：不抽 MOQ 与港口", text: reply("MOQ 500 pcs, unit price USD 4.80 FOB Ningbo."), expect: {}, absent: ["moq", "loadingPorts"] },
  { name: "付款条款与百分比：不抽大货周期", text: reply("30% deposit, balance before shipment, production 30 days."), expect: {}, absent: ["productionLeadTime"] },
  { name: "中文报价句：起订量 500 件，单价 25 元", text: reply("起订量500件，单价25元。"), expect: {}, absent: ["moq"] },
  { name: "折扣句", text: reply("For MOQ 1000 pcs we can offer a 5 discount."), expect: {}, absent: ["moq"] },
  // ── 引用截断与买家排除 ──
  {
    name: "引用的买家原信：不抽买家网站 / 港口",
    text: `Hi Mark,\n\nWell received, will revert soon.\n\nBest regards,\nLucy\n\nOn Mon, Oct 26, 2026 at 9:00 AM Mark <mark@buyer-shop.example> wrote:\n> We ship from Shanghai port.\n> Catalog: https://buyer-shop.example/catalog\n> www.buyer-shop.example`,
    expect: {},
    absent: ["loadingPorts", "catalogUrl", "signature"],
  },
  {
    name: "买家同域网址不当我方目录",
    text: reply("Here is the catalog you sent: https://www.buyer-shop.example/catalog"),
    expect: {},
    absent: ["catalogUrl"],
    opts: { buyerEmail: "mark@buyer-shop.example" },
  },
  {
    name: "WhatsApp 与买家电话相同 → 不取",
    text: reply("Ok.", "Best regards,\nLucy\nWhatsApp: +1 416 555 0199"),
    expect: {},
    absent: ["signature"],
    opts: { buyerPhone: "+1 (416) 555-0199" },
  },
  {
    name: "每个字段只取第一个值",
    text: reply("MOQ 500 pcs per color.\nFor smaller runs MOQ 300 pcs per color."),
    expect: { moq: { quantity: 500, unit: "pcs", per: "color" } },
  },
];

console.log("\n表驱动");
for (const c of CASES) {
  ok(c.name, () => {
    const got = extract(c.text, c.opts);
    for (const [field, value] of Object.entries(c.expect)) assert.deepEqual(got[field as FactField], value, field);
    for (const field of c.absent ?? []) assert.equal(got[field], undefined, `${field} 不应抽到`);
  });
}

console.log("\n辅助函数");

ok(`表驱动用例数 ≥ 20（实际 ${CASES.length}）`, () => {
  assert.ok(CASES.length >= 20);
});

ok("stripQuotedReply：> / On … wrote: / Original Message / 发件人： / 在…写道：", () => {
  assert.equal(stripQuotedReply("a\nb\n> q"), "a\nb");
  assert.equal(stripQuotedReply("a\n-----Original Message-----\nx"), "a");
  assert.equal(stripQuotedReply("a\n发件人：Mark\nx"), "a");
  assert.equal(stripQuotedReply("a\n在 2026年10月26日 Mark 写道：\nx"), "a");
  assert.equal(stripQuotedReply("a\nb"), "a\nb");
});

ok("isPriceLine：币种 / 价格词 / 百分号；FOB 本身不是价格", () => {
  for (const l of ["USD 4.8", "$5", "unit price 3", "报价如下", "10% off", "payment by T/T", "佣金 3 个点", "price list"]) assert.equal(isPriceLine(l), true, l);
  for (const l of ["FOB Ningbo", "MOQ 500 pcs", "交期 30 天", "after deposit"]) assert.equal(isPriceLine(l), false, l);
});

ok("dayRange：区间 / 单值 / 周换算 / 倒置区间无效", () => {
  assert.deepEqual(dayRange("30-35 days"), { min: 30, max: 35 });
  assert.deepEqual(dayRange("30 to 35 business days"), { min: 30, max: 35 });
  assert.deepEqual(dayRange("2~3 周"), { min: 14, max: 21 });
  assert.deepEqual(dayRange("7 天"), { min: 7, max: 7 });
  assert.equal(dayRange("45-35 days"), null);
  assert.equal(dayRange("no numbers"), null);
});

ok("canonicalPort / buyerDomain", () => {
  assert.equal(canonicalPort("宁波"), "Ningbo");
  assert.equal(canonicalPort(" ningbo "), "Ningbo");
  assert.equal(canonicalPort("Hamburg"), null);
  assert.equal(buyerDomain("mark@buyer-shop.example"), "buyer-shop.example");
  assert.equal(buyerDomain("mark@gmail.com"), null);
  assert.equal(buyerDomain(null), null);
});

ok("规范键：同一事实不同写法同一个键；港口按规范名排序去重", () => {
  assert.equal(factValueKey("moq", { quantity: 500, unit: "PCS", per: "Color" }), factValueKey("moq", { quantity: 500, unit: "pcs", per: "color" }));
  assert.equal(factValueKey("loadingPorts", ["宁波", "Shanghai"]), factValueKey("loadingPorts", ["Shanghai", "Ningbo", "ningbo"]));
  assert.equal(factValueKey("catalogUrl", "https://x.example/cat/"), factValueKey("catalogUrl", "HTTPS://X.EXAMPLE/CAT"));
  assert.notEqual(factValueKey("productionLeadTime", { daysMin: 30, daysMax: 35, startsFrom: "deposit received" }), factValueKey("productionLeadTime", { daysMin: 30, daysMax: 35, startsFrom: DEFAULT_PRODUCTION_STARTS_FROM }));
});

ok("中文展示：未配置 / 起订量 / 周期 / 港口 / 落款", () => {
  assert.equal(factValueLabel("moq", null), "未配置");
  assert.equal(factValueLabel("loadingPorts", []), "未配置");
  assert.equal(factValueLabel("moq", { quantity: 500, unit: "pcs", per: "color" }), "500 pcs / color");
  assert.equal(factValueLabel("productionLeadTime", { daysMin: 35, daysMax: 45, startsFrom: "deposit received" }), "35–45 天（自 deposit received 起）");
  assert.equal(factValueLabel("sampleLeadTime", { stockDays: 3, customDaysMin: 7, customDaysMax: 10 }), "现货样 3 天，定制样 7–10 天");
  assert.equal(factValueLabel("loadingPorts", ["Ningbo", "Shanghai"]), "Ningbo、Shanghai");
  assert.equal(factValueLabel("signature", { title: "Sales Manager", whatsapp: null, website: null }), "职位 Sales Manager");
});

ok("确定性：同一输入两次抽取结果相同；lineIndex 指向触发行", () => {
  const text = reply("MOQ is 500 pcs per color.\nLead time 30-35 days.");
  const lines = sectionedLines(stripQuotedReply(text));
  const a = extractFacts(lines);
  assert.deepEqual(a, extractFacts(lines));
  const moq = a.find((f) => f.field === "moq")!;
  assert.match(lines[moq.lineIndex].line, /MOQ/);
  const prod = a.find((f) => f.field === "productionLeadTime")!;
  assert.match(lines[prod.lineIndex].line, /Lead time/);
});

console.log(`\nfact-extract: ${pass} passed`);
