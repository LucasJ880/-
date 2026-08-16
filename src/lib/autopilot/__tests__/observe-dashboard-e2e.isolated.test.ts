/**
 * Autopilot A1-P3 isolated Postgres E2E — Observe Dashboard.
 *
 * Guard-first：安全检查完成前不得 import @/lib/db。
 * 生产库 → HARD FAIL。未配置 URL / 未显式开启 E2E → skip (exit 0)。
 *
 * 运行（隔离库，禁止生产 URL）：
 *   NODE_ENV=test AUTOPILOT_A1P3_E2E=1 DATABASE_URL=... DIRECT_URL=... \
 *     npx tsx src/lib/autopilot/__tests__/observe-dashboard-e2e.isolated.test.ts
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";
import { scanObserveResponse } from "../observe-privacy";
import {
  getAutopilotTableQueryCount,
  resetAutopilotTableQueryCount,
} from "../observe-read-gate";
import { parseObserveCursor } from "../observe-range";

function skip(reason: string): never {
  console.log(`⏭  跳过 Autopilot A1-P3 isolated E2E（${reason}）`);
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) {
  skip("未提供 DATABASE_URL");
}
if (process.env.NODE_ENV !== "test") {
  skip("需 NODE_ENV=test");
}
if (
  process.env.AUTOPILOT_A1P3_E2E !== "1" &&
  (process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated"
) {
  skip("需 AUTOPILOT_A1P3_E2E=1 或 DATABASE_ENVIRONMENT=isolated");
}

assertSafeTestDatabase({
  scriptName: "autopilot A1-P3 isolated postgres e2e",
});

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

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

const SECRET_NEEDLES = [
  "Bearer secret-token-value",
  "Dear customer, here is the quote.",
  "full prompt text for privacy",
  "qy_session=abc",
  "hunter2-password",
];

async function main() {
  process.env.AUTOPILOT_ENABLED = "1";
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "1";
  process.env.AUTOPILOT_PROCESSOR_ENABLED = "1";

  const { db } = await import("@/lib/db");
  const { appendAgentRunEvent } = await import("@/lib/agent-runtime/run");
  const {
    getAutopilotOverview,
    getAutopilotRun,
    listAutopilotRuns,
  } = await import("../service");

  console.log("autopilot A1-P3 isolated Postgres E2E");

  const tag = `a1p3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const actor = await db.user.create({
    data: { email: `a1p3_${tag}@example.test`, name: "A1P3 Actor" },
  });
  process.env.AUTOPILOT_OWNER_USER_IDS = actor.id;
  const owner = { id: actor.id, role: "user" };

  const org = await db.organization.create({
    data: {
      name: `A1P3 Org ${tag}`,
      code: `a1p3_${tag}`,
      ownerId: actor.id,
      status: "active",
    },
  });
  const orgId = org.id;
  await db.organizationMember.create({
    data: { orgId, userId: actor.id, role: "org_member", status: "active" },
  });
  const session = await db.agentSession.create({
    data: { orgId, channel: "e2e", status: "active" },
  });

  const foreignOrg = await db.organization.create({
    data: {
      name: `A1P3 Foreign ${tag}`,
      code: `a1p3_f_${tag}`,
      ownerId: actor.id,
      status: "active",
    },
  });
  const foreignSession = await db.agentSession.create({
    data: { orgId: foreignOrg.id, channel: "e2e", status: "active" },
  });

  const startedAt = new Date(Date.now() - 60_000);
  async function seedRun(input: {
    status: string;
    startedAt?: Date;
    org?: string;
    sessionId?: string;
  }) {
    return db.agentRun.create({
      data: {
        orgId: input.org ?? orgId,
        sessionId: input.sessionId ?? session.id,
        runType: "conversation",
        status: input.status,
        startedAt: input.startedAt ?? startedAt,
        completedAt:
          input.status === "running" || input.status === "queued"
            ? null
            : startedAt,
        latencyMs: 120,
      },
    });
  }

  async function addEvent(
    runId: string,
    sequence: number,
    eventType: string,
    payload?: Record<string, unknown>,
    eventOrgId = orgId,
  ) {
    return db.agentRunEvent.create({
      data: {
        orgId: eventOrgId,
        runId,
        sequence,
        eventType,
        title: eventType,
        payload: payload ?? {},
      },
    });
  }

  // ── Scenario A — Overview metrics ──
  for (let i = 0; i < 2; i++) await seedRun({ status: "completed" });
  for (let i = 0; i < 2; i++) await seedRun({ status: "failed" });
  await seedRun({ status: "cancelled" });

  const signalRun = await seedRun({ status: "completed" });
  await addEvent(signalRun.id, 1, "human.edit");
  await addEvent(signalRun.id, 2, "human.edit");
  await addEvent(signalRun.id, 3, "human.override");
  await addEvent(signalRun.id, 4, "human.reask");
  await addEvent(signalRun.id, 5, "human.reask");
  await addEvent(signalRun.id, 6, "human.reask");

  const overviewA = await getAutopilotOverview(owner, orgId, {
    range: "7d",
  });
  ok(overviewA.active === true, "A: overview active");
  ok("completedRuns" in overviewA && overviewA.completedRuns === 3, "A: completedRuns = 3", overviewA);
  ok("failedRuns" in overviewA && overviewA.failedRuns === 2, "A: failedRuns = 2", overviewA);
  ok("cancelledRuns" in overviewA && overviewA.cancelledRuns === 1, "A: cancelledRuns = 1", overviewA);
  ok("humanEditCount" in overviewA && overviewA.humanEditCount === 2, "A: Human Edit = 2", overviewA);
  ok("humanOverrideCount" in overviewA && overviewA.humanOverrideCount === 1, "A: Human Override = 1", overviewA);
  ok("reAskCount" in overviewA && overviewA.reAskCount === 3, "A: Re-Ask = 3", overviewA);
  ok(
    !JSON.stringify(overviewA).includes("successRate"),
    "A: no successRate field",
  );
  ok(
    !JSON.stringify(overviewA).includes("negativeFeedback"),
    "A: no negativeFeedback",
  );
  const overviewScan = scanObserveResponse(overviewA);
  ok(overviewScan.scoreKeys.length === 0, "A: no quality score keys");

  // ── Scenario B — Run detail + post-terminal human ──
  const runB = await seedRun({ status: "completed" });
  await addEvent(runB.id, 1, "run.started");
  await addEvent(runB.id, 2, "model.started", { modelCallId: "m1", model: "test" });
  await addEvent(runB.id, 3, "model.completed", { modelCallId: "m1" });
  await addEvent(runB.id, 4, "agent.output", { hash: "h", bytes: 4 });
  await addEvent(runB.id, 5, "run.completed");
  await addEvent(runB.id, 6, "human.edit", {
    prompt: "full prompt text for privacy",
    completion: "Dear customer, here is the quote.",
    Authorization: "Bearer secret-token-value",
    Cookie: "qy_session=abc",
    password: "hunter2-password",
    sourceAgentRunId: runB.id,
  });
  const detailB = await getAutopilotRun(owner, orgId, runB.id);
  ok(detailB != null && "events" in detailB, "B: run detail loaded");
  if (detailB && "events" in detailB) {
    const types = detailB.events.map((e) => e.eventType);
    ok(
      types.join(">") ===
        "USER_INPUT>MODEL_STARTED>MODEL_COMPLETED>AGENT_OUTPUT>TASK_COMPLETED>HUMAN_EDIT",
      "B: sequence order",
      types,
    );
    ok(
      detailB.diagnostics.postTerminalHumanSignals === 1,
      "B: post-terminal Human Edit counted as legal",
    );
    ok(detailB.diagnostics.extraTerminal === false, "B: no extra terminal");
    const raw = JSON.stringify(detailB);
    ok(
      SECRET_NEEDLES.every((n) => !raw.includes(n)),
      "B/F: privacy needles absent from run detail",
    );
    ok(!raw.includes("successRate"), "B: no successRate");
  }

  const runTerminal = await seedRun({ status: "completed" });
  await addEvent(runTerminal.id, 1, "run.completed");
  await addEvent(runTerminal.id, 2, "run.failed");
  const detailTerm = await getAutopilotRun(owner, orgId, runTerminal.id);
  ok(
    detailTerm != null &&
      "diagnostics" in detailTerm &&
      detailTerm.diagnostics.extraTerminal === true,
    "B: second terminal is diagnostic, page does not crash",
  );

  // ── Scenario C — projection gap → DEGRADED ──
  const runC = await seedRun({ status: "completed" });
  await appendAgentRunEvent({
    orgId,
    runId: runC.id,
    eventType: "run.started",
    title: "run.started",
  });
  const overviewC = await getAutopilotOverview(owner, orgId, {
    range: "7d",
  });
  ok(
    overviewC.observeState === "DEGRADED" || (overviewC.projectionGap ?? 0) > 0,
    "C: projection gap observed / DEGRADED",
    { state: overviewC.observeState, gap: overviewC.projectionGap },
  );

  // ── Scenario D — capture on, empty org ──
  const emptyOrg = await db.organization.create({
    data: {
      name: `A1P3 Empty ${tag}`,
      code: `a1p3_e_${tag}`,
      ownerId: actor.id,
      status: "active",
    },
  });
  const overviewD = await getAutopilotOverview(owner, emptyOrg.id, {
    range: "7d",
  });
  ok(overviewD.active === true, "D: empty org still active observe");
  ok(overviewD.runsObserved === 0, "D: no observed runs");
  ok(overviewD.mode === "OBSERVE", "D: not interpreted as dark/off");

  // ── Scenario E — Dark mode, zero Autopilot table queries ──
  const darkEnv = {
    AUTOPILOT_ENABLED: "1",
    AUTOPILOT_OWNER_USER_IDS: actor.id,
    AUTOPILOT_TELEMETRY_CAPTURE_ENABLED: "0",
    AUTOPILOT_PROCESSOR_ENABLED: "0",
  };
  resetAutopilotTableQueryCount();
  const darkOverview = await getAutopilotOverview(owner, orgId, {
    range: "7d",
    env: darkEnv,
  });
  const darkRuns = await listAutopilotRuns(owner, orgId, { env: darkEnv });
  const darkDetail = await getAutopilotRun(owner, orgId, runB.id, {
    env: darkEnv,
  });
  ok(darkOverview.observeState === "NOT_ACTIVE", "E: overview NOT_ACTIVE");
  ok(darkRuns.observeState === "NOT_ACTIVE", "E: runs NOT_ACTIVE");
  ok(
    darkDetail != null &&
      "observeState" in darkDetail &&
      darkDetail.observeState === "NOT_ACTIVE",
    "E: run detail NOT_ACTIVE",
  );
  ok(
    getAutopilotTableQueryCount() === 0,
    "E: AUTOPILOT_DB_QUERY_COUNT = ZERO",
    getAutopilotTableQueryCount(),
  );

  // ── Cross-org ──
  const foreignRun = await seedRun({
    status: "completed",
    org: foreignOrg.id,
    sessionId: foreignSession.id,
  });
  const cross = await getAutopilotRun(owner, orgId, foreignRun.id);
  ok(cross === null, "cross-org runId → not found (no existence leak)");

  // ── Pagination: 120 runs, page size 25, stable cursor ──
  const pageOrg = await db.organization.create({
    data: {
      name: `A1P3 Page ${tag}`,
      code: `a1p3_p_${tag}`,
      ownerId: actor.id,
      status: "active",
    },
  });
  const pageSession = await db.agentSession.create({
    data: { orgId: pageOrg.id, channel: "e2e", status: "active" },
  });
  const tieTime = new Date(startedAt.getTime() - 1_000);
  const pageRows = Array.from({ length: 120 }, (_, i) => ({
    orgId: pageOrg.id,
    sessionId: pageSession.id,
    runType: "conversation",
    status: "completed",
    startedAt: i < 3 ? tieTime : new Date(startedAt.getTime() - i * 1000),
  }));
  await db.agentRun.createMany({ data: pageRows });

  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const page = await listAutopilotRuns(owner, pageOrg.id, {
      limit: 25,
      cursor: parseObserveCursor(cursor),
      range: "30d",
    });
    pages += 1;
    for (const item of page.items) {
      ok(!seen.has(item.runId), "pagination: no duplicate", item.runId);
      seen.add(item.runId);
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    if (pages > 10) break;
  }
  ok(seen.size === 120, `pagination: 120 unique runs, pages=${pages}`, seen.size);
  ok(pages === 5, "pagination: 120/25 = 5 pages", pages);

  // ── Performance: 500 runs LOCAL/ISOLATED ──
  const perfOrg = await db.organization.create({
    data: {
      name: `A1P3 Perf ${tag}`,
      code: `a1p3_pf_${tag}`,
      ownerId: actor.id,
      status: "active",
    },
  });
  const perfSession = await db.agentSession.create({
    data: { orgId: perfOrg.id, channel: "e2e", status: "active" },
  });
  await db.agentRun.createMany({
    data: Array.from({ length: 500 }, (_, i) => ({
      orgId: perfOrg.id,
      sessionId: perfSession.id,
      runType: "conversation",
      status: i % 10 === 0 ? "failed" : "completed",
      startedAt: new Date(startedAt.getTime() - i * 500),
    })),
  });
  const overviewSamples: number[] = [];
  const runsSamples: number[] = [];
  const detailSamples: number[] = [];
  const sampleRun = await db.agentRun.findFirst({
    where: { orgId: perfOrg.id },
    select: { id: true },
  });
  for (let i = 0; i < 5; i++) {
    let t0 = performance.now();
    await getAutopilotOverview(owner, perfOrg.id, { range: "30d" });
    overviewSamples.push(performance.now() - t0);
    t0 = performance.now();
    await listAutopilotRuns(owner, perfOrg.id, { limit: 25, range: "30d" });
    runsSamples.push(performance.now() - t0);
    t0 = performance.now();
    if (sampleRun) await getAutopilotRun(owner, perfOrg.id, sampleRun.id);
    detailSamples.push(performance.now() - t0);
  }
  const overviewP50 = Math.round(percentile(overviewSamples, 50));
  const overviewP95 = Math.round(percentile(overviewSamples, 95));
  const runsP50 = Math.round(percentile(runsSamples, 50));
  const runsP95 = Math.round(percentile(runsSamples, 95));
  const detailP50 = Math.round(percentile(detailSamples, 50));
  const detailP95 = Math.round(percentile(detailSamples, 95));
  console.log(
    `  performance LOCAL/ISOLATED NOT PRODUCTION dataset=500 AgentRuns overview_p50=${overviewP50}ms overview_p95=${overviewP95}ms runs_p50=${runsP50}ms runs_p95=${runsP95}ms detail_p50=${detailP50}ms detail_p95=${detailP95}ms`,
  );
  ok(overviewP95 < 30_000, "overview P95 < 30s (no unbounded scan)");
  ok(runsP95 < 30_000, "runs P95 < 30s");
  ok(detailP95 < 30_000, "run detail P95 < 30s");

  // ── Failed runs do not degrade observability on empty-event org ──
  const failedOrg = await db.organization.create({
    data: {
      name: `A1P3 Failed ${tag}`,
      code: `a1p3_fl_${tag}`,
      ownerId: actor.id,
      status: "active",
    },
  });
  const failedSession = await db.agentSession.create({
    data: { orgId: failedOrg.id, channel: "e2e", status: "active" },
  });
  await db.agentRun.createMany({
    data: Array.from({ length: 10 }, () => ({
      orgId: failedOrg.id,
      sessionId: failedSession.id,
      runType: "conversation",
      status: "failed",
      startedAt,
    })),
  });
  const overviewFailed = await getAutopilotOverview(owner, failedOrg.id, {
    range: "7d",
  });
  ok(overviewFailed.failedRuns === 10, "E-health: 10 TASK_FAILED / failed runs");
  ok(
    overviewFailed.observeState === "HEALTHY" ||
      overviewFailed.observeState === "UNKNOWN",
    "E-health: failed runs do not force observability DEGRADED",
    overviewFailed.observeState,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
