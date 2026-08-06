import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessMarketingWorkspace,
  isMarketingApiPath,
  isMarketingPagePath,
  isMarketingWorkspacePath,
} from "../route-access";

test("销售不能通过品牌增长深链或营销 API 绕过导航", () => {
  assert.equal(canAccessMarketingWorkspace("sales"), false);
  assert.equal(isMarketingPagePath("/operations/growth"), true);
  assert.equal(isMarketingPagePath("/operations/growth/metrics"), true);
  assert.equal(isMarketingPagePath("/marketing/employee"), true);
  assert.equal(isMarketingApiPath("/api/marketing/dashboard"), true);
  assert.equal(isMarketingWorkspacePath("/api/marketing/economics"), true);
});

test("运营和管理角色保留营销工作区权限", () => {
  for (const role of ["operations", "boss", "manager", "admin", "super_admin", "user"]) {
    assert.equal(canAccessMarketingWorkspace(role), true, role);
  }
});

test("营销门禁不误伤销售业务页面与 API", () => {
  assert.equal(isMarketingWorkspacePath("/sales"), false);
  assert.equal(isMarketingWorkspacePath("/sales/quote-sheet"), false);
  assert.equal(isMarketingWorkspacePath("/api/sales/quotes"), false);
  assert.equal(isMarketingWorkspacePath("/operations/center"), false);
});
