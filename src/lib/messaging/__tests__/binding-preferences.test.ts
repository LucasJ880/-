/**
 * 微信绑定偏好白名单：偏好接口只能改推送开关 / 推送域 / 静默时段 / 过滤方式，不能借机改绑定归属。
 * 纯函数，无 DB；「只能改本人的绑定」见 owner-today-db.isolated.test.ts。
 * 运行：npx tsx src/lib/messaging/__tests__/binding-preferences.test.ts
 */
import assert from "node:assert/strict";
import { sanitizeBindingPreferences } from "../binding";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("binding preferences");

ok("userId / orgId / status / externalId / channel 等字段一律丢弃", () => {
  const out = sanitizeBindingPreferences({ userId: "attacker", orgId: "org_x", status: "active", externalId: "wx_1", channel: "wecom", id: "b2", pushBriefing: false });
  assert.deepEqual(out, { pushBriefing: false });
});

ok("推送开关只认布尔值；推送域只认已知域并去重", () => {
  assert.deepEqual(sanitizeBindingPreferences({ pushSales: "true", pushReport: true }), { pushReport: true });
  assert.deepEqual(sanitizeBindingPreferences({ pushDomains: "trade, sales,trade,evil" }), { pushDomains: "trade,sales" });
  assert.deepEqual(sanitizeBindingPreferences({ pushDomains: "evil" }), {});
});

ok("静默时段只认 HH:MM，空串 / null 清空；过滤方式只认 all / keyword / whitelist", () => {
  assert.deepEqual(sanitizeBindingPreferences({ silentStart: "22:00", silentEnd: "25:00" }), { silentStart: "22:00" });
  assert.deepEqual(sanitizeBindingPreferences({ silentStart: "", silentEnd: null }), { silentStart: null, silentEnd: null });
  assert.deepEqual(sanitizeBindingPreferences({ filterMode: "regex", filterKeyword: "  青砚 " }), { filterKeyword: "青砚" });
  assert.deepEqual(sanitizeBindingPreferences({ filterMode: "keyword" }), { filterMode: "keyword" });
});

ok("非对象输入返回空偏好", () => {
  assert.deepEqual(sanitizeBindingPreferences(null), {});
  assert.deepEqual(sanitizeBindingPreferences(["pushBriefing"]), {});
});

console.log(`  ${pass} passed`);
