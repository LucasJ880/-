/**
 * Autopilot A1-P2 Human Signals — deterministic facts only.
 * 运行：npx tsx src/lib/autopilot/__tests__/human-signals.test.ts
 *
 * 不判断 AI 对错 / 员工绩效。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyAgentRunEvent,
  mapAgentRunEventToAutopilot,
} from "../map-events";
import { summarizeCoverage } from "../coverage";
import {
  DOMAIN_HUMAN_SIGNAL_COVERAGE,
  LEGACY_HUMAN_SIGNAL_GAPS,
  buildHumanSignalPayload,
  changeMagnitude,
  classifyFollowUp,
  humanEditSignalKey,
  humanOverrideSignalKey,
  humanSignalProjectionGap,
  reAskSignalKey,
  shouldEmitHumanEdit,
  shouldEmitReAsk,
  snapshotStats,
} from "../human-signals";
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

console.log("autopilot A1-P2 human signals");

const AI_DRAFT = "Dear customer, here is the quote.";
const EDITED = "Dear customer, here is the revised quote.";

ok(
  shouldEmitHumanEdit({
    sourceAgentRunId: "run_1",
    beforeHash: snapshotStats(AI_DRAFT).hash,
    afterHash: snapshotStats(AI_DRAFT).hash,
    commitOccurred: true,
  }) === false,
  "1 unchanged AI draft → no HUMAN_EDIT",
);
ok(
  shouldEmitHumanEdit({
    sourceAgentRunId: "run_1",
    beforeHash: snapshotStats(AI_DRAFT).hash,
    afterHash: snapshotStats(EDITED).hash,
    commitOccurred: true,
  }) === true,
  "2 changed + committed → HUMAN_EDIT eligible",
);
ok(
  shouldEmitHumanEdit({
    sourceAgentRunId: "run_1",
    beforeHash: snapshotStats(AI_DRAFT).hash,
    afterHash: snapshotStats(EDITED).hash,
    commitOccurred: false,
  }) === false,
  "3 keystroke/autosave (no commit) → no event storm",
);
ok(
  shouldEmitHumanEdit({
    sourceAgentRunId: "",
    beforeHash: snapshotStats(AI_DRAFT).hash,
    afterHash: snapshotStats(EDITED).hash,
    commitOccurred: true,
  }) === false,
  "7 non-AI / missing lineage → no HUMAN_EDIT",
);

const key1 = humanEditSignalKey({
  sourceRunId: "run_1",
  artifactId: "draft_1",
  committedVersion: "v3",
});
ok(
  key1 === "human.edit:run_1:draft_1:v3",
  "4 signalKey is business identity, not timestamp",
);
ok(
  humanOverrideSignalKey({
    sourceRunId: "run_1",
    decisionRef: "pa_1",
    transition: "rejected",
  }) === "human.override:run_1:pa_1:rejected",
  "override signalKey = run + decision + transition",
);
ok(
  reAskSignalKey({
    sourceRunId: "run_a",
    retryActionId: "assistant-run-retry:run_a:1",
  }) === "human.reask:run_a:assistant-run-retry:run_a:1",
  "reask signalKey = original run + retryActionId",
);

const stats = snapshotStats(AI_DRAFT);
ok(typeof stats.hash === "string" && stats.hash.length === 16, "6 hash persisted shape");
ok(stats.chars === AI_DRAFT.length, "6 length persisted");
ok(snapshotStats(AI_DRAFT).hash === snapshotStats(AI_DRAFT).hash, "hash is deterministic");
ok(
  changeMagnitude(AI_DRAFT.length, EDITED.length) ===
    Math.abs(EDITED.length - AI_DRAFT.length),
  "changeMagnitude is a deterministic number",
);

const dirtyPayload = buildHumanSignalPayload({
  sourceAgentRunId: "run_1",
  beforeHash: stats.hash,
  afterHash: snapshotStats(EDITED).hash,
  beforeChars: stats.chars,
  afterChars: EDITED.length,
  beforeText: AI_DRAFT,
  afterText: EDITED,
  diffText: "- quote\n+ revised quote",
  body: "Dear customer...",
  content: AI_DRAFT,
  Authorization: "Bearer secret-token-value",
  Cookie: "qy_session=abc",
  password: "hunter2",
  overrideReason: "AI was wrong",
  reasonText: "user said the answer was bad",
});
const dirtyJson = JSON.stringify(dirtyPayload);
ok(!dirtyJson.includes(AI_DRAFT), "5 beforeText not persisted");
ok(!dirtyJson.includes(EDITED), "5 afterText not persisted");
ok(!dirtyJson.includes("revised quote"), "5 diff text not persisted");
ok(!dirtyJson.includes("Bearer secret-token-value"), "28 Bearer not persisted");
ok(!dirtyJson.includes("qy_session=abc"), "28 Cookie not persisted");
ok(!dirtyJson.includes("hunter2"), "28 password not persisted");
ok(!dirtyJson.includes("AI was wrong"), "41.6 no semantic reason inference stored");
ok(dirtyPayload.beforeHash === stats.hash, "6 beforeHash persisted");
ok(dirtyPayload.afterChars === EDITED.length, "6 afterChars persisted");

ok(
  mapAgentRunEventToAutopilot("human.edit", {
    beforeHash: "abc",
    afterHash: "xyz",
    beforeText: "Dear customer secret body",
  })?.eventType === "HUMAN_EDIT",
  "human.edit maps to HUMAN_EDIT",
);
ok(
  !JSON.stringify(
    mapAgentRunEventToAutopilot("human.edit", {
      beforeHash: "abc",
      beforeText: "Dear customer secret body",
    })?.payload ?? {},
  ).includes("Dear customer secret body"),
  "mapping drops raw edit text",
);
ok(
  mapAgentRunEventToAutopilot("approval.rejected", {
    pendingActionId: "pa_1",
    overrideType: "REJECTED",
  })?.eventType === "HUMAN_OVERRIDE",
  "41.1 AI PendingAction rejected → HUMAN_OVERRIDE",
);
ok(
  mapAgentRunEventToAutopilot("approval.executed")?.eventType === "HUMAN_ACTION",
  "41.2 AI PendingAction approved → HUMAN_ACTION, not OVERRIDE",
);
ok(
  mapAgentRunEventToAutopilot("human.override", {
    overrideType: "REPLACED",
    replacementRef: "vendor_b",
    replacementText: "Vendor B full proposal",
  })?.eventType === "HUMAN_OVERRIDE",
  "41.5 replacement decision → HUMAN_OVERRIDE",
);
ok(
  !JSON.stringify(
    mapAgentRunEventToAutopilot("human.override", {
      overrideType: "REPLACED",
      replacementRef: "vendor_b",
      replacementText: "Vendor B full proposal",
    })?.payload ?? {},
  ).includes("Vendor B full proposal"),
  "replacement body not mapped",
);
ok(
  mapAgentRunEventToAutopilot("human.reask", {
    originalAgentRunId: "run_a",
    newAgentRunId: "run_b",
  })?.eventType === "RE_ASK_SIGNAL",
  "42.1 explicit retry event → RE_ASK_SIGNAL",
);
ok(
  classifyAgentRunEvent("run.retry_requested") === "internal",
  "run.retry_requested stays internal (no double-count)",
);
ok(
  mapAgentRunEventToAutopilot("run.retry_requested") === null,
  "run.retry_requested is not projected as RE_ASK",
);

ok(shouldEmitReAsk({ explicitRetry: true }) === true, "42.1 explicit Retry → reask");
ok(
  shouldEmitReAsk({ explicitRegenerate: true }) === true,
  "42.2 explicit Regenerate → reask",
);
ok(
  shouldEmitReAsk({ retriedFromRunId: "run_a" }) === true,
  "retry metadata → reask",
);
ok(
  classifyFollowUp({}) === "ordinary" && shouldEmitReAsk({}) === false,
  "42.3 ordinary follow-up → no RE_ASK",
);
ok(
  classifyFollowUp({ explicitRetry: false, retriedFromRunId: null }) ===
    "ordinary",
  "42.4 unrelated new prompt → no RE_ASK",
);

ok(
  humanSignalProjectionGap({
    sourceHumanSignalCount: 3,
    projectedHumanSignalCount: 3,
  }) === 0,
  "HUMAN_SIGNAL_PROJECTION_GAP = 0 when drained",
);
ok(
  humanSignalProjectionGap({
    sourceHumanSignalCount: 2,
    projectedHumanSignalCount: 0,
  }) === 2,
  "gap = source − projected",
);

const cov = summarizeCoverage({
  runCount: 1,
  events: [
    {
      eventType: "human.edit",
      runId: "run_1",
      payload: { sourceAgentRunId: "run_1", signalKey: "human.edit:run_1:a:1" },
    },
    {
      eventType: "human.edit",
      runId: "run_1",
      payload: { sourceAgentRunId: "run_1", signalKey: "human.edit:run_1:a:1" },
    },
    {
      eventType: "approval.rejected",
      runId: "run_1",
      payload: { sourceAgentRunId: "run_1", signalKey: "human.override:run_1:pa:rejected" },
    },
    {
      eventType: "human.reask",
      runId: "run_1",
      payload: {
        originalAgentRunId: "run_1",
        newAgentRunId: "run_2",
        signalKey: "human.reask:run_1:retry:1",
      },
    },
    { eventType: "run.completed", runId: "run_1" },
  ],
  outboxEventCount: 5,
  projectedEventCount: 5,
  projectedHumanSignalCount: 4,
  captureEnabled: true,
  classify: classifyAgentRunEvent,
});
ok(cov.humanEditCount === 2, "HUMAN_EDIT_COUNT");
ok(cov.humanOverrideCount === 1, "HUMAN_OVERRIDE_COUNT");
ok(cov.reAskCount === 1, "RE_ASK_COUNT");
ok(cov.duplicateHumanSignalCount === 1, "duplicate signalKey counted");
ok(cov.unlinkedHumanSignalCount === 0, "UNLINKED_HUMAN_SIGNAL_COUNT = 0");
ok(cov.humanSignalProjectionGap === 0, "counts include duplicate source rows");
ok(cov.unknownHumanSignalCount === 0, "UNKNOWN_HUMAN_SIGNAL_COUNT = 0");

const unlinked = summarizeCoverage({
  runCount: 1,
  events: [
    {
      eventType: "human.edit",
      runId: "run_x",
      payload: { signalKey: "k", beforeHash: "a", afterHash: "b" },
    },
  ],
  outboxEventCount: 0,
  projectedEventCount: 0,
  captureEnabled: false,
  classify: classifyAgentRunEvent,
});
ok(unlinked.unlinkedHumanSignalCount === 1, "missing sourceAgentRunId → unlinked diagnostic");

ok(
  DOMAIN_HUMAN_SIGNAL_COVERAGE.some((d) => d.domain === "Assistant") &&
    DOMAIN_HUMAN_SIGNAL_COVERAGE.some((d) => d.domain === "Tender") &&
    DOMAIN_HUMAN_SIGNAL_COVERAGE.some((d) => d.domain === "Sales"),
  "domain coverage table present",
);
ok(
  LEGACY_HUMAN_SIGNAL_GAPS.some((g) => g.id === "sales_legacy_ai_draft_lineage") &&
    LEGACY_HUMAN_SIGNAL_GAPS.some((g) => g.id === "tender_auto_analysis_lineage") &&
    LEGACY_HUMAN_SIGNAL_GAPS.some((g) => g.id === "employee_ai_feedback_observe_best_effort"),
  "legacy gaps remain visible",
);

const ROOT = process.cwd();
const observeSrc = readFileSync(join(ROOT, "src/lib/autopilot/observe-human.ts"), "utf8");
ok(observeSrc.includes('eventType: "human.edit"'), "observe writes human.edit");
ok(observeSrc.includes("visibleToUser: false"), "human signals are not user-visible status");
ok(
  observeSrc.includes("CROSS_ORG_OR_MISSING_RUN"),
  "8 cross-org sourceRun rejected",
);
ok(observeSrc.includes("status: \"duplicate\""), "HTTP retry → duplicate suppressed");

const retrySrc = readFileSync(join(ROOT, "src/lib/assistant/retry-run.ts"), "utf8");
ok(retrySrc.includes("observeRetryReAsk"), "Retry UI/API wires RE_ASK");
ok(
  retrySrc.indexOf("reserved.kind === \"completed\"") <
    retrySrc.indexOf("await observeRetryReAsk"),
  "completed retry slot still observes (durable replay)",
);

const reconcileSrc = readFileSync(
  join(ROOT, "src/lib/assistant/reconcile-run.ts"),
  "utf8",
);
ok(
  reconcileSrc.includes('rejected: "approval.rejected"') &&
    reconcileSrc.includes('overrideType: "REJECTED"'),
  "PA reject enriches approval.rejected as HUMAN_OVERRIDE source",
);
ok(
  !reconcileSrc.includes('eventType: "human.override"'),
  "PA reject does not double-write human.override",
);

const feedbackSrc = readFileSync(
  join(ROOT, "src/lib/employee-ai/feedback-service.ts"),
  "utf8",
);
ok(feedbackSrc.includes("observeHumanEditSafe"), "employee-ai edited observes HUMAN_EDIT");
ok(
  feedbackSrc.includes("!event.pendingActionId"),
  "employee-ai reject skips override when PA will emit it",
);

const instrSrc = readFileSync(
  join(ROOT, "src/lib/autopilot/instrumentation.ts"),
  "utf8",
);
ok(
  /mapDeterministicOutcome\(\{\s*status: run.status,\s*errorCode: run.errorCode,\s*\}\)/.test(
    instrSrc,
  ),
  "instrumentation does not pass humanOverride into outcome (not A2 eval)",
);

const dispatchSrc = readFileSync(join(ROOT, "src/lib/assistant/dispatch.ts"), "utf8");
ok(
  dispatchSrc.includes("retriedFromRunId: input.retryContext.retriedFromRunId") ||
    dispatchSrc.includes("retriedFromRunId: input.retryContext?.retriedFromRunId"),
  "retriedFromRunId only from explicit retryContext",
);

const typesSrc = readFileSync(join(ROOT, "src/lib/agent-runtime/types.ts"), "utf8");
ok(
  typesSrc.includes('"human.edit"') &&
    typesSrc.includes('"human.override"') &&
    typesSrc.includes('"human.reask"'),
  "canonical human signal event types declared",
);

ok(
  classifyAgentRunEvent("human.edit") === "mapped" &&
    classifyAgentRunEvent("human.override") === "mapped" &&
    classifyAgentRunEvent("human.reask") === "mapped",
  "UNMAPPED_CANONICAL human events = 0",
);

ok(
  !JSON.stringify(
    sanitizeAutopilotPayload({
      Authorization: "Bearer xyz",
      oauth_token: "ya29.abc",
      apiKey: "sk-live-abcdefghijklmnopqrstuvwxyz",
    }) ?? {},
  ).includes("Bearer xyz"),
  "credential sanitizer still applies",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
