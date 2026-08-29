/**
 * 站内通知投递门禁测试（类型开关 grandfather / 仅高优 / 静默时段）
 * 运行：npx tsx src/lib/notifications/__tests__/delivery-gate.test.ts
 */

import assert from "node:assert/strict";
import {
  evaluateDeliveryGate,
  isTypeEnabledForUser,
} from "../delivery-gate";

const BEFORE_INTRO = new Date("2026-08-20T00:00:00Z");
const AFTER_INTRO = new Date("2026-09-01T00:00:00Z");

// ── isTypeEnabledForUser ──
assert.equal(
  isTypeEnabledForUser({
    type: "quote_signed",
    enabledTypes: new Set(["followup"]),
    hasCustomList: false,
    listUpdatedAt: null,
  }),
  true,
  "从未自定义 → 默认全开",
);
assert.equal(
  isTypeEnabledForUser({
    type: "quote_signed",
    enabledTypes: new Set(["quote_signed"]),
    hasCustomList: true,
    listUpdatedAt: AFTER_INTRO,
  }),
  true,
  "清单里有 → 开",
);
assert.equal(
  isTypeEnabledForUser({
    type: "quote_signed",
    enabledTypes: new Set(["followup"]),
    hasCustomList: true,
    listUpdatedAt: BEFORE_INTRO,
  }),
  true,
  "清单早于类型引入 → grandfather 视为开启",
);
assert.equal(
  isTypeEnabledForUser({
    type: "quote_signed",
    enabledTypes: new Set(["followup"]),
    hasCustomList: true,
    listUpdatedAt: AFTER_INTRO,
  }),
  false,
  "类型引入后保存过且未勾选 → 显式关闭",
);
assert.equal(
  isTypeEnabledForUser({
    type: "followup",
    enabledTypes: new Set(["quote_signed"]),
    hasCustomList: true,
    listUpdatedAt: BEFORE_INTRO,
  }),
  false,
  "老类型无 grandfather：不在清单即关闭",
);

// ── evaluateDeliveryGate ──
const basePref = {
  enableInAppNotifications: true,
  onlyHighPriority: false,
  quietHoursEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  enabledTypes: new Set(["followup", "quote_signed"]),
};

assert.equal(
  evaluateDeliveryGate({
    type: "followup",
    priority: "medium",
    pref: basePref,
    hasCustomList: true,
    listUpdatedAt: AFTER_INTRO,
  }),
  true,
);
assert.equal(
  evaluateDeliveryGate({
    type: "followup",
    priority: "medium",
    pref: { ...basePref, enableInAppNotifications: false },
    hasCustomList: true,
    listUpdatedAt: AFTER_INTRO,
  }),
  false,
  "总开关关闭 → 不投",
);
assert.equal(
  evaluateDeliveryGate({
    type: "followup",
    priority: "medium",
    pref: { ...basePref, onlyHighPriority: true },
    hasCustomList: true,
    listUpdatedAt: AFTER_INTRO,
  }),
  false,
  "仅高优 + medium → 不投",
);
assert.equal(
  evaluateDeliveryGate({
    type: "followup",
    priority: "urgent",
    pref: { ...basePref, onlyHighPriority: true },
    hasCustomList: true,
    listUpdatedAt: AFTER_INTRO,
  }),
  true,
  "仅高优 + urgent → 投",
);
// 静默时段：medium 被压制，urgent 打破（用跨午夜全天段保证任意运行时刻都在静默内）
const quietPref = {
  ...basePref,
  quietHoursEnabled: true,
  quietHoursStart: "00:00",
  quietHoursEnd: "23:59",
};
assert.equal(
  evaluateDeliveryGate({
    type: "followup",
    priority: "medium",
    pref: quietPref,
    hasCustomList: true,
    listUpdatedAt: AFTER_INTRO,
  }),
  false,
  "静默时段 medium 不投",
);
assert.equal(
  evaluateDeliveryGate({
    type: "followup",
    priority: "urgent",
    pref: quietPref,
    hasCustomList: true,
    listUpdatedAt: AFTER_INTRO,
  }),
  true,
  "静默时段 urgent 打破",
);

console.log("Notification delivery gate tests passed");
