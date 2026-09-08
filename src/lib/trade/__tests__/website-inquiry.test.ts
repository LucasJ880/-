/**
 * 网站询盘归一化/派生 纯函数测试
 * 运行：npx tsx src/lib/trade/__tests__/website-inquiry.test.ts
 */

import assert from "node:assert/strict";
import {
  buildInquiryMessage,
  deriveCompanyName,
  normalizeInquiry,
} from "../website-inquiry";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("website-inquiry");

ok("完整 JSON 载荷归一化：小写邮箱、裁剪空白、UTM 落位", () => {
  const r = normalizeInquiry({
    name: "  Cathy  Li ",
    email: "Buyer@Hotel-Supply.COM",
    company: "Hotel Supply Inc",
    country: "USA",
    product: "coral fleece bathrobe",
    message: "500 pcs, 280GSM,   S-XL",
    page: "https://mengxin.example/bathrobes?utm_source=coldemail",
    utm_source: "coldemail",
    utm_campaign: "bathrobe-hotel",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.name, "Cathy Li");
  assert.equal(r.value.email, "buyer@hotel-supply.com");
  assert.equal(r.value.message, "500 pcs, 280GSM, S-XL");
  assert.equal(r.value.utm.source, "coldemail");
  assert.equal(r.value.utm.campaign, "bathrobe-hotel");
  assert.equal(r.value.honeypotTripped, false);
});

ok("缺邮箱与电话 → 拒绝", () => {
  const r = normalizeInquiry({ name: "Nobody", message: "hi" });
  assert.equal(r.ok, false);
});

ok("只有电话也可受理（WhatsApp 买家）", () => {
  const r = normalizeInquiry({ name: "Ali", whatsapp: "+1 555 0100" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.phone, "+1 555 0100");
});

ok("邮箱格式非法 → 拒绝", () => {
  const r = normalizeInquiry({ email: "not-an-email" });
  assert.equal(r.ok, false);
});

ok("蜜罐字段被填 → 标记 tripped（调用方静默 200）", () => {
  const r = normalizeInquiry({ email: "bot@spam.io", _hp: "http://spam" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.honeypotTripped, true);
});

ok("超长字段被截断到上限", () => {
  const r = normalizeInquiry({ email: "a@b.co", message: "x".repeat(5000) });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.message.length, 4000);
});

ok("公司名兜底：公司 → 姓名 → 企业邮箱域名；免费邮箱不当公司名", () => {
  const base = normalizeInquiry({ email: "tom@acme-textiles.com" });
  assert.equal(base.ok, true);
  if (base.ok) assert.equal(deriveCompanyName(base.value), "acme-textiles.com");
  const free = normalizeInquiry({ email: "tom@gmail.com" });
  if (free.ok) assert.equal(deriveCompanyName(free.value), "tom@gmail.com");
  const named = normalizeInquiry({ email: "tom@gmail.com", name: "Tom" });
  if (named.ok) assert.equal(deriveCompanyName(named.value), "Tom");
  const co = normalizeInquiry({ email: "tom@gmail.com", name: "Tom", company: "Tom Trading" });
  if (co.ok) assert.equal(deriveCompanyName(co.value), "Tom Trading");
});

ok("消息正文：含产品/留言/联系人/来源页/UTM 各行，空项不出现", () => {
  const r = normalizeInquiry({
    email: "a@b.co",
    product: "sherpa blanket",
    message: "need quote",
    page: "https://x.y/z",
    utm_source: "coldemail",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const body = buildInquiryMessage(r.value);
  assert.match(body, /^【网站询盘】/);
  assert.match(body, /产品：sherpa blanket/);
  assert.match(body, /留言：need quote/);
  assert.match(body, /来源页：https:\/\/x\.y\/z/);
  assert.match(body, /UTM：source=coldemail/);
  assert.doesNotMatch(body, /国家：/);
});

console.log(`\nwebsite-inquiry: ${pass} 通过`);
