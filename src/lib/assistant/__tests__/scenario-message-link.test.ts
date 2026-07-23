/**
 * Run ↔ Assistant 消息精确关联（无 DB）
 * 运行：npx tsx src/lib/assistant/__tests__/scenario-message-link.test.ts
 */

import assert from "node:assert/strict";
import { attachRunsToAssistantMessages } from "@/lib/assistant/attach-runs";
import {
  buildRunStatusEvent,
  toAssistantRunStatusDto,
  type AssistantRunStatusDto,
} from "@/lib/assistant/run-status";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function makeRun(
  partial: Partial<AssistantRunStatusDto> & {
    runId: string;
    assistantMessageId: string | null;
  },
): AssistantRunStatusDto {
  return toAssistantRunStatusDto({
    run: {
      id: partial.runId,
      orgId: "sunny",
      status: "completed",
      intent: "daily_business_brief",
      errorCode: null,
      errorMessage: null,
      userMessageId: partial.userMessageId ?? null,
      metadata: {
        threadId: "t1",
        initiatedByUserId: "u1",
        assistantMessageId: partial.assistantMessageId,
      },
      startedAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    },
    threadId: "t1",
    initiatedByUserId: "u1",
    pendingActionIds: partial.pendingActionIds ?? [],
  });
}

console.log("scenario-message-link");

ok(
  "两个 Run 对应两条不同 Assistant 消息，刷新不串卡",
  (() => {
    const runA = makeRun({
      runId: "run-a",
      assistantMessageId: "msg-a",
      userMessageId: "user-a",
      pendingActionIds: ["pa-a"],
    });
    const runB = makeRun({
      runId: "run-b",
      assistantMessageId: "msg-b",
      userMessageId: "user-b",
      pendingActionIds: ["pa-b1", "pa-b2"],
    });
    // 列表按 startedAt DESC：B 在前（最新）
    const messages = [
      { id: "user-a", role: "user" },
      { id: "msg-a", role: "assistant" },
      { id: "user-b", role: "user" },
      { id: "msg-b", role: "assistant" },
    ];
    const attached = attachRunsToAssistantMessages(messages, [runB, runA]);
    const a = attached.find((m) => m.id === "msg-a");
    const b = attached.find((m) => m.id === "msg-b");
    return (
      a?.assistantRun?.runId === "run-a" &&
      b?.assistantRun?.runId === "run-b" &&
      a?.assistantRun?.pendingActionIds[0] === "pa-a" &&
      b?.assistantRun?.pendingActionIds.length === 2
    );
  })(),
);

ok(
  "禁止 runs[0]→最后一条：最新 Run 不得挂到无关消息",
  (() => {
    const runOld = makeRun({
      runId: "run-old",
      assistantMessageId: "msg-old",
    });
    const messages = [
      { id: "msg-old", role: "assistant" },
      { id: "msg-new", role: "assistant" }, // 无对应 Run
    ];
    // 若错误地挂 runs[0]，msg-new 会拿到 run-old
    const attached = attachRunsToAssistantMessages(messages, [runOld]);
    const neu = attached.find((m) => m.id === "msg-new");
    const old = attached.find((m) => m.id === "msg-old");
    return !neu?.assistantRun && old?.assistantRun?.runId === "run-old";
  })(),
);

ok(
  "assistantMessageId 缺失时不挂载卡片",
  (() => {
    const run = makeRun({
      runId: "run-x",
      assistantMessageId: null,
    });
    const attached = attachRunsToAssistantMessages(
      [{ id: "msg-1", role: "assistant" }],
      [run],
    );
    return !attached[0].assistantRun;
  })(),
);

ok(
  "SSE 生命周期：received→planning→running→completed 状态一致",
  (() => {
    const base = makeRun({
      runId: "run-sse",
      assistantMessageId: "am-1",
    });
    const seq: Array<"received" | "planning" | "running" | "completed"> = [
      "received",
      "planning",
      "running",
      "completed",
    ];
    return seq.every((s) => {
      const ev = buildRunStatusEvent(base, s);
      return (
        ev.type === "run_status" &&
        ev.transition === s &&
        ev.run.status === s &&
        !("status" in ev && (ev as { status?: string }).status !== undefined)
      );
    });
  })(),
);

ok(
  "waiting_for_confirmation 与 approval 路径状态一致",
  (() => {
    const base = makeRun({
      runId: "run-wait",
      assistantMessageId: "am-2",
      pendingActionIds: ["pa-1"],
    });
    const ev = buildRunStatusEvent(base, "waiting_for_confirmation");
    return (
      ev.run.status === "waiting_for_confirmation" &&
      ev.transition === "waiting_for_confirmation" &&
      ev.run.pendingActionIds.includes("pa-1")
    );
  })(),
);

ok(
  "failed 路径 transition 与 run.status 一致",
  (() => {
    const base = makeRun({
      runId: "run-fail",
      assistantMessageId: "am-3",
    });
    const ev = buildRunStatusEvent(base, "failed");
    return ev.run.status === "failed" && ev.transition === "failed";
  })(),
);

ok(
  "场景错误码可恢复：DTO 优先 scenarioErrorCode 而非 tool_failed",
  (() => {
    const dto = toAssistantRunStatusDto({
      run: {
        id: "run-err",
        orgId: "sunny",
        status: "failed",
        intent: "gmail_email_draft",
        errorCode: "tool_failed",
        errorMessage: "DRAFT_CREATION_FAILED",
        userMessageId: "um-1",
        metadata: {
          threadId: "t1",
          initiatedByUserId: "u1",
          assistantMessageId: "am-1",
          scenarioErrorCode: "DRAFT_CREATION_FAILED",
        },
        startedAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      },
      threadId: "t1",
      initiatedByUserId: "u1",
    });
    return dto.errorCode === "DRAFT_CREATION_FAILED";
  })(),
);

ok(
  "GRADER_FAILED 场景码可恢复",
  (() => {
    const dto = toAssistantRunStatusDto({
      run: {
        id: "run-g",
        orgId: "sunny",
        status: "failed",
        intent: "daily_business_brief",
        errorCode: "tool_failed",
        errorMessage: "GRADER_FAILED",
        metadata: {
          threadId: "t1",
          initiatedByUserId: "u1",
          assistantMessageId: "am-g",
          scenarioErrorCode: "GRADER_FAILED",
        },
        startedAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      },
      threadId: "t1",
      initiatedByUserId: "u1",
    });
    return dto.errorCode === "GRADER_FAILED";
  })(),
);

console.log(`结果: ${passed} passed`);
