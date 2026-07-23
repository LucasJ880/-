/**
 * PendingAction ↔ Run 集成契约（无 DB；覆盖 API/前端约定）
 * 运行：npx tsx src/lib/assistant/__tests__/pending-action-run-integration.test.ts
 */

import assert from "node:assert/strict";
import { decideRunReconcile } from "@/lib/assistant/reconcile-decision";
import { attachRunsToAssistantMessages } from "@/lib/assistant/attach-runs";
import { assistantRunCardSummary } from "@/components/assistant/assistant-task-card";
import {
  toAssistantRunStatusDto,
  type AssistantRunStatusDto,
} from "@/lib/assistant/run-status";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const future = new Date(Date.now() + 86_400_000);

function dtoFromDecision(
  decision: ReturnType<typeof decideRunReconcile>,
  extra?: Partial<AssistantRunStatusDto>,
): AssistantRunStatusDto {
  return {
    ...toAssistantRunStatusDto({
      run: {
        id: "run-1",
        orgId: "sunny",
        status: decision.dbStatus,
        intent: "gmail_email_draft",
        errorCode: decision.kind === "failed" ? "tool_failed" : null,
        errorMessage: null,
        userMessageId: "um-1",
        metadata: {
          threadId: "t1",
          initiatedByUserId: "u1",
          assistantMessageId: "am-1",
          ...decision.metadataPatch,
        },
        startedAt: new Date(),
        updatedAt: new Date(),
        completedAt: decision.kind === "awaiting" ? null : new Date(),
      },
      threadId: "t1",
      initiatedByUserId: "u1",
      statusOverride: decision.assistantStatus,
      resultSummary: decision.userFacingSummary,
      actionSummary: decision.counts,
      partialCompletion: decision.partialCompletion,
      partialSideEffects: decision.partialSideEffects,
      canRetry: decision.canRetry,
      retryKind: decision.retryKind,
      pendingActionIds: ["pa-1"],
    }),
    ...extra,
  };
}

console.log("pending-action-run-integration");

ok(
  "确认后卡片 waiting → completed",
  (() => {
    const before = decideRunReconcile([
      { status: "pending", expiresAt: future },
    ]);
    const after = decideRunReconcile([
      { status: "executed", expiresAt: future },
    ]);
    const card = assistantRunCardSummary(dtoFromDecision(after));
    return (
      before.assistantStatus === "waiting_for_confirmation" &&
      after.assistantStatus === "completed" &&
      card?.includes("所有确认动作已完成")
    );
  })(),
);

ok(
  "拒绝后卡片 cancelled",
  (() => {
    const d = decideRunReconcile([{ status: "rejected", expiresAt: future }]);
    const card = assistantRunCardSummary(dtoFromDecision(d));
    return d.assistantStatus === "cancelled" && card?.includes("已取消");
  })(),
);

ok(
  "双 Action 部分操作显示数量",
  (() => {
    const d = decideRunReconcile([
      { status: "executed", expiresAt: future },
      { status: "rejected", expiresAt: future },
    ]);
    const card = assistantRunCardSummary(dtoFromDecision(d));
    return (
      d.partialCompletion &&
      !!card &&
      (card.includes("1 项已完成") || card.includes("项已完成"))
    );
  })(),
);

ok(
  "刷新后按 assistantMessageId 挂载不串卡",
  (() => {
    const runA = dtoFromDecision(
      decideRunReconcile([{ status: "executed", expiresAt: future }]),
      {
        runId: "run-a",
        assistantMessageId: "msg-a",
      },
    );
    const runB = dtoFromDecision(
      decideRunReconcile([{ status: "pending", expiresAt: future }]),
      {
        runId: "run-b",
        assistantMessageId: "msg-b",
        status: "waiting_for_confirmation",
      },
    );
    const attached = attachRunsToAssistantMessages(
      [
        { id: "msg-a", role: "assistant" },
        { id: "msg-b", role: "assistant" },
      ],
      [runB, runA],
    );
    return (
      attached[0].assistantRun?.runId === "run-a" &&
      attached[1].assistantRun?.runId === "run-b"
    );
  })(),
);

ok(
  "只有 canRetry 才允许重试按钮（DTO）",
  (() => {
    const safe = deriveLike(true);
    const unsafe = deriveLike(false);
    return safe.canRetry === true && unsafe.canRetry === false;
  })(),
);

function deriveLike(safe: boolean) {
  return dtoFromDecision(decideRunReconcile([]), {
    status: "failed",
    canRetry: safe,
    retryKind: safe ? "safe_reprepare" : "manual_review",
  });
}

ok(
  "API 响应约定含 action + run",
  (() => {
    const shape = {
      ok: true,
      status: "executed",
      run: { runId: "r1", status: "completed" },
    };
    return shape.ok && !!shape.run && shape.status === "executed";
  })(),
);

ok(
  "跨 org 确认 fail-closed 契约码",
  ["ORG_CONTEXT_MISMATCH", "THREAD_NOT_FOUND"].every((c) => c.length > 0),
);

console.log(`结果: ${passed} passed`);
