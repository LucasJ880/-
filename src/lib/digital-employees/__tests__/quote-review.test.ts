import assert from "node:assert/strict";
import { reviewQuoteWorkflow } from "../quote-review";

const base = {
  customerId: "customer-1",
  customerName: "Test Customer",
  customerEmail: "customer@example.com",
  customerAddress: "Toronto, ON",
  productsSubtotal: 1000,
  enteredLineCount: 2,
  motorizedLineCount: 0,
  sunnyMotorPrice: 150,
  taxRate: 0.13,
  specialPromotion: 0,
  promoRatio: 0,
  promoMaxPct: 0.15,
  promoBlocked: false,
  promotionApprovalRequested: false,
  paymentMethod: "direct" as const,
  depositAmount: 500,
  grandTotal: 1130,
  depositMinPct: 0.3,
  depositUnlocked: false,
  isAdmin: false,
  emailChannel: "connected" as const,
  hasSignature: false,
};

const ready = reviewQuoteWorkflow(base);
assert.equal(ready.blockedCount, 0);
assert.match(ready.nextAction, /检查通过|继续保存/);

const missingCustomer = reviewQuoteWorkflow({
  ...base,
  customerId: "",
  customerName: "",
});
assert.equal(missingCustomer.status, "blocked");
assert.equal(missingCustomer.items.find((item) => item.key === "customer")?.action, "customer");

const motor = reviewQuoteWorkflow({
  ...base,
  motorizedLineCount: 2,
  sunnyMotorPrice: 187.5,
});
assert.match(motor.items.find((item) => item.key === "motor")?.detail ?? "", /375/);

const promotion = reviewQuoteWorkflow({
  ...base,
  specialPromotion: 200,
  promoRatio: 0.2,
  promoBlocked: true,
});
assert.equal(promotion.status, "blocked");
assert.match(promotion.nextAction, /管理员/);

const approvalRequested = reviewQuoteWorkflow({
  ...base,
  specialPromotion: 200,
  promoRatio: 0.2,
  promoBlocked: true,
  promotionApprovalRequested: true,
});
assert.equal(approvalRequested.items.find((item) => item.key === "promotion")?.status, "attention");

const regionalTax = reviewQuoteWorkflow({ ...base, taxRate: 0.05 });
assert.equal(regionalTax.items.find((item) => item.key === "tax")?.status, "info");

const lowDeposit = reviewQuoteWorkflow({ ...base, depositAmount: 100 });
assert.equal(lowDeposit.items.find((item) => item.key === "deposit")?.status, "blocked");

console.log("Digital employee quote review tests passed");
