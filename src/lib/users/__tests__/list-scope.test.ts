/**
 * USR-1：平台用户管理的列表范围（纯函数）。
 * 运行：npx tsx src/lib/users/__tests__/list-scope.test.ts
 */
import assert from "node:assert/strict";
import { resolveUserListScope } from "../list-scope";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

ok("scope=platform 显式看全平台（优先于 orgId 与当前企业）", () => {
  assert.deepEqual(resolveUserListScope({ scopeParam: "platform", orgIdParam: "org_a", activeOrgId: "org_b" }), { ok: true, scope: { type: "platform" } });
  assert.deepEqual(resolveUserListScope({ scopeParam: " platform ", orgIdParam: null, activeOrgId: null }), { ok: true, scope: { type: "platform" } });
});

ok("orgId 参数优先于当前工作企业", () => {
  assert.deepEqual(resolveUserListScope({ scopeParam: undefined, orgIdParam: " org_a ", activeOrgId: "org_b" }), { ok: true, scope: { type: "org", orgId: "org_a" } });
});

ok("没传参数 → 当前工作企业", () => {
  assert.deepEqual(resolveUserListScope({ scopeParam: null, orgIdParam: "", activeOrgId: "org_b" }), { ok: true, scope: { type: "org", orgId: "org_b" } });
});

ok("没有任何企业范围 → ORG_SCOPE_REQUIRED，不回落到全平台", () => {
  for (const scopeParam of [undefined, null, "", "org", "all"]) {
    const r = resolveUserListScope({ scopeParam, orgIdParam: undefined, activeOrgId: null });
    assert.ok(!r.ok && r.code === "ORG_SCOPE_REQUIRED", String(scopeParam));
  }
});

console.log(`\n${pass} passed`);
