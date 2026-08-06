import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePromotionApproval } from "../promotion-approval";

const base = {
  specialPromotion: 200,
  finalDiscountPct: 0.2,
  promotionApprovalStatus: "required",
  promotionApprovalAmount: null,
  promotionApprovalRatio: null,
  promotionApprovalMaxPct: null,
};

test("上限内报价无需审批", () => {
  assert.deepEqual(evaluatePromotionApproval({ ...base, finalDiscountPct: 0.1 }, 0.15), {
    required: false,
    approved: true,
    reason: null,
  });
});

test("超限报价只有金额与比例快照完全匹配才可发送", () => {
  const approved = { ...base, promotionApprovalStatus: "approved", promotionApprovalAmount: 200, promotionApprovalRatio: 0.2, promotionApprovalMaxPct: 0.15 };
  assert.equal(evaluatePromotionApproval(approved, 0.15).approved, true);
  assert.equal(evaluatePromotionApproval({ ...approved, specialPromotion: 210 }, 0.15).approved, false);
  assert.match(evaluatePromotionApproval({ ...base, promotionApprovalStatus: "pending" }, 0.15).reason ?? "", /等待管理员/);
});
