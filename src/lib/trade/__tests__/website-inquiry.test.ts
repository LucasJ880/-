/**
 * 网站询盘归一化/派生 纯函数测试
 * 运行：npx tsx src/lib/trade/__tests__/website-inquiry.test.ts
 */

import assert from "node:assert/strict";
import {
  blankInquiry,
  buildInquiryMessage,
  deriveCompanyName,
  normalizeInquiry,
  originOfReceipt,
} from "../website-inquiry";
import { receiptMeta } from "../website-inquiry-receipts";

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

ok("eventId：解析 eventId / event_id，裁剪空白并截断到上限；蜜罐命中时也保留", () => {
  const r = normalizeInquiry({ email: "a@b.co", message: "hi", eventId: "  inq_20260908T031500_9f1c2b7a " });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.eventId, "inq_20260908T031500_9f1c2b7a");
  const alt = normalizeInquiry({ email: "a@b.co", message: "hi", event_id: "evt-2" });
  if (alt.ok) assert.equal(alt.value.eventId, "evt-2");
  const none = normalizeInquiry({ email: "a@b.co", message: "hi" });
  if (none.ok) assert.equal(none.value.eventId, "");
  const long = normalizeInquiry({ email: "a@b.co", message: "hi", eventId: "x".repeat(500) });
  if (long.ok) assert.equal(long.value.eventId.length, 120);
  const bot = normalizeInquiry({ email: "bot@spam.io", _hp: "http://spam", eventId: "evt-bot" });
  if (bot.ok) assert.equal(bot.value.eventId, "evt-bot");
});

ok("eventId 不进入消息正文（正文只由表单内容决定，站点重发正文一致）", () => {
  const a = normalizeInquiry({ email: "a@b.co", message: "need quote", eventId: "evt-1" });
  const b = normalizeInquiry({ email: "a@b.co", message: "need quote", eventId: "evt-2" });
  assert.equal(a.ok && b.ok, true);
  if (a.ok && b.ok) assert.equal(buildInquiryMessage(a.value), buildInquiryMessage(b.value));
});

ok("空询盘载荷 blankInquiry：全部字段为空串、UTM 五项为空、未触发蜜罐，只带 eventId", () => {
  assert.deepEqual(blankInquiry("evt-1"), {
    name: "", email: "", phone: "", company: "", country: "", message: "", product: "", website: "", page: "", referrer: "", landing: "",
    utm: { source: "", medium: "", campaign: "", content: "", term: "" },
    eventId: "evt-1",
    honeypotTripped: false,
  });
  // 每次返回新对象：调用方改了 utm 不会影响下一次
  const a = blankInquiry("x");
  a.utm.source = "changed";
  assert.equal(blankInquiry("x").utm.source, "");
});

ok("蜜罐命中：只保留姓名 / 邮箱 / 电话 / 公司 / eventId，其余为空（与改用 blankInquiry 之前完全一致）", () => {
  const r = normalizeInquiry({ name: "Bot", email: "Bot@Spam.io", phone: "+1 555 0100", company: "Spam Co", message: "buy now", page: "https://x.example", utm_source: "s", eventId: "evt-bot", _hp: "x" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value, {
    name: "Bot", email: "bot@spam.io", phone: "+1 555 0100", company: "Spam Co",
    country: "", message: "", product: "", website: "", page: "", referrer: "", landing: "",
    utm: { source: "", medium: "", campaign: "", content: "", term: "" },
    eventId: "evt-bot",
    honeypotTripped: true,
  });
});

ok("公司名兜底按统一的免费邮箱判定：各国大服务商域名 / 国内免费邮箱都不当公司名", () => {
  for (const email of ["tom@live.com", "tom@gmx.de", "tom@yandex.ru", "tom@foxmail.com", "tom@aol.co.uk", "tom@protonmail.ch", "tom@hotmail.fr"]) {
    const r = normalizeInquiry({ email });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(deriveCompanyName(r.value), email, email);
  }
  const corp = normalizeInquiry({ email: "tom@liveoak-textiles.example" });
  if (corp.ok) assert.equal(deriveCompanyName(corp.value), "liveoak-textiles.example");
});

ok("收据 → 来源 originOfReceipt：按收据来源反查；邮件转发带回 meta 里的原主题（空 / 缺失 / 非字符串 → null）", () => {
  assert.deepEqual(originOfReceipt({ source: "website", payload: {} }), { kind: "website" });
  assert.deepEqual(originOfReceipt({ source: "embed", payload: null }), { kind: "embed" });
  assert.deepEqual(originOfReceipt({ source: "trade_show", payload: {} }), { kind: "trade_show" });
  assert.deepEqual(originOfReceipt({ source: "whatsapp", payload: {} }), { kind: "whatsapp" });
  assert.deepEqual(originOfReceipt({ source: "something_else", payload: {} }), { kind: "website" });
  assert.deepEqual(originOfReceipt({ source: "website", payload: { meta: { subject: "ignored" } } }), { kind: "website" });
  // 邮件重投重放原先的写法：{ kind: "email_forward", subject: (meta.subject 是字符串 ? meta.subject : "") || null }
  const legacyEmailOrigin = (meta: unknown) => {
    const m = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
    const subj = typeof m.subject === "string" ? m.subject : "";
    return { kind: "email_forward", subject: subj || null };
  };
  for (const meta of [undefined, null, [], {}, { subject: "" }, { subject: "RFQ: 500 bath towels" }, { subject: 42 }, { subject: null }]) {
    const payload = meta === undefined ? { name: "x" } : { name: "x", meta };
    assert.deepEqual(originOfReceipt({ source: "email", payload: payload as never }), legacyEmailOrigin(meta), JSON.stringify(meta));
  }
});

ok("收据 meta 读取 receiptMeta：只认对象，其余（缺失 / 数组 / 字符串 / 空载荷）→ {}", () => {
  assert.deepEqual(receiptMeta({ payload: { meta: { subject: "RFQ", kind: "email_forward" } } }), { subject: "RFQ", kind: "email_forward" });
  assert.deepEqual(receiptMeta({ payload: { name: "x" } }), {});
  assert.deepEqual(receiptMeta({ payload: { meta: ["a"] } }), {});
  assert.deepEqual(receiptMeta({ payload: { meta: "x" } }), {});
  assert.deepEqual(receiptMeta({ payload: null }), {});
});

console.log(`\nwebsite-inquiry: ${pass} 通过`);
