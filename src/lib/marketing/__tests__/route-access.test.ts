/**
 * 营销接口判定（旧模式 JWT 平台角色 sales 拦截 /api/marketing/**）
 * VIS-1a：营销工作区页面改由路由门判定（route-gate.test.ts 覆盖），这里只测接口层
 * 运行：npx tsx src/lib/marketing/__tests__/route-access.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { canAccessMarketingWorkspace, isMarketingApiPath } from "../route-access";

test("销售不能经营销接口读增长中心数据", () => {
  assert.equal(canAccessMarketingWorkspace("sales"), false);
  assert.equal(isMarketingApiPath("/api/marketing"), true);
  assert.equal(isMarketingApiPath("/api/marketing/dashboard"), true);
  assert.equal(isMarketingApiPath("/api/marketing/economics"), true);
});

test("运营和管理角色保留营销接口权限", () => {
  for (const role of ["operations", "boss", "manager", "admin", "super_admin", "user"]) {
    assert.equal(canAccessMarketingWorkspace(role), true, role);
  }
});

test("营销接口判定不误伤销售接口与页面路径", () => {
  assert.equal(isMarketingApiPath("/api/sales/quotes"), false);
  assert.equal(isMarketingApiPath("/api/marketingx"), false);
  assert.equal(isMarketingApiPath("/marketing/employee"), false);
  assert.equal(isMarketingApiPath("/operations/growth"), false);
});
