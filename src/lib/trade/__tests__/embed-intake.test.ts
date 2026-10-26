/**
 * 嵌入表单 + 渠道凭证加固（PRD F1.1 / F1.4）— 纯函数与静态契约
 *
 *   公开 key 格式 / 来源规范化与精确匹配 / 限流判定 / 服务端密钥轮换宽限期（宽限期内连续轮换、上限、立即停用）/ 凭证掩码 /
 *   需求内容校验与主干拒收分类 /
 *   嵌入载荷白名单与事件 id / referrer、落地页不进业务指纹 / 管理角色矩阵 /
 *   路由段配置字面量、响应最小化、脚本不用 cookie 与 localStorage、渠道页不再把密钥放进浏览器。
 *
 * 运行：npx tsx src/lib/trade/__tests__/embed-intake.test.ts（从仓库根目录）
 * 公开仓库：只用虚构企业与 example 域名。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_ALLOWED_ORIGINS,
  MAX_PREVIOUS_SECRETS,
  PUBLIC_KEY_RE,
  SECRET_ROTATION_GRACE_MS,
  SecretRotationLimitError,
  activePreviousSecrets,
  endSecretGraceConfig,
  ensureWebsiteCredentialConfig,
  generatePublicKey,
  hashClientIp,
  isWellFormedPublicKey,
  maskChannelConfig,
  maskCredential,
  matchPublicKey,
  matchWebsiteSecret,
  normalizeOrigin,
  originAllowed,
  parseAllowedOrigins,
  readWebsiteCredentials,
  rotatePublicKeyConfig,
  rotateSecretConfig,
} from "../website-channel-credentials";
import {
  DAY_MS,
  EMBED_ATTEMPT_LIMIT,
  EMBED_RATE_LIMITS,
  HOUR_MS,
  decideEmbedRateLimit,
  EMBED_EVENT_PREFIX,
  EMBED_KEY_QUERY,
  clientIpFrom,
  decoyReceiptId,
  embedEventId,
  hasInquiryContent,
  isPermanentSpineRejection,
  toEmbedInquiryRaw,
} from "../embed-intake";
import { buildInquiryMessage, normalizeInquiry } from "../website-inquiry";
import { EMBED_INQUIRY_SOURCE, computePayloadHash, fromReceiptPayload, toReceiptPayload } from "../website-inquiry-receipts";
import { roleCanManageTradeChannels } from "../channel-access";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

console.log("embed-intake / website-channel-credentials");

// ── 公开 key ──
ok("公开 key：qyk_ + 24 字节 base64url（32 字符），每次不同", () => {
  const a = generatePublicKey();
  const b = generatePublicKey();
  assert.match(a, PUBLIC_KEY_RE);
  assert.equal(a.length, 36);
  assert.ok(a.startsWith("qyk_"));
  assert.notEqual(a, b);
  assert.ok(isWellFormedPublicKey(a));
  for (const bad of ["", "qyk_", "qyk_short", `qyk_${"a".repeat(31)}`, `qyk_${"a".repeat(33)}`, `QYK_${"a".repeat(32)}`, `qyk_${"a".repeat(31)}=`, `qyk_${"a".repeat(31)}+`, null, 42]) {
    assert.equal(isWellFormedPublicKey(bad), false, String(bad));
  }
});

ok("公开 key 比对：恒时、只认本通道 key；格式不对直接不匹配", () => {
  const key = generatePublicKey();
  assert.equal(matchPublicKey({ publicKey: key }, key), true);
  assert.equal(matchPublicKey({ publicKey: key }, generatePublicKey()), false);
  assert.equal(matchPublicKey({}, key), false);
  assert.equal(matchPublicKey({ publicKey: "qyk_short" }, "qyk_short"), false);
});

// ── 来源 ──
ok("来源规范化：只要 scheme + host[:port]；主机小写、省略默认端口、尾斜杠可接受", () => {
  assert.equal(normalizeOrigin("https://www.example.com"), "https://www.example.com");
  assert.equal(normalizeOrigin("https://WWW.Example.COM/"), "https://www.example.com");
  assert.equal(normalizeOrigin("https://example.com:443"), "https://example.com");
  assert.equal(normalizeOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeOrigin(" https://shop.example.co.uk:8443 "), "https://shop.example.co.uk:8443");
});

ok("来源规范化：路径 / 查询 / 片段 / 用户信息 / 通配符 / 非 http(s) / 裸域名 一律拒绝", () => {
  for (const bad of [
    "https://example.com/contact",
    "https://example.com?x=1",
    "https://example.com#top",
    "https://user:pw@example.com",
    "https://*.example.com",
    "*",
    "ftp://example.com",
    "javascript:alert(1)",
    "example.com",
    "null",
    "",
    42,
  ]) {
    assert.equal(normalizeOrigin(bad), null, String(bad));
  }
});

ok("白名单解析：数组或多行文本，去重，返回无效项", () => {
  const r = parseAllowedOrigins("https://www.example.com\nhttps://example.com/\n\nhttps://www.example.com, https://example.com/contact , not a url");
  assert.deepEqual(r.origins, ["https://www.example.com", "https://example.com"]);
  assert.deepEqual(r.invalid, ["https://example.com/contact", "not a url"]);
  const arr = parseAllowedOrigins(["https://a.example", 5, "https://A.example"]);
  assert.deepEqual(arr.origins, ["https://a.example"]);
  assert.deepEqual(parseAllowedOrigins(undefined), { origins: [], invalid: [] });
  assert.ok(MAX_ALLOWED_ORIGINS >= 5);
});

ok("Origin 精确匹配：scheme / www / 端口 / 大小写 / 尾斜杠 / 子域都不放宽；null 与缺失拒绝", () => {
  const allowed = ["https://www.example.com", "http://localhost:3000"];
  assert.equal(originAllowed("https://www.example.com", allowed), true);
  assert.equal(originAllowed("http://localhost:3000", allowed), true);
  for (const o of [
    "http://www.example.com",
    "https://example.com",
    "https://www.example.com:8443",
    "https://WWW.EXAMPLE.COM",
    "https://www.example.com/",
    "https://evil.www.example.com",
    "https://www.example.com.evil.test",
    "http://localhost:3001",
    "null",
    "",
    null,
    undefined,
  ]) {
    assert.equal(originAllowed(o, allowed), false, String(o));
  }
  assert.equal(originAllowed("https://www.example.com", []), false);
});

// ── 限流判定 ──
ok("限流判定：低于上限放行；IP 优先，其次组织小时、组织日；Retry-After 为窗口长度", () => {
  const L = EMBED_RATE_LIMITS;
  assert.deepEqual(decideEmbedRateLimit({ ipWindow: 0, orgHour: 0, orgDay: 0 }), { allowed: true });
  assert.deepEqual(decideEmbedRateLimit({ ipWindow: L.perIp - 1, orgHour: L.perOrgHour - 1, orgDay: L.perOrgDay - 1 }), { allowed: true });
  assert.deepEqual(decideEmbedRateLimit({ ipWindow: L.perIp, orgHour: 0, orgDay: 0 }), { allowed: false, reason: "ip", retryAfterSec: L.perIpWindowMs / 1000 });
  assert.deepEqual(decideEmbedRateLimit({ ipWindow: L.perIp, orgHour: L.perOrgHour, orgDay: L.perOrgDay }), { allowed: false, reason: "ip", retryAfterSec: L.perIpWindowMs / 1000 });
  assert.deepEqual(decideEmbedRateLimit({ ipWindow: 0, orgHour: L.perOrgHour, orgDay: 0 }), { allowed: false, reason: "org_hour", retryAfterSec: HOUR_MS / 1000 });
  assert.deepEqual(decideEmbedRateLimit({ ipWindow: 0, orgHour: 0, orgDay: L.perOrgDay }), { allowed: false, reason: "org_day", retryAfterSec: DAY_MS / 1000 });
  assert.deepEqual(
    decideEmbedRateLimit({ ipWindow: 2, orgHour: 0, orgDay: 0 }, { perIp: 2, perIpWindowMs: 60_000, perOrgHour: 9, perOrgDay: 9 }),
    { allowed: false, reason: "ip", retryAfterSec: 60 },
  );
});

ok("限流常量：IP 窗口 10 分钟；组织小时 < 组织日；请求次数粗筛宽于新询盘上限", () => {
  assert.equal(EMBED_RATE_LIMITS.perIpWindowMs, 10 * 60 * 1000);
  assert.ok(EMBED_RATE_LIMITS.perIp >= 3 && EMBED_RATE_LIMITS.perIp <= 10);
  assert.ok(EMBED_RATE_LIMITS.perOrgHour < EMBED_RATE_LIMITS.perOrgDay);
  assert.ok(EMBED_ATTEMPT_LIMIT.maxRequests > EMBED_RATE_LIMITS.perIp);
  assert.equal(EMBED_ATTEMPT_LIMIT.windowMs, EMBED_RATE_LIMITS.perIpWindowMs);
});

// ── 服务端密钥轮换 ──
ok("密钥轮换：新密钥立即生效，旧密钥宽限期（默认 72 小时）内仍接受，到期拒绝", () => {
  const now = new Date("2026-10-24T08:00:00.000Z");
  const base = ensureWebsiteCredentialConfig({ secret: "old-secret-value-0001", allowedOrigins: ["https://www.example.com"] });
  const rotated = rotateSecretConfig(base, now);
  const cred = readWebsiteCredentials(rotated);
  assert.equal(SECRET_ROTATION_GRACE_MS, 72 * 60 * 60 * 1000);
  assert.notEqual(cred.secret, "old-secret-value-0001");
  assert.equal(cred.secretPrev, "old-secret-value-0001");
  assert.equal(cred.secretPrevExpiresAt, new Date(now.getTime() + SECRET_ROTATION_GRACE_MS).toISOString());
  assert.deepEqual(cred.allowedOrigins, ["https://www.example.com"], "轮换不动白名单");
  assert.equal(cred.publicKey, readWebsiteCredentials(base).publicKey, "轮换密钥不动公开 key");
  assert.equal(matchWebsiteSecret(rotated, cred.secret!, now), "current");
  assert.equal(matchWebsiteSecret(rotated, "old-secret-value-0001", now), "previous");
  assert.equal(matchWebsiteSecret(rotated, "old-secret-value-0001", new Date(now.getTime() + SECRET_ROTATION_GRACE_MS - 1)), "previous");
  assert.equal(matchWebsiteSecret(rotated, "old-secret-value-0001", new Date(now.getTime() + SECRET_ROTATION_GRACE_MS)), null);
  assert.equal(matchWebsiteSecret(rotated, "wrong", now), null);
  assert.equal(matchWebsiteSecret(rotated, "", now), null);
});

ok("宽限期内再轮换：最早的旧密钥按自己的到期时间继续有效（站点仍在用的密钥不提前失效），各旧密钥分别到期", () => {
  const t0 = new Date("2026-10-24T08:00:00.000Z");
  const s0 = "old-secret-value-0001";
  const r1 = rotateSecretConfig(ensureWebsiteCredentialConfig({ secret: s0 }), t0);
  const s1 = readWebsiteCredentials(r1).secret!;
  const t1 = new Date(t0.getTime() + 60_000);
  const r2 = rotateSecretConfig(r1, t1);
  const c2 = readWebsiteCredentials(r2);
  const s2 = c2.secret!;
  assert.ok(s2 !== s1 && s2 !== s0);
  assert.equal(c2.secretPrev, s1, "最近一个旧密钥在 secretPrev");
  assert.deepEqual(c2.previousSecrets.map((p) => p.secret), [s1, s0], "更早的旧密钥移入 secretPrevOlder");
  const at = (ms: number) => new Date(ms);
  // 第二次轮换 1 分钟后：s0 / s1 都仍被接受
  assert.equal(matchWebsiteSecret(r2, s0, at(t1.getTime() + 60_000)), "previous");
  assert.equal(matchWebsiteSecret(r2, s1, at(t1.getTime() + 60_000)), "previous");
  assert.equal(matchWebsiteSecret(r2, s2, at(t1.getTime() + 60_000)), "current");
  // s0 在它自己的到期时间（t0 + 72h）失效；s1 到 t1 + 72h 才失效
  assert.equal(matchWebsiteSecret(r2, s0, at(t0.getTime() + SECRET_ROTATION_GRACE_MS - 1)), "previous");
  assert.equal(matchWebsiteSecret(r2, s0, at(t0.getTime() + SECRET_ROTATION_GRACE_MS)), null);
  assert.equal(matchWebsiteSecret(r2, s1, at(t0.getTime() + SECRET_ROTATION_GRACE_MS)), "previous");
  assert.equal(matchWebsiteSecret(r2, s1, at(t1.getTime() + SECRET_ROTATION_GRACE_MS)), null);
  assert.deepEqual(activePreviousSecrets(r2, at(t0.getTime() + SECRET_ROTATION_GRACE_MS)).map((p) => p.secret), [s1]);
  // 已过期的旧密钥在下一次轮换时清掉
  const r3 = rotateSecretConfig(r2, at(t0.getTime() + SECRET_ROTATION_GRACE_MS + 1));
  assert.deepEqual(readWebsiteCredentials(r3).previousSecrets.map((p) => p.secret), [s2, s1]);
  assert.ok(!("secretPrevOlder" in endSecretGraceConfig(r3, t0)));
});

ok("宽限期内旧密钥上限：已有 MAX_PREVIOUS_SECRETS 个时再轮换抛 SecretRotationLimitError（输入不变），最早一个到期后可再轮换", () => {
  assert.equal(MAX_PREVIOUS_SECRETS, 3);
  const t0 = new Date("2026-10-24T08:00:00.000Z");
  let c: Record<string, unknown> = ensureWebsiteCredentialConfig({ secret: "seed-secret-0000" });
  for (let i = 1; i <= MAX_PREVIOUS_SECRETS; i++) c = rotateSecretConfig(c, new Date(t0.getTime() + i * 1000));
  assert.equal(activePreviousSecrets(c, new Date(t0.getTime() + 5000)).length, MAX_PREVIOUS_SECRETS);
  const snapshot = JSON.stringify(c);
  let err: unknown = null;
  try {
    rotateSecretConfig(c, new Date(t0.getTime() + 5000));
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof SecretRotationLimitError);
  assert.equal((err as SecretRotationLimitError).retryAt, new Date(t0.getTime() + 1000 + SECRET_ROTATION_GRACE_MS).toISOString(), "retryAt = 最早一个旧密钥到期");
  assert.equal(JSON.stringify(c), snapshot, "被拒的轮换不改 config");
  assert.equal(matchWebsiteSecret(c, "seed-secret-0000", new Date(t0.getTime() + 5000)), "previous", "最早的密钥仍有效");
  // 最早一个到期后腾出名额
  const later = rotateSecretConfig(c, new Date(t0.getTime() + 1000 + SECRET_ROTATION_GRACE_MS));
  assert.equal(readWebsiteCredentials(later).previousSecrets.length, MAX_PREVIOUS_SECRETS);
  assert.equal(matchWebsiteSecret(later, "seed-secret-0000", new Date(t0.getTime() + 1000 + SECRET_ROTATION_GRACE_MS)), null);
});

ok("立即停用旧密钥：所有旧密钥马上失效，当前密钥 / 公开 key / 白名单不变；grace=0 轮换保留此前仍有效的旧密钥", () => {
  const t0 = new Date("2026-10-24T08:00:00.000Z");
  const base = ensureWebsiteCredentialConfig({ secret: "old-secret-value-0009", allowedOrigins: ["https://www.example.com"] });
  const twice = rotateSecretConfig(rotateSecretConfig(base, t0), new Date(t0.getTime() + 1000));
  const cur = readWebsiteCredentials(twice);
  const ended = endSecretGraceConfig(twice, new Date(t0.getTime() + 2000));
  const e = readWebsiteCredentials(ended);
  assert.equal(e.secret, cur.secret);
  assert.equal(e.publicKey, cur.publicKey);
  assert.deepEqual(e.allowedOrigins, cur.allowedOrigins);
  assert.deepEqual(e.previousSecrets, []);
  assert.equal(e.secretPrev, null);
  assert.equal(ended.secretGraceEndedAt, new Date(t0.getTime() + 2000).toISOString());
  for (const p of cur.previousSecrets) assert.equal(matchWebsiteSecret(ended, p.secret, new Date(t0.getTime() + 3000)), null);
  assert.equal(matchWebsiteSecret(ended, cur.secret!, new Date(t0.getTime() + 3000)), "current");
  const noGrace = readWebsiteCredentials(rotateSecretConfig(twice, new Date(t0.getTime() + 2000), 0));
  assert.deepEqual(noGrace.previousSecrets.map((p) => p.secret), cur.previousSecrets.map((p) => p.secret), "grace=0 只是不保留被换下的那个");
  // 历史 / 脏数据：secretPrevOlder 里不是对象、缺 secret 的项忽略；缺到期时间按已过期
  const junk = readWebsiteCredentials({ secret: "cur-aaaaaaaa", secretPrevOlder: [null, 5, { expiresAt: "2099-01-01T00:00:00.000Z" }, { secret: "older-cccccccc" }] });
  assert.deepEqual(junk.previousSecrets, [{ secret: "older-cccccccc", expiresAt: "" }]);
  assert.equal(matchWebsiteSecret({ secret: "cur-aaaaaaaa", secretPrevOlder: [{ secret: "older-cccccccc" }] }, "older-cccccccc"), null);
});

ok("宽限期到期时间缺失 / 无法解析 → 旧密钥按已过期处理；grace=0 不保留旧密钥", () => {
  assert.equal(matchWebsiteSecret({ secret: "cur-aaaaaaaa", secretPrev: "prev-bbbbbbbb" }, "prev-bbbbbbbb"), null);
  assert.equal(matchWebsiteSecret({ secret: "cur-aaaaaaaa", secretPrev: "prev-bbbbbbbb", secretPrevExpiresAt: "not-a-date" }, "prev-bbbbbbbb"), null);
  const noGrace = readWebsiteCredentials(rotateSecretConfig({ secret: "old-secret-value-0002" }, new Date(), 0));
  assert.equal(noGrace.secretPrev, null);
  assert.equal(noGrace.secretPrevExpiresAt, null);
});

ok("补齐凭证：缺什么补什么，已有的不变（重复保存不让已部署代码失效）", () => {
  const first = ensureWebsiteCredentialConfig({});
  const c1 = readWebsiteCredentials(first);
  assert.ok(c1.secret && c1.secret.length >= 20);
  assert.ok(isWellFormedPublicKey(c1.publicKey));
  assert.ok(c1.ipSalt && c1.ipSalt.length >= 16);
  assert.deepEqual(c1.allowedOrigins, []);
  const again = readWebsiteCredentials(ensureWebsiteCredentialConfig({ ...first, allowedOrigins: ["https://www.example.com"] }));
  assert.equal(again.secret, c1.secret);
  assert.equal(again.publicKey, c1.publicKey);
  assert.equal(again.ipSalt, c1.ipSalt);
  assert.deepEqual(again.allowedOrigins, ["https://www.example.com"]);
  // 历史通道只有 secret：保留密钥，补公开 key
  const legacy = readWebsiteCredentials(ensureWebsiteCredentialConfig({ secret: "legacy-secret-0003" }));
  assert.equal(legacy.secret, "legacy-secret-0003");
  assert.ok(isWellFormedPublicKey(legacy.publicKey));
});

ok("公开 key 轮换：立即换新，密钥 / 盐 / 白名单不变", () => {
  const base = ensureWebsiteCredentialConfig({ allowedOrigins: ["https://www.example.com"] });
  const b = readWebsiteCredentials(base);
  const r = readWebsiteCredentials(rotatePublicKeyConfig(base, new Date()));
  assert.notEqual(r.publicKey, b.publicKey);
  assert.ok(isWellFormedPublicKey(r.publicKey));
  assert.equal(r.secret, b.secret);
  assert.equal(r.ipSalt, b.ipSalt);
  assert.deepEqual(r.allowedOrigins, b.allowedOrigins);
});

// ── 掩码 ──
ok("凭证掩码：只显示末 4 位；ipSalt 不出现；白名单 / 到期时间原样；非字符串不外泄", () => {
  assert.equal(maskCredential("abcdefghijklmnop"), "****mnop");
  assert.equal(maskCredential("short"), "****");
  const m = maskChannelConfig({
    accessToken: "EAAG-fixture-token-1234",
    phoneNumberId: "100200300",
    secret: "srv-secret-zz-9876",
    secretPrev: "srv-secret-old-5555",
    publicKey: "qyk_" + "x".repeat(28) + "WXYZ",
    ipSalt: "salt-should-never-leave",
    allowedOrigins: ["https://www.example.com"],
    secretPrevExpiresAt: "2026-10-27T08:00:00.000Z",
    secretPrevOlder: [{ secret: "srv-secret-older-4444", expiresAt: "2026-10-27T07:00:00.000Z" }],
    nested: { a: 1 },
  });
  assert.equal(m.accessToken, "****1234");
  assert.equal(m.phoneNumberId, "****0300");
  assert.equal(m.secret, "****9876");
  assert.equal(m.secretPrev, "****5555");
  assert.equal(m.publicKey, "****WXYZ");
  assert.ok(!("ipSalt" in m));
  assert.deepEqual(m.allowedOrigins, ["https://www.example.com"]);
  assert.equal(m.secretPrevExpiresAt, "2026-10-27T08:00:00.000Z");
  assert.equal(m.nested, "****");
  assert.equal(m.secretPrevOlder, "****");
  const text = JSON.stringify(m);
  for (const leak of ["EAAG-fixture", "srv-secret", "salt-should", "x".repeat(28)]) assert.ok(!text.includes(leak), leak);
});

ok("访客 IP 只存 HMAC：同盐同 IP 稳定、换盐或换 IP 不同、不含原 IP", () => {
  const h1 = hashClientIp("203.0.113.7", "salt-a");
  assert.equal(h1, hashClientIp("203.0.113.7", "salt-a"));
  assert.notEqual(h1, hashClientIp("203.0.113.7", "salt-b"));
  assert.notEqual(h1, hashClientIp("203.0.113.8", "salt-a"));
  assert.match(h1, /^[0-9a-f]{32}$/);
  assert.ok(!h1.includes("203"));
  assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIpFrom(new Headers()), "unknown");
});

// ── 嵌入载荷 ──
ok("事件 id：浏览器 uuid 加 emb: 前缀并小写；缺失或格式不对服务端生成 uuid", () => {
  assert.equal(embedEventId("3F2504E0-4F89-41D3-9A0C-0305E82C3301"), "emb:3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  for (const bad of [undefined, "", "abc", "emb:3f2504e0-4f89-41d3-9a0c-0305e82c3301", 123, "3f2504e0-4f89-41d3-9a0c-0305e82c3301; drop"]) {
    const id = embedEventId(bad);
    assert.ok(id.startsWith(EMBED_EVENT_PREFIX), String(bad));
    assert.match(id.slice(EMBED_EVENT_PREFIX.length), /^[0-9a-f-]{36}$/);
  }
  assert.notEqual(embedEventId(undefined), embedEventId(undefined));
  assert.equal(EMBED_INQUIRY_SOURCE, "embed");
});

ok("嵌入载荷白名单：数量并入留言；不透传 secret / orgId / website 等未知字段；蜜罐字段保留", () => {
  const raw = toEmbedInquiryRaw({
    name: "Jane Doe",
    email: "Jane@Maple-Home.example",
    company: "Maple Home Goods",
    country: "Canada",
    product: "Waffle bathrobe",
    quantity: "  1,500   pcs ",
    message: "380 gsm, embroidered logo",
    page: "https://www.example.com/contact",
    referrer: "https://www.search.example/",
    landing: "https://www.example.com/bathrobes?utm_source=newsletter",
    utm_source: "newsletter",
    eventId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    secret: "should-not-pass",
    orgId: "org_other",
    website: "https://buyer.example",
    _hp: "",
  });
  assert.equal(raw.message, "Quantity: 1,500 pcs — 380 gsm, embroidered logo");
  assert.equal(raw.eventId, "emb:3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  assert.ok(!("secret" in raw) && !("orgId" in raw) && !("website" in raw));
  assert.equal(raw.utm_source, "newsletter");
  const n = normalizeInquiry(raw);
  assert.ok(n.ok && !n.value.honeypotTripped);
  if (n.ok) {
    assert.equal(n.value.email, "jane@maple-home.example");
    assert.equal(n.value.referrer, "https://www.search.example/");
    assert.equal(n.value.landing, "https://www.example.com/bathrobes?utm_source=newsletter");
    assert.equal(n.value.website, "");
  }
  assert.equal(toEmbedInquiryRaw({ quantity: "200" }).message, "Quantity: 200");
  assert.equal(toEmbedInquiryRaw({ quantity: "   " }).message, "", "数量只有空白不算内容");
  assert.equal(toEmbedInquiryRaw({ message: "hello" }).message, "hello");
  const bot = normalizeInquiry(toEmbedInquiryRaw({ email: "bot@spam.example", _hp: "http://spam.example" }));
  assert.ok(bot.ok && bot.value.honeypotTripped);
  assert.match(decoyReceiptId(), /^c[0-9a-f]{24}$/);
});

// ── referrer / landing 不进业务指纹 ──
ok("referrer / 落地页：截断到 500；不进业务指纹（与 page / UTM 一样）；收据载荷往返保留；meta 不还原进业务事实", () => {
  const a = normalizeInquiry({ email: "a@maple-home.example", message: "need quote", referrer: "https://r1.example/", landing: "https://www.example.com/a" });
  const b = normalizeInquiry({ email: "a@maple-home.example", message: "need quote", referer: "https://r2.example/" + "x".repeat(800), landing: "https://www.example.com/b", page: "p", utm_source: "s" });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(b.value.referrer.length, 500);
  assert.equal(computePayloadHash(a.value), computePayloadHash(b.value));
  const payload = toReceiptPayload(a.value, { ipHash: "f".repeat(32) });
  assert.equal(payload.referrer, "https://r1.example/");
  assert.equal(payload.landing, "https://www.example.com/a");
  assert.deepEqual(payload.meta, { ipHash: "f".repeat(32) });
  const back = fromReceiptPayload(JSON.parse(JSON.stringify(payload)));
  assert.equal(back.referrer, "https://r1.example/");
  assert.equal(back.landing, "https://www.example.com/a");
  assert.ok(!("meta" in back));
  assert.equal(computePayloadHash(back), computePayloadHash(a.value));
  assert.ok(!("meta" in toReceiptPayload(a.value)), "无 meta 时不写空对象");
  // 历史收据（没有 referrer / landing 字段）还原为空串，正文与当时一致
  const legacy = fromReceiptPayload({ email: "a@maple-home.example", message: "need quote", utm: {} });
  assert.equal(legacy.referrer, "");
  assert.equal(legacy.landing, "");
  assert.doesNotMatch(buildInquiryMessage(legacy), /落地页|引荐页/);
});

ok("消息正文：有 referrer / 落地页才出现对应行；落地页与来源页相同不重复", () => {
  const n = normalizeInquiry({ email: "a@maple-home.example", page: "https://www.example.com/contact", landing: "https://www.example.com/bathrobes", referrer: "https://www.search.example/" });
  assert.ok(n.ok);
  if (!n.ok) return;
  const body = buildInquiryMessage(n.value, "网站询盘（嵌入表单）");
  assert.match(body, /^【网站询盘（嵌入表单）】/);
  assert.match(body, /落地页：https:\/\/www\.example\.com\/bathrobes/);
  assert.match(body, /引荐页：https:\/\/www\.search\.example\//);
  const same = normalizeInquiry({ email: "a@maple-home.example", page: "https://www.example.com/x", landing: "https://www.example.com/x" });
  assert.ok(same.ok);
  if (same.ok) assert.doesNotMatch(buildInquiryMessage(same.value), /落地页/);
});

// ── 需求内容与主干拒收 ──
ok("需求内容：产品 / 数量（并入留言）/ 留言至少一项；只有姓名 + 邮箱不算", () => {
  const norm = (p: Record<string, unknown>) => {
    const n = normalizeInquiry(toEmbedInquiryRaw({ name: "Jane Doe", email: "jane@maple-home.example", ...p }));
    assert.ok(n.ok);
    return n.ok ? n.value : null!;
  };
  assert.equal(hasInquiryContent(norm({})), false);
  assert.equal(hasInquiryContent(norm({ message: "   ", product: " ", quantity: "  " })), false);
  assert.equal(hasInquiryContent(norm({ product: "Waffle bathrobe" })), true);
  assert.equal(hasInquiryContent(norm({ quantity: "500 pcs" })), true);
  assert.equal(hasInquiryContent(norm({ message: "Please quote" })), true);
});

ok("主干结果分类：带 intakeCode 的 SPINE_FAILED / 主干拒收码 = 拒收（不重试）；抛错 / INCOMPLETE = 暂时失败（503 重试）", () => {
  assert.equal(isPermanentSpineRejection({ ok: false, code: "SPINE_FAILED", error: "询盘内容为空", intakeCode: "EMPTY_MESSAGE" }), true);
  assert.equal(isPermanentSpineRejection({ ok: false, code: "SPINE_FAILED", error: "组织没有可分配的负责人", intakeCode: "NO_OWNER" }), true);
  assert.equal(isPermanentSpineRejection({ ok: false, code: "INVALID_EMAIL", error: "x" }), true);
  assert.equal(isPermanentSpineRejection({ ok: false, code: "SPINE_FAILED", error: "connection reset" }), false);
  assert.equal(isPermanentSpineRejection({ ok: false, code: "INCOMPLETE", error: "x" }), false);
  assert.equal(isPermanentSpineRejection({ ok: false, code: "REPLAY", error: "x" }), false);
  const intakeOk = { ok: true, customerId: "c", opportunityId: "o", interactionId: "i", salesActionId: null } as unknown as Parameters<typeof isPermanentSpineRejection>[0];
  assert.equal(isPermanentSpineRejection(intakeOk), false);
});

ok("主干拒收时保留拒收码：ingestWebsiteInquiry 的 SPINE_FAILED 带 intakeCode（抛错路径不带）", () => {
  const lib = read("src/lib/trade/website-inquiry.ts");
  assert.match(lib, /code: "SPINE_FAILED", error: intake\.error, intakeCode: intake\.code/);
  assert.match(lib, /code: "SPINE_FAILED", error: reason \}/);
});

// ── 管理角色 ──
ok("管理通道的角色：平台管理员；本组织 active 的 org_owner / org_admin；其余（含外贸 org_member）不行", () => {
  assert.equal(roleCanManageTradeChannels("admin", null, false), true);
  assert.equal(roleCanManageTradeChannels("super_admin", null, false), true);
  assert.equal(roleCanManageTradeChannels("trade", "org_owner", true), true);
  assert.equal(roleCanManageTradeChannels("trade", "org_admin", true), true);
  assert.equal(roleCanManageTradeChannels("trade", "org_member", true), false);
  assert.equal(roleCanManageTradeChannels("trade", "org_viewer", true), false);
  assert.equal(roleCanManageTradeChannels("trade", "org_owner", false), false);
  assert.equal(roleCanManageTradeChannels("trade", null, false), false);
  assert.equal(roleCanManageTradeChannels("sales", "org_member", true), false);
});

// ── 静态契约 ──
ok("嵌入路由：段配置静态字面量；成功响应只有 { ok, receiptId }；CORS 只回显已校验来源；deferred + embed 来源", () => {
  const src = read("src/app/api/trade/webhook/website/embed/route.ts");
  assert.match(src, /^export const runtime = "nodejs";$/m);
  assert.match(src, /^export const maxDuration = 300;$/m);
  assert.doesNotMatch(src, /prospectId|opportunityId|duplicate|websiteWebhookBody|messageId/);
  assert.match(src, /reply\(\{ ok: true, receiptId: result\.receiptId \}, 200, allowOrigin\)/);
  assert.match(src, /reply\(\{ ok: false, error: "invalid_key" \}, 401, null\)/);
  assert.match(src, /reply\(\{ ok: false, error: "origin_not_allowed" \}, 403, null\)/);
  assert.doesNotMatch(src, /"Access-Control-Allow-Origin":\s*["']\*["']|origin \|\| "\*"/);
  assert.match(src, /fdeMode: "deferred"/);
  assert.match(src, /origin: \{ kind: "embed" \}/);
  assert.match(src, /receiptMeta: \{ ipHash \}/);
  // 限流在 ingest 之前
  assert.ok(src.indexOf("decideEmbedRateLimit(") < src.indexOf("ingestWebsiteInquiry("));
  assert.ok(src.indexOf("originAllowed(") < src.indexOf("readInquiryPayload(request)"));  // 没有需求内容在入站前 400；503 只给暂时失败（主干拒收不让脚本重试）
  assert.match(src, /reply\(\{ ok: false, error: "message_required" \}, 400, allowOrigin\)/);
  assert.ok(src.indexOf("hasInquiryContent(") < src.indexOf("ingestWebsiteInquiry("));
  assert.ok(src.indexOf("isPermanentSpineRejection(result.spine)") < src.indexOf('"temporarily_unavailable"'));
  // 预检按 ?k= 的公开 key 定位通道，只回显该通道白名单里的来源；不再按"任一租户白名单"放行
  const opts = src.slice(src.indexOf("export async function OPTIONS"), src.indexOf("export async function POST"));
  assert.match(opts, /searchParams\.get\(EMBED_KEY_QUERY\)/);
  assert.match(opts, /preflightAllowedOrigin\(origin, key\)/);
  assert.doesNotMatch(src, /isOriginRegisteredForEmbed/);
  assert.equal(EMBED_KEY_QUERY, "k");
});

ok("服务端密钥解析：webhook 与状态接口共用 resolveWebsiteChannelBySecret，接受宽限期内的旧密钥", () => {
  const lib = read("src/lib/trade/website-inquiry.ts");
  assert.match(lib, /matchWebsiteSecret\(c, secret, now\)/);
  assert.match(read("src/app/api/trade/webhook/website/route.ts"), /resolveWebsiteChannelBySecret\(secret\)/);
  assert.match(read("src/app/api/trade/webhook/website/status/route.ts"), /resolveWebsiteChannelBySecret\(secret\)/);
});

ok("嵌入脚本：不用 cookie / localStorage；归因只进 sessionStorage；Shadow DOM；en/zh；data-key / data-product；API 基址取自 script src", () => {
  const js = read("public/embed/inquiry.js");
  // 只看代码（去掉注释：头注释里写着“不写 localStorage”）
  const code = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /document\.cookie|localStorage|indexedDB/);
  assert.match(js, /sessionStorage/);
  assert.match(js, /attachShadow\(/);
  assert.match(js, /document\.currentScript/);
  assert.match(js, /data-key/);
  assert.match(js, /data-lang/);
  assert.match(js, /data-product/);
  assert.match(js, /new URL\(script\.getAttribute\("data-api"\) \|\| script\.src/);
  assert.match(js, /\/api\/trade\/webhook\/website\/embed/);
  assert.match(js, /"x-qingyan-form-key": KEY/);
  assert.match(js, /\/api\/trade\/webhook\/website\/embed\?k=" \+ encodeURIComponent\(KEY\)/);
  // 产品 / 数量 / 留言至少一项；服务端 message_required 落到留言字段，中英文提示
  assert.match(js, /name === "message" && !v && needsMessage\(\)/);
  assert.match(js, /r\.body\.error === "message_required"/);
  assert.equal((js.match(/errNeed:/g) ?? []).length, 2);
  assert.match(js, /credentials: "omit"/);
  assert.match(js, /name: "_hp"/);
  for (const f of ["name", "email", "phone", "company", "country", "product", "quantity", "message"]) assert.match(js, new RegExp(`name: "${f}"`), f);
  assert.match(js, /en: \{/);
  assert.match(js, /zh: \{/);
  assert.match(js, /aria-live/);
  assert.doesNotMatch(js, /x-qingyan-webhook-secret/);
});

ok("渠道页：不再把服务端密钥放进浏览器 fetch 示例；服务器示例从环境变量读密钥；去掉“加密存储”说法", () => {
  const page = read("src/app/(main)/trade/channels/page.tsx");
  assert.doesNotMatch(page, /'x-qingyan-webhook-secret':\s*'\$\{secret/);
  assert.doesNotMatch(page, /document\.getElementById\('qy-inquiry'\)/);
  assert.doesNotMatch(page, /加密存储/);
  assert.match(page, /getenv\('QINGYAN_WEBHOOK_SECRET'\)/);
  assert.match(page, /\$QINGYAN_WEBHOOK_SECRET/);
  assert.match(page, /\/embed\/inquiry\.js/);
  assert.match(page, /data-key=/);
  assert.match(page, /set_allowed_origins/);
  assert.match(page, /end_secret_grace/);
  assert.match(page, /previousSecrets/);
});

ok("渠道接口：GET 单个通道不再原样返回 config；列表与新建只回掩码视图；管理动作要求管理角色", () => {
  const single = read("src/app/api/trade/channels/[channel]/route.ts");
  const list = read("src/app/api/trade/channels/route.ts");
  assert.doesNotMatch(single, /NextResponse\.json\(ch\)/);
  assert.match(single, /channelView\(ch, canManage\)/);
  for (const fn of ["DELETE", "PATCH"]) {
    const body = single.slice(single.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, 1200), /canManageTradeChannels\(auth\.user, orgRes\.orgId\)/, fn);
  }
  const post = list.slice(list.indexOf("export async function POST"));
  assert.match(post, /canManageTradeChannels\(auth\.user, orgRes\.orgId\)/);
  assert.match(post, /toChannelView\(ch\)/);
  assert.doesNotMatch(list, /NextResponse\.json\(channel, \{ status: 201 \}\)/);
});

ok("website 通道重复保存：已有通道走 updatedAt 比较并交换（不整包覆盖，不会写回并发轮换前的凭证）", () => {
  const svc = read("src/lib/trade/channel-service.ts");
  const fn = svc.slice(svc.indexOf("export async function upsertWebsiteChannel"), svc.indexOf("/** 通道对外视图"));
  assert.doesNotMatch(fn, /tradeChannel\.upsert\(/);
  assert.match(fn, /mutateWebsiteChannelConfig\(input\.orgId, \(c\) => ensureWebsiteCredentialConfig\(c\), \{ name: input\.name, status: "active" \}\)/);
  assert.match(fn, /P2002/);
  assert.match(svc, /where: \{ id: ch\.id, orgId, updatedAt: ch\.updatedAt, \.\.\.sameConfig \}/);
  assert.match(svc, /config: \{ equals: ch\.config as Prisma\.InputJsonValue \}/);
});

console.log(`\nembed-intake: ${pass} 通过`);
