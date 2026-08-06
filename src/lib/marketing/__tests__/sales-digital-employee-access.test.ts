import assert from "node:assert/strict";
import test from "node:test";
import { canUseMarketingDigitalEmployee } from "../access";

test("销售账号不能使用营销数字员工", () => {
  assert.equal(canUseMarketingDigitalEmployee("sales"), false);
});

test("运营和管理账号仍可使用营销数字员工", () => {
  assert.equal(canUseMarketingDigitalEmployee("operations"), true);
  assert.equal(canUseMarketingDigitalEmployee("admin"), true);
  assert.equal(canUseMarketingDigitalEmployee("super_admin"), true);
});

test("未登录或角色未知时默认不展示营销数字员工", () => {
  assert.equal(canUseMarketingDigitalEmployee(null), false);
  assert.equal(canUseMarketingDigitalEmployee(undefined), false);
  assert.equal(canUseMarketingDigitalEmployee(""), false);
});
