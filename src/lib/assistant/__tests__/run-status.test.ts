/**
 * 运行：npx tsx src/lib/assistant/__tests__/run-status.test.ts
 */

import assert from "node:assert/strict";
import {
  mapAgentRunToAssistantStatus,
  toAssistantRunStatusDto,
} from "@/lib/assistant/run-status";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("run-status");

ok(
  "queued → received",
  mapAgentRunToAssistantStatus({ runStatus: "queued" }) === "received",
);

ok(
  "acknowledged → received",
  mapAgentRunToAssistantStatus({ runStatus: "acknowledged" }) === "received",
);

ok(
  "planning → planning",
  mapAgentRunToAssistantStatus({ runStatus: "planning" }) === "planning",
);

ok(
  "running → running",
  mapAgentRunToAssistantStatus({ runStatus: "running" }) === "running",
);

ok(
  "awaiting_approval → waiting_for_confirmation",
  mapAgentRunToAssistantStatus({ runStatus: "awaiting_approval" }) ===
    "waiting_for_confirmation",
);

ok(
  "waiting_for_approval alias → waiting_for_confirmation",
  mapAgentRunToAssistantStatus({ runStatus: "waiting_for_approval" }) ===
    "waiting_for_confirmation",
);

ok(
  "PA pending overrides → waiting_for_confirmation",
  mapAgentRunToAssistantStatus({
    runStatus: "running",
    pendingActionStatus: "pending",
  }) === "waiting_for_confirmation",
);

ok(
  "PA rejected → cancelled",
  mapAgentRunToAssistantStatus({
    runStatus: "running",
    pendingActionStatus: "rejected",
  }) === "cancelled",
);

ok(
  "completed → completed",
  mapAgentRunToAssistantStatus({ runStatus: "completed" }) === "completed",
);

ok(
  "failed → failed",
  mapAgentRunToAssistantStatus({ runStatus: "failed" }) === "failed",
);

ok(
  "DTO binds threadId not sessionId",
  (() => {
    const dto = toAssistantRunStatusDto({
      run: {
        id: "run-1",
        orgId: "sunny",
        status: "running",
        intent: "general_answer",
        errorCode: null,
        errorMessage: null,
        metadata: { threadId: "thread-1" },
        startedAt: new Date("2026-07-23T00:00:00Z"),
        updatedAt: new Date("2026-07-23T00:01:00Z"),
        completedAt: null,
      },
      threadId: "thread-1",
      userId: "user-1",
      events: [
        {
          eventType: "tool.started",
          title: "查询客户",
          visibleToUser: true,
          createdAt: new Date("2026-07-23T00:00:30Z"),
        },
      ],
    });
    return (
      dto.runId === "run-1" &&
      dto.conversationId === "thread-1" &&
      dto.organizationId === "sunny" &&
      dto.initiatedByPrincipalId === "user-1" &&
      dto.status === "running" &&
      dto.currentStep?.type === "tool_execution"
    );
  })(),
);

console.log(`结果: ${passed} passed`);
