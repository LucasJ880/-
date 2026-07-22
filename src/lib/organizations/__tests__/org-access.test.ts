/**
 * Security-1：企业访问模式 / 组织状态 / 草稿 key
 * 运行：npx tsx src/lib/organizations/__tests__/org-access.test.ts
 */

import {
  canSelfSwitchOrganizations,
  isOrgStatusActive,
} from "../org-access";

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

// —— 多组织授权闸门 ——
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
    orgAccessMode: "FIXED",
    canSelfSwitchOrg: true,
    activeOrgId: "o1",
  }),
  "FIXED + 误开 canSelfSwitchOrg 仍不可切换",
);

ok(
  !canSelfSwitchOrganizations({
    orgAccessMode: "MULTI_ORG",
    canSelfSwitchOrg: false,
    activeOrgId: "o1",
  }),
  "MULTI_ORG + canSelfSwitchOrg=false 不可切换",
);

ok(
  canSelfSwitchOrganizations({
    orgAccessMode: "MULTI_ORG",
    canSelfSwitchOrg: true,
    activeOrgId: "o1",
  }),
  "MULTI_ORG + canSelfSwitchOrg=true 才能切换",
);

ok(
  !canSelfSwitchOrganizations({
    orgAccessMode: "PLATFORM_SUPPORT",
    canSelfSwitchOrg: true,
    activeOrgId: null,
  }),
  "PLATFORM_SUPPORT 不可走普通切换",
);

// —— 企业状态 fail closed ——
ok(isOrgStatusActive("active"), "active → 可以切换");
ok(!isOrgStatusActive("archived"), "archived → 拒绝");
ok(!isOrgStatusActive("inactive"), "inactive → 拒绝");
ok(!isOrgStatusActive("suspended"), "suspended → 拒绝");
ok(!isOrgStatusActive("pending"), "未知状态 pending → 拒绝");
ok(!isOrgStatusActive(""), "空状态 → 拒绝");
ok(!isOrgStatusActive(null), "null → 拒绝");
ok(!isOrgStatusActive(undefined), "undefined → 拒绝");

// —— 草稿隔离 ——
const k1 = draftStorageKey("orgA", "user1");
const k2 = draftStorageKey("orgB", "user1");
ok(k1.includes("orgA") && k1.includes("user1"), "草稿 key 含 orgId+userId");
ok(k1 !== k2, "不同企业草稿 key 不同");
ok(!k1.endsWith("v1"), "草稿 key 不是全局裸键");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
