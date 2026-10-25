/**
 * 展会速记卡解析 / 校验 / 映射 纯函数测试
 * 运行：npx tsx src/lib/trade/__tests__/booth-cards.test.ts
 */

import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  BOOTH_CARD_COLUMNS,
  boothCardFromInput,
  boothCardToInquiry,
  buildBoothCardContext,
  buildBoothCardMessage,
  buildBoothCardTemplate,
  normalizeStyles,
  parseBoothCardSheet,
  validateBoothCard,
  type BoothCard,
} from "../booth-cards";
import { detectLanguage } from "@/lib/revenue-spine/normalize";
import { extractRfqHeuristic } from "@/lib/revenue-spine/rfq/heuristic-extractor";
import { detectBuyerType } from "@/lib/revenue-spine/lexicon";
import { DEFAULT_PRODUCT_KEYWORDS } from "@/lib/revenue-spine/policy";
import { resolveStyles } from "../style-references";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const EVENT = "the Canton Fair (Booth 14.3E07)";

function xlsx(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "s");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const HEADER = BOOTH_CARD_COLUMNS.map((c) => c.header);

function card(over: Partial<BoothCard> = {}): BoothCard {
  return {
    row: 2, cardNo: "CF140-0001", date: "10/31", sales: "Cathy", company: "Maple Home Goods", contactName: "Emma Brown",
    title: "Buyer", email: "emma@maplehome.example", whatsapp: "", country: "Canada", buyerType: "零售/自有品牌",
    styles: "MX-BL-001, MX-BR-001", specs: "OEKO-TEX; 280gsm", volume: "1-5柜", timing: "3个月内", nextStep: "报价, 寄样",
    grade: "A", note: "Wants own-brand gift box packaging", noteOriginal: "", voiceNote: "", ...over,
  };
}

console.log("booth-cards");

ok("模板：下载的 xlsx 用模板列名，能被同一解析器读回；示例行（卡号 0000）忘了删也不会被录入", () => {
  const buf = buildBoothCardTemplate();
  const parsed = parseBoothCardSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.deepEqual(parsed.missingColumns, []);
  assert.deepEqual(parsed.unknownColumns, []);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].card.cardNo, "CF140-0000");
  assert.deepEqual(parsed.cards[0].errors, ["这是模板的示例行（卡号 0000），请删除"]);
  // 示例行除卡号外的内容本身合法
  assert.deepEqual(validateBoothCard({ ...parsed.cards[0].card, cardNo: "CF140-0099" }), []);
});

ok("录入接口的输入同样清洗：非字符串、超长、大小写", () => {
  const c = boothCardFromInput({ cardNo: " cf140-0042 ", email: "X@Y.EXAMPLE", grade: "b", styles: "mx-bl-001", note: "n".repeat(5000), company: 42 }, 0);
  assert.equal(c.cardNo, "CF140-0042");
  assert.equal(c.email, "x@y.example");
  assert.equal(c.grade, "B");
  assert.equal(c.styles, "MX-BL-001");
  assert.equal(c.note.length, 1000);
  assert.equal(c.company, "42");
});

ok("解析：中文列名、卡号/等级/款号归一、行号从 2 起、尾部空行跳过", () => {
  const p = parseBoothCardSheet(
    xlsx([
      HEADER,
      [" cf140 – 0007 ", "11/1", "Leo", "Sol Textiles", "Ana", "", "ANA@SOL.example", "", "Spain", "进口/批发", "mx-bl-002、MX-BL-002；mx-cp-001", "", "", "", "", "a级", "", ""],
      [],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]),
  );
  assert.equal(p.cards.length, 1);
  const c = p.cards[0].card;
  assert.equal(c.row, 2);
  assert.equal(c.cardNo, "CF140-0007");
  assert.equal(c.email, "ana@sol.example");
  assert.equal(c.grade, "A");
  assert.equal(c.styles, "MX-BL-002, MX-CP-001");
  assert.deepEqual(p.cards[0].errors, []);
});

ok("解析：英文 / 变体列名也认（Card No、WhatsApp / 微信、Grade），未知列只提示", () => {
  const p = parseBoothCardSheet(
    xlsx([
      ["Card No", "Company", "Name", "WhatsApp / 微信", "Grade", "Favourite colour"],
      ["CF140-0002", "Nord AB", "Lars", "+46 70 123 4567", "B", "blue"],
    ]),
  );
  assert.deepEqual(p.unknownColumns, ["Favourite colour"]);
  assert.equal(p.cards[0].card.whatsapp, "+46 70 123 4567");
  assert.equal(p.cards[0].card.contactName, "Lars");
  assert.deepEqual(p.cards[0].errors, []);
});

ok("解析：没有卡号列 → 整表拒绝（不猜身份）", () => {
  const p = parseBoothCardSheet(xlsx([["公司", "邮箱"], ["A", "a@a.example"]]));
  assert.deepEqual(p.missingColumns, ["卡号"]);
  assert.equal(p.cards.length, 0);
});

ok("解析：CSV 文本同样可用，按原文读（10/31 不变成日期，+区号电话不变成数字）", () => {
  const p = parseBoothCardSheet("卡号,日期,公司,邮箱,WhatsApp\nCF140-0003,10/31,Acme,buyer@acme.example,+971501234567\n");
  assert.equal(p.cards.length, 1);
  assert.deepEqual(p.cards[0].errors, []);
  assert.equal(p.cards[0].card.date, "10/31");
  assert.equal(p.cards[0].card.whatsapp, "+971501234567");
});

ok("解析：Excel 里被存成日期的 10/31 输出为 月/日", () => {
  const ws = XLSX.utils.aoa_to_sheet([["卡号", "日期", "公司", "邮箱"], ["CF140-0004", new Date(2026, 9, 31), "Acme", "b@acme.example"]], { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "s");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const p = parseBoothCardSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(p.cards[0].card.date, "10/31");
});

ok("校验：同表卡号重复、缺联系方式、邮箱格式、等级、无名无公司、卡号格式", () => {
  const p = parseBoothCardSheet(
    xlsx([
      ["卡号", "公司", "联系人", "邮箱", "WhatsApp", "等级"],
      ["CF140-0010", "A Co", "", "a@a.example", "", "A"],
      ["CF140-0010", "B Co", "", "b@b.example", "", "B"],
      ["CF140-0011", "C Co", "", "", "", ""],
      ["CF140-0012", "D Co", "", "not-an-email", "", ""],
      ["CF140-0013", "E Co", "", "e@e.example", "", "S"],
      ["CF140-0014", "", "", "f@f.example", "", ""],
      ["0015", "G Co", "", "g@g.example", "", ""],
    ]),
  );
  const errs = p.cards.map((c) => c.errors.join(" | "));
  assert.equal(errs[0], "");
  assert.match(errs[1], /卡号与第 2 行重复/);
  assert.match(errs[2], /邮箱和 WhatsApp 至少填一项/);
  assert.match(errs[3], /邮箱格式不正确/);
  assert.match(errs[4], /等级只能是 A \/ B \/ C/);
  assert.match(errs[5], /公司和联系人至少填一项/);
  assert.match(errs[6], /卡号格式不对/);
});

ok("只留 WhatsApp 也能录入（与网站表单同一规则）", () => {
  assert.deepEqual(validateBoothCard(card({ email: "", whatsapp: "+971 50 123 4567" })), []);
});

ok("勾选项按字段译成英文、去重；没认出的值原样保留；款号归一", () => {
  const m = buildBoothCardMessage(card({ buyerType: "进口/批发", volume: ">5柜", timing: "有具体项目", nextStep: "报价, 寄样、视频验厂" }));
  assert.match(m, /Buyer type: importer \/ wholesaler\./);
  assert.match(m, /Volume: over five containers\./);
  assert.match(m, /Timing: has a live project\./);
  assert.match(m, /Agreed next step: quotation, samples, video factory audit\./);
  assert.match(buildBoothCardMessage(card({ buyerType: "Hotel chain", volume: "<1柜", timing: "先了解" })), /Buyer type: hotel project\.\nInterested in[^]*Volume: under one container\.\nTiming: exploring for now\./);
  assert.match(buildBoothCardMessage(card({ buyerType: "Florist" })), /Buyer type: Florist\./);
  assert.equal(normalizeStyles(" mx-bl-001 ,MX-BL-001\nmx-br-005"), "MX-BL-001, MX-BR-005");
});

ok("正文（RFQ 抽取读的）：一句一个事实，不含卡号 / 日期 / 业务员 / 等级 / 展会名；备注是中文时语言也不变中文", () => {
  const m = buildBoothCardMessage(card());
  assert.equal(
    m,
    [
      "Met at our trade show booth.",
      "Buyer type: retailer (own brand).",
      "Interested in: MX-BL-001, MX-BR-001.",
      "Requirements: OEKO-TEX; 280gsm.",
      "Volume: one to five containers.",
      "Timing: plans to buy within three months.",
      "Agreed next step: quotation, samples.",
      "Wants own-brand gift box packaging.",
    ].join("\n"),
  );
  assert.doesNotMatch(m, /CF140|10\/31|Cathy|grade|Canton/i);
  assert.notEqual(detectLanguage(buildBoothCardMessage(card({ note: "要自有品牌包装，圣诞季" }))), "zh");
});

ok("规则抽取读正文不会误判：款号不是数量、没有虚构交期、定制/包装只取所在那一句；买家类型照常识别", () => {
  // 与 Revenue Spine 实际读到的文本一致：Product 行 + 正文（换行被归一化成空格）
  const c = card({ styles: "MX-SP-202606, MX-BL-001" });
  const r = boothCardToInquiry(c, EVENT);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const text = `Product: ${r.value.product}\n${r.value.message}`;
  const ex = extractRfqHeuristic(text, { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
  assert.equal(ex.fields.quantity, null, `quantity=${ex.fields.quantity}`);
  assert.equal(ex.fields.requiredDeliveryDate, null);
  assert.equal(ex.fields.customization, null, `customization=${ex.fields.customization}`);
  assert.equal(ex.fields.packaging, "Wants own-brand gift box packaging");
  assert.equal(ex.fields.certification, "OEKO-TEX");
  assert.equal(ex.fields.sampleRequired, true);
  assert.equal(detectBuyerType(text).type, "brand");
  assert.equal(detectBuyerType(buildBoothCardMessage(card({ buyerType: "进口/批发" }))).type, "wholesaler");
  assert.equal(detectBuyerType(buildBoothCardMessage(card({ buyerType: "酒店项目" }))).type, "hotel_group");
  assert.equal(detectBuyerType(buildBoothCardMessage(card({ buyerType: "电商/亚马逊" }))).type, "ecommerce");
});

ok("有参考表时：款号写成「品类名 (ref. 款号)」，RFQ 认出产品与类目、仍不读出数量", () => {
  const styles = resolveStyles("MX-BL-001, MX-BR-001, MX-SP-202606", [
    { code: "MX-BL-001", name: "Flannel / Coral Fleece Blanket" },
    { code: "MX-BR-001", name: "Solid / Hotel / Spa Bathrobes" },
  ]);
  const m = buildBoothCardMessage(card({ styles: "MX-BL-001, MX-BR-001, MX-SP-202606" }), styles);
  assert.match(m, /Interested in reference styles: Flannel \/ Coral Fleece Blanket \(ref\. MX-BL-001\); Solid \/ Hotel \/ Spa Bathrobes \(ref\. MX-BR-001\); MX-SP-202606\./);
  const r = boothCardToInquiry(card({ styles: "MX-BL-001, MX-BR-001, MX-SP-202606" }), EVENT, styles);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const ex = extractRfqHeuristic(`Product: ${r.value.product}\n${r.value.message}`, { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
  assert.equal(ex.fields.productCategory, "blanket");
  assert.match(ex.fields.productName ?? "", /fleece blanket/i);
  assert.equal(ex.fields.quantity, null);
});

ok("时间线「展会」一行：卡上勾选项和备注原文按中文原样记录，给看中文的同事", () => {
  assert.equal(
    buildBoothCardContext(card({ noteOriginal: "要自有品牌礼盒包装，圣诞季" }), EVENT),
    "the Canton Fair (Booth 14.3E07) · 卡号 CF140-0001 · 10/31 · 业务员 Cathy · 等级 A · 职位 Buyer · 买家类型 零售/自有品牌" +
      " · 规模 1-5柜 · 时间 3个月内 · 下一步 报价, 寄样 · 规格认证 OEKO-TEX; 280gsm · 备注原文 要自有品牌礼盒包装，圣诞季",
  );
  assert.equal(
    buildBoothCardContext(card({ date: "", sales: "", grade: "", title: "", buyerType: "", volume: "", timing: "", nextStep: "", specs: "" }), ""),
    "展会 · 卡号 CF140-0001",
  );
});

ok("备注原文：表头「备注原文」读进 noteOriginal，不进给买家的正文（正文只用英文备注）", () => {
  const header = [...HEADER];
  const row = header.map((h) => {
    const f = BOOTH_CARD_COLUMNS.find((c) => c.header === h)!.field;
    return { cardNo: "CF140-0002", email: "a@b.example", grade: "B", company: "Acme", note: "Needs 3 colours", noteOriginal: "要三个颜色" }[f as string] ?? "";
  });
  const parsed = parseBoothCardSheet(xlsx([header, row]));
  assert.equal(parsed.cards.length, 1);
  assert.deepEqual(parsed.cards[0].errors, []);
  assert.equal(parsed.cards[0].card.noteOriginal, "要三个颜色");
  assert.equal(parsed.cards[0].card.note, "Needs 3 colours");
  const m = buildBoothCardMessage(parsed.cards[0].card);
  assert.match(m, /Needs 3 colours/);
  assert.doesNotMatch(m, /要三个颜色/);
  const alias = parseBoothCardSheet(xlsx([["卡号", "邮箱", "等级", "英文备注", "中文备注"], ["CF140-0003", "c@d.example", "C", "Hotel project", "酒店项目"]]));
  assert.equal(alias.cards[0].card.note, "Hotel project");
  assert.equal(alias.cards[0].card.noteOriginal, "酒店项目");
});

ok("映射：事件身份 = card:<卡号>，UTM 记来源，联系人字段落位", () => {
  const r = boothCardToInquiry(card({ whatsapp: "+1 604 555 0100" }), EVENT);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.eventId, "card:CF140-0001");
  assert.equal(r.value.name, "Emma Brown");
  assert.equal(r.value.company, "Maple Home Goods");
  assert.equal(r.value.phone, "+1 604 555 0100");
  assert.equal(r.value.product, "MX-BL-001, MX-BR-001");
  assert.deepEqual(
    { s: r.value.utm.source, m: r.value.utm.medium, c: r.value.utm.content },
    { s: "booth", m: "card", c: "CF140-0001" },
  );
  assert.match(r.value.page, /^the Canton Fair \(Booth 14\.3E07\) · 卡号 CF140-0001/);
});

console.log(`\n${pass} passed`);
