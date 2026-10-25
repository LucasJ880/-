/**
 * Revenue Spine — RFQ 抽取 / 缺失信息 / 语言 纯函数测试（无 LLM）
 * 运行：npx tsx src/lib/revenue-spine/__tests__/rfq-extract.test.ts
 */
import assert from "node:assert/strict";
import { DEFAULT_PRODUCT_KEYWORDS } from "../policy";
import { extractRfqHeuristic, INBOUND_MESSAGE_SEPARATOR } from "../rfq/heuristic-extractor";
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

ok("款号 / 编号 / 序数 / 日期里的数字不是数量；单位不能只是单词开头", () => {
  const codes = extractRfqHeuristic("Product: MX-SP-202606, MX-BL-001. Met at the 140th Canton Fair (Booth 14.3E07) on 10/31, card CF140-0101.", opts);
  assert.equal(codes.fields.quantity, null, `quantity=${codes.fields.quantity}`);
  const months = extractRfqHeuristic("We plan to order around 2,000 pcs of blankets within 3 months.", opts);
  assert.equal(months.fields.quantity, 2000);
  assert.equal(months.fields.unit, "pcs");
  const mattress = extractRfqHeuristic("Looking for 200 mattress protectors.", opts);
  assert.equal(mattress.fields.quantity, 200);
  assert.notEqual(mattress.fields.unit, "m");
  // 仍识别：连写单位、中文单位、千分位
  assert.equal(extractRfqHeuristic("need 500pcs bathrobes", opts).fields.quantity, 500);
  assert.equal(extractRfqHeuristic("需要3000条毛毯", opts).fields.quantity, 3000);
});

ok("定制 / 包装只取关键词所在的句子，并去掉句首标签", () => {
  const r = extractRfqHeuristic("Buyer type: retailer (own brand). Packaging: gift box with hang tag. Agreed next step: samples.", opts);
  assert.equal(r.fields.packaging, "gift box with hang tag");
  const ev = r.evidence.find((e) => e.field === "packaging");
  assert.equal(ev?.evidenceText, "Packaging: gift box with hang tag");
  // 数字里的小数点不算句末
  const c = extractRfqHeuristic("Embroidered logo on 8.5 inch patch, thanks", opts);
  assert.equal(c.fields.customization, "Embroidered logo on 8.5 inch patch, thanks");
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

const FORM_DETAILS = [
  "Project brief (guided form)",
  "Certification needs: OEKO-TEX",
  "Notes: We are an importer. Please quote FOB Ningbo for 2 colours.",
  "We need the first shipment before March 2027.",
  "",
  "— Form details —",
  "Estimated quantity: 3,000 pcs per colour, 2 colours",
  "Target market: Canada",
  "Buyer type: Retail & Private Label",
  "Construction: double-layer, hemmed edge",
  "Material: flannel fleece with sherpa back",
  "GSM: 300 GSM",
  "Size / specification: 127 x 152 cm",
  "Branding: care label in EN/FR",
  "Packaging: polybag + belly band, 12 per carton",
  "Required date: March 2027",
  "Sample requirement: yes",
].join("\n");
const now25 = new Date("2026-10-25T00:00:00Z");
const fx = (t: string) => extractRfqHeuristic(t, { ...opts, now: now25 }).fields;
const block = (...lines: string[]) => ["— Form details —", ...lines].join("\n");

ok("表单区块（— Form details —）：值整行照录，覆盖关键词猜测；买家类型不串进定制 / 包装", () => {
  const r = extractRfqHeuristic(FORM_DETAILS, opts);
  assert.equal(r.fields.material, "flannel fleece with sherpa back");
  assert.equal(r.fields.quantity, 3000);
  assert.equal(r.fields.unit, "pcs per colour", "单位到 per colour 为止");
  assert.equal(r.fields.customization, "care label in EN/FR", "买家类型选项不当定制，改用买家自己填的 Branding");
  assert.equal(r.fields.packaging, "polybag + belly band, 12 per carton");
  assert.equal(r.fields.size, "127 x 152 cm");
  assert.equal(r.fields.certification, "OEKO-TEX");
  assert.equal(r.fields.sampleRequired, true);
  assert.equal(r.fields.destinationCountry, "Canada");
  assert.equal(r.fields.incoterm, "FOB");
  assert.equal(r.fields.requiredDeliveryDate?.toISOString().slice(0, 10), "2027-03-31", "同一封来信里正文先说的「before March 2027」为准（按当月底读）");
  const flat = FORM_DETAILS.replace(/\s+/g, " ");
  for (const e of r.evidence) assert.ok(flat.includes(e.evidenceText.replace(/\s+/g, " ")), `${e.field} evidence must come from source`);
  const qty = r.evidence.filter((e) => e.field === "quantity");
  assert.equal(qty.length, 1);
  assert.ok(qty[0].confidence >= 0.85);
  const prose = fx("Hello,\nBuyer type: boutique hotel, we want white bamboo bath towels with our logo\nPlease quote 3000 pcs.");
  assert.equal(prose.material, "bamboo", "表单区块之外的买家类型行照常扫描（买家可能把规格写在这一行）");
});

ok("表单区块之外的「Label: value」不覆盖关键词扫描（邮件里常是占位、模糊回答、引用旧内容）", () => {
  const mail = fx("Dear Sir,\nWe would like a quotation for hotel bath linen.\nMaterial: see below\nQuantity: 3,000 pcs\n- Bath towel 70x140cm, 100% cotton terry, 600gsm");
  assert.notEqual(mail.material, "see below");
  assert.equal(mail.quantity, 3000);
  const discount = fx("We need bath towels.\nQuantity: 5000 pcs if you give 10% discount");
  assert.equal(discount.unit, "pcs");
});

ok("表单区块里没答 / 占位 / yes-no / 认证不在词表：不覆盖", () => {
  const r = fx(["We need flannel blankets, 3000 pcs.", "", block("Material: please advise", "Certification needs: Required", "Size / specification: Custom — specify in message", "Branding: Yes")].join("\n"));
  assert.equal(r.material, "flannel");
  const punct = fx(["We need 100% cotton bath towels, 3000 pcs, 70x140cm.", "", block("Material: -", "Size / specification: see photo")].join("\n"));
  assert.equal(punct.material, "100% cotton", "只有标点的值不是答案");
  assert.equal(punct.size, "70x140cm", "see photo 不是答案");
  assert.equal(r.certification, null);
  assert.equal(r.size, null);
  assert.equal(r.customization, null);
  const body = "We need 100% cotton bath towels, 3000 pcs, 70x140cm. Our logo embroidered on the border, each towel in a poly bag.";
  for (const v of ["No requirement", "Later", "n.a.", "same", "As described above", "无", "暂时没有"]) {
    assert.equal(fx([body, "", block(`Material: ${v}`)].join("\n")).material, "100% cotton", `Material: ${v}`);
  }
  for (const v of ["normal", "several sizes", "如图", "后面再说"]) {
    assert.equal(fx([body, "", block(`Size / specification: ${v}`)].join("\n")).size, "70x140cm", `Size: ${v}`);
  }
  for (const v of ["maybe", "Later", "As above", "We will discuss"]) {
    assert.notEqual(fx([body, "", block(`Branding: ${v}`)].join("\n")).customization, v, `Branding: ${v}`);
  }
  assert.equal(fx(["Need 3000 bath towels.", "", block("Material: Later")].join("\n")).material, null, "没写材质时也不把 Later 当材质");
  const cert = fx(block("Certification needs: OEKO-TEX certified. Please send the certificate.", "Material: *cotton terry*"));
  assert.equal(cert.certification, "OEKO-TEX");
  assert.equal(cert.material, "cotton terry");
  const zh = fx(["需要法兰绒毯2000条。", "", block("Sample requirement: 不需要", "Packaging: 每条一个PE袋，20条一箱")].join("\n"));
  assert.equal(zh.sampleRequired, true, "样品不按表单覆盖（正文、标签里提到样品照原样记为要样品）");
  assert.equal(zh.packaging, "每条一个PE袋，20条一箱");
  assert.equal(fx(["Need 3000 bath towels.", "", block("Sample requirement: yes")].join("\n")).sampleRequired, true);
  assert.equal(fx(["Need 3000 bath towels.", "", block("Size / specification: S/M and L/XL")].join("\n")).size, "S/M and L/XL", "整个值都是尺码词时照录");
  assert.equal(fx(["Need 3000 bath towels.", "", block("Size / specification: it's the same as above")].join("\n")).size, null, "it's 里的 s 不是尺码");
});

ok("表单数量只在说得清时采用：样品 / 每箱 / 起订量 / 试单 / 多个带单位的数交给关键词扫描；Pieces 记成 pcs；只写数字时沿用正文单位", () => {
  assert.equal(fx(["Hi, we'd like hotel bath towels.", "", block("Estimated quantity: 2 pcs samples first, then 3,000 pcs")].join("\n")).quantity, 3000);
  assert.equal(fx(["Need bath towels.", "", block("Estimated quantity: 20 pcs per carton, 5000 pcs total")].join("\n")).quantity, 5000);
  assert.equal(fx(["Please quote bath towels.", "", block("Estimated quantity: MOQ 500 pcs? We plan 2,000 pcs")].join("\n")).quantity, 2000);
  assert.equal(fx(["Two colours: navy and grey.", "", block("Qty: 2 colours x 1500 pcs")].join("\n")).quantity, null, "乘数写法不按每款数量算");
  const ali = fx(["Need bath towels.", "", block("Estimated quantity: 5000 Piece/Pieces")].join("\n"));
  assert.equal(ali.quantity, 5000);
  assert.equal(ali.unit, "piece", "关键词读到了单位：表单不改写（只能细化）");
  const meters = fx(["We need 5000 meters of blackout curtain fabric.", "", block("Estimated quantity: 5000")].join("\n"));
  assert.equal(meters.unit, "meters");
  const sets = fx(["We need 3,000 sets of duvet cover sets.", "", block("Estimated quantity: 4000")].join("\n"));
  assert.equal(sets.quantity, 3000, "同一封来信里正文先说的数量为准");
  assert.equal(sets.unit, "sets");
  const cartonText = ["Need bath towels.", "", block("Estimated quantity: 3000", "Packaging: 24 pcs per carton, about 125 cartons")].join("\n");
  assert.deepEqual(fx(cartonText).quantity, fx(cartonText.split("— Form details —").join("Form details")).quantity, "关键词读到了另一个数：表单不改写");
});

ok("多封来信：表单只用于单独一封、只含一个区块的来信；只要有多封，结果与没有表单层时一样", () => {
  const noForm = (t: string) => fx(t.split("— Form details —").join("Form details"));
  const form = ["Product: Bath towels", "", block("Estimated quantity: 3,000 pcs per colour", "Material: flannel fleece with sherpa back", "Required date: March 2027", "Destination: Toronto, Canada")].join("\n");
  const fresh = fx(form);
  assert.equal(fresh.unit, "pcs per colour");
  assert.equal(fresh.material, "flannel fleece with sherpa back");
  assert.equal(fresh.requiredDeliveryDate?.toISOString().slice(0, 10), "2027-03-31");
  for (const reply of ["Hi Lily, our launch moved up, we need delivery by Feb 15, 2027.", "Hi, after checking with my team we need 5,000 pcs now.", "Sizes are 70x140cm please."]) {
    const t = form + INBOUND_MESSAGE_SEPARATOR + reply;
    assert.deepEqual(fx(t), noForm(t), reply);
  }
  const twice = block("Estimated quantity: 3,000 pcs") + INBOUND_MESSAGE_SEPARATOR + block("Estimated quantity: 4,000 pcs");
  assert.deepEqual(fx(twice), noForm(twice), "两次提交");
  const emailThenForm = "We need 3,000 sets of duvet cover sets." + INBOUND_MESSAGE_SEPARATOR + ["Updated brief:", "", block("Estimated quantity: 4000 pcs")].join("\n");
  assert.deepEqual(fx(emailThenForm), noForm(emailThenForm), "先来邮件、后提交表单：多封来信，也按原有关键词扫描");
});

ok("目的地：正文里买家提到了交货地就以正文为准；没提时用表单的国家", () => {
  const noForm = (t: string) => fx(t.split("— Form details —").join("Form details"));
  const mentioned = ["Need 3000 bath towels, our Toronto team will receive them.", "", block("Destination: USA")].join("\n");
  assert.deepEqual(fx(mentioned), noForm(mentioned));
  const formOnly = fx(["Need 3000 bath towels.", "", block("Destination: Vancouver, Canada")].join("\n"));
  assert.equal(formOnly.destinationCountry, "Canada");
  assert.equal(formOnly.destinationCity, "Vancouver");
});

ok("买家自己说的 minimum order quantity of N 照算", () => {
  assert.equal(fx("Hello, we are a small boutique. Can you accept a minimum order quantity of 300 pcs for velvet cushion covers 45x45cm?").quantity, 300);
});

ok("第二次提交的是别的产品：不拿它的字段改前一个产品", () => {
  const r = fx(["Product: Flannel blankets", block("Estimated quantity: 5,000 pcs", "Size / specification: 127 x 152 cm")].join("\n") + INBOUND_MESSAGE_SEPARATOR + ["Product: Cushion covers", block("Estimated quantity: 800 pcs", "Size / specification: 45x45cm")].join("\n"));
  assert.equal(r.quantity, 5000);
  assert.equal(r.size, "127 x 152 cm");
});

ok("表单里的买家类型选项不当定制 / 包装；买家在这一行写长句的不动", () => {
  const opt = fx(["Product: Flannel blankets", "", block("Estimated quantity: 2000 pcs", "Buyer type: Retail & Private Label", "Material: flannel")].join("\n"));
  assert.equal(opt.customization, null);
  assert.equal(opt.packaging, null);
  const long = fx(["Please send your best offer.", "", block("Estimated quantity: 3000 pcs", "Business type: Hotel supplier, need white 100% cotton towels with embroidered logo")].join("\n"));
  assert.equal(long.material, "100% cotton");
  assert.equal(long.color, "white");
});

ok("交期：early / mid 取 10 / 15 日（不说成月底）；只给月份不落到过去；before end of；not before 不算 before", () => {
  const d = (t: string) => fx(t).requiredDeliveryDate?.toISOString().slice(0, 10) ?? null;
  assert.equal(d(["We need 3000 bath towels.", "", block("Required date: early March 2027")].join("\n")), "2027-03-10");
  assert.equal(d("We need 3000 bath towels by mid-March 2027. We started our business in May 2010."), "2027-03-15", "不跳到后面不相干的月份");
  assert.equal(d("We need 3000 bath towels before October."), "2026-10-31", "没写年份时取不早于今天的那一年");
  assert.equal(d("We need 3000 bath towels by September."), "2027-09-30");
  assert.equal(d("We cannot receive goods before March 2027 (warehouse full). Need 2,000 sheets."), "2027-03-31", "before 一律按当月底，否定句不会读反");
  assert.equal(d("We need 3000 bath towels before end of March 2027."), "2027-03-31");
  assert.equal(d("Note our warehouse is closed until the end of January. Please deliver 900 throws in March."), "2027-03-31", "「the end of」不认（常是别的事情的期限）");
  assert.equal(d("Please do not ship before March because our warehouse is full."), "2027-03-31", "not before March 不是 2 月底");
});

ok("第六轮审查用例：否定的定制 / 认证、后来的来信改尺码 / 改期 / 要样品、买家类型行、同类别别的产品、表情符号", () => {
  const q = "Product: Bath towels\nPlease quote.\n\n— Form details —\nEstimated quantity: 3000 pcs\n";
  for (const v of ["plain, no logos", "your brand is fine", "Label-free / no tags", "we don't need labels"]) {
    const f = fx(q + `Branding: ${v}`);
    assert.notEqual(f.customization, v, `Branding: ${v}`);
  }
  assert.notEqual(fx(q + "Certification: CE marking not needed, just OEKO-TEX").certification, "CE, OEKO-TEX");
  const later = (form: string, reply: string) => fx(q + form + INBOUND_MESSAGE_SEPARATOR + reply);
  assert.notEqual(later("Size / specification: Queen", "Hi, please switch everything to King, thanks.").size, "Queen");
  assert.notEqual(later("Required date: March 2027", "Change of plan: we need them for Christmas.").requiredDeliveryDate?.toISOString().slice(0, 10), "2027-03-31");
  assert.notEqual(later("Sample requirement: No", "Please send 2 pcs for lab testing first.").sampleRequired, false);
  const logo = fx(q + "Buyer type: Private label\nPackaging: gift box with our logo printed");
  assert.equal(logo.customLogo, true, "包装行里写的 logo 照算定制");
  const utm = fx(q + "Buyer type: Retail & Private Label\nUTM：source=google medium=cpc campaign=oem_logo_towels");
  assert.doesNotMatch(utm.customization ?? "", /campaign|source=/);
  const twoProducts = fx("Product: Bath towels\nQuote towels.\n\n— Form details —\nEstimated quantity: 3000 pcs" + INBOUND_MESSAGE_SEPARATOR + "Product: Beach towels\nAnd beach towels to Australia.\n\n— Form details —\nEstimated quantity: 1000 pcs");
  assert.equal(twoProducts.quantity, 3000);
  assert.equal(fx(q + "Material: Cotton 🙂").material, "Cotton");
});

ok("第七轮审查用例：定制值里的各种否定、认证与样品不按表单覆盖、区块后的 P.S.、泛称产品、❌ 标记、来源行", () => {
  const q = "Product: Bath towels\nPlease quote.\n\n— Form details —\nEstimated quantity: 3000 pcs\n";
  // 这些值表单层不采用：结果与去掉表单标记（只走关键词扫描）时完全一样
  const noForm = (t: string) => fx(t.replace("— Form details —", "Form details"));
  for (const v of ["we won't need logos", "brandless, generic labels are fine", "可以不印字", "素色，暂不绣花", "Logo ❌", "logo maybe later"]) {
    const a = fx(q + `Branding: ${v}`);
    const b = noForm(q + `Branding: ${v}`);
    assert.deepEqual([a.customization, a.customLogo], [b.customization, b.customLogo], `Branding: ${v}`);
  }
  assert.notEqual(fx(q + "Certification: GOTS, FSC isn't required").certification, "GOTS, FSC");
  assert.equal(fx("Product: 浴巾\n先寄样品看看\n\n— Form details —\nEstimated quantity: 3000条\nSample requirement: 不需要").sampleRequired, true);
  assert.match(fx(q + "Branding: embroidered logo\n\nP.S. we changed our mind: printed logo instead").customization ?? "", /printed logo/);
  const generic = fx("Product: Other / custom textile\nBlackout curtains.\n\n— Form details —\nEstimated quantity: 600 pcs\nSize / specification: 140x260cm" + INBOUND_MESSAGE_SEPARATOR + "Product: Other / custom textile\nAlso cushions.\n\n— Form details —\nEstimated quantity: 200 pcs\nSize / specification: 45x45cm");
  assert.equal(generic.size, "140x260cm");
  assert.doesNotMatch(fx(q + "Buyer type: Private label\nInquiry source: Logo towels landing page").customization ?? "", /landing page/i);
});

ok("第十轮审查用例：表单值只能补上或细化，不能改成另一个；正文里任何数量说法都算提到", () => {
  const q = "Product: Bath towels\nPlease quote.\n\n— Form details —\nEstimated quantity: 3000 pcs\n";
  assert.equal(fx(q + "Target market: USA\nDestination: Birmingham, Alabama").destinationCountry, "United States", "不把美国改成英国");
  assert.equal(fx("Product: Bath towels\nHi\n\n— Form details —\nQuantity: 3000\nNotes: total 8,000").quantity, 8000);
  assert.equal(fx(q + "Material: Fabric").material, null, "Fabric 不是面料");
  assert.equal(fx(q + "Material: Cotton,").material, "Cotton", "去掉尾部标点");
  assert.equal(fx(q + "Construction: organic cotton terry, double-layer\nMaterial: cotton").material, "organic cotton", "不把更具体的材质改粗");
  assert.notEqual(fx("Product: Bathrobes\nBathrobes S-L, 500 each colour.\n\n— Form details —\nEstimated quantity: 2000 pcs\nSize / specification: XL").size, "XL", "正文写了尺码区间");
  const zh = fx("Product: 毛巾\n您好，请报价。\n\n— Form details —\n买家类型：电商卖家，要印我们的logo，每条独立包装\n数量：3000 条");
  assert.ok(zh.customization || zh.customLogo, "长句的买家类型行不当选项抹掉");
  const t = "Product: Bath towels\nPlease quote.\n\n— Form details —\nEstimated quantity: 3,000 pcs\nPackaging: polybag" + " ".repeat(19800) + "x";
  const started = Date.now();
  fx(t);
  assert.ok(Date.now() - started < 500, "长空白不能让抽取变慢");
});

ok("第十一轮审查用例：正文里的 5k / 3万 / 2000 robes、by the 15th、medium 都算提到；装箱数不当数量；Queen; 160x200cm；Notes 行与链接", () => {
  const noForm = (t: string) => fx(t.split("— Form details —").join("Form details"));
  const same = (t: string, note: string) => assert.deepEqual(fx(t), noForm(t), note);
  same("Looking for 5k towels for a promo.\n\n— Form details —\nEstimated quantity: 500", "5k");
  same("Product: 浴巾\n总量3万，请报价。\n\n— Form details —\n预计数量: 3000", "3万");
  same("Product: Bathrobes\nPlease change it to 2000 robes.\n\n— Form details —\nEstimated quantity: 1500", "2000 robes");
  same("Product: Bath towels\nMust arrive by the 15th.\n\n— Form details —\nEstimated quantity: 3000 pcs\nRequired date: March 2027", "by the 15th");
  same("Product: Bathrobes\nMedium is our best seller, please quote medium.\n\n— Form details —\nEstimated quantity: 2000 pcs\nSize / specification: XL", "medium");
  same("Product: Bath towels\nPlease send your best price.\n\n— Form details —\nEstimated quantity: 1,200 towels in 20 cartons", "装箱数");
  assert.equal(fx("Product: Bed sheets\nPlease quote.\n\n— Form details —\nEstimated quantity: 3000 pcs\nSize / specification: Queen; 160x200cm").size, "160x200cm");
  const notes = fx("Product: Bath towels\nPlease quote.\n\n— Form details —\nEstimated quantity: 3000 pcs\nBuyer type: Retail & Private Label\nMaterial: 100% cotton terry\nNotes: Need embroidered logo on each towel");
  assert.equal(notes.customLogo, true, "区块里 Notes 行写的 logo 照算");
  const link = fx("Product: Bath towels\nProject brief (guided form)\nNotes: Our store: https://www.example-shop.com/collections/logo-towels\n\n— Form details —\nEstimated quantity: 3000 pcs\nBuyer type: Retail & Private Label");
  assert.doesNotMatch(link.customization ?? "", /example-shop|collections/);
});

ok("第十二轮审查用例：表单值只能补上或细化关键词结果；买家类型选项的定制 / 包装用买家自己的答案或作废", () => {
  const noForm = (t: string) => fx(t.split("— Form details —").join("Form details"));
  const t1 = "Product: Bath towels\nHi, please quote 3000 pcs. Price term=FOB Ningbo.\n\n— Form details —\nIncoterm: CIF";
  assert.equal(fx(t1).incoterm, noForm(t1).incoterm, "正文的 FOB 不被表单 CIF 改写");
  const t2 = "Product: Bath towels\nPlease quote.\n\n— Form details —\nEstimated quantity: 3,000 bath towels + 20 sets for the lobby";
  assert.equal(fx(t2).quantity, noForm(t2).quantity, "不读成 20 sets");
  const ref = fx("Product: Bath towels\nPlease quote.\n\n— Form details —\nBuyer type: Retail & Private Label\nEstimated quantity: 3000 pcs\nReferrer: blog.example.org/custom-logo-towels");
  assert.doesNotMatch(ref.customization ?? "", /blog\.example/);
  const poly = "Product: Bath towels\nPlease quote.\n\n— Form details —\nEstimated quantity: 3000 pcs\nBuyer type: Amazon seller polybag";
  assert.equal(fx(poly).packaging, noForm(poly).packaging, "买家类型行里写了包装要求就不当选项");
  const zh = "Product: 浴巾\n你好\n\n— Form details —\n预计数量: 3000\n留言：其实我们需要5000条，3月底前到货";
  assert.equal(fx(zh).quantity, noForm(zh).quantity, "留言行算买家自己写的");
});

ok("第十三轮审查用例：金额不当数量、m2 不是 m、per size run、尺寸后的大写词、中文里的链接、FOC 与授权字眼、带 hang tags 的买家类型", () => {
  const q = "Product: Blankets\nPlease quote.\n\n— Form details —\n";
  assert.equal(fx(q + "Estimated quantity: $5,000").quantity, null);
  assert.equal(fx(q + "Estimated quantity: USD 5000").quantity, null);
  assert.notEqual(fx("Product: Blackout fabric\nPlease quote.\n\n— Form details —\nEstimated quantity: 3000 m2").unit, "m");
  assert.notEqual(fx(q + "Estimated quantity: 500 pcs per size run (S-XL)").unit, "pcs per size");
  assert.equal(fx("Product: Mattress Protectors\nHello.\n\n— Form details —\nEstimated quantity: 2000 pcs\nSize / specification: 160x200 Mattress protector").size, "160x200");
  assert.equal(fx("您好，我们的网站是https://www.homeco.com：货发到洛杉矶，请报价。\n\n— Form details —\n目的地：美国纽约").destinationCity, "洛杉矶");
  const foc = fx("Project brief (guided form)\n\n— Form details —\nEstimated quantity: 3,000 pcs\nBuyer type: Retail & Private Label\nMaterial: cotton terry\nBranding: Logo printing FOC");
  assert.doesNotMatch(foc.customization ?? "", /FOC/);
  const tags = "Hi, please quote 3,000 bath towels 70x140cm, cotton, to Toronto, Canada by March 2027.\n\n— Form details —\nBuyer type: Private label + hang tags";
  assert.deepEqual([fx(tags).customization, fx(tags).packaging], [fx(tags.split("— Form details —").join("Form details")).customization, fx(tags.split("— Form details —").join("Form details")).packaging]);
});

ok("第十四轮审查用例：自己的 Branding / Packaging 答案只收普通用词；单位修饰须收尾；尺寸单位区分大小写", () => {
  const noForm = (t: string) => fx(t.split("— Form details —").join("Form details"));
  const b = "Project brief (guided form)\n\n— Form details —\nOrder type: OEM\nEstimated quantity: 3,000 pcs\nBuyer type: Retail & Private Label\nMaterial: cotton terry\n";
  for (const v of ["Embroidered logo, setup fee waived", "Embroidered Lacoste crocodile logo", "logo-less", "Embroidered logo, no wait, printed"]) {
    const t = b + `Branding: ${v}`;
    assert.deepEqual([fx(t).customization, fx(t).customLogo], [noForm(t).customization, noForm(t).customLogo], `Branding: ${v}`);
  }
  const plain = fx(b + "Branding: Embroidered logo on hem, 5cm");
  assert.equal(plain.customization, "Embroidered logo on hem, 5cm");
  assert.equal(plain.customLogo, true);
  assert.equal(fx(b + "Branding: printed care label EN/FR").customLogo, null, "洗标不是 logo");
  assert.equal(fx("Product: 床品\n您好\n\n— Form details —\n包装：礼盒包邮").packaging, noForm("Product: 床品\n您好\n\n— Form details —\n包装：礼盒包邮").packaging);
  assert.notEqual(fx("Product: Bathrobes\nHello.\n\n— Form details —\nEstimated quantity: 1200 pcs per size curve").unit, "pcs per size");
  assert.notEqual(fx("Product: 浴袍\n您好，请报价。\n\n— Form details —\n数量: 1000件/码段").unit, "件 per 码");
  assert.equal(fx("Product: Blankets\nHello.\n\n— Form details —\nEstimated quantity: 2000 pcs\nSize / specification: 150X200 IN GREY").size, "150X200");
});

ok("中文日期保持原有读法（只给月份按 1 日、写了日按当天）", () => {
  const d = (t: string) => fx(t).requiredDeliveryDate?.toISOString().slice(0, 10) ?? null;
  assert.equal(d("需要3000条浴巾，2027年3月交货"), "2027-03-01");
  assert.equal(d("需要3000条浴巾，2027年3月15日交货"), "2027-03-15");
});

ok("交期：before / by <月份> 都按当月底（原有读法）", () => {
  const before = extractRfqHeuristic("We need 3,000 blankets before March 2027.", opts);
  assert.equal(before.fields.requiredDeliveryDate?.toISOString().slice(0, 10), "2027-03-31");
  const by = extractRfqHeuristic("We need 3,000 blankets by March 2027.", opts);
  assert.equal(by.fields.requiredDeliveryDate?.toISOString().slice(0, 10), "2027-03-31");
});

console.log(`\n${pass} passed`);
