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
  { name: "MOQ 没写按什么计 → per 为 null（起卡时沿用当前值）", text: reply("MOQ 2000 m for this fabric."), expect: { moq: { quantity: 2000, unit: "m", per: null } } },
  {
    name: "低于起订量：取关键词之后的数字，不取买家的数量",
    text: reply("Your order of 300 pcs is below our MOQ of 500 pcs per color."),
    expect: { moq: { quantity: 500, unit: "pcs", per: "color" } },
  },
  { name: "中文：您要的 300 件低于起订量 500 件", text: reply("您要的300件低于我们的起订量500件"), expect: { moq: { quantity: 500, unit: "pcs", per: null } } },
  { name: "数字在关键词之前：500 pcs MOQ per color", text: reply("500 pcs MOQ per color"), expect: { moq: { quantity: 500, unit: "pcs", per: "color" } } },
  { name: "中文：每色500件起订（数字紧挨关键词）", text: reply("每色500件起订"), expect: { moq: { quantity: 500, unit: "pcs", per: "color" } } },
  { name: "低于起订量（关键词后没有数字）：不取买家的 300", text: reply("Sorry, 300 pcs is below our MOQ."), expect: {}, absent: ["moq"] },
  { name: "低于起订量 + 分句后才给 500：不取 300", text: reply("300 pcs is below our MOQ, could you increase to 500 pcs?"), expect: {}, absent: ["moq"] },
  { name: "中文：300件低于起订量，建议每色 500 件 → 不取 300", text: reply("300件低于我们的起订量，建议每色 500 件。"), expect: {}, absent: ["moq"] },
  {
    name: "中文长句：消费者 / 宁波港 不误杀，起订量与大货周期照抽",
    text: reply("您好，我们是宁波的窗帘工厂，产品深受欧美消费者喜爱，起订量每色500件，大货周期30天，从宁波港出货。"),
    expect: { moq: { quantity: 500, unit: "pcs", per: "color" }, productionLeadTime: { daysMin: 30, daysMax: 30, startsFrom: null } },
  },
  {
    name: "in charge of / CAD drawing 不误杀",
    text: reply("Thanks for your inquiry. I am in charge of your account. Our MOQ is 500 pcs per color and lead time is 30-35 days."),
    expect: { moq: { quantity: 500, unit: "pcs", per: "color" }, productionLeadTime: { daysMin: 30, daysMax: 35, startsFrom: null } },
  },
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
    expect: { sampleLeadTime: { stockDays: null, customDaysMin: 7, customDaysMax: 7 }, productionLeadTime: { daysMin: 25, daysMax: 30, startsFrom: null } },
  },
  { name: "账期不是大货周期：60 days credit after delivery", text: reply("We can offer 60 days credit after delivery."), expect: {}, absent: ["productionLeadTime"] },
  { name: "海运时间不是大货周期", text: reply("Delivery to your warehouse takes 25-30 days by sea."), expect: {}, absent: ["productionLeadTime"] },
  { name: "中文：海运 25 天不是大货周期", text: reply("海运到港大约25天。"), expect: {}, absent: ["productionLeadTime"] },
  { name: "产前样时效不是大货周期", text: reply("Pre-production sample takes 5 days."), expect: {}, absent: ["productionLeadTime", "sampleLeadTime"] },
  // ── 装运港 ──
  { name: "FOB Ningbo or Shanghai（无价格）", text: reply("We ship FOB Ningbo or Shanghai."), expect: { loadingPorts: ["Ningbo", "Shanghai"] } },
  { name: "中文：装运港青岛", text: reply("装运港：青岛"), expect: { loadingPorts: ["Qingdao"] } },
  { name: "提到城市但不是港口语境 → 不抽", text: reply("Our factory is in Shanghai."), expect: {}, absent: ["loadingPorts"] },
  { name: "目的港不是装运港", text: reply("Destination port: Hong Kong."), expect: {}, absent: ["loadingPorts"] },
  { name: "中文：目的港香港", text: reply("目的港：香港"), expect: {}, absent: ["loadingPorts"] },
  // ── 目录 ──
  { name: "目录链接", text: reply("Please find our catalog here: https://example-home.example/catalog.pdf."), expect: { catalogUrl: "https://example-home.example/catalog.pdf" } },
  { name: "中文：产品目录 www 链接 → 补 https://", text: reply("产品目录：www.example-home.example/catalog"), expect: { catalogUrl: "https://www.example-home.example/catalog" } },
  { name: "http:// 目录链接不收（合并规则只收 https）", text: reply("Catalog: http://example-home.example/catalog"), expect: {}, absent: ["catalogUrl"] },
  { name: "大写 HTTPS:// 目录链接 → scheme 转小写", text: reply("Catalog: HTTPS://example-home.example/Catalog"), expect: { catalogUrl: "https://example-home.example/Catalog" } },
  // ── 落款 ──
  {
    name: "落款：职位 / WhatsApp / 网站",
    text: reply("Thanks for your inquiry.", "Best regards,\nLucy Wang\nSales Manager\nWhatsApp: +86 138 0013 8000\nwww.example-home.example"),
    expect: { signature: { title: "Sales Manager", whatsapp: "+86 138 0013 8000", website: "www.example-home.example" } },
  },
  {
    name: "落款：WhatsApp/WeChat 合写；LinkedIn 不当网站",
    text: reply("Thanks.", "Best regards,\nLucy\nWhatsApp/WeChat: +86 138 0013 8000\nhttps://www.linkedin.com/in/lucy-example\nwww.example-home.example"),
    expect: { signature: { title: null, whatsapp: "+86 138 0013 8000", website: "www.example-home.example" } },
  },
  {
    name: "P.S. 一句话不当职位",
    text: reply("Noted.", "Best regards,\nLucy\nP.S. Our sales manager will call you tomorrow"),
    expect: {},
    absent: ["signature"],
  },
  {
    name: "Yours faithfully 也算结束语：签名口号不当事实抽",
    text: reply("Noted.", "Yours faithfully,\nLily\nFast delivery in 15 days | Ship from Ningbo port"),
    expect: {},
    absent: ["productionLeadTime", "loadingPorts"],
  },
  {
    name: "没有结束语的短回复：最后一段不当签名跳过",
    text: "Hi Mark,\n\nMOQ is 500 pcs per color.",
    expect: { moq: { quantity: 500, unit: "pcs", per: "color" } },
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
  { name: "币种紧贴数字：MOQ 500 pcs at USD4.80 FOB Ningbo", text: reply("MOQ 500 pcs at USD4.80 FOB Ningbo."), expect: {}, absent: ["moq", "loadingPorts"] },
  { name: "中文：起订量 500 件，25 元/件", text: reply("起订量500件，25元/件。"), expect: {}, absent: ["moq"] },
  { name: "样品费句：不抽样品时效", text: reply("Sample fee is 50, samples ready in 7 days."), expect: {}, absent: ["sampleLeadTime"] },
  { name: "免费样品句：不抽样品时效", text: reply("Free samples within 7 days."), expect: {}, absent: ["sampleLeadTime"] },
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

ok("isPriceLine：币种（含紧贴数字）/ 金额单位 / 价格与费用词 / 账期 / 百分号；FOB 本身不是价格", () => {
  for (const l of [
    "USD 4.8",
    "USD4.80 FOB",
    "RMB25/pc",
    "EUR4.8/pc",
    "CNY 30",
    "4.8美元/件",
    "人民币25一件",
    "25元/件",
    "30块一件",
    "4.80 dollars each",
    "Sample fee is 50",
    "运费另计",
    "$5",
    "unit price 3",
    "报价如下",
    "10% off",
    "payment by T/T",
    "60 days credit",
    "net 30",
    "佣金 3 个点",
    "price list",
    "free sample",
    "样品免费",
    "free of charge",
    "CAD 25",
    "25 CAD",
    "HKD100",
    "30块一件",
    "25元每件",
    "样品费 50",
    "收费标准",
  ])
    assert.equal(isPriceLine(l), true, l);
  for (const l of [
    "FOB Ningbo",
    "MOQ 500 pcs",
    "交期 30 天",
    "after deposit",
    "Europe market",
    "Lead time 30-35 days after deposit received",
    "产品深受欧美消费者喜爱",
    "我们的电子元件起订量 1000 个，交期 25 天。",
    "元旦前可以安排生产，大货周期 30 天。",
    "样品 3 块，7 天寄出。",
    "Please send the CAD drawing, samples ready in 7 days, bulk 30 days.",
    "I am in charge of your account.",
    "元丰家纺",
  ])
    assert.equal(isPriceLine(l), false, l);
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
  assert.equal(canonicalPort("Ningbo Port"), "Ningbo");
  assert.equal(canonicalPort("宁波港"), "Ningbo");
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
  assert.equal(factValueLabel("moq", { quantity: 500, unit: "pcs", per: null }), "500 pcs");
  assert.equal(factValueLabel("productionLeadTime", { daysMin: 30, daysMax: 30, startsFrom: null }), "30 天");
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
  // 落款的证据行是第一个抽到子字段的行，不是 "Best regards,"
  const sigLines = sectionedLines(reply("Thanks.", "Best regards,\nLucy Wang\nSales Manager\nwww.example-home.example"));
  const sig = extractFacts(sigLines).find((f) => f.field === "signature")!;
  assert.equal(sigLines[sig.lineIndex].line, "Sales Manager");
});

console.log(`\nfact-extract: ${pass} passed`);
