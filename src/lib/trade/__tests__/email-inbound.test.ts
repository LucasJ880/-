/**
 * 邮件转发入站（PRD F1.2）— 规则 / 验签 / 路由契约，无 DB、无网络：
 *   - Resend（Svix）验签：有效 / 篡改 / 错密钥 / 过期 / 未来时间戳 / 缺头 / 密钥格式错 / 正文非 JSON
 *   - 路由：未配置密钥 503、签名错 401、过期 401（都在任何 DB 访问之前返回）；段配置静态字面量；验签先于处理
 *   - 别名：inq- + 10 位 base32、与 org code 无关；收件地址 → 别名（域名必须一致、+tag、大小写）；未配置域名不生成地址
 *   - 转发白名单归一；发件人严格解析（引号显示名 / 多地址）；DKIM / DMARC 判定（只看原始邮件头最上面一条、
 *     必须是受信 authserv-id；未配置 / 只有 headers 记录 / 伪造在下面 → 失败即关闭）；隔离原因
 *   - eventId（email:<Message-ID>，超长摘要）；解析结果 → 归一化载荷；官网询盘内容孪生判定（空 / 短留言不算）；
 *     双重入站只对官网通知 / 本厂与系统地址判定；busy → 409；白名单判定先于取正文
 * 运行：npx tsx src/lib/trade/__tests__/email-inbound.test.ts
 *
 * 公开仓库：只用虚构企业与保留域名（.example）。
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  INBOUND_ALIAS_RE,
  WEBSITE_TWIN_MIN_MESSAGE,
  aliasFromRecipient,
  emailEventId,
  formatInboundAlias,
  headerFieldsFromRaw,
  inboundAddressFor,
  isAllowlistedSender,
  isWebsiteContentTwin,
  mayBeWebsiteNotification,
  normalizeForwarderAllowlist,
  normalizeInboundDomain,
  parseAuthVerdict,
  quarantineReasons,
  readForwarderAllowlist,
  sameBuyerContact,
  verifyResendWebhookSignature,
} from "../email-inbound-rules";
import { bareAddress, parseForwardedEmail, senderAddress } from "../email-forward-parse";
import { computePayloadHash, toReceiptPayload } from "../website-inquiry-receipts";
import { buildEmailInquiry } from "../email-inbound";
import { blankInquiry } from "../website-inquiry";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** 按 Svix 规范签名（与 SDK 无关的独立实现，用来交叉验证 SDK 的 verify） */
function svixSign(secret: string, id: string, timestampSec: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${timestampSec}.${body}`).digest("base64");
  return `v1,${sig}`;
}

const SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const OTHER_SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const nowSec = () => Math.floor(Date.now() / 1000);
const BODY = JSON.stringify({ type: "email.received", created_at: "2026-10-24T08:00:00Z", data: { email_id: "em_fixture_1", to: ["inq-abcdefghij@in.qingyan.example"] } });

async function main() {
  console.log("email-inbound rules / signature / route contract");

  await ok("验签：有效签名通过并返回事件；多个签名中有一个匹配即可（密钥轮换期）", () => {
    const ts = nowSec();
    const r = verifyResendWebhookSignature(BODY, { id: "msg_1", timestamp: String(ts), signature: svixSign(SECRET, "msg_1", ts, BODY) }, SECRET);
    assert.equal(r.ok, true);
    assert.equal((r as { event: { type: string } }).event.type, "email.received");
    const rotated = `${svixSign(OTHER_SECRET, "msg_1", ts, BODY)} ${svixSign(SECRET, "msg_1", ts, BODY)}`;
    assert.equal(verifyResendWebhookSignature(BODY, { id: "msg_1", timestamp: String(ts), signature: rotated }, SECRET).ok, true);
  });

  await ok("验签：篡改正文 / 换 id / 错密钥 → invalid_signature", () => {
    const ts = nowSec();
    const sig = svixSign(SECRET, "msg_1", ts, BODY);
    const tampered = BODY.replace("em_fixture_1", "em_fixture_2");
    assert.deepEqual(verifyResendWebhookSignature(tampered, { id: "msg_1", timestamp: String(ts), signature: sig }, SECRET), { ok: false, reason: "invalid_signature" });
    assert.deepEqual(verifyResendWebhookSignature(BODY, { id: "msg_2", timestamp: String(ts), signature: sig }, SECRET), { ok: false, reason: "invalid_signature" });
    assert.deepEqual(verifyResendWebhookSignature(BODY, { id: "msg_1", timestamp: String(ts), signature: svixSign(OTHER_SECRET, "msg_1", ts, BODY) }, SECRET), {
      ok: false,
      reason: "invalid_signature",
    });
    assert.deepEqual(verifyResendWebhookSignature(BODY, { id: "msg_1", timestamp: String(ts), signature: "v1,AAAA" }, SECRET), { ok: false, reason: "invalid_signature" });
  });

  await ok("验签：时间戳超过 5 分钟（过去或未来）→ expired，即使签名本身正确", () => {
    const old = nowSec() - 10 * 60;
    assert.deepEqual(verifyResendWebhookSignature(BODY, { id: "msg_1", timestamp: String(old), signature: svixSign(SECRET, "msg_1", old, BODY) }, SECRET), {
      ok: false,
      reason: "expired",
    });
    const future = nowSec() + 10 * 60;
    assert.deepEqual(verifyResendWebhookSignature(BODY, { id: "msg_1", timestamp: String(future), signature: svixSign(SECRET, "msg_1", future, BODY) }, SECRET), {
      ok: false,
      reason: "expired",
    });
    const nearlyOld = nowSec() - 4 * 60;
    assert.equal(verifyResendWebhookSignature(BODY, { id: "msg_1", timestamp: String(nearlyOld), signature: svixSign(SECRET, "msg_1", nearlyOld, BODY) }, SECRET).ok, true);
  });

  await ok("验签：缺头 → missing_headers；密钥格式错 → secret_misconfigured；签名对但正文不是 JSON → invalid_payload", () => {
    const ts = nowSec();
    assert.deepEqual(verifyResendWebhookSignature(BODY, { id: null, timestamp: String(ts), signature: "v1,x" }, SECRET), { ok: false, reason: "missing_headers" });
    assert.deepEqual(verifyResendWebhookSignature(BODY, { id: "a", timestamp: "", signature: "v1,x" }, SECRET), { ok: false, reason: "missing_headers" });
    assert.deepEqual(verifyResendWebhookSignature(BODY, { id: "a", timestamp: String(ts), signature: undefined }, SECRET), { ok: false, reason: "missing_headers" });
    assert.deepEqual(verifyResendWebhookSignature(BODY, { id: "a", timestamp: String(ts), signature: "v1,x" }, "not a secret!"), { ok: false, reason: "secret_misconfigured" });
    assert.deepEqual(verifyResendWebhookSignature(BODY, { id: "a", timestamp: String(ts), signature: "v1,x" }, ""), { ok: false, reason: "secret_misconfigured" });
    const notJson = "hello";
    assert.deepEqual(verifyResendWebhookSignature(notJson, { id: "a", timestamp: String(ts), signature: svixSign(SECRET, "a", ts, notJson) }, SECRET), {
      ok: false,
      reason: "invalid_payload",
    });
  });

  await ok("路由：段配置静态字面量（maxDuration 300，与 after() 里的 FDE 同函数时长）；验签在处理之前；不信任载荷里的 org", () => {
    const route = src("src/app/api/trade/webhook/email/route.ts");
    assert.match(route, /^export const runtime = "nodejs";$/m);
    assert.match(route, /^export const maxDuration = 300;$/m);
    assert.doesNotMatch(route, /^export const (?!runtime|maxDuration|dynamic)\w+/m);
    const verifyIdx = route.indexOf("verifyResendWebhookSignature(");
    const handleIdx = route.indexOf("handleResendInboundEvent(");
    assert.ok(verifyIdx > 0 && handleIdx > verifyIdx, "verify before handle");
    assert.doesNotMatch(route, /db\.|@\/lib\/db/, "route itself never touches the DB");
    assert.doesNotMatch(route, /orgId/);
    const lib = src("src/lib/trade/email-inbound.ts");
    assert.doesNotMatch(lib, /data\.org|body\.org|\.orgId\s*\?\?|payload\.orgId/);
    assert.match(lib, /fdeMode: "deferred"/);
    // 另一次投递正在处理（busy）返回 409 让 Resend 重试，不能是 200（否则首次处理失败后再没人重试）
    assert.match(lib, /if \(result\.busy\) return \{ status: 409,/);
    // 白名单判定在取正文 / 解析之前
    const allowIdx = lib.indexOf("if (!isAllowlistedSender(sender, channel.allowlist))");
    assert.ok(allowIdx > 0 && allowIdx < lib.indexOf("fetchInboundEmailFromResend)(resendEmailId") && allowIdx < lib.indexOf("parseForwardedEmail({"), "allowlist before fetch / parse");
    assert.match(src("src/middleware.ts"), /"\/api\/trade\/webhook",/);
  });

  await ok("路由（动态）：未配置密钥 503；超过 5 MB 413；签名错 / 过期 401；签名对但非 JSON 400 —— 都不碰 DB", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/trade/webhook/email/route");
    const prev = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
    const req = (body: string, headers: Record<string, string>) =>
      new NextRequest("http://localhost/api/trade/webhook/email", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    try {
      delete process.env.RESEND_INBOUND_WEBHOOK_SECRET;
      assert.equal((await POST(req(BODY, {}))).status, 503);
      process.env.RESEND_INBOUND_WEBHOOK_SECRET = "garbage secret";
      assert.equal((await POST(req(BODY, { "svix-id": "a", "svix-timestamp": String(nowSec()), "svix-signature": "v1,x" }))).status, 503);
      process.env.RESEND_INBOUND_WEBHOOK_SECRET = SECRET;
      const ts = nowSec();
      const bad = await POST(req(BODY, { "svix-id": "msg_1", "svix-timestamp": String(ts), "svix-signature": svixSign(OTHER_SECRET, "msg_1", ts, BODY) }));
      assert.equal(bad.status, 401);
      assert.doesNotMatch(JSON.stringify(await bad.json()), /whsec_/);
      assert.equal((await POST(req(BODY, {}))).status, 401);
      // 先看 Content-Length：超大正文不读、不算 HMAC
      assert.equal((await POST(req(BODY, { "content-length": String(6 * 1024 * 1024) }))).status, 413);
      const old = nowSec() - 600;
      assert.equal((await POST(req(BODY, { "svix-id": "msg_1", "svix-timestamp": String(old), "svix-signature": svixSign(SECRET, "msg_1", old, BODY) }))).status, 401);
      assert.equal((await POST(req("nope", { "svix-id": "msg_1", "svix-timestamp": String(ts), "svix-signature": svixSign(SECRET, "msg_1", ts, "nope") }))).status, 400);
    } finally {
      if (prev === undefined) delete process.env.RESEND_INBOUND_WEBHOOK_SECRET;
      else process.env.RESEND_INBOUND_WEBHOOK_SECRET = prev;
    }
  });

  await ok("处理器在访问 DB 之前的结论：非 email.received → ignored；未配置收信域名 → 503", async () => {
    const { handleResendInboundEvent } = await import("../email-inbound");
    assert.deepEqual(await handleResendInboundEvent({ type: "email.delivered", data: {} }, { domain: "in.qingyan.example" }), {
      status: 200,
      body: { ok: true, outcome: "ignored", reason: "event_type" },
    });
    assert.equal((await handleResendInboundEvent({ type: "email.received", data: { to: ["inq-abcdefghij@x.example"] } }, { domain: "" })).status, 503);
  });

  await ok("别名：inq- + 10 位 base32（全部 32 个字符可达），与组织 code 无关", () => {
    const alias = formatInboundAlias(Uint8Array.from([0, 1, 2, 25, 26, 31, 32, 63, 255, 128]));
    // 每字节取低 5 位：0,1,2,25,26,31,32→0,63→31,255→31,128→0
    assert.equal(alias, "inq-abcz27a77a");
    assert.match(alias, INBOUND_ALIAS_RE);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(formatInboundAlias(randomBytes(10)));
    assert.equal(seen.size, 200);
    for (const a of seen) assert.match(a, INBOUND_ALIAS_RE);
    assert.throws(() => formatInboundAlias(new Uint8Array(4)));
    assert.doesNotMatch(src("src/lib/trade/channel-service.ts"), /inboundAlias:\s*[^,}]*\.code/, "alias never derived from org code");
  });

  await ok("地址：未配置收信域名不生成地址（页面显示「未开通」）；域名归一；别名无效不生成", () => {
    assert.equal(inboundAddressFor("inq-abcdefghij", undefined), null);
    assert.equal(inboundAddressFor("inq-abcdefghij", ""), null);
    assert.equal(inboundAddressFor("inq-abcdefghij", "not a domain"), null);
    assert.equal(inboundAddressFor("inq-abcdefghij", " @In.Qingyan.Example "), "inq-abcdefghij@in.qingyan.example");
    assert.equal(inboundAddressFor("example-textiles", "in.qingyan.example"), null);
    assert.equal(inboundAddressFor(undefined, "in.qingyan.example"), null);
    assert.equal(normalizeInboundDomain("in.qingyan.example"), "in.qingyan.example");
    assert.equal(normalizeInboundDomain("localhost"), null);
  });

  await ok("收件地址 → 别名：显示名、大小写、+tag 都能解析；域名不一致 / 非 inq- 别名返回 null", () => {
    const d = "in.qingyan.example";
    assert.equal(aliasFromRecipient("inq-abcdefghij@in.qingyan.example", d), "inq-abcdefghij");
    assert.equal(aliasFromRecipient('"Inquiries" <INQ-ABCDEFGHIJ@IN.QINGYAN.EXAMPLE>', d), "inq-abcdefghij");
    assert.equal(aliasFromRecipient("inq-abcdefghij+alibaba@in.qingyan.example", d), "inq-abcdefghij");
    assert.equal(aliasFromRecipient("inq-abcdefghij@evil.example", d), null);
    assert.equal(aliasFromRecipient("inq-abcdefghij@sub.in.qingyan.example", d), null);
    assert.equal(aliasFromRecipient("sales@in.qingyan.example", d), null);
    assert.equal(aliasFromRecipient("inq-abc@in.qingyan.example", d), null);
    assert.equal(aliasFromRecipient("inq-abcdefghij@in.qingyan.example", null), null);
  });

  await ok("转发白名单：字符串 / 数组、显示名、大小写、去重；无效地址拒绝；上限 50", () => {
    assert.deepEqual(normalizeForwarderAllowlist("Sales@ExampleTextiles.example\nlily@exampletextiles.example, sales@exampletextiles.example；Kevin <kevin@exampletextiles.example>"), {
      ok: true,
      value: ["sales@exampletextiles.example", "lily@exampletextiles.example", "kevin@exampletextiles.example"],
    });
    assert.deepEqual(normalizeForwarderAllowlist(["a@b.example", 3, "A@B.example"]), { ok: true, value: ["a@b.example"] });
    assert.deepEqual(normalizeForwarderAllowlist(undefined), { ok: true, value: [] });
    const bad = normalizeForwarderAllowlist("sales@exampletextiles.example, not-an-email");
    assert.equal(bad.ok, false);
    assert.deepEqual((bad as { invalid: string[] }).invalid, ["not-an-email"]);
    assert.equal(normalizeForwarderAllowlist({ x: 1 }).ok, false);
    const many = Array.from({ length: 51 }, (_, i) => `user${i}@exampletextiles.example`);
    assert.equal(normalizeForwarderAllowlist(many).ok, false);
    assert.deepEqual(readForwarderAllowlist({ forwarderAllowlist: ["A@b.example", 1, ""] }), ["a@b.example"]);
    assert.deepEqual(readForwarderAllowlist(null), []);
  });

  await ok("DKIM / DMARC（原始邮件头最上面一条 + 受信 authserv-id）：DMARC 通过或对齐的 DKIM 通过 → pass；他人代签 / 失败 → fail；没有结果 → missing", () => {
    const sender = "Lily <lily@exampletextiles.example>";
    const T = { trustedAuthServId: "mx.receiver.example" };
    const raw = (...ars: string[]) =>
      [...ars.map((v) => `Authentication-Results: ${v}`), "Received: from mail.exampletextiles.example by mx.receiver.example", "From: Lily <lily@exampletextiles.example>", "Subject: Fwd: RFQ", "", "body line: Authentication-Results: forged; dmarc=pass"].join("\r\n");
    const v = (ar: string) => parseAuthVerdict({ rawHeaders: raw(ar) }, sender, T).verdict;
    assert.equal(v("mx.receiver.example; dkim=pass header.d=exampletextiles.example; spf=pass smtp.mailfrom=exampletextiles.example; dmarc=pass header.from=exampletextiles.example"), "pass");
    assert.equal(v("mx.receiver.example; dkim=pass header.i=@mail.exampletextiles.example"), "pass");
    assert.equal(v("mx.receiver.example; dkim=pass header.d=sendgrid.example; dmarc=none"), "fail");
    assert.equal(v("mx.receiver.example; dkim=fail header.d=exampletextiles.example; dmarc=fail header.from=exampletextiles.example"), "fail");
    assert.equal(v("mx.receiver.example; dmarc=pass header.from=other.example"), "fail");
    assert.equal(v("mx.receiver.example; spf=pass smtp.mailfrom=exampletextiles.example"), "missing");
    assert.equal(v("mx.receiver.example; dkim=none"), "missing");
    // 折行的头（续行以空白开头）能接上
    const folded = "Authentication-Results: mx.receiver.example;\r\n\tdkim=pass header.d=exampletextiles.example;\r\n dmarc=pass header.from=exampletextiles.example\r\nFrom: x\r\n\r\n";
    assert.equal(parseAuthVerdict({ rawHeaders: folded }, sender, T).verdict, "pass");
    const full = parseAuthVerdict({ rawHeaders: raw("mx.receiver.example; spf=pass; dkim=pass header.d=exampletextiles.example; dmarc=pass") }, sender, T);
    assert.deepEqual(
      { ...full },
      { verdict: "pass", dkim: "pass", dkimDomain: "exampletextiles.example", spf: "pass", dmarc: "pass", authServId: "mx.receiver.example", source: "raw", note: null, seenAuthServIds: ["mx.receiver.example"] },
    );
  });

  await ok("DKIM / DMARC 失败即关闭：未配置 authserv-id、只有 receiving API 的 headers 记录、最上面一条不是受信方写的 → missing", () => {
    const sender = "lily@exampletextiles.example";
    const good = "Authentication-Results: mx.receiver.example; dkim=pass header.d=exampletextiles.example; dmarc=pass header.from=exampletextiles.example\r\nFrom: x\r\n";
    // 未配置受信 authserv-id：发件方自己写的 Authentication-Results 也长这样，一律不信（但记下看到的 id 供运维配置）
    const noTrust = parseAuthVerdict({ rawHeaders: good }, sender, {});
    assert.equal(noTrust.verdict, "missing");
    assert.equal(noTrust.note, "authserv_id_not_configured");
    assert.deepEqual(noTrust.seenAuthServIds, ["mx.receiver.example"]);
    assert.equal(parseAuthVerdict({ rawHeaders: good }, sender, { trustedAuthServId: "  " }).note, "authserv_id_not_configured");
    // receiving API 的 headers 是 Record（同名头合并方式未知）：只用于排障，不参与判定
    const record = parseAuthVerdict({ headers: { "Authentication-Results": "mx.receiver.example; dkim=pass header.d=exampletextiles.example; dmarc=pass" } }, sender, { trustedAuthServId: "mx.receiver.example" });
    assert.equal(record.verdict, "missing");
    assert.equal(record.note, "raw_headers_unavailable");
    assert.deepEqual(record.seenAuthServIds, ["mx.receiver.example"]);
    assert.equal(parseAuthVerdict({}, sender, { trustedAuthServId: "mx.receiver.example" }).verdict, "missing");
    assert.equal(parseAuthVerdict({ rawHeaders: "From: x\r\nSubject: y\r\n" }, sender, { trustedAuthServId: "mx.receiver.example" }).note, "no_authentication_results");
    // 发件方伪造的「通过」在收信方那条下面：只看最上面一条
    const forgedBelow = [
      "Authentication-Results: mx.receiver.example; dkim=fail header.d=exampletextiles.example; dmarc=fail header.from=exampletextiles.example",
      "Received: from attacker.example by mx.receiver.example",
      "Authentication-Results: mx.receiver.example; dkim=pass header.d=exampletextiles.example; dmarc=pass header.from=exampletextiles.example",
      "From: lily@exampletextiles.example",
    ].join("\r\n");
    assert.equal(parseAuthVerdict({ rawHeaders: forgedBelow }, sender, { trustedAuthServId: "mx.receiver.example" }).verdict, "fail");
    // 最上面一条是别人写的（收信方没有写自己的结论）→ 不往下找
    const otherOnTop = ["Authentication-Results: forged.example; dkim=pass header.d=exampletextiles.example; dmarc=pass", "Authentication-Results: mx.receiver.example; dkim=pass header.d=exampletextiles.example"].join("\n");
    const top = parseAuthVerdict({ rawHeaders: otherOnTop }, sender, { trustedAuthServId: "mx.receiver.example" });
    assert.equal(top.verdict, "missing");
    assert.equal(top.note, "topmost_not_trusted");
    assert.deepEqual(top.seenAuthServIds, ["forged.example", "mx.receiver.example"]);
    // 受信 id 的子域也认（收信集群的主机名）
    assert.equal(parseAuthVerdict({ rawHeaders: good }, sender, { trustedAuthServId: "receiver.example" }).verdict, "pass");
    // 头块在第一个空行结束：正文里的同名行不算
    assert.deepEqual(headerFieldsFromRaw("A: 1\r\n  folded\r\nB: 2\r\n\r\nAuthentication-Results: x"), [
      { name: "a", value: "1 folded" },
      { name: "b", value: "2" },
    ]);
  });

  await ok("发件人严格解析：引号里的显示名藏白名单地址、多个地址、未闭合引号 → 不在白名单；DMARC 对齐也用真实地址", () => {
    const allow = ["lily@exampletextiles.example"];
    assert.equal(isAllowlistedSender("Lily Chen <lily@exampletextiles.example>", allow), true);
    assert.equal(isAllowlistedSender("LILY@exampletextiles.example", allow), true);
    assert.equal(isAllowlistedSender("lily@exampletextiles.example (Lily)", allow), true);
    assert.equal(isAllowlistedSender('"<lily@exampletextiles.example>" <mallory@evil.example>', allow), false);
    assert.equal(isAllowlistedSender('"lily@exampletextiles.example" <mallory@evil.example>', allow), false);
    assert.equal(isAllowlistedSender("lily@exampletextiles.example, mallory@evil.example", allow), false);
    assert.equal(isAllowlistedSender("<lily@exampletextiles.example> <mallory@evil.example>", allow), false);
    assert.equal(isAllowlistedSender('"Lily <lily@exampletextiles.example>', allow), false);
    assert.equal(isAllowlistedSender("", allow), false);
    assert.equal(senderAddress('"<lily@exampletextiles.example>" <mallory@evil.example>'), "mallory@evil.example");
    assert.equal(bareAddress('"<lily@exampletextiles.example>" <mallory@evil.example>'), "mallory@evil.example");
    // 伪造头 + 引号显示名：白名单与 DKIM 对齐都按 mallory 的域名判定 → 双双不通过
    const forged = 'Authentication-Results: mx.receiver.example; dmarc=pass header.from=exampletextiles.example; dkim=pass header.d=exampletextiles.example\r\n';
    const from = '"<lily@exampletextiles.example>" <mallory@evil.example>';
    const auth = parseAuthVerdict({ rawHeaders: forged }, from, { trustedAuthServId: "mx.receiver.example" });
    assert.equal(auth.verdict, "fail");
    assert.deepEqual(quarantineReasons({ sender: from, allowlist: allow, auth, buyerEmail: "jane@maple.example", buyerPhone: "" }), ["sender_not_allowed", "auth_unverified"]);
  });

  await ok("隔离原因：发件人不在白名单 / 验证未通过 / 无买家联系方式，可同时成立", () => {
    const allow = ["lily@exampletextiles.example"];
    assert.deepEqual(quarantineReasons({ sender: "Lily <LILY@exampletextiles.example>", allowlist: allow, auth: { verdict: "pass" }, buyerEmail: "jane@maple.example", buyerPhone: "" }), []);
    assert.deepEqual(quarantineReasons({ sender: "lily@exampletextiles.example", allowlist: allow, auth: { verdict: "pass" }, buyerEmail: "", buyerPhone: "+1 416 555 0134" }), []);
    assert.deepEqual(quarantineReasons({ sender: "mallory@evil.example", allowlist: allow, auth: { verdict: "missing" }, buyerEmail: "", buyerPhone: "" }), [
      "sender_not_allowed",
      "auth_unverified",
      "no_buyer_contact",
    ]);
    assert.deepEqual(quarantineReasons({ sender: "lily@exampletextiles.example", allowlist: [], auth: { verdict: "pass" }, buyerEmail: "jane@maple.example", buyerPhone: "" }), ["sender_not_allowed"]);
    assert.deepEqual(quarantineReasons({ sender: "lily@exampletextiles.example", allowlist: allow, auth: { verdict: "fail" }, buyerEmail: "jane@maple.example", buyerPhone: "" }), ["auth_unverified"]);
  });

  await ok("eventId：email:<Message-ID>（去尖括号）；超长 → sha256 摘要（稳定、≤120）；无 Message-ID 用 Resend id", () => {
    assert.equal(emailEventId("<CAF=abc123@mail.gmail.example>"), "email:CAF=abc123@mail.gmail.example");
    const long = `<${"x".repeat(200)}@outlook.example>`;
    const a = emailEventId(long)!;
    assert.match(a, /^email:sha256:[0-9a-f]{40}$/);
    assert.equal(emailEventId(long), a);
    assert.equal(emailEventId("", "em_123"), "email:resend:em_123");
    assert.equal(emailEventId(null, null), null);
  });

  await ok("解析结果 → 归一化载荷：长度上限、邮箱小写、来源页 / UTM 留空（指纹不含归因字段）", () => {
    const parsed = parseForwardedEmail({
      from: "lily@exampletextiles.example",
      text: `---------- Forwarded message ---------\nFrom: Jane Doe <Jane.Doe@MapleHomeGoods.example>\nDate: Mon, Oct 20, 2026\nSubject: RFQ\nTo: <lily@exampletextiles.example>\n\nPlease quote 500 towels.\n\n\n\nThanks`,
    });
    const v = buildEmailInquiry(parsed, "email:abc@x.example");
    assert.equal(v.email, "jane.doe@maplehomegoods.example");
    assert.equal(v.eventId, "email:abc@x.example");
    assert.equal(v.page, "");
    assert.deepEqual(v.utm, { source: "", medium: "", campaign: "", content: "", term: "" });
    assert.equal(v.honeypotTripped, false);
    assert.ok(v.message.length <= 4000);
    assert.equal(computePayloadHash(v), computePayloadHash({ ...v, page: "https://x.example", utm: { ...v.utm, source: "google" } }));
    // 白名单以外的发件人：不解析，收据只放空载荷（原主题等在 meta）
    const blank = blankInquiry("email:spam@x.example");
    assert.deepEqual({ name: blank.name, email: blank.email, phone: blank.phone, message: blank.message, eventId: blank.eventId }, { name: "", email: "", phone: "", message: "", eventId: "email:spam@x.example" });
    // 解析结果没带的字段沿用空载荷
    const base = blankInquiry("email:abc@x.example");
    for (const k of ["website", "page", "referrer", "landing", "utm", "eventId", "honeypotTripped"] as const) assert.deepEqual(v[k], base[k], k);
  });

  await ok("隔离 / 重复收据载荷：toReceiptPayload(v, meta) 与原先的 { ...toReceiptPayload(v), meta } 相同（meta 总是非空）", () => {
    const v = { ...blankInquiry("email:q@x.example"), email: "jane.doe@maplehomegoods.example", message: "Please quote 500 towels." };
    for (const meta of [
      { kind: "email_forward", subject: "RFQ", quarantine: { reasons: ["auth_unverified"], at: "2026-10-20T00:00:00.000Z", notifyKey: null } },
      { kind: "email_forward", subject: "", parse: null, auth: null, duplicate: { websiteReceiptId: "r1", websiteEventId: "evt-1", matchedBy: "content_twin" } },
    ]) {
      assert.deepEqual(toReceiptPayload(v, meta), { ...toReceiptPayload(v), meta });
    }
  });

  await ok("官网询盘孪生：同联系人 + 留言整段（或 80% 词）出现在转发全文 → 是；换人 / 换内容 → 否", () => {
    const web = { email: "jane.doe@maplehomegoods.example", phone: "+1 416 555 0134", message: "We need 550gsm bath towels in 3 colors, please quote FOB Ningbo.", product: "Bath Towels" };
    const full = "New inquiry\nEmail: jane.doe@maplehomegoods.example\nMessage:\nWe need 550gsm bath towels in 3 colors, please quote FOB Ningbo.\n";
    assert.equal(isWebsiteContentTwin(web, { buyerEmail: "jane.doe@maplehomegoods.example", buyerPhone: "", fullText: full }), true);
    // 只有电话一致（末 10 位）
    assert.equal(isWebsiteContentTwin(web, { buyerEmail: "", buyerPhone: "(416) 555-0134", fullText: full }), true);
    // 转发时 HTML 换行 / 标点被打乱：80% 词命中
    assert.equal(isWebsiteContentTwin(web, { buyerEmail: web.email, buyerPhone: "", fullText: "we need 550gsm bath towels in 3 colors; please quote FOB" }), true);
    // 联系人不同
    assert.equal(isWebsiteContentTwin(web, { buyerEmail: "other@example.com", buyerPhone: "", fullText: full }), false);
    // 同一买家的另一条新询盘
    assert.equal(isWebsiteContentTwin(web, { buyerEmail: web.email, buyerPhone: "", fullText: "Hello, now we also need 2000 beach towels with printing." }), false);
    // 官网留言为空 / 太短：一律不算孪生（不再退回「同联系人 + 产品出现」——同一买家之后的新询盘会被误判、内容丢失）
    const empty = { ...web, message: "" };
    assert.equal(isWebsiteContentTwin(empty, { buyerEmail: web.email, buyerPhone: "", fullText: "Product Interest: Bath Towels" }), false);
    assert.equal(isWebsiteContentTwin(empty, { buyerEmail: web.email, buyerPhone: "", fullText: "Hi, now please quote 5000 bath towels, 600gsm, navy, FOB Ningbo." }), false);
    const productOnly = { ...web, message: "Bath", product: "Bath" };
    assert.equal(isWebsiteContentTwin(productOnly, { buyerEmail: web.email, buyerPhone: "", fullText: "Bath towels RFQ: we need 5000 pcs in navy" }), false);
    assert.equal(WEBSITE_TWIN_MIN_MESSAGE, 20);
  });

  await ok("双重入站只对官网通知 / 本厂人员与系统地址发出的邮件判定；买家来信与平台通知永不判重复；联系人一致判定", () => {
    assert.equal(mayBeWebsiteNotification({ format: "website_notification", platform: null, senderKind: "staff" }), true);
    assert.equal(mayBeWebsiteNotification({ format: "website_notification", platform: null, senderKind: "buyer" }), true);
    assert.equal(mayBeWebsiteNotification({ format: "gmail_forward", platform: null, senderKind: "system" }), true);
    assert.equal(mayBeWebsiteNotification({ format: "plain", platform: null, senderKind: "staff" }), true);
    assert.equal(mayBeWebsiteNotification({ format: "gmail_forward", platform: null, senderKind: "buyer" }), false);
    assert.equal(mayBeWebsiteNotification({ format: "outlook_forward", platform: null, senderKind: "unknown" }), false);
    assert.equal(mayBeWebsiteNotification({ format: "platform_notification", platform: "alibaba", senderKind: "platform" }), false);
    assert.equal(mayBeWebsiteNotification({ format: "gmail_forward", platform: null, senderKind: "platform" }), false);
    // 买家来信里的「RFQ No.」不是官网询盘编号
    const rfq = parseForwardedEmail({
      from: "lily@exampletextiles.example",
      text: "---------- Forwarded message ---------\nFrom: Bob Example <bob@examplebuyer.example>\nDate: Mon, Oct 20, 2026\nSubject: RFQ\nTo: <lily@exampletextiles.example>\n\nRFQ No.: 1523\nPlease quote 5000 bath towels.",
    });
    assert.equal(rfq.websiteInquiryId, "");
    assert.equal(rfq.senderKind, "buyer");
    assert.equal(mayBeWebsiteNotification(rfq), false);
    assert.equal(sameBuyerContact({ email: "Jane@Maple.example", phone: "" }, { email: "jane@maple.example", phone: "" }), true);
    assert.equal(sameBuyerContact({ email: "", phone: "+1 (416) 555-0134" }, { email: "x@y.example", phone: "416 555 0134" }), true);
    assert.equal(sameBuyerContact({ email: "jane@maple.example", phone: "" }, { email: "other@maple.example", phone: "" }), false);
    assert.equal(sameBuyerContact({ email: "", phone: "" }, { email: "", phone: "" }), false);
  });

  console.log(`\nemail-inbound: ${pass} 通过`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
