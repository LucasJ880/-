/**
 * Revenue Spine — 电话 E.164 归一与比对（客户去重第二级键，PRD F2.3）+ 来源 / 互动渠道映射。纯函数，无 DB。
 * 运行：npx tsx src/lib/revenue-spine/__tests__/phone-match.test.ts
 *
 * 公开仓库：号码全是虚构的 555 / 900 测试号段。
 */
import assert from "node:assert/strict";
import { phonesMatch, resolveDialingCountry, splitCallingCode, toE164 } from "../phone";
import { buildDedupeKeys } from "../customer-match";
import { OPPORTUNITY_SOURCES, inquiryInteractionChannel, inquiryInteractionType, isOpportunitySource } from "../inquiry-intake";
import { OPPORTUNITY_SOURCE_LABELS, opportunitySourceLabel } from "../source-labels";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("phone E.164 / customer match keys");

ok("国际格式：+ / 00 / 括号里的 + / 分机号 / (0) 都归一为 E.164", () => {
  assert.equal(toE164("+1 (647) 555-0142"), "+16475550142");
  assert.equal(toE164("+16475550142"), "+16475550142");
  assert.equal(toE164("0044 7700 900123"), "+447700900123");
  assert.equal(toE164("(+44) 7700 900123"), "+447700900123");
  assert.equal(toE164("+44 (0)20 7946 0018"), "+442079460018");
  assert.equal(toE164("+1 647 555 0142 ext. 22"), "+16475550142");
  assert.equal(toE164("+1 647 555 0142 x22"), "+16475550142");
  assert.equal(toE164("＋86 138 0013 8000"), "+8613800138000");
  assert.equal(toE164("+1 647 555 0142, +1 416 555 0199"), "+16475550142", "多个号码只取第一个");
});

ok("本地格式 + 国家提示：去国内长途前缀后加国家码（英文名 / ISO 码 / 中文名 / 城市）", () => {
  assert.equal(toE164("(647) 555-0142", "Canada"), "+16475550142");
  assert.equal(toE164("1-647-555-0142", "CA"), "+16475550142");
  assert.equal(toE164("647.555.0142", "United States"), "+16475550142");
  assert.equal(toE164("07700 900123", "United Kingdom"), "+447700900123");
  assert.equal(toE164("07700 900123", "UK"), "+447700900123");
  assert.equal(toE164("07700 900123", "英国"), "+447700900123");
  assert.equal(toE164("0412 345 678", "Sydney, Australia"), "+61412345678");
  assert.equal(toE164("030 1234567", "Germany"), "+49301234567");
  assert.equal(toE164("06 1234 5678", "Italy"), "+390612345678", "意大利号码首位 0 是号码本身");
  assert.equal(toE164("138 0013 8000", "中国"), "+8613800138000");
  assert.equal(toE164("011 44 7700 900123", "Canada"), "+447700900123", "北美国际冠码 011");
  assert.equal(toE164("0011 44 7700 900123", "Australia"), "+447700900123", "澳大利亚国际冠码 0011");
  assert.equal(toE164("44 7700 900123", "United Kingdom"), "+447700900123", "写了国家码没写 +");
  assert.equal(toE164("9876543210", "India"), "+919876543210", "以国家码数字开头的本地手机号不误判");
});

ok("无法确定时返回 null：本地格式没有国家提示 / 太短 / 国家码不存在 / 北美位数不对", () => {
  assert.equal(toE164("(647) 555-0142"), null);
  assert.equal(toE164("647 555 0142", "Atlantis"), null);
  assert.equal(toE164("12345"), null);
  assert.equal(toE164("+0 123 456 789"), null);
  assert.equal(toE164("+1 647 555 014"), null);
  assert.equal(toE164(""), null);
  assert.equal(toE164(null), null);
});

ok("国家提示解析与国家码拆分", () => {
  assert.equal(resolveDialingCountry("u.s.")?.cc, "1");
  assert.equal(resolveDialingCountry("gb")?.iso2, "GB");
  assert.equal(resolveDialingCountry("加拿大")?.iso2, "CA");
  assert.equal(resolveDialingCountry("Hong Kong")?.cc, "852");
  assert.equal(resolveDialingCountry(""), null);
  assert.deepEqual(splitCallingCode("16475550142"), { cc: "1", national: "6475550142" });
  assert.deepEqual(splitCallingCode("447700900123"), { cc: "44", national: "7700900123" });
  assert.deepEqual(splitCallingCode("97150123456"), { cc: "971", national: "50123456" });
  assert.equal(splitCallingCode("0123"), null);
});

ok("比对：WhatsApp 号码 vs 网站表单本地号 + 国家 → 同一号码", () => {
  assert.ok(phonesMatch({ phone: "+16475550142" }, { phone: "(647) 555-0142", country: "Canada" }));
  assert.ok(phonesMatch({ phone: "+447700900123" }, { phone: "07700 900123", country: "United Kingdom" }));
});

ok("比对：一边没有国家提示 → 借用另一边的国家码（去一位长途前缀 / 国家码没写 +）", () => {
  assert.ok(phonesMatch({ phone: "+16475550142" }, { phone: "647-555-0142" }));
  assert.ok(phonesMatch({ phone: "+16475550142" }, { phone: "1 647 555 0142" }));
  assert.ok(phonesMatch({ phone: "+447700900123" }, { phone: "07700 900123" }));
  assert.ok(phonesMatch({ phone: "447700900123" }, { phone: "+44 7700 900123" }));
});

ok("比对：尾号相同但国家不同 → 不是同一号码（旧规则取末 10 位会误合并）", () => {
  assert.ok(!phonesMatch({ phone: "+16475550142" }, { phone: "+446475550142" }));
  assert.ok(!phonesMatch({ phone: "+16475550142" }, { phone: "647 555 0142", country: "United Kingdom" }), "另一边明确是别的国家");
  assert.ok(!phonesMatch({ phone: "+447700900123" }, { phone: "+447700900124" }));
});

ok("比对：两边都无法归一 → 仅数字串完全相同才算", () => {
  assert.ok(phonesMatch({ phone: "555 0142 777" }, { phone: "555-0142-777" }));
  assert.ok(!phonesMatch({ phone: "6475550142" }, { phone: "16475550142" }));
  assert.ok(!phonesMatch({ phone: "123" }, { phone: "123" }));
  assert.ok(!phonesMatch({ phone: null }, { phone: "+16475550142" }));
});

ok("去重键：旧 phone 键不变（存在性判断），另给出 E.164 键（国家提示）", () => {
  const k = buildDedupeKeys({ email: "Buyer@Example-Textiles.com", phone: "(416) 555-0199", country: "Canada" });
  assert.equal(k.phone, "4165550199");
  assert.equal(k.phoneE164, "+14165550199");
  assert.equal(buildDedupeKeys({ phone: "(416) 555-0199" }).phoneE164, null);
  assert.equal(buildDedupeKeys({ phone: "+16475550142" }).phoneE164, "+16475550142");
});

ok("来源：whatsapp / wechat 是合法商机来源且有中文标签；互动渠道 / 类型映射", () => {
  assert.ok(isOpportunitySource("whatsapp") && isOpportunitySource("wechat"));
  for (const s of OPPORTUNITY_SOURCES) assert.ok(OPPORTUNITY_SOURCE_LABELS[s], s);
  assert.equal(opportunitySourceLabel("whatsapp"), "WhatsApp");
  assert.equal(opportunitySourceLabel("wechat"), "微信");
  assert.equal(inquiryInteractionChannel("whatsapp"), "whatsapp");
  assert.equal(inquiryInteractionChannel("wechat"), "wechat");
  assert.equal(inquiryInteractionChannel("website_inquiry"), "website");
  assert.equal(inquiryInteractionChannel("trade_show"), "other");
  assert.equal(inquiryInteractionChannel("trade_show", "trade_show"), "trade_show");
  assert.equal(inquiryInteractionChannel("manual"), "other");
  assert.equal(inquiryInteractionType("whatsapp"), "whatsapp");
  assert.equal(inquiryInteractionType("wechat"), "wechat");
  assert.equal(inquiryInteractionType("website_inquiry"), "web_form");
  assert.equal(inquiryInteractionType("email"), "email");
  assert.equal(inquiryInteractionType("trade_show"), "in_person");
  assert.equal(inquiryInteractionType("manual"), "note");
});

console.log(`\nphone E.164 / customer match keys: ${pass} 通过`);
