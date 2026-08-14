/**
 * Autopilot taxonomy + event mapping + outcome
 * 运行：npx tsx src/lib/autopilot/__tests__/taxonomy.test.ts
 */

import {
  AUTOPILOT_A1_MANDATORY_BLOCKERS,
  AUTOPILOT_FAILURE_TYPES,
  AUTOPILOT_OUTCOMES,
  AUTOPILOT_TRACE_EVENT_TYPES,
} from "../types";
import { AUTOPILOT_METRIC_DEFINITIONS } from "../metrics";
import { mapAgentRunEventToAutopilot } from "../map-events";
import { mapDeterministicFailureType, mapDeterministicOutcome } from "../outcome";
import { projectAutopilotTraceEvents } from "../projection";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("autopilot taxonomy");

ok(AUTOPILOT_OUTCOMES.includes("TASK_SUCCESS"), "TASK_SUCCESS");
ok(AUTOPILOT_OUTCOMES.includes("UNKNOWN"), "UNKNOWN");
ok(AUTOPILOT_FAILURE_TYPES.includes("HALLUCINATION"), "HALLUCINATION 类型存在");
ok(AUTOPILOT_TRACE_EVENT_TYPES.includes("RE_ASK_SIGNAL"), "RE_ASK_SIGNAL 接口存在");
ok(AUTOPILOT_METRIC_DEFINITIONS.length >= 14, "metrics 定义齐全");
ok(
  AUTOPILOT_A1_MANDATORY_BLOCKERS.some(
    (b) => b.id === "TELEMETRY_DURABILITY" && b.status === "BLOCKER",
  ),
  "A1 mandatory blocker: TELEMETRY_DURABILITY remains BLOCKER",
);

ok(mapDeterministicOutcome({ status: "failed" }) === "FAILURE", "failed → FAILURE");
ok(mapDeterministicOutcome({ status: "cancelled" }) === "ABANDONED", "cancelled → ABANDONED");
ok(
  mapDeterministicOutcome({ status: "completed" }) === "UNKNOWN",
  "completed 不升格为 TASK_SUCCESS",
);
ok(
  mapDeterministicOutcome({ status: "completed", humanOverride: true }) ===
    "HUMAN_OVERRIDE",
  "human override",
);
ok(
  mapDeterministicFailureType("tool_failed")?.failureType === "TOOL_FAILURE",
  "tool_failed → TOOL_FAILURE (system)",
);
ok(
  mapDeterministicFailureType("tool_failed")?.failureSource === "system",
  "A0 failure source = system",
);
ok(mapDeterministicFailureType(null) === null, "无 errorCode 不猜 failure");

ok(
  mapAgentRunEventToAutopilot("tool.started", { name: "gmail.send" })?.eventType ===
    "TOOL_CALL_STARTED",
  "tool.started",
);
ok(
  mapAgentRunEventToAutopilot("tool.completed", { name: "x", ok: false })?.eventType ===
    "TOOL_CALL_FAILED",
  "tool.completed ok=false → FAILED",
);
ok(
  mapAgentRunEventToAutopilot("approval.rejected")?.eventType === "HUMAN_OVERRIDE",
  "approval.rejected → HUMAN_OVERRIDE",
);
ok(
  mapAgentRunEventToAutopilot("job.human_edited")?.eventType === "HUMAN_EDIT",
  "human edit event",
);
ok(
  mapAgentRunEventToAutopilot("run.failed", { code: "tool_failed" })?.eventType ===
    "TASK_FAILED",
  "run.failed",
);

const traced = projectAutopilotTraceEvents("r1", [
  {
    id: "e1",
    runId: "r1",
    sequence: 1,
    eventType: "tool.started",
    payload: { name: "search", Authorization: "Bearer abc" },
    createdAt: new Date("2026-08-14T00:00:00Z"),
  },
]);
ok(traced[0]?.eventType === "TOOL_CALL_STARTED", "投影 event type");
ok(
  !JSON.stringify(traced[0]?.payload ?? {}).includes("Bearer abc"),
  "投影 payload 不含原始 Authorization 值（映射层丢弃未声明字段）",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
