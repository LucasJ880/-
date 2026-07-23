/**
 * Run 收敛决策表（无 DB）
 * 运行：npx tsx src/lib/assistant/__tests__/run-reconcile.test.ts
 */

import assert from "node:assert/strict";
import {
  decideRunReconcile,
  deriveRetryFlags,
  effectiveActionStatus,
  summarizeActions,
} from "@/lib/assistant/reconcile-decision";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

console.log("run-reconcile");

ok(
  "pending 未过期仍为 pending",
  effectiveActionStatus({ status: "pending", expiresAt: future }) === "pending",
);

ok(
  "pending 且过期 → expired",
  effectiveActionStatus({ status: "pending", expiresAt: past }) === "expired",
);

ok(
  "单 Action pending → waiting",
  decideRunReconcile([{ status: "pending", expiresAt: future }]).kind ===
    "awaiting",
);

ok(
  "单 Action executed → completed",
  (() => {
    const d = decideRunReconcile([{ status: "executed", expiresAt: future }]);
    return (
      d.kind === "completed" &&
      d.resultSummary === "all_actions_executed" &&
      d.assistantStatus === "completed"
    );
  })(),
);

ok(
  "单 Action rejected → cancelled",
  decideRunReconcile([{ status: "rejected", expiresAt: future }]).kind ===
    "cancelled",
);

ok(
  "单 Action failed → failed",
  decideRunReconcile([{ status: "failed", expiresAt: future }]).kind ===
    "failed",
);

ok(
  "单 Action expired → failed",
  decideRunReconcile([{ status: "pending", expiresAt: past }]).kind ===
    "failed",
);

ok(
  "executed + pending → waiting",
  decideRunReconcile([
    { status: "executed", expiresAt: future },
    { status: "pending", expiresAt: future },
  ]).kind === "awaiting",
);

ok(
  "executed + executed → completed all",
  (() => {
    const d = decideRunReconcile([
      { status: "executed", expiresAt: future },
      { status: "executed", expiresAt: future },
    ]);
    return d.kind === "completed" && d.resultSummary === "all_actions_executed";
  })(),
);

ok(
  "executed + rejected → completed partial",
  (() => {
    const d = decideRunReconcile([
      { status: "executed", expiresAt: future },
      { status: "rejected", expiresAt: future },
    ]);
    return (
      d.kind === "completed" &&
      d.partialCompletion === true &&
      d.resultSummary === "partially_executed" &&
      d.userFacingSummary.includes("项已完成")
    );
  })(),
);

ok(
  "rejected + rejected → cancelled",
  decideRunReconcile([
    { status: "rejected", expiresAt: future },
    { status: "rejected", expiresAt: future },
  ]).kind === "cancelled",
);

ok(
  "executed + failed → failed + partialSideEffects",
  (() => {
    const d = decideRunReconcile([
      { status: "executed", expiresAt: future },
      { status: "failed", expiresAt: future },
    ]);
    return (
      d.kind === "failed" &&
      d.partialSideEffects === true &&
      d.userFacingSummary.includes("不会自动回滚")
    );
  })(),
);

ok(
  "failed + pending → waiting",
  decideRunReconcile([
    { status: "failed", expiresAt: future },
    { status: "pending", expiresAt: future },
  ]).kind === "awaiting",
);

ok(
  "重复 decide 同输入 → 相同 eventKey（幂等）",
  (() => {
    const a = decideRunReconcile([
      { status: "executed", expiresAt: future },
      { status: "rejected", expiresAt: future },
    ]);
    const b = decideRunReconcile([
      { status: "executed", expiresAt: future },
      { status: "rejected", expiresAt: future },
    ]);
    return a.eventKey === b.eventKey && a.dbStatus === b.dbStatus;
  })(),
);

ok(
  "无 PA + safeToRetry → canRetry",
  (() => {
    const f = deriveRetryFlags({
      runStatus: "failed",
      metadata: { safeToRetry: true, retryAttempt: 0 },
      actions: [],
    });
    return f.canRetry && f.retryKind === "safe_reprepare";
  })(),
);

ok(
  "有 executed PA → manual_review 不可自动重试",
  (() => {
    const f = deriveRetryFlags({
      runStatus: "failed",
      metadata: { safeToRetry: true },
      actions: [{ status: "executed", expiresAt: future }],
    });
    return !f.canRetry && f.retryKind === "manual_review";
  })(),
);

ok(
  "retryAttempt >= 2 → 不可再试",
  (() => {
    const f = deriveRetryFlags({
      runStatus: "failed",
      metadata: { safeToRetry: true, retryAttempt: 2 },
      actions: [],
    });
    return !f.canRetry;
  })(),
);

ok(
  "summarizeActions 计数正确",
  (() => {
    const c = summarizeActions([
      { status: "executed", expiresAt: future },
      { status: "pending", expiresAt: past },
      { status: "rejected", expiresAt: future },
    ]);
    return c.total === 3 && c.executed === 1 && c.expired === 1 && c.rejected === 1;
  })(),
);

ok(
  "无关联 Action → noop",
  decideRunReconcile([]).kind === "noop_no_actions",
);

console.log(`结果: ${passed} passed`);
