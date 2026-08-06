/**
 * 运行：npx tsx src/lib/blinds/__tests__/discount-permissions.test.ts
 */

import assert from "node:assert/strict";
import { canManageQuoteDiscountSettings } from "../discount-permissions";

assert.equal(
  canManageQuoteDiscountSettings("org_owner"),
  true,
  "企业负责人可以维护企业折扣",
);

for (const role of [
  "org_admin",
  "org_member",
  "org_viewer",
  "admin",
  "super_admin",
]) {
  assert.equal(
    canManageQuoteDiscountSettings(role),
    false,
    `${role} 不能仅凭该身份维护企业折扣`,
  );
}

console.log("Quote discount owner permission tests passed");
