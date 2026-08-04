/**
 * 运行：npx tsx src/lib/blinds/__tests__/sunny-motor.test.ts
 */

import assert from "node:assert/strict";
import { calculateQuoteTotal } from "../pricing-engine";
import { validateDiscountsInput } from "../discount-settings";
import type { QuoteItemInput } from "../pricing-types";

const zebra: QuoteItemInput = {
  product: "Zebra",
  fabric: "Light Filtering",
  widthIn: 24,
  heightIn: 36,
};

const base = calculateQuoteTotal({
  items: [zebra],
  installMode: "pickup",
  deliveryFee: 0,
  taxRate: 0,
  sunnyMotorPrice: 150,
});
const motorized = calculateQuoteTotal({
  items: [{ ...zebra, motorized: true }],
  installMode: "pickup",
  deliveryFee: 0,
  taxRate: 0,
  sunnyMotorPrice: 150,
});
assert.equal(motorized.merchSubtotal - base.merchSubtotal, 150);
assert.equal(
  motorized.itemResults[0].msrp - base.itemResults[0].msrp,
  150,
  "Motor 加价不参与产品折扣，MSRP 与成交价同时增加",
);

const customMotor = calculateQuoteTotal({
  items: [{ ...zebra, motorized: true }],
  installMode: "pickup",
  deliveryFee: 0,
  taxRate: 0,
  sunnyMotorPrice: 225.5,
});
assert.equal(customMotor.merchSubtotal - base.merchSubtotal, 225.5);

const manualMotor = calculateQuoteTotal({
  items: [
    {
      product: "Roman",
      fabric: "Custom",
      widthIn: 36,
      heightIn: 60,
      manualPrice: 500,
      motorized: true,
    },
  ],
  installMode: "pickup",
  deliveryFee: 0,
  taxRate: 0,
  sunnyMotorPrice: 150,
});
assert.equal(manualMotor.merchSubtotal, 650);

const validSetting = validateDiscountsInput({ sunnyMotorPrice: 187.555 });
assert.equal(validSetting.ok, true);
if (validSetting.ok) {
  assert.equal(validSetting.value.sunnyMotorPrice, 187.56);
}
assert.equal(
  validateDiscountsInput({ sunnyMotorPrice: 10001 }).ok,
  false,
);

console.log("Sunny Motor pricing tests passed");
