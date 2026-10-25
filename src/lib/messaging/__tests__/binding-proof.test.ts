/**
 * 微信绑定占有证明（验证码）+ 归属判定 — 纯函数，无 DB。
 * 真实库上的「不能抢别人的绑定」见 wechat-binding-confirm-db.isolated.test.ts。
 * 运行：npx tsx src/lib/messaging/__tests__/binding-proof.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BIND_CODE_LENGTH,
  BIND_CODE_WINDOW_MS,
  buildUnboundReply,
  decideBindingClaim,
  deriveBindCodeKey,
  formatBindCode,
  isPersonalWeChatBindCommand,
  issueBindCode,
  normalizeBindCode,
  verifyBindCode,
} from "../binding-proof";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("binding proof");

const KEY = deriveBindCodeKey("test-root-secret-for-binding-proof")!;
const OTHER_KEY = deriveBindCodeKey("another-root-secret")!;
// 时间窗起点 + 1 分钟
const T0 = new Date(Math.floor(Date.UTC(2026, 9, 24, 2, 0, 0) / BIND_CODE_WINDOW_MS) * BIND_CODE_WINDOW_MS + 60_000);
const at = (ms: number) => new Date(T0.getTime() + ms);

ok("没有服务端密钥：不下发、不通过（fail-closed）", () => {
  assert.equal(deriveBindCodeKey(undefined), null);
  assert.equal(deriveBindCodeKey("   "), null);
  assert.equal(issueBindCode(null, "wecom", "ZhangSan", T0), null);
  assert.equal(verifyBindCode(null, "wecom", "ZhangSan", "ABCDEFGH", T0), false);
});

ok("验证码：8 位、只含无歧义字符、同窗内确定", () => {
  const c = issueBindCode(KEY, "wecom", "ZhangSan", T0)!;
  assert.equal(c.length, BIND_CODE_LENGTH);
  assert.match(c, /^[2-9A-HJ-NP-Z]{8}$/);
  assert.equal(issueBindCode(KEY, "wecom", "ZhangSan", at(5 * 60_000)), c);
  assert.equal(formatBindCode(c), `${c.slice(0, 4)}-${c.slice(4)}`);
});

ok("本窗与上一窗的验证码有效，再早就过期", () => {
  const c = issueBindCode(KEY, "wecom", "ZhangSan", T0)!;
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", c, T0), true);
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", c, at(BIND_CODE_WINDOW_MS)), true, "下一个窗仍有效（保证至少 15 分钟）");
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", c, at(2 * BIND_CODE_WINDOW_MS)), false, "两个窗之后过期");
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", c, at(-BIND_CODE_WINDOW_MS)), false, "未来窗的码不能提前用");
});

ok("验证码绑定外部账号与渠道：换账号 / 换渠道 / 换密钥都不通过", () => {
  const c = issueBindCode(KEY, "wecom", "ZhangSan", T0)!;
  assert.equal(verifyBindCode(KEY, "wecom", "LiSi", c, T0), false);
  assert.equal(verifyBindCode(KEY, "personal_wechat", "ZhangSan", c, T0), false);
  assert.equal(verifyBindCode(OTHER_KEY, "wecom", "ZhangSan", c, T0), false);
  assert.notEqual(issueBindCode(KEY, "wecom", "LiSi", T0), c);
});

ok("输入归一：小写 / 连字符 / 空格都可以；长度不对、多字节字符、非字符串一律不通过（不抛错）", () => {
  const c = issueBindCode(KEY, "wecom", "ZhangSan", T0)!;
  const messy = ` ${c.slice(0, 4).toLowerCase()} - ${c.slice(4).toLowerCase()} `;
  assert.equal(normalizeBindCode(messy), c);
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", messy, T0), true);
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", c.slice(0, 7), T0), false);
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", `${c}A`, T0), false);
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", "验证码ABCDE", T0), false);
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", "绑定码一二三四五六七八", T0), false);
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", 12345678, T0), false);
  assert.equal(verifyBindCode(KEY, "wecom", "ZhangSan", undefined, T0), false);
  assert.equal(verifyBindCode(KEY, "wecom", "", c, T0), false);
});

ok("归属判定：别人仍在用 → conflict（绝不迁移）；别人已解绑 → 可接手；本人 → 刷新；没有 → 新建", () => {
  assert.equal(decideBindingClaim(null, "u1"), "create");
  assert.equal(decideBindingClaim({ userId: "u1", status: "active" }, "u1"), "refresh_own");
  assert.equal(decideBindingClaim({ userId: "u1", status: "disconnected" }, "u1"), "refresh_own");
  assert.equal(decideBindingClaim({ userId: "victim", status: "active" }, "attacker"), "conflict");
  assert.equal(decideBindingClaim({ userId: "old", status: "disconnected" }, "u2"), "reclaim_released");
  assert.equal(decideBindingClaim({ userId: "old", status: "expired" }, "u2"), "reclaim_released");
});

ok("个人微信下发验证码只认「绑定青砚」整句（客户闲聊里的「绑定」不触发）", () => {
  assert.equal(isPersonalWeChatBindCommand("绑定青砚"), true);
  assert.equal(isPersonalWeChatBindCommand("  绑定 青砚 "), true);
  assert.equal(isPersonalWeChatBindCommand("绑定"), false);
  assert.equal(isPersonalWeChatBindCommand("怎么绑定青砚？"), false);
  assert.equal(isPersonalWeChatBindCommand(undefined), false);
});

ok("机器人回复：含外部账号与格式化验证码；没密钥时不下发并提示联系管理员", () => {
  const c = issueBindCode(KEY, "wecom", "ZhangSan", T0)!;
  const r = buildUnboundReply("wecom", "ZhangSan", c);
  assert.ok(r.includes("企微 UserId：ZhangSan") && r.includes(formatBindCode(c)) && r.includes("请勿转发"));
  const p = buildUnboundReply("personal_wechat", "wx_abc", issueBindCode(KEY, "personal_wechat", "wx_abc", T0));
  assert.ok(p.includes("微信 ID：wx_abc") && p.includes("绑定验证码"));
  const none = buildUnboundReply("wecom", "ZhangSan", null);
  assert.ok(!none.includes("绑定验证码") && none.includes("联系管理员"));
});

ok("绑定接口：创建路径必须带验证码，且不再用 upsert 覆盖 userId", () => {
  const root = path.resolve(__dirname, "../../../..");
  const route = readFileSync(path.join(root, "src/app/api/messaging/bindings/route.ts"), "utf8");
  const lib = readFileSync(path.join(root, "src/lib/messaging/binding.ts"), "utf8");
  assert.ok(route.includes("bindCode: body.bindCode"), "路由把 bindCode 交给 createBinding");
  assert.ok(route.includes("status: 409"), "别人在用 → 409");
  assert.ok(!/weChatBinding\.upsert/.test(lib), "binding.ts 不再 upsert（upsert 会把别人的绑定改到自己名下）");
  assert.ok(lib.includes("verifyBindCode(key, params.channel, params.externalId, params.bindCode, now)"), "createBinding 内部校验验证码，调用方绕不过");
  // 早先的修复仍在：偏好 / 解绑只作用于本人的绑定
  assert.ok(/updateMany\(\{\s*where: \{ id: bindingId, userId \}/.test(lib), "偏好 / 解绑 where { id, userId }");
});

console.log(`  ${pass} passed`);
