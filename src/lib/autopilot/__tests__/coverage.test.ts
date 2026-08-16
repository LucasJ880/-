/**
 * Autopilot A1-P1 coverage mapping + pairing + privacy.
 * 运行：npx tsx src/lib/autopilot/__tests__/coverage.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyAgentRunEvent,
  mapAgentRunEventToAutopilot,
} from "../map-events";
import {
  CONTEXT_LIFECYCLE,
  LEGACY_RUNTIME_GAPS,
  MODEL_LIFECYCLE,
  RETRIEVAL_LIFECYCLE,
  RUNTIME_COVERAGE_GAP_LIVE_NOTE,
  TOOL_LIFECYCLE,
  countLifecycleOrphans,
  durableCaptureGap,
  projectionGap,
  runtimeCoverageGap,
  summarizeCoverage,
} from "../coverage";
import { AUTOPILOT_TRACE_EVENT_TYPES } from "../types";
import { projectAutopilotTraceEvents } from "../projection";
import { sanitizeAutopilotPayload } from "../sanitize";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

console.log("autopilot A1-P1 coverage");

ok(
  mapAgentRunEventToAutopilot("run.started", { userMessageId: "m1" })
    ?.eventType === "USER_INPUT",
  "1 USER_INPUT mapping",
);
ok(
  mapAgentRunEventToAutopilot("planning.completed", {
    intent: "email",
    confidence: 0.8,
  })?.eventType === "INTENT_RESOLVED",
  "2 INTENT_RESOLVED mapping",
);

ok(
  mapAgentRunEventToAutopilot("context.loading")?.eventType ===
    "CONTEXT_LOAD_STARTED",
  "3 CONTEXT_LOAD_STARTED",
);
ok(
  mapAgentRunEventToAutopilot("context.loaded", { sourceCount: 3 })
    ?.eventType === "CONTEXT_LOADED",
  "3 CONTEXT_LOADED",
);
ok(
  mapAgentRunEventToAutopilot("context.failed", { errorCode: "x" })
    ?.eventType === "CONTEXT_LOAD_FAILED",
  "4 CONTEXT_LOAD_FAILED",
);

ok(
  mapAgentRunEventToAutopilot("retrieval.started", { retrievalId: "r1" })
    ?.eventType === "RETRIEVAL_STARTED",
  "5 RETRIEVAL_STARTED",
);
ok(
  mapAgentRunEventToAutopilot("retrieval.completed", { retrievalId: "r1" })
    ?.eventType === "RETRIEVAL_COMPLETED",
  "5 RETRIEVAL_COMPLETED",
);
ok(
  mapAgentRunEventToAutopilot("retrieval.failed", { retrievalId: "r1" })
    ?.eventType === "RETRIEVAL_FAILED",
  "6 RETRIEVAL_FAILED",
);

ok(
  mapAgentRunEventToAutopilot("tool.started", {
    name: "gmail.send",
    toolCallId: "t1",
  })?.eventType === "TOOL_CALL_STARTED",
  "7 TOOL_CALL_STARTED",
);
ok(
  mapAgentRunEventToAutopilot("tool.completed", {
    name: "gmail.send",
    toolCallId: "t1",
    ok: true,
  })?.eventType === "TOOL_CALL_COMPLETED",
  "7 TOOL_CALL_COMPLETED",
);
ok(
  mapAgentRunEventToAutopilot("tool.failed", {
    name: "gmail.send",
    toolCallId: "t1",
  })?.eventType === "TOOL_CALL_FAILED",
  "8 TOOL_CALL_FAILED",
);

ok(
  mapAgentRunEventToAutopilot("model.started", { modelCallId: "m1" })
    ?.eventType === "MODEL_STARTED",
  "9 MODEL_STARTED",
);
ok(
  mapAgentRunEventToAutopilot("response.started", { modelCallId: "m1" })
    ?.eventType === "MODEL_STARTED",
  "9 response.started → MODEL_STARTED",
);
ok(
  mapAgentRunEventToAutopilot("model.completed", { modelCallId: "m1" })
    ?.eventType === "MODEL_COMPLETED",
  "9 MODEL_COMPLETED",
);
ok(
  mapAgentRunEventToAutopilot("model.failed", { modelCallId: "m1" })
    ?.eventType === "MODEL_FAILED",
  "10 MODEL_FAILED",
);

ok(
  mapAgentRunEventToAutopilot("agent.output", { hash: "abc", bytes: 12 })
    ?.eventType === "AGENT_OUTPUT",
  "11 AGENT_OUTPUT",
);
ok(
  mapAgentRunEventToAutopilot("run.completed")?.eventType === "TASK_COMPLETED",
  "12 TASK_COMPLETED",
);
ok(
  mapAgentRunEventToAutopilot("run.failed", { code: "tool_failed" })
    ?.eventType === "TASK_FAILED",
  "13 TASK_FAILED",
);
ok(
  mapAgentRunEventToAutopilot("run.cancelled")?.eventType === "TASK_CANCELLED",
  "14 TASK_CANCELLED",
);

const unknown = mapAgentRunEventToAutopilot("totally.unknown.event");
ok(unknown?.eventType === "UNKNOWN_EVENT", "15 unknown event diagnostic");
ok(classifyAgentRunEvent("totally.unknown.event") === "unknown", "15 classify unknown");
ok(classifyAgentRunEvent("ack.sent") === "internal", "15 internal not unknown");
ok(mapAgentRunEventToAutopilot("ack.sent") === null, "15 internal not projected");

const dirty = mapAgentRunEventToAutopilot("tool.started", {
  name: "search",
  toolCallId: "t1",
  Authorization: "Bearer secret-token",
  prompt: "full user prompt should not map",
});
ok(
  !JSON.stringify(dirty?.payload ?? {}).includes("secret-token") &&
    !JSON.stringify(dirty?.payload ?? {}).includes("full user prompt"),
  "16 mapping drops secrets and prompt",
);
ok(
  !JSON.stringify(
    sanitizeAutopilotPayload({
      Authorization: "Bearer xyz",
      cookie: "sid=1",
    }) ?? {},
  ).includes("Bearer xyz"),
  "16 sanitizer redacts credentials",
);

ok(
  AUTOPILOT_TRACE_EVENT_TYPES.includes("UNKNOWN_EVENT") &&
    AUTOPILOT_TRACE_EVENT_TYPES.includes("TASK_CANCELLED") &&
    AUTOPILOT_TRACE_EVENT_TYPES.includes("CONTEXT_LOAD_STARTED"),
  "catalog includes new A1-P1 types",
);

const traced = projectAutopilotTraceEvents("r1", [
  {
    id: "e1",
    runId: "r1",
    sequence: 1,
    eventType: "tool.started",
    payload: { name: "search", Authorization: "Bearer abc", toolCallId: "t9" },
    createdAt: new Date("2026-08-15T00:00:00Z"),
  },
]);
ok(
  !JSON.stringify(traced[0]?.payload ?? {}).includes("Bearer abc"),
  "16 projection payload 不含 Authorization",
);

ok(
  durableCaptureGap({
    captureEnabled: true,
    canonicalEventCount: 10,
    outboxEventCount: 10,
  }) === 0,
  "durable capture gap 0",
);
ok(
  durableCaptureGap({
    captureEnabled: false,
    canonicalEventCount: 10,
    outboxEventCount: 0,
  }) === null,
  "capture OFF gap is n/a",
);
ok(projectionGap({ mappedEventCount: 8, projectedEventCount: 8 }) === 0, "projection gap 0");
ok(
  projectionGap({
    mappedEventCount: 2,
    unknownEventCount: 1,
    projectedEventCount: 2,
  }) === 1,
  "2 mapped + 1 unknown, projected=2 → PROJECTION_GAP=1",
);
ok(
  projectionGap({
    mappedEventCount: 2,
    unknownEventCount: 1,
    projectedEventCount: 3,
  }) === 0,
  "2 mapped + 1 unknown, projected=3 → PROJECTION_GAP=0",
);
ok(
  projectionGap({
    mappedEventCount: 2,
    unknownEventCount: 1,
    projectedEventCount: 2,
    projectedMappedCount: 0,
    projectedUnknownCount: 2,
  }) === 2,
  "UNKNOWN_EVENT extras do not mask missing mapped projections",
);
ok(
  runtimeCoverageGap(
    ["USER_INPUT", "TASK_COMPLETED"],
    ["USER_INPUT", "TASK_COMPLETED"],
  ).gap === 0,
  "runtime coverage gap 0 for defined scenario contract",
);

const toolPair = [
  { eventType: "tool.started", payload: { toolCallId: "a" } },
  { eventType: "tool.completed", payload: { toolCallId: "a", ok: true } },
];
ok(
  countLifecycleOrphans(toolPair, TOOL_LIFECYCLE).orphanCount === 0,
  "same toolCallId exactly one start + one terminal",
);

const toolOrphan = [
  { eventType: "tool.started", payload: { toolCallId: "orphan" } },
];
ok(
  countLifecycleOrphans(toolOrphan, TOOL_LIFECYCLE).orphanCount === 1,
  "TOOL STARTED without terminal = orphan",
);

const twoTools = [
  { eventType: "tool.started", payload: { toolCallId: "tA" } },
  { eventType: "tool.started", payload: { toolCallId: "tB" } },
  { eventType: "tool.completed", payload: { toolCallId: "tB" } },
  { eventType: "tool.failed", payload: { toolCallId: "tA" } },
];
ok(
  countLifecycleOrphans(twoTools, TOOL_LIFECYCLE).orphanCount === 0,
  "two concurrent tools do not cross-pair",
);

const twoModels = [
  { eventType: "model.started", payload: { modelCallId: "mA" } },
  { eventType: "response.started", payload: { modelCallId: "mB" } },
  { eventType: "model.completed", payload: { modelCallId: "mA" } },
  { eventType: "response.completed", payload: { modelCallId: "mB" } },
];
ok(
  countLifecycleOrphans(twoModels, MODEL_LIFECYCLE).orphanCount === 0,
  "two concurrent model calls keep correlation",
);

const retrievalPair = [
  { eventType: "retrieval.started", payload: { retrievalId: "rA" } },
  { eventType: "retrieval.failed", payload: { retrievalId: "rA" } },
];
ok(
  countLifecycleOrphans(retrievalPair, RETRIEVAL_LIFECYCLE).orphanCount === 0,
  "retrievalId start → fail",
);

const crossRunTools = [
  {
    eventType: "tool.started",
    runId: "runA",
    payload: { toolCallId: "step1:1" },
  },
  {
    eventType: "tool.completed",
    runId: "runA",
    payload: { toolCallId: "step1:1" },
  },
  {
    eventType: "tool.started",
    runId: "runB",
    payload: { toolCallId: "step1:1" },
  },
  {
    eventType: "tool.completed",
    runId: "runB",
    payload: { toolCallId: "step1:1" },
  },
];
ok(
  countLifecycleOrphans(crossRunTools, TOOL_LIFECYCLE).orphanCount === 0,
  "cross-run reused toolCallId step1:1 is not an orphan",
);

const crossRunModels = [
  {
    eventType: "model.started",
    runId: "runA",
    payload: { modelCallId: "step1:1" },
  },
  {
    eventType: "model.completed",
    runId: "runA",
    payload: { modelCallId: "step1:1" },
  },
  {
    eventType: "response.started",
    runId: "runB",
    payload: { modelCallId: "step1:1" },
  },
  {
    eventType: "response.completed",
    runId: "runB",
    payload: { modelCallId: "step1:1" },
  },
];
ok(
  countLifecycleOrphans(crossRunModels, MODEL_LIFECYCLE).orphanCount === 0,
  "cross-run reused modelCallId is not an orphan",
);

const crossRunRetrieval = [
  {
    eventType: "retrieval.started",
    runId: "runA",
    payload: { retrievalId: "step1:1" },
  },
  {
    eventType: "retrieval.completed",
    runId: "runA",
    payload: { retrievalId: "step1:1" },
  },
  {
    eventType: "retrieval.started",
    runId: "runB",
    payload: { retrievalId: "step1:1" },
  },
  {
    eventType: "retrieval.failed",
    runId: "runB",
    payload: { retrievalId: "step1:1" },
  },
];
ok(
  countLifecycleOrphans(crossRunRetrieval, RETRIEVAL_LIFECYCLE).orphanCount === 0,
  "cross-run reused retrievalId is not an orphan",
);

ok(
  countLifecycleOrphans(
    [
      {
        eventType: "tool.started",
        runId: "runA",
        payload: { toolCallId: "step1:1" },
      },
      {
        eventType: "tool.started",
        runId: "runA",
        payload: { toolCallId: "step1:1" },
      },
      {
        eventType: "tool.completed",
        runId: "runA",
        payload: { toolCallId: "step1:1" },
      },
    ],
    TOOL_LIFECYCLE,
  ).orphanCount === 1,
  "same-run duplicate toolCallId remains an orphan",
);

const snapshot = summarizeCoverage({
  runCount: 1,
  events: [
    ...toolPair,
    { eventType: "ack.sent" },
    { eventType: "mystery.event" },
  ],
  outboxEventCount: 4,
  projectedEventCount: 2,
  captureEnabled: true,
  classify: classifyAgentRunEvent,
});
ok(snapshot.unknownEventTypeCount === 1, "unknownEventTypeCount");
ok(snapshot.toolOrphans === 0, "snapshot tool orphans 0");
ok(snapshot.durableCaptureGap === 0, "snapshot durable gap 0");
ok(snapshot.projectableEvents === 3, "projectable = mapped + unknown, exclude internal");
ok(
  snapshot.projectionGap === 1,
  "2 mapped + 1 unknown + 1 internal, projected=2 → PROJECTION_GAP=1",
);
ok(snapshot.runtimeCoverageGap === null, "live runtimeCoverageGap is N/A, not fake 0");
ok(
  snapshot.runtimeCoverageGapNote === RUNTIME_COVERAGE_GAP_LIVE_NOTE,
  "live diagnostics explain N/A reason",
);

const snapshotClosed = summarizeCoverage({
  runCount: 1,
  events: [
    ...toolPair,
    { eventType: "ack.sent" },
    { eventType: "mystery.event" },
  ],
  outboxEventCount: 4,
  projectedEventCount: 3,
  captureEnabled: true,
  classify: classifyAgentRunEvent,
});
ok(
  snapshotClosed.projectionGap === 0,
  "2 mapped + 1 unknown + 1 internal, projected=3 → PROJECTION_GAP=0",
);

ok(LEGACY_RUNTIME_GAPS.length >= 5, "LEGACY_RUNTIME_GAPS remain documented");
ok(
  LEGACY_RUNTIME_GAPS.some((g) => g.id === "sales_create_completion_without_agent_run") &&
    LEGACY_RUNTIME_GAPS.some((g) => g.id === "trade_firecrawl_retrieval") &&
    LEGACY_RUNTIME_GAPS.some((g) => g.id === "tender_auto_analysis") &&
    LEGACY_RUNTIME_GAPS.some((g) => g.id === "assistant_partial_legacy_semantics"),
  "legacy sales/trade/tender/assistant gaps stay visible",
);

const typesSrc = readFileSync(
  join(process.cwd(), "src/lib/agent-runtime/types.ts"),
  "utf8",
);
const declared = [
  ...typesSrc.matchAll(/^\s+\| "([a-z0-9_.]+)"/gm),
].map((m) => m[1]);
const runEventTypes = declared.filter((t) => t.includes("."));
const unmapped = runEventTypes.filter(
  (t) => classifyAgentRunEvent(t) === "unknown",
);
ok(
  unmapped.length === 0,
  "UNMAPPED_CANONICAL_EVENTS = 0",
  unmapped,
);

ok(
  countLifecycleOrphans(
    [
      { eventType: "context.loading", runId: "r1" },
      { eventType: "context.loaded", runId: "r1" },
    ],
    {
      started: CONTEXT_LIFECYCLE.started,
      terminal: CONTEXT_LIFECYCLE.terminal,
      idKeys: ["missing"],
    },
  ).orphanCount === 0,
  "context pairing without id is not a tool-style orphan",
);

const processSrc = readFileSync(
  join(process.cwd(), "src/lib/agent-runtime/process.ts"),
  "utf8",
);
ok(processSrc.includes("onToolStart"), "v1 conversation instruments onToolStart");
ok(processSrc.includes("response.failed"), "v1 conversation emits response.failed");
ok(processSrc.includes("emitAgentOutputEvent"), "v1 conversation emits AGENT_OUTPUT");

const orgKb = readFileSync(
  join(process.cwd(), "src/lib/agent-core/tools/org-knowledge.ts"),
  "utf8",
);
ok(orgKb.includes("withObservedRetrieval"), "org_search_knowledge retrieval wrapper");

const clientSrc = readFileSync(join(process.cwd(), "src/lib/ai/client.ts"), "utf8");
ok(clientSrc.includes("agentRunId"), "createCompletionDetailed optional agentRunId");
ok(
  clientSrc.includes('await import("@/lib/agent-runtime/observe")'),
  "model wrapper dynamic-imports observe",
);

const runSrc = readFileSync(
  join(process.cwd(), "src/lib/agent-runtime/run.ts"),
  "utf8",
);
function exportedFn(src: string, name: string) {
  const start = src.indexOf(`export async function ${name}`);
  const next = src.indexOf("export async function", start + 1);
  return start >= 0 ? src.slice(start, next === -1 ? undefined : next) : "";
}
ok(runSrc.includes("FOR UPDATE"), "terminal transition locks AgentRun FOR UPDATE");
ok(
  runSrc.includes("applyAgentRunTerminalInTx"),
  "canonical atomic terminal helper exists",
);
ok(
  exportedFn(runSrc, "completeAgentRun").includes("applyAgentRunTerminalInTx") &&
    exportedFn(runSrc, "failAgentRun").includes("applyAgentRunTerminalInTx") &&
    exportedFn(runSrc, "cancelAgentRun").includes("applyAgentRunTerminalInTx"),
  "complete/fail/cancel share one atomic terminal transition",
);
ok(
  exportedFn(runSrc, "failAgentRun").includes("isAgentRunTerminalStatus"),
  "failAgentRun short-circuits any terminal status, not only cancelled",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
