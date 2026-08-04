import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSalesActionActiveKey,
  canTransitionSalesAction,
  defaultSalesActionDueAt,
  summarizeSalesActions,
  validateSalesActionResolution,
} from "../action-loop";

test("终态行动不可重新打开", () => {
  assert.equal(canTransitionSalesAction("completed", "open"), false);
  assert.equal(canTransitionSalesAction("dismissed", "in_progress"), false);
  assert.equal(canTransitionSalesAction("open", "completed"), true);
});

test("完成与忽略都必须记录结果", () => {
  assert.match(validateSalesActionResolution({ status: "completed" }) ?? "", /处理结果/);
  assert.match(validateSalesActionResolution({ status: "dismissed" }) ?? "", /原因/);
  assert.equal(validateSalesActionResolution({ status: "completed", resolutionNote: "客户确认周五量房" }), null);
});

test("活动键在同组织客户商机和信号内稳定", () => {
  assert.equal(
    buildSalesActionActiveKey({ orgId: "org-1", customerId: "c-1", opportunityId: "o-1", signalKey: "Viewed Not Signed" }),
    "org-1:c-1:o-1:viewed_not_signed",
  );
});

test("紧急行动默认八小时内到期并可汇总闭环指标", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");
  assert.equal(defaultSalesActionDueAt("urgent", now).toISOString(), "2026-08-04T20:00:00.000Z");
  assert.deepEqual(summarizeSalesActions([
    { status: "open", dueAt: "2026-08-04T10:00:00.000Z" },
    { status: "in_progress", dueAt: "2026-08-05T10:00:00.000Z" },
    { status: "completed", dueAt: null },
    { status: "dismissed", dueAt: null },
  ], now), { open: 2, overdue: 1, completed: 1, dismissed: 1, completionRate: 50 });
});
