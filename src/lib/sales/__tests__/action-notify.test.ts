/**
 * 销售行动站内通知 — 纯函数测试（sourceKey 幂等键 / 摘要文案）
 * 运行：npx tsx src/lib/sales/__tests__/action-notify.test.ts
 */

import assert from "node:assert/strict";
import {
  buildDailyDigestSourceKey,
  buildDailyDigestSummary,
  buildUrgentActionSourceKey,
} from "../action-notify";

// ── sourceKey：urgent 按行动去重；摘要按 org+user+Toronto 日期去重 ──
assert.equal(buildUrgentActionSourceKey("act_1"), "sales-action-urgent:act_1");
assert.equal(
  buildDailyDigestSourceKey("org_a", "user_b", "2026-08-29"),
  "sales-actions-daily:org_a:2026-08-29:user_b",
);
assert.notEqual(
  buildDailyDigestSourceKey("org_a", "user_b", "2026-08-29"),
  buildDailyDigestSourceKey("org_a", "user_b", "2026-08-30"),
  "跨天必须产生新键（每日一条）",
);
assert.notEqual(
  buildDailyDigestSourceKey("org_a", "user_b", "2026-08-29"),
  buildDailyDigestSourceKey("org_a", "user_c", "2026-08-29"),
  "不同销售互不挤占",
);

// ── 摘要文案 ──
const withBacklog = buildDailyDigestSummary({ newCount: 2, openTotal: 5 });
assert.ok(withBacklog.includes("2 件"), "包含新增数");
assert.ok(withBacklog.includes("5 件"), "包含总待处理数");
const freshOnly = buildDailyDigestSummary({ newCount: 3, openTotal: 3 });
assert.ok(freshOnly.includes("3 件"));
assert.ok(!freshOnly.includes("目前共有"), "无存量时不重复报总数");

console.log("Sales action notify tests passed");
