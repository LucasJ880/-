/**
 * Autopilot A2-P0 deterministic evaluate — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/evaluate.test.ts
 */

import {
  a2p0AssignsTaskSuccess,
  evaluateDeterministicRun,
  humanSignalMapsToHallucination,
  isForbiddenA2P0FailureType,
} from "../evaluate";
import { evaluateMetricMapsToAiWrong } from "../evaluate-metrics";
import {
  AUTOPILOT_A2_PATHS,
  AUTOPILOT_DISABLED_CAPABILITIES,
  AUTOPILOT_EVALUATE_SURFACE,
  AUTOPILOT_EVALUATOR_KIND,
  AUTOPILOT_RESERVED_PATHS,
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

console.log("autopilot A2-P0 deterministic evaluate");

ok(
  AUTOPILOT_EVALUATE_SURFACE === "A2_P0_DETERMINISTIC_EVALUATE",
  "evaluate surface is A2-P0",
);
ok(
  AUTOPILOT_DISABLED_CAPABILITIES.aiEvaluator === "DISABLED",
  "LLM AI Evaluator remains DISABLED",
);
ok(
  AUTOPILOT_A2_PATHS.evaluations === "/ai/autopilot/evaluations",
  "evaluations path opened",
);
ok(
  !("evaluations" in AUTOPILOT_RESERVED_PATHS),
  "evaluations is no longer reserved",
);
ok(
  AUTOPILOT_RESERVED_PATHS.issues === "/ai/autopilot/issues",
  "issues remain reserved",
);

ok(a2p0AssignsTaskSuccess() === false, "A2-P0 never assigns TASK_SUCCESS");
ok(
  humanSignalMapsToHallucination() === false,
  "human signals do not map to HALLUCINATION",
);
ok(
  evaluateMetricMapsToAiWrong("humanOverrideOutcomeCount") === false,
  "override outcome count is not AI_WRONG",
);

const completed = evaluateDeterministicRun({ status: "completed" });
ok(completed.outcome === "UNKNOWN", "completed → UNKNOWN");
ok(completed.judged === false, "completed is not judged");
ok(completed.ruleId === "NOT_JUDGED", "completed rule is NOT_JUDGED");
ok(completed.evaluatorKind === AUTOPILOT_EVALUATOR_KIND, "kind=deterministic");

const edited = evaluateDeterministicRun({
  status: "completed",
  humanEdit: true,
});
ok(edited.outcome === "UNKNOWN", "HUMAN_EDIT does not become PARTIAL_SUCCESS");
ok(edited.evidence.humanEdit === true, "edit is recorded as evidence only");

const reasked = evaluateDeterministicRun({
  status: "completed",
  reAsk: true,
});
ok(reasked.outcome === "UNKNOWN", "RE_ASK does not become FAILURE");

const failed = evaluateDeterministicRun({
  status: "failed",
  errorCode: "tool_failed",
});
ok(failed.outcome === "FAILURE", "failed → FAILURE");
ok(failed.failureType === "TOOL_FAILURE", "tool_failed → TOOL_FAILURE");
ok(failed.failureSource === "system", "runtime failure source=system");
ok(failed.judged === true, "failure is judged");
ok(failed.ruleId === "RUNTIME_FAILED", "failure rule");

const cancelled = evaluateDeterministicRun({ status: "cancelled" });
ok(cancelled.outcome === "ABANDONED", "cancelled → ABANDONED");
ok(cancelled.failureType === null, "abandoned has no failureType");
ok(cancelled.ruleId === "RUNTIME_CANCELLED", "cancelled rule");

const overridden = evaluateDeterministicRun({
  status: "completed",
  humanOverride: true,
});
ok(overridden.outcome === "HUMAN_OVERRIDE", "override → HUMAN_OVERRIDE");
ok(overridden.failureType === null, "override does not invent failureType");
ok(overridden.failureSource === "human_signal", "override source=human_signal");
ok(overridden.ruleId === "HUMAN_OVERRIDE_PRESENT", "override rule");

const overrideBeatsFailure = evaluateDeterministicRun({
  status: "failed",
  errorCode: "tool_failed",
  humanOverride: true,
});
ok(
  overrideBeatsFailure.outcome === "HUMAN_OVERRIDE",
  "human override wins over failed status",
);
ok(
  overrideBeatsFailure.failureType === null,
  "override does not keep TOOL_FAILURE as AI_WRONG",
);

ok(
  !isForbiddenA2P0FailureType("TOOL_FAILURE"),
  "TOOL_FAILURE is allowed when system-mapped",
);
ok(
  isForbiddenA2P0FailureType("HALLUCINATION"),
  "HALLUCINATION is forbidden in A2-P0",
);
ok(isForbiddenA2P0FailureType("INTENT_ERROR"), "INTENT_ERROR is forbidden");
ok(isForbiddenA2P0FailureType("WRONG_TOOL"), "WRONG_TOOL is forbidden");

const running = evaluateDeterministicRun({ status: "running" });
ok(running.outcome === "UNKNOWN" && running.judged === false, "running not judged");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
