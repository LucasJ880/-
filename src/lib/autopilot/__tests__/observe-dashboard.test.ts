/**
 * Autopilot A1-P3 Observe Dashboard — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/observe-dashboard.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AutopilotAccessError } from "../access";
import {
  humanEditMapsToAiWrong,
  observeMetricMapsToAiWrong,
} from "../metrics-definition";
import { observabilityHealthState } from "../observe-health";
import { scanObserveResponse } from "../observe-privacy";
import {
  ObserveQueryError,
  parseObserveCursor,
  parseObserveLimit,
  parseObserveRange,
  parseObserveRunsQuery,
  parseObserveStatus,
  utcBucketStart,
} from "../observe-range";
import {
  getAutopilotTableQueryCount,
  resetAutopilotTableQueryCount,
} from "../observe-read-gate";
import {
  postTerminalHumanSignalsAreLegal,
  terminalInvariant,
  timelineSafeSummary,
} from "../observe-timeline";
import {
  getAutopilotOverview,
  getAutopilotRun,
  listAutopilotRuns,
} from "../service";

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
  console.log("autopilot A1-P3 observe dashboard");

  ok(humanEditMapsToAiWrong() === false, "HUMAN_EDIT does not map to AI_WRONG");
  ok(
    observeMetricMapsToAiWrong("humanOverrideCount") === false,
    "HUMAN_OVERRIDE does not map to AI_WRONG",
  );
  ok(
    observeMetricMapsToAiWrong("reAskCount") === false,
    "RE_ASK does not map to AI_WRONG",
  );

  ok(
    observabilityHealthState({
      telemetryReadEnabled: false,
      coverageAvailable: true,
      durableCaptureGap: 0,
      projectionGap: 0,
      humanSignalProjectionGap: 0,
      toolOrphans: 0,
      modelOrphans: 0,
      retrievalOrphans: 0,
      unknownEventTypeCount: 0,
      unlinkedHumanSignalCount: 0,
    }) === "NOT_ACTIVE",
    "Case A: capture/read off → NOT_ACTIVE",
  );
  ok(
    observabilityHealthState({
      telemetryReadEnabled: true,
      coverageAvailable: true,
      durableCaptureGap: 0,
      projectionGap: 0,
      humanSignalProjectionGap: 0,
      toolOrphans: 0,
      modelOrphans: 0,
      retrievalOrphans: 0,
      unknownEventTypeCount: 0,
      unlinkedHumanSignalCount: 0,
    }) === "HEALTHY",
    "Case B: capture on, gaps 0 → HEALTHY",
  );
  ok(
    observabilityHealthState({
      telemetryReadEnabled: true,
      coverageAvailable: true,
      durableCaptureGap: 0,
      projectionGap: 4,
      humanSignalProjectionGap: 0,
      toolOrphans: 0,
      modelOrphans: 0,
      retrievalOrphans: 0,
      unknownEventTypeCount: 0,
      unlinkedHumanSignalCount: 0,
    }) === "DEGRADED",
    "Case C: projectionGap > 0 → DEGRADED",
  );
  ok(
    observabilityHealthState({
      telemetryReadEnabled: true,
      coverageAvailable: false,
      durableCaptureGap: 0,
      projectionGap: 0,
      humanSignalProjectionGap: 0,
      toolOrphans: 0,
      modelOrphans: 0,
      retrievalOrphans: 0,
      unknownEventTypeCount: 0,
      unlinkedHumanSignalCount: 0,
    }) === "UNKNOWN",
    "Case D: coverage unavailable → UNKNOWN",
  );
  ok(
    observabilityHealthState({
      telemetryReadEnabled: true,
      coverageAvailable: true,
      durableCaptureGap: 0,
      projectionGap: 0,
      humanSignalProjectionGap: 0,
      toolOrphans: 0,
      modelOrphans: 0,
      retrievalOrphans: 0,
      unknownEventTypeCount: 0,
      unlinkedHumanSignalCount: 0,
    }) === "HEALTHY",
    "Case E: TASK_FAILED count is not an observability input → still HEALTHY",
  );

  ok(parseObserveRange("24h") === "24h", "range 24h");
  ok(parseObserveRange("7d") === "7d", "range 7d");
  ok(parseObserveRange("30d") === "30d", "range 30d");
  try {
    parseObserveRange("90d");
    ok(false, "range 90d rejected");
  } catch (error) {
    ok(error instanceof ObserveQueryError, "range 90d → 400");
  }
  try {
    parseObserveLimit("101");
    ok(false, "limit 101 rejected");
  } catch (error) {
    ok(error instanceof ObserveQueryError, "limit > 100 → 400");
  }
  try {
    parseObserveStatus("success");
    ok(false, "status success rejected");
  } catch (error) {
    ok(error instanceof ObserveQueryError, "unknown status → 400");
  }
  try {
    parseObserveCursor("not-a-cursor");
    ok(false, "bad cursor rejected");
  } catch (error) {
    ok(error instanceof ObserveQueryError, "bad cursor → 400");
  }

  const parsed = parseObserveRunsQuery({
    get: (key: string) => {
      if (key === "range") return "7d";
      if (key === "limit") return "25";
      return null;
    },
  });
  ok(parsed.limit === 25 && parsed.range === "7d", "runs query defaults");

  ok(
    utcBucketStart(new Date("2026-08-16T15:07:00.000Z"), "hour") ===
      "2026-08-16T15:00:00.000Z",
    "24h bucket uses UTC hour boundary",
  );
  ok(
    utcBucketStart(new Date("2026-08-16T15:07:00.000Z"), "day") ===
      "2026-08-16T00:00:00.000Z",
    "7d/30d bucket uses UTC day boundary",
  );

  const timeline = [
    { eventType: "USER_INPUT", sequence: 1 },
    { eventType: "MODEL_STARTED", sequence: 2 },
    { eventType: "MODEL_COMPLETED", sequence: 3 },
    { eventType: "AGENT_OUTPUT", sequence: 4 },
    { eventType: "TASK_COMPLETED", sequence: 5 },
    { eventType: "HUMAN_EDIT", sequence: 6 },
  ];
  ok(
    postTerminalHumanSignalsAreLegal() === true,
    "Human Edit after terminal is legal",
  );
  ok(
    terminalInvariant(timeline).extraTerminal === false,
    "single terminal + post-terminal human is not invariant violation",
  );
  ok(
    terminalInvariant([
      ...timeline,
      { eventType: "TASK_FAILED", sequence: 7 },
    ]).extraTerminal === true,
    "second logical terminal is invariant diagnostic",
  );

  const safe = timelineSafeSummary({
    prompt: "full prompt text",
    completion: "full model output",
    args: { secret: 1 },
    toolName: "draft",
    model: "gpt",
    errorCode: "MODEL_FAILED",
  });
  ok(
    safe != null &&
      !("prompt" in safe) &&
      !("completion" in safe) &&
      !("args" in safe) &&
      safe.toolName === "draft" &&
      safe.errorCode === "MODEL_FAILED",
    "timeline summary keeps tool/model/error, drops prompt/args",
  );

  const leakyScan = scanObserveResponse({
    successRate: 0.5,
    negativeFeedback: 6,
    prompt: "Bearer secret-token-value",
  });
  ok(
    leakyScan.ok === false && leakyScan.scoreKeys.includes("successRate"),
    "privacy scanner catches successRate",
  );
  ok(
    leakyScan.needles.some((n) => n.includes("Bearer")),
    "privacy scanner catches credential needle",
  );

  const prevEnabled = process.env.AUTOPILOT_ENABLED;
  const prevOwners = process.env.AUTOPILOT_OWNER_USER_IDS;
  const prevCapture = process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED;
  const prevProcessor = process.env.AUTOPILOT_PROCESSOR_ENABLED;
  process.env.AUTOPILOT_ENABLED = "1";
  process.env.AUTOPILOT_OWNER_USER_IDS = "lucas_canonical_id";
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "0";
  process.env.AUTOPILOT_PROCESSOR_ENABLED = "0";

  const owner = { id: "lucas_canonical_id", role: "user" };
  const other = { id: "business_user", role: "admin" };

  resetAutopilotTableQueryCount();
  const darkOverview = await getAutopilotOverview(owner, "org_1");
  ok(darkOverview.observeState === "NOT_ACTIVE", "Lucas dark overview NOT_ACTIVE");
  ok(darkOverview.mode === "DARK", "dark mode DARK");
  ok(
    !JSON.stringify(darkOverview).includes("successRate"),
    "overview API has no successRate field",
  );
  ok(
    !JSON.stringify(darkOverview).includes("negativeFeedback"),
    "overview API has no negativeFeedback",
  );
  ok(
    getAutopilotTableQueryCount() === 0,
    "dark overview AUTOPILOT_DB_QUERY_COUNT = 0",
  );
  const darkScan = scanObserveResponse(darkOverview);
  ok(darkScan.scoreKeys.length === 0, "dark overview has no score keys");

  resetAutopilotTableQueryCount();
  const darkRuns = await listAutopilotRuns(owner, "org_1");
  ok(
    darkRuns.observeState === "NOT_ACTIVE" && darkRuns.items.length === 0,
    "dark runs list is inactive empty",
  );
  ok(getAutopilotTableQueryCount() === 0, "dark runs AUTOPILOT_DB_QUERY_COUNT = 0");

  resetAutopilotTableQueryCount();
  const darkDetail = await getAutopilotRun(owner, "org_1", "run_missing");
  ok(
    darkDetail != null &&
      "observeState" in darkDetail &&
      darkDetail.observeState === "NOT_ACTIVE",
    "dark run detail is inactive, not a leaked 404",
  );
  ok(
    getAutopilotTableQueryCount() === 0,
    "dark run detail AUTOPILOT_DB_QUERY_COUNT = 0",
  );

  try {
    await getAutopilotOverview(other, "org_1");
    ok(false, "non-Lucas overview denied");
  } catch (error) {
    ok(error instanceof AutopilotAccessError, "non-Lucas authorized user → 403");
  }

  try {
    await listAutopilotRuns({ id: "", role: "user" }, "org_1");
    ok(false, "anonymous overview denied");
  } catch (error) {
    ok(
      error instanceof AutopilotAccessError && error.httpStatus === 401,
      "anonymous → unauthorized",
    );
  }

  if (prevEnabled === undefined) delete process.env.AUTOPILOT_ENABLED;
  else process.env.AUTOPILOT_ENABLED = prevEnabled;
  if (prevOwners === undefined) delete process.env.AUTOPILOT_OWNER_USER_IDS;
  else process.env.AUTOPILOT_OWNER_USER_IDS = prevOwners;
  if (prevCapture === undefined) {
    delete process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED;
  } else {
    process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = prevCapture;
  }
  if (prevProcessor === undefined) delete process.env.AUTOPILOT_PROCESSOR_ENABLED;
  else process.env.AUTOPILOT_PROCESSOR_ENABLED = prevProcessor;

  const root = process.cwd();
  const overviewUi = readFileSync(
    join(root, "src/app/(main)/ai/autopilot/page.tsx"),
    "utf8",
  );
  ok(!/successRate/i.test(overviewUi), "Overview UI has no Success Rate");
  ok(
    !/retry run|cancel run|optimize|deploy/i.test(overviewUi),
    "Overview has no write actions",
  );
  ok(
    !/AI Judge|Evaluator Agent|hallucination/i.test(overviewUi),
    "Overview has no AI Judge",
  );

  const runsUi = readFileSync(
    join(root, "src/app/(main)/ai/autopilot/runs/page.tsx"),
    "utf8",
  );
  ok(!/userId|Employee/.test(runsUi), "Runs table does not show employee/userId");
  ok(
    /EDIT /.test(runsUi) && /OVERRIDE /.test(runsUi),
    "Runs show human signal badges",
  );

  const nav = readFileSync(join(root, "src/lib/navigation/registry.ts"), "utf8");
  ok(!/autopilot\/evaluations/.test(nav), "no Evaluations nav");
  ok(!/autopilot\/issues/.test(nav), "no Issues nav");
  ok(!/autopilot\/optimizations/.test(nav), "no Optimizations nav");

  const telemetryHealth = readFileSync(
    join(root, "src/lib/autopilot/telemetry-health.ts"),
    "utf8",
  );
  ok(
    telemetryHealth.includes("isObserveTelemetryReadEnabled") &&
      telemetryHealth.indexOf("isObserveTelemetryReadEnabled") <
        telemetryHealth.indexOf("db.autopilotTelemetryOutbox"),
    "telemetry-health short-circuits before Autopilot table query",
  );
  ok(
    !/code === ["']P2021["']/.test(telemetryHealth),
    "telemetry-health does not catch P2021 as safety",
  );

  const coverageHealth = readFileSync(
    join(root, "src/lib/autopilot/coverage-health.ts"),
    "utf8",
  );
  ok(
    coverageHealth.includes("isObserveTelemetryReadEnabled") &&
      !coverageHealth.includes("P2021"),
    "coverage-health gates before Autopilot tables, no P2021 catch",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
