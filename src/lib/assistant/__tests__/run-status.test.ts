/**
 * 运行：npx tsx src/lib/assistant/__tests__/run-status.test.ts
 */

import assert from "node:assert/strict";
import {
  buildRunStatusEvent,
  mapAgentRunToAssistantStatus,
  runMatchesOwner,
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
  "awaiting_approval → waiting_for_confirmation",
  mapAgentRunToAssistantStatus({ runStatus: "awaiting_approval" }) ===
    "waiting_for_confirmation",
);

ok(
  "PA rejected → cancelled",
  mapAgentRunToAssistantStatus({
    runStatus: "running",
    pendingActionStatus: "rejected",
  }) === "cancelled",
);

ok(
  "DTO 使用已验证发起人，不冒充调用方",
  (() => {
    const dto = toAssistantRunStatusDto({
      run: {
        id: "run-1",
        orgId: "sunny",
        status: "completed",
        intent: "gmail_email_draft",
        errorCode: null,
        errorMessage: null,
        metadata: {
          threadId: "thread-1",
          initiatedByUserId: "owner-1",
        },
        startedAt: new Date("2026-07-23T00:00:00Z"),
        updatedAt: new Date("2026-07-23T00:01:00Z"),
        completedAt: new Date("2026-07-23T00:01:00Z"),
      },
      threadId: "thread-1",
      initiatedByUserId: "owner-1",
    });
    return dto.initiatedByPrincipalId === "owner-1";
  })(),
);

ok(
  "同 org、同 thread、同 user → 可见",
  runMatchesOwner({
    orgId: "sunny",
    activeOrgId: "sunny",
    metadataThreadId: "t1",
    requestThreadId: "t1",
    sessionUserId: "u1",
    metadataInitiatedByUserId: "u1",
    currentUserId: "u1",
  }),
);

ok(
  "同 org、同 thread、其他 user → 不可见",
  !runMatchesOwner({
    orgId: "sunny",
    activeOrgId: "sunny",
    metadataThreadId: "t1",
    requestThreadId: "t1",
    sessionUserId: "u2",
    metadataInitiatedByUserId: "u2",
    currentUserId: "u1",
  }),
);

ok(
  "其他 org、相同 metadata.threadId → 不可见",
  !runMatchesOwner({
    orgId: "mengxin",
    activeOrgId: "sunny",
    metadataThreadId: "t1",
    requestThreadId: "t1",
    sessionUserId: "u1",
    metadataInitiatedByUserId: "u1",
    currentUserId: "u1",
  }),
);

ok(
  "伪造 threadId 但用户不匹配 → 不可见",
  !runMatchesOwner({
    orgId: "sunny",
    activeOrgId: "sunny",
    metadataThreadId: "t1",
    requestThreadId: "t1",
    sessionUserId: "u1",
    metadataInitiatedByUserId: "attacker",
    currentUserId: "u1",
  }),
);

ok(
  "run_status 事件内外状态一致（received）",
  (() => {
    const base = toAssistantRunStatusDto({
      run: {
        id: "run-1",
        orgId: "sunny",
        status: "completed",
        intent: null,
        errorCode: null,
        errorMessage: null,
        metadata: { threadId: "t1", initiatedByUserId: "u1" },
        startedAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      },
      threadId: "t1",
      initiatedByUserId: "u1",
    });
    const ev = buildRunStatusEvent(base, "received");
    return (
      ev.type === "run_status" &&
      ev.run.status === "received" &&
      ev.transition === "received" &&
      !("status" in ev && (ev as { status?: string }).status !== undefined &&
        !("run" in ev))
    );
  })(),
);

ok(
  "run_status 完成事件 transition 与 run.status 一致",
  (() => {
    const base = toAssistantRunStatusDto({
      run: {
        id: "run-1",
        orgId: "sunny",
        status: "completed",
        intent: null,
        errorCode: null,
        errorMessage: null,
        metadata: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      },
      threadId: "t1",
      initiatedByUserId: "u1",
    });
    const ev = buildRunStatusEvent(base, "completed");
    return ev.run.status === "completed" && ev.transition === "completed";
  })(),
);

console.log(`结果: ${passed} passed`);
