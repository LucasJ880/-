/**
 * B-1 询盘回复草稿结构化 diff 与买家信息替换（openspec change fde-feedback-loop，spec revenue-spine/fde-draft-feedback）
 * 运行：npx tsx src/lib/revenue-spine/fde/__tests__/draft-diff.test.ts
 */
import {
  PII_PLACEHOLDERS,
  buildDraftDiff,
  captureNumbers,
  classifyParagraphs,
  draftContentHash,
  maskBuyerPii,
  normalizeDraftBody,
} from "../draft-diff";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 500)}`}`);
  }
}

// 与 reply-draft.ts 英文首封模板同结构
const EN = [
  "Dear John,",
  "",
  "Thank you for contacting Sunny Home Deco on behalf of Acme Home Ltd. We have received your inquiry about blackout roller blinds.",
  "",
  "Here is our understanding of your requirement — please confirm:",
  "- Quantity: 2,000 sets",
  "- Size: 120 x 180 cm",
  "",
  "To prepare an accurate quotation, could you please let us know:",
  "1. Which fabric colours do you need?",
  "2. What is your target delivery date?",
  "",
  "Regarding MOQ and pricing: our team will confirm these internally once we have the details above and revert to you with a formal reply.",
  "",
  "We look forward to hearing from you.",
  "",
  "Best regards,",
  "Lucas",
  "Sales Manager",
  "Sunny Home Deco",
  "WhatsApp +1 416 555 0100",
].join("\n");

// 与 reply-draft.ts 中文首封模板同结构（无结束语，落款直接跟在最后）
const ZH = [
  "张先生，您好：",
  "",
  "感谢您通过官网联系 晴朗家居，我们已收到您关于遮光卷帘的询盘。",
  "",
  "我们对需求的理解如下，请确认：",
  "- 数量：2000 套",
  "",
  "为便于准确核算并给您报价，请补充以下信息：",
  "1. 需要哪些颜色？",
  "2. 期望交期是什么时候？",
  "",
  "关于MOQ、价格：以上均需内部确认，我们会在收到上述信息后尽快给您正式答复。",
  "",
  "期待您的回复。",
  "",
  "李明",
  "晴朗家居",
].join("\n");

const sectionsOf = (body: string) => classifyParagraphs(body).map((p) => p.section);

console.log("段落分类");
ok(JSON.stringify(sectionsOf(EN)) === JSON.stringify(["greeting", "facts", "facts", "questions", "facts", "facts", "signature"]), "英文首封：问候 / 事实 / 确认事实 / 追问 / 待确认 / 结尾句 / 签名", sectionsOf(EN));
ok(JSON.stringify(sectionsOf(ZH)) === JSON.stringify(["greeting", "facts", "facts", "questions", "facts", "facts", "signature"]), "中文首封：无结束语时最后的短行块是签名", sectionsOf(ZH));
{
  const followZh = ["张先生，您好：", "", "跟进一下我在 10 月 20 日发给您的邮件。为了给您准确报价，还需要以下几点信息：", "1. 预计采购数量？", "", "祝好！", "李明", "晴朗家居"].join("\n");
  ok(JSON.stringify(sectionsOf(followZh)) === JSON.stringify(["greeting", "questions", "signature"]), "中文跟进：祝好！及其后是签名", sectionsOf(followZh));
  const inline = ["Hi Anna,", "", "Thanks for the update.", "Best regards,", "Lucas"].join("\n");
  ok(JSON.stringify(sectionsOf(inline)) === JSON.stringify(["greeting", "facts", "signature"]), "结束语与正文同段：之前的行按正文、结束语起为签名", sectionsOf(inline));
  ok(JSON.stringify(sectionsOf("Please find the catalogue attached.\nThanks for your patience.")) === JSON.stringify(["facts"]), "单段正文：不把以句读结尾的行当签名");
}

console.log("diff：全文照发 / 改签名 / 加一句 MOQ（spec 场景）");
{
  const same = buildDraftDiff(EN, `  ${EN}\n\n`);
  ok(!same.changed && same.sections.length === 0 && same.changedRatio === 0 && same.capturedNumbers.length === 0, "首尾空白不同仍判未改过", same);
  const longBody = "x".repeat(12_000);
  ok(!buildDraftDiff(longBody, `${longBody}tail`).changed, "超过 10k 的部分不参与比较（与执行器截断一致）");

  const sig = buildDraftDiff(EN, EN.replace("Sales Manager", "Export Sales Director"));
  ok(sig.changed && JSON.stringify(sig.sections) === '["signature"]', "改签名 → 段落类型只有签名", sig);
  ok(sig.changedRatio > 0 && sig.changedRatio < 0.2, "改动占比在 0–1 之间且很小", sig.changedRatio);

  const moq = buildDraftDiff(EN, EN.replace("Regarding MOQ and pricing", "MOQ is 500 pcs per color.\nRegarding pricing"));
  ok(moq.changed && JSON.stringify(moq.sections) === '["facts"]', "加一句 MOQ → 段落类型只有事实段", moq.sections);
  ok(moq.capturedNumbers.some((n) => n.value === 500 && n.unit === "pcs" && n.per === "color"), "捕获 500 pcs per color", moq.capturedNumbers);

  const q = buildDraftDiff(EN, EN.replace("2. What is your target delivery date?", "2. Do you need custom packaging?"));
  ok(JSON.stringify(q.sections) === '["questions"]' && q.capturedNumbers.length === 0, "改追问 → 段落类型只有追问段，不捕获数值");

  const greet = buildDraftDiff(EN, EN.replace("Dear John,", "Hi John,"));
  ok(JSON.stringify(greet.sections) === '["greeting"]', "改称呼 → 段落类型只有问候");

  const zhMoq = buildDraftDiff(ZH, ZH.replace("期待您的回复。", "起订量 300 件/每色，生产周期约 25 天。\n期待您的回复。"));
  ok(JSON.stringify(zhMoq.sections) === '["facts"]' && zhMoq.capturedNumbers.some((n) => n.value === 300 && n.unit === "件" && n.per === "色") && zhMoq.capturedNumbers.some((n) => n.value === 25 && n.unit === "天"), "中文：起订量 300 件/每色、25 天", zhMoq.capturedNumbers);

  const shortened = buildDraftDiff(EN, EN.split("\n").slice(0, 3).join("\n"));
  ok(shortened.changed && shortened.changedRatio > 0.5 && (shortened.shortenedPct ?? 0) >= 30 && shortened.sections.includes("signature"), "大幅删减：占比高、沿用结构化 diff 的缩短百分比", shortened);

  const all = [sig, moq, q, greet, zhMoq, shortened].map((d) => JSON.stringify(d)).join("\n");
  const sentences = [...EN.split("\n"), ...ZH.split("\n")].filter((l) => l.length > 12);
  ok(sentences.every((s) => !all.includes(s)), "diff 结果不含任何一句正文（spec 场景）", sentences.filter((s) => all.includes(s)));
}

console.log("数值捕获不含金额与百分比");
ok(captureNumbers("MOQ 1,000 pcs, lead time 30 days").map((n) => `${n.value} ${n.unit}`).join("|") === "1000 pcs|30 days", "千分位与多个单位");
ok(captureNumbers("Price is $5 pcs per unit or USD 12 sets").length === 0, "货币后的数字不捕获");
ok(captureNumbers("Margin 30% and 25 percent").length === 0, "百分比不捕获");
ok(captureNumbers("Fabric 280 gsm, width 2.8 m").map((n) => `${n.value} ${n.unit}`).join("|") === "280 gsm|2.8 m", "规格单位（gsm 优先于 g）");
ok(captureNumbers("Delivery within 6 weeks; 2 months for peak season").map((n) => n.unit).join(",") === "weeks,months", "时长单位");
ok(captureNumbers("Order 2026-10-26 ref 12345").length === 0, "无单位的数字不捕获");

console.log("归一与哈希");
ok(normalizeDraftBody(`  a \n`) === "a" && normalizeDraftBody(null) === "", "归一：trim");
ok(draftContentHash("a") === draftContentHash("a") && draftContentHash("a") !== draftContentHash("b") && /^[0-9a-f]{16}$/.test(draftContentHash("a")), "哈希：16 位十六进制");

console.log("买家信息替换（spec 场景）");
{
  const text = "Dear John Smith,\nThanks from Acme Home Ltd. Call me at +1 (416) 555-0199 or john.private@gmail.com; reply to buyer@acme.com. Meeting on 2026-10-26.";
  const masked = maskBuyerPii(text, { contactName: "John Smith", companyName: "Acme Home Ltd", recipientEmail: "Buyer@Acme.com" });
  ok(!masked.includes("John Smith") && masked.includes(PII_PLACEHOLDERS.contact), "联系人名替换", masked);
  ok(!masked.includes("Acme Home Ltd") && masked.includes(PII_PLACEHOLDERS.company), "公司名替换");
  ok(!masked.includes("555-0199") && masked.includes(PII_PLACEHOLDERS.phone), "电话替换");
  ok(!masked.includes("john.private@gmail.com") && masked.includes(PII_PLACEHOLDERS.email), "非收件人邮箱替换");
  ok(masked.includes("buyer@acme.com"), "收件人邮箱保留（大小写不敏感比较）");
  ok(masked.includes("2026-10-26"), "日期不当电话");
  const first = maskBuyerPii("语气太硬，John 是老客户；JOHN 也这么说", { contactName: "John Smith", companyName: null });
  ok(!/john/i.test(first) && first.includes(PII_PLACEHOLDERS.contact), "联系人的名字单独出现也替换（原样与全大写）", first);
  ok(maskBuyerPii("Johnson & Co", { contactName: "John" }) === "Johnson & Co", "按词边界：Johnson 不被误替换");
  ok(maskBuyerPii("张先生，您好：张伟说", { contactName: "张伟", companyName: "上海某某家居有限公司" }).includes(PII_PLACEHOLDERS.contact), "中文名按子串替换");
  ok(maskBuyerPii("Mr Smith from Home Ltd", { contactName: "Mr Smith", companyName: "Home Ltd" }) === `${PII_PLACEHOLDERS.contact} from ${PII_PLACEHOLDERS.company}`, "称谓不单独替换，整名替换");
  ok(maskBuyerPii(null, {}) === "" && maskBuyerPii("no pii here", {}) === "no pii here", "空值与无信息原样");
}

console.log("买家信息替换：不过度替换、不漏（交叉审查用例）");
{
  const keep = ["MOQ 500-1000 pcs per color", "Total USD 12000.50", "Ship on 12.01.2026", "Window 2026-12-01 - 2027-01-15", "Order 2,000 sets", "Lead time 25-30 days"];
  for (const t of keep) ok(maskBuyerPii(t, { contactName: "John Smith" }) === t, `不当电话：${t}`, maskBuyerPii(t, { contactName: "John Smith" }));
  for (const t of ["+86 138 0013 8000", "(416) 555-0199", "416-555-0199", "0571-88881234", "13800138000"]) {
    ok(maskBuyerPii(`Tel ${t}.`, {}) === `Tel ${PII_PLACEHOLDERS.phone}.`, `电话：${t}`, maskBuyerPii(`Tel ${t}.`, {}));
  }
  ok(maskBuyerPii("We will ship an order to the team", { contactName: "Will An", companyName: "Purchasing Team" }) === "We will ship an order to the team", "小写常用词不因联系人 / 公司名被替换（区分大小写、≥ 3 字母、常见词表）");
  ok(maskBuyerPii("Hi Will, the Purchasing Team says hi", { contactName: "Will An", companyName: "Purchasing Team" }) === `Hi ${PII_PLACEHOLDERS.contact}, the ${PII_PLACEHOLDERS.company} says hi`, "首字母大写的名字与整名照常替换");
  ok(maskBuyerPii("Smith said ok; José agreed", { contactName: "José Smith" }) === `${PII_PLACEHOLDERS.contact} said ok; ${PII_PLACEHOLDERS.contact} agreed`, "非 ASCII 拉丁名拆开替换");
  ok(maskBuyerPii("Reply to john@acme.com, cc John at Acme", { contactName: "John", companyName: "Acme", recipientEmail: "john@acme.com" }) === `Reply to john@acme.com, cc ${PII_PLACEHOLDERS.contact} at ${PII_PLACEHOLDERS.company}`, "收件人邮箱不被名字替换拆坏");
  ok(maskBuyerPii("ping john.private@gmail.com", { contactName: "John" }) === `ping ${PII_PLACEHOLDERS.email}`, "其他邮箱整体替换");
}

console.log("段落分类边界");
ok(JSON.stringify(sectionsOf(["Dear Ann,", "", "Size options:", "10.5 cm wide", "", "Best regards,", "Lucas"].join("\n"))) === JSON.stringify(["greeting", "facts", "signature"]), "\"10.5 cm\" 不算编号追问");
ok(JSON.stringify(sectionsOf(["张先生，您好：", "", "感谢您的询盘。", "", "期待您的回复。", "", "李明", "Sunny Home Deco Co., Ltd."].join("\n"))) === JSON.stringify(["greeting", "facts", "facts", "signature"]), "以 Co., Ltd. 结尾的公司名仍算签名块");

console.log(`\nFDE 询盘回复草稿 diff: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
