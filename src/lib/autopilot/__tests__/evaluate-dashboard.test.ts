/**
 * Autopilot A2-P0 Evaluate surface — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/evaluate-dashboard.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AutopilotAccessError } from "../access";
import { evaluateMetricMapsToAiWrong } from "../evaluate-metrics";
import {
  getAutopilotTableQueryCount,
  resetAutopilotTableQueryCount,
} from "../observe-read-gate";
import { getAutopilotEvaluations } from "../service";

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

async function main() {
  console.log("autopilot A2-P0 evaluate dashboard");

  ok(
    evaluateMetricMapsToAiWrong("taskSuccessCount") === false,
    "taskSuccessCount is not a quality score",
  );

  const prevCapture = process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED;
  const prevProcessor = process.env.AUTOPILOT_PROCESSOR_ENABLED;
  const prevEnabled = process.env.AUTOPILOT_ENABLED;
  const prevOwners = process.env.AUTOPILOT_OWNER_USER_IDS;
  process.env.AUTOPILOT_ENABLED = "1";
  process.env.AUTOPILOT_OWNER_USER_IDS = "lucas_eval_owner";
  delete process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED;
  delete process.env.AUTOPILOT_PROCESSOR_ENABLED;

  try {
    resetAutopilotTableQueryCount();
    const dark = await getAutopilotEvaluations(
      { id: "lucas_eval_owner", role: "user" },
      "org_eval",
      { env: { AUTOPILOT_ENABLED: "1" } },
    );
    ok(dark.evaluateState === "NOT_ACTIVE", "dark evaluateState NOT_ACTIVE");
    ok(dark.items.length === 0, "dark evaluations items empty");
    ok(
      getAutopilotTableQueryCount() === 0,
      "dark evaluations does not query Autopilot tables",
    );

    try {
      await getAutopilotEvaluations({ id: "admin_user", role: "admin" }, "org_eval");
      ok(false, "admin cannot read evaluations");
    } catch (err) {
      ok(err instanceof AutopilotAccessError, "admin evaluations → access error");
    }
  } finally {
    if (prevCapture === undefined) delete process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED;
    else process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = prevCapture;
    if (prevProcessor === undefined) delete process.env.AUTOPILOT_PROCESSOR_ENABLED;
    else process.env.AUTOPILOT_PROCESSOR_ENABLED = prevProcessor;
    if (prevEnabled === undefined) delete process.env.AUTOPILOT_ENABLED;
    else process.env.AUTOPILOT_ENABLED = prevEnabled;
    if (prevOwners === undefined) delete process.env.AUTOPILOT_OWNER_USER_IDS;
    else process.env.AUTOPILOT_OWNER_USER_IDS = prevOwners;
  }

  const root = process.cwd();
  const ui = readFileSync(
    join(root, "src/app/(main)/ai/autopilot/evaluations/page.tsx"),
    "utf8",
  );
  ok(!/successRate/i.test(ui), "Evaluations UI has no Success Rate");
  ok(!/userId|Employee/.test(ui), "Evaluations table does not show employee/userId");
  ok(
    !/optimize|deploy|retry run|cancel run/i.test(ui),
    "Evaluations has no write/optimize actions",
  );
  ok(
    /AI Evaluator/.test(ui) && /DISABLED/.test(ui),
    "Evaluations still shows AI Evaluator DISABLED",
  );
  ok(/LLM Judge/.test(ui), "Evaluations shows LLM Judge status");
  ok(
    /not AI_WRONG/.test(ui) || /Not AI_WRONG/.test(ui),
    "Evaluations copy says override is not AI_WRONG",
  );

  const overviewUi = readFileSync(
    join(root, "src/app/(main)/ai/autopilot/page.tsx"),
    "utf8",
  );
  ok(
    /AI Evaluator/.test(overviewUi) && /DISABLED/.test(overviewUi),
    "Overview still shows AI Evaluator DISABLED",
  );
  ok(!/successRate/i.test(overviewUi), "Overview still has no Success Rate");

  const api = readFileSync(
    join(root, "src/app/api/autopilot/evaluations/route.ts"),
    "utf8",
  );
  ok(api.includes("requireAutopilotAccess"), "evaluations API uses access helper");
  ok(!api.includes('from "@/lib/db"'), "evaluations API does not query prisma directly");

  const instr = readFileSync(
    join(root, "src/lib/autopilot/instrumentation.ts"),
    "utf8",
  );
  ok(
    /mapDeterministicOutcome\(\{\s*status: run.status,\s*errorCode: run.errorCode,\s*\}\)/.test(
      instr,
    ),
    "Observe persist still does not pass humanOverride into overlay outcome",
  );
  ok(
    instr.includes("persistDeterministicEvaluation"),
    "projection persists deterministic evaluation separately",
  );
  ok(
    instr.includes("persistLlmJudgeEvaluation"),
    "projection may persist LLM Judge after deterministic eval",
  );
  ok(
    instr.includes("shouldInvokeLlmJudge"),
    "LLM Judge is not invoked on every projected event",
  );
  ok(
    /LLM Judge must never fail Observe/.test(instr),
    "LLM Judge errors cannot fail Observe projection",
  );

  const nav = readFileSync(join(root, "src/lib/navigation/registry.ts"), "utf8");
  ok(/autopilot-evaluations/.test(nav), "nav has evaluations child");
  ok(
    /autopilot-evaluations[\s\S]{0,220}autopilotOwnerOnly: true/.test(nav),
    "evaluations nav is owner-only",
  );
  ok(!/autopilot\/issues/.test(nav), "Issues still closed");
  ok(!/autopilot\/optimizations/.test(nav), "Optimizations still closed");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
