/**
 * Autopilot A2-P1 LLM Judge — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/evaluate-judge.test.ts
 */

import {
  acceptLlmJudgeVerdict,
  buildLlmJudgePacket,
  isLlmJudgeEligible,
  LLM_JUDGE_SYSTEM_PROMPT,
  llmJudgeUserPrompt,
  shouldInvokeLlmJudge,
  shouldReuseExistingLlmJudge,
} from "../evaluate-judge";
import { isAutopilotLlmJudgeEnabled } from "../flags";
import {
  AUTOPILOT_DISABLED_CAPABILITIES,
  AUTOPILOT_LLM_EVALUATOR_KIND,
  AUTOPILOT_LLM_JUDGE_SURFACE,
} from "../types";

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

function verdictJson(extra: Record<string, unknown>): string {
  return JSON.stringify({
    confidence: "high",
    rationale: "structural only",
    failureType: null,
    ...extra,
  });
}

console.log("autopilot A2-P1 LLM Judge");

ok(
  AUTOPILOT_LLM_JUDGE_SURFACE === "A2_P1_LLM_JUDGE",
  "LLM Judge surface is A2-P1",
);
ok(
  AUTOPILOT_DISABLED_CAPABILITIES.aiEvaluator === "DISABLED",
  "Evaluator Agent remains DISABLED",
);
ok(!isAutopilotLlmJudgeEnabled({}), "LLM Judge flag default OFF");
ok(
  LLM_JUDGE_SYSTEM_PROMPT.includes("HUMAN_EDIT") &&
    LLM_JUDGE_SYSTEM_PROMPT.includes("not AI_WRONG") &&
    LLM_JUDGE_SYSTEM_PROMPT.includes("Completed is not automatically TASK_SUCCESS"),
  "system prompt locks human-signal and completed rules",
);
ok(
  /Never output HALLUCINATION/.test(LLM_JUDGE_SYSTEM_PROMPT),
  "system prompt forbids HALLUCINATION without source text",
);

ok(
  isLlmJudgeEligible({
    status: "completed",
    deterministicOutcome: "UNKNOWN",
  }),
  "UNKNOWN completed is eligible",
);
ok(
  !isLlmJudgeEligible({
    status: "completed",
    deterministicOutcome: "HUMAN_OVERRIDE",
  }),
  "HUMAN_OVERRIDE is not eligible",
);
ok(
  !isLlmJudgeEligible({
    status: "failed",
    deterministicOutcome: "FAILURE",
  }),
  "runtime FAILURE is not eligible",
);
ok(
  !isLlmJudgeEligible({
    status: "running",
    deterministicOutcome: "UNKNOWN",
  }),
  "running is not eligible",
);

const clean = buildLlmJudgePacket({ status: "completed" });
const cleanPrompt = llmJudgeUserPrompt(clean);
ok(!/Bearer |password|prompt/i.test(cleanPrompt), "packet JSON has no secrets/prompts");
ok(!("summary" in (JSON.parse(cleanPrompt) as object)), "packet has no text summary");

const accepted = acceptLlmJudgeVerdict(
  clean,
  verdictJson({ outcome: "TASK_SUCCESS", evidenceCode: "clean_completed_run" }),
);
ok(accepted.outcome === "TASK_SUCCESS", "clean completed can be TASK_SUCCESS");
ok(accepted.judged === true, "accepted verdict is judged");
ok(accepted.evaluatorKind === AUTOPILOT_LLM_EVALUATOR_KIND, "kind=llm");
ok(accepted.ruleId === "LLM_JUDGE_ACCEPTED", "accepted rule");

const edited = buildLlmJudgePacket({ status: "completed", humanEdit: true });
const editAsSuccess = acceptLlmJudgeVerdict(
  edited,
  verdictJson({
    outcome: "TASK_SUCCESS",
    evidenceCode: "human_edit_after_output",
  }),
);
ok(
  editAsSuccess.outcome === "UNKNOWN" &&
    editAsSuccess.ruleId === "LLM_JUDGE_REJECTED_HUMAN_SIGNAL_AS_QUALITY",
  "human edit cannot become TASK_SUCCESS",
);
const editPartial = acceptLlmJudgeVerdict(
  edited,
  verdictJson({
    outcome: "PARTIAL_SUCCESS",
    evidenceCode: "human_edit_after_output",
  }),
);
ok(editPartial.outcome === "PARTIAL_SUCCESS", "human edit can be PARTIAL_SUCCESS");

const hallucinated = acceptLlmJudgeVerdict(
  edited,
  verdictJson({
    outcome: "FAILURE",
    failureType: "HALLUCINATION",
    evidenceCode: "human_edit_after_output",
  }),
);
ok(
  hallucinated.ruleId === "LLM_JUDGE_REJECTED_SEMANTIC_FAILURE",
  "HALLUCINATION from human edit is rejected",
);

const toolFailed = buildLlmJudgePacket({
  status: "completed",
  eventCounts: { TOOL_CALL_FAILED: 1 },
});
const toolFailure = acceptLlmJudgeVerdict(
  toolFailed,
  verdictJson({
    outcome: "FAILURE",
    failureType: "TOOL_FAILURE",
    evidenceCode: "has_tool_failure_event",
  }),
);
ok(toolFailure.outcome === "FAILURE", "tool failure event can be FAILURE");
ok(toolFailure.failureType === "TOOL_FAILURE", "grounded TOOL_FAILURE");

const ungroundedFailure = acceptLlmJudgeVerdict(
  clean,
  verdictJson({
    outcome: "FAILURE",
    failureType: "TOOL_FAILURE",
    evidenceCode: "has_tool_failure_event",
  }),
);
ok(
  ungroundedFailure.ruleId === "LLM_JUDGE_REJECTED_UNGROUNDED",
  "FAILURE without matching events is rejected",
);

const parsed = acceptLlmJudgeVerdict(clean, "not json");
ok(parsed.ruleId === "LLM_JUDGE_PARSE_FAILED", "non-JSON is parse failed");

const intent = acceptLlmJudgeVerdict(
  clean,
  verdictJson({
    outcome: "FAILURE",
    failureType: "INTENT_ERROR",
    evidenceCode: "clean_completed_run",
  }),
);
ok(
  intent.ruleId === "LLM_JUDGE_REJECTED_SEMANTIC_FAILURE",
  "INTENT_ERROR is rejected without source text",
);

ok(
  shouldInvokeLlmJudge({ noticeType: "run_terminal" }),
  "run_terminal may invoke LLM Judge",
);
ok(
  !shouldInvokeLlmJudge({ noticeType: "run_created" }),
  "run_created does not invoke LLM Judge",
);
ok(
  !shouldInvokeLlmJudge({
    noticeType: "event",
    mappedEventType: "MODEL_COMPLETED",
  }),
  "ordinary model.completed does not invoke LLM Judge",
);
ok(
  shouldInvokeLlmJudge({
    noticeType: "event",
    mappedEventType: "HUMAN_EDIT",
  }),
  "HUMAN_EDIT may re-invoke LLM Judge",
);
ok(
  shouldInvokeLlmJudge({
    noticeType: "event",
    mappedEventType: "TOOL_CALL_FAILED",
  }),
  "TOOL_CALL_FAILED may re-invoke LLM Judge",
);

const acceptedEvidence = {
  ruleId: "LLM_JUDGE_ACCEPTED",
  evidence: { packet: clean },
};
ok(
  shouldReuseExistingLlmJudge(acceptedEvidence, clean),
  "same packet after accepted verdict skips a second model call",
);
ok(
  !shouldReuseExistingLlmJudge(
    { ruleId: "LLM_JUDGE_UNAVAILABLE", evidence: { packet: clean } },
    clean,
  ),
  "UNAVAILABLE is retried",
);
ok(
  !shouldReuseExistingLlmJudge(
    acceptedEvidence,
    buildLlmJudgePacket({ status: "completed", humanEdit: true }),
  ),
  "human-edit packet change does not skip",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
