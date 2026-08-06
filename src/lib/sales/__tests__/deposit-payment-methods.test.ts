import assert from "node:assert/strict";
import test from "node:test";

import {
  DEPOSIT_PAYMENT_METHOD_OPTIONS,
  getDepositPaymentMethodLabel,
  isAcceptedDepositPaymentMethod,
} from "../deposit-payment-methods";

test("定金登记提供四种当前支付方式", () => {
  assert.deepEqual(
    DEPOSIT_PAYMENT_METHOD_OPTIONS.map((option) => option.value),
    ["cash", "visa", "check", "finance"],
  );
});

test("接口兼容旧的 Email Transfer，但拒绝未知方式", () => {
  for (const value of ["cash", "visa", "check", "finance", "etransfer"]) {
    assert.equal(isAcceptedDepositPaymentMethod(value), true);
  }
  assert.equal(isAcceptedDepositPaymentMethod("mastercard"), false);
  assert.equal(getDepositPaymentMethodLabel("finance"), "Finance（融资）");
  assert.equal(getDepositPaymentMethodLabel("etransfer"), "Email Transfer");
});
