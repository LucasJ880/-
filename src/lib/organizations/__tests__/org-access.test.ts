/**
 * Security-1：企业访问模式 / 草稿 key
 * 运行：npx tsx src/lib/organizations/__tests__/org-access.test.ts
 */

import { canSelfSwitchOrganizations } from "../org-access";

function draftStorageKey(orgId: string, userId: string): string {
  return `qingyan:quote-sheet-draft:v1:${orgId}:${userId}`;
}

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("security-1 org access");

ok(
  !canSelfSwitchOrganizations({
    orgAccessMode: "FIXED",
    canSelfSwitchOrg: false,
    activeOrgId: "o1",
  }),
  "FIXED 不可切换",
);

ok(
  !canSelfSwitchOrganizations({
    orgAccessMode: "MULTI_ORG",
    canSelfSwitchOrg: false,
    activeOrgId: "o1",
  }),
  "MULTI_ORG 但未授权 canSelfSwitchOrg 不可切换",
);

ok(
  canSelfSwitchOrganizations({
    orgAccessMode: "MULTI_ORG",
    canSelfSwitchOrg: true,
    activeOrgId: "o1",
  }),
  "MULTI_ORG + canSelfSwitchOrg 可切换",
);

ok(
  !canSelfSwitchOrganizations({
    orgAccessMode: "PLATFORM_SUPPORT",
    canSelfSwitchOrg: true,
    activeOrgId: null,
  }),
  "PLATFORM_SUPPORT 不可走普通切换",
);

const k1 = draftStorageKey("orgA", "user1");
const k2 = draftStorageKey("orgB", "user1");
ok(k1.includes("orgA") && k1.includes("user1"), "草稿 key 含 orgId+userId");
ok(k1 !== k2, "不同企业草稿 key 不同");
ok(!k1.endsWith("v1"), "草稿 key 不是全局裸键");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
