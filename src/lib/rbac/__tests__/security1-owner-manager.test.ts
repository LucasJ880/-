/**
 * Security-1：org_owner / manager 门禁
 * 运行：npx tsx src/lib/rbac/__tests__/security1-owner-manager.test.ts
 */

import {
  canManageUsers,
  canDeleteUsers,
  hasOrgRole,
  isOrgSystemAdmin,
} from "../roles";
import { wouldRemoveLastOrgOwner } from "@/lib/organizations/owner-guard";

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

console.log("security-1 owner / manager");

ok(hasOrgRole("org_owner", "org_admin"), "org_owner >= org_admin");
ok(hasOrgRole("org_owner", "org_owner"), "org_owner >= org_owner");
ok(!hasOrgRole("org_admin", "org_owner"), "org_admin < org_owner");
ok(isOrgSystemAdmin("org_owner") && isOrgSystemAdmin("org_admin"), "系统管理角色");
ok(!isOrgSystemAdmin("org_member"), "普通成员非系统管理");

ok(!canManageUsers("manager"), "manager 不能平台用户管理");
ok(!canDeleteUsers("manager"), "manager 不能全局删号");
ok(canManageUsers("admin"), "admin 可平台用户管理");
ok(canManageUsers("super_admin"), "super_admin 可平台用户管理");
ok(!canManageUsers("sales"), "sales 不能平台用户管理");

ok(
  wouldRemoveLastOrgOwner({
    currentRole: "org_owner",
    currentStatus: "active",
    nextRole: "org_admin",
    nextStatus: "active",
    activeOwnerCount: 1,
  }),
  "唯一 owner 降级被拦",
);

ok(
  !wouldRemoveLastOrgOwner({
    currentRole: "org_owner",
    currentStatus: "active",
    nextRole: "org_admin",
    nextStatus: "active",
    activeOwnerCount: 2,
  }),
  "非唯一 owner 可降级",
);

ok(
  wouldRemoveLastOrgOwner({
    currentRole: "org_owner",
    currentStatus: "active",
    nextRole: "org_owner",
    nextStatus: "inactive",
    activeOwnerCount: 1,
  }),
  "唯一 owner 移除被拦",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
