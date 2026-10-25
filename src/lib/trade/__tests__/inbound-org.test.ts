/**
 * 入站标识（WhatsApp phoneNumberId / 公众号原始 ID）纯函数：取值口径与跨组织重复的列举（无 DB）
 * 运行：npx tsx src/lib/trade/__tests__/inbound-org.test.ts
 *
 * 公开仓库：只用虚构 id。
 */
import assert from "node:assert/strict";
import { INBOUND_ID_KEYS, crossOrgInboundIdDuplicates, inboundIdsOf, isInboundIdChannel } from "../inbound-org";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("inbound-org");

ok("参与入站解析的字段：WhatsApp 只有 phoneNumberId；微信四个字段；其他通道不参与", () => {
  assert.deepEqual([...INBOUND_ID_KEYS.whatsapp], ["phoneNumberId"]);
  assert.deepEqual([...INBOUND_ID_KEYS.wechat], ["originalId", "toUserName", "ghId", "wechatId"]);
  assert.equal(isInboundIdChannel("whatsapp"), true);
  assert.equal(isInboundIdChannel("wechat"), true);
  for (const c of ["wechat_work", "website", "email", "toString", "constructor"]) assert.equal(isInboundIdChannel(c), false, c);
});

ok("inboundIdsOf：去首尾空白、去空、去重；数字也按字符串比较；非对象 config → 空", () => {
  assert.deepEqual(inboundIdsOf("whatsapp", { phoneNumberId: " 1001 ", accessToken: "secret" }), [{ key: "phoneNumberId", value: "1001" }]);
  assert.deepEqual(inboundIdsOf("whatsapp", { phoneNumberId: 1001 }), [{ key: "phoneNumberId", value: "1001" }]);
  assert.deepEqual(inboundIdsOf("whatsapp", { phoneNumberId: "  " }), []);
  assert.deepEqual(inboundIdsOf("wechat", { originalId: "gh_a", ghId: "gh_a", toUserName: "gh_b", appSecret: "s" }), [
    { key: "originalId", value: "gh_a" },
    { key: "toUserName", value: "gh_b" },
  ]);
  for (const bad of [null, undefined, "gh_a", ["gh_a"], 42]) assert.deepEqual(inboundIdsOf("wechat", bad), [], JSON.stringify(bad));
});

ok("跨组织重复：同一值在两个组织 → 列出；同组织 / 不同值不列；微信跨字段也算；结果不含标识值与凭证", () => {
  const rows = [
    { id: "ch-wa-1", orgId: "org-1", channel: "whatsapp", config: { phoneNumberId: "900", accessToken: "tok-1" } },
    { id: "ch-wa-2", orgId: "org-2", channel: "whatsapp", config: { phoneNumberId: " 900", accessToken: "tok-2" } },
    { id: "ch-wa-3", orgId: "org-3", channel: "whatsapp", config: { phoneNumberId: "901" } },
    { id: "ch-oa-1", orgId: "org-1", channel: "wechat", config: { originalId: "gh_x", ghId: "gh_x" } },
    { id: "ch-oa-2", orgId: "org-2", channel: "wechat", config: { wechatId: "gh_x", toUserName: "gh_x" } },
    { id: "ch-oa-3", orgId: "org-3", channel: "wechat", config: { originalId: "gh_y" } },
    // 不同通道类型之间不比较（企业微信不按这些字段解析）
    { id: "ch-ww-1", orgId: "org-4", channel: "wechat_work", config: { phoneNumberId: "900", originalId: "gh_x" } },
  ];
  const groups = crossOrgInboundIdDuplicates(rows);
  assert.deepEqual(groups, [
    { channel: "whatsapp", keys: ["phoneNumberId"], channels: [{ orgId: "org-1", channelId: "ch-wa-1" }, { orgId: "org-2", channelId: "ch-wa-2" }] },
    // 同一通道里多个字段填同一值时按字段顺序记第一个（originalId → toUserName → ghId → wechatId）
    { channel: "wechat", keys: ["originalId", "toUserName"], channels: [{ orgId: "org-1", channelId: "ch-oa-1" }, { orgId: "org-2", channelId: "ch-oa-2" }] },
  ]);
  const text = JSON.stringify(groups);
  for (const secret of ["900", "gh_x", "tok-1", "tok-2"]) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(crossOrgInboundIdDuplicates(rows.filter((r) => r.orgId !== "org-2")), []);
});

ok("同一组织不可能有两条同类通道（唯一约束），但即便传进来也不算跨组织重复", () => {
  assert.deepEqual(
    crossOrgInboundIdDuplicates([
      { id: "a", orgId: "org-1", channel: "whatsapp", config: { phoneNumberId: "7" } },
      { id: "b", orgId: "org-1", channel: "whatsapp", config: { phoneNumberId: "7" } },
    ]),
    [],
  );
});

console.log(`\ninbound-org: ${pass} 通过`);
