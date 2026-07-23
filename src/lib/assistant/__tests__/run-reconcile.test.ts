/**
 * Run 收敛决策表（无 DB）
 * 运行：npx tsx src/lib/assistant/__tests__/run-reconcile.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decideRunReconcile,
  deriveRetryFlags,
  effectiveActionStatus,
  summarizeActions,
} from "@/lib/assistant/reconcile-decision";
import {
  actionEventKey,
  planReconcileEventKeys,
  readWrittenEventKeys,
} from "@/lib/assistant/reconcile-run";

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

// ── Commit 6A：事件幂等计划（可验证事务边界）──────────────────────

ok(
  "重复确认 executed → approval.executed 仅规划一次",
  (() => {
    const decision = decideRunReconcile([
      { status: "executed", expiresAt: future },
    ]);
    const first = planReconcileEventKeys({
      writtenKeys: [],
      decision,
      triggerAction: { id: "pa_123", outcome: "executed" },
    });
    const second = planReconcileEventKeys({
      writtenKeys: first.nextKeys,
      decision,
      triggerAction: { id: "pa_123", outcome: "executed" },
    });
    return (
      first.writeAction === true &&
      first.actionKey === "approval-action:pa_123:executed" &&
      second.writeAction === false &&
      second.writeTerminal === false
    );
  })(),
);

ok(
  "重复拒绝 → approval.rejected 仅规划一次",
  (() => {
    const decision = decideRunReconcile([
      { status: "rejected", expiresAt: future },
    ]);
    const first = planReconcileEventKeys({
      writtenKeys: [],
      decision,
      triggerAction: { id: "pa_456", outcome: "rejected" },
    });
    const second = planReconcileEventKeys({
      writtenKeys: first.nextKeys,
      decision,
      triggerAction: { id: "pa_456", outcome: "rejected" },
    });
    return (
      first.writeAction &&
      first.actionKey === actionEventKey("pa_456", "rejected") &&
      !second.writeAction &&
      first.writeTerminal &&
      !second.writeTerminal
    );
  })(),
);

ok(
  "并发 reconcile completed → run.completed 终态键仅一次",
  (() => {
    const decision = decideRunReconcile([
      { status: "executed", expiresAt: future },
    ]);
    // 模拟两事务先后：后到者读到已写入的 keys
    const a = planReconcileEventKeys({
      writtenKeys: [],
      decision,
      triggerAction: null,
    });
    const b = planReconcileEventKeys({
      writtenKeys: a.nextKeys,
      decision,
      triggerAction: null,
    });
    return (
      a.writeTerminal === true &&
      b.writeTerminal === false &&
      a.nextKeys.includes(decision.eventKey)
    );
  })(),
);

ok(
  "已写入终态后再触发 Action → 不重写 terminal",
  (() => {
    const decision = decideRunReconcile([
      { status: "executed", expiresAt: future },
    ]);
    const afterTerminal = planReconcileEventKeys({
      writtenKeys: [decision.eventKey],
      decision,
      triggerAction: { id: "pa_x", outcome: "executed" },
    });
    return (
      afterTerminal.writeTerminal === false &&
      afterTerminal.writeAction === true
    );
  })(),
);

ok(
  "readWrittenEventKeys 解析 metadata",
  (() => {
    const keys = readWrittenEventKeys({
      writtenEventKeys: ["approval-action:pa_1:executed", "completed:all:1"],
    });
    return keys.length === 2 && keys[0].startsWith("approval-action:");
  })(),
);

ok(
  "reconcile-run 锁内写事件（源码契约）",
  (() => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/assistant/reconcile-run.ts"),
      "utf8",
    );
    const hasForUpdate = src.includes("FOR UPDATE");
    const createsInTx = src.includes("createRunEventInTx");
    // 终态不得在事务外 appendAgentRunEvent
    const afterTxAppend =
      /\$transaction[\s\S]*appendAgentRunEvent/.test(src) === false ||
      !src.includes("appendAgentRunEvent");
    const failClosedOrg = src.includes("ORG_LINK_MISMATCH");
    const noUnknown =
      !src.includes('initiatedByPrincipalId: "unknown"') &&
      !src.includes('initiatedByUserId: "unknown"');
    return (
      hasForUpdate &&
      createsInTx &&
      afterTxAppend &&
      failClosedOrg &&
      noUnknown
    );
  })(),
);

console.log(`结果: ${passed} passed`);
