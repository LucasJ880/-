/**
 * Autopilot A2-P0 isolated Postgres E2E — Deterministic Evaluate.
 *
 * Guard-first：安全检查完成前不得 import @/lib/db。
 * 生产库 → HARD FAIL。未配置 URL / 未显式开启 E2E → skip (exit 0)。
 *
 * 运行（隔离库，禁止生产 URL）：
 *   NODE_ENV=test AUTOPILOT_A2P0_E2E=1 DATABASE_URL=... DIRECT_URL=... \
 *     npx tsx src/lib/autopilot/__tests__/evaluate-e2e.isolated.test.ts
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";
import { scanObserveResponse } from "../observe-privacy";
import {
  getAutopilotTableQueryCount,
  resetAutopilotTableQueryCount,
} from "../observe-read-gate";

function skip(reason: string): never {
  console.log(`⏭  跳过 Autopilot A2-P0 isolated E2E（${reason}）`);
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) {
  skip("未提供 DATABASE_URL");
}
if (process.env.NODE_ENV !== "test") {
  skip("需 NODE_ENV=test");
}
if (
  process.env.AUTOPILOT_A2P0_E2E !== "1" &&
  (process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated"
) {
  skip("需 AUTOPILOT_A2P0_E2E=1 或 DATABASE_ENVIRONMENT=isolated");
}

assertSafeTestDatabase({
  scriptName: "autopilot A2-P0 isolated postgres e2e",
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

async function main() {
  process.env.AUTOPILOT_ENABLED = "1";
  process.env.AUTOPILOT_TELEMETRY_CAPTURE_ENABLED = "1";
  process.env.AUTOPILOT_PROCESSOR_ENABLED = "1";

  const { db } = await import("@/lib/db");
  const { projectAutopilotNotice } = await import("../instrumentation");
  const { getAutopilotEvaluations } = await import("../service");
  const { AUTOPILOT_EVALUATOR_VERSION } = await import("../types");

  console.log("autopilot A2-P0 isolated Postgres E2E");

  const tag = `a2p0_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const actor = await db.user.create({
    data: { email: `a2p0_${tag}@example.test`, name: "A2P0 Actor" },
  });
  process.env.AUTOPILOT_OWNER_USER_IDS = actor.id;
  const owner = { id: actor.id, role: "user" };

  const org = await db.organization.create({
    data: {
      name: `A2P0 Org ${tag}`,
      code: `a2p0_${tag}`,
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
      name: `A2P0 Foreign ${tag}`,
      code: `a2p0_f_${tag}`,
      ownerId: actor.id,
      status: "active",
    },
  });
  const foreignSession = await db.agentSession.create({
    data: { orgId: foreignOrg.id, channel: "e2e", status: "active" },
  });

  async function seedRun(input: {
    status: string;
    errorCode?: string | null;
    org?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const startedAt = new Date();
    return db.agentRun.create({
      data: {
        orgId: input.org ?? orgId,
        sessionId: input.sessionId ?? session.id,
        runType: "conversation",
        status: input.status,
        errorCode: input.errorCode,
        metadata: input.metadata,
        startedAt,
        completedAt:
          input.status === "running" || input.status === "queued"
            ? null
            : startedAt,
        latencyMs: 80,
      },
    });
  }

  const darkEnv = {
    AUTOPILOT_ENABLED: "1",
    AUTOPILOT_OWNER_USER_IDS: actor.id,
  };
  resetAutopilotTableQueryCount();
  const dark = await getAutopilotEvaluations(owner, orgId, { env: darkEnv });
  ok(dark.evaluateState === "NOT_ACTIVE", "E2E dark evaluate NOT_ACTIVE");
  ok(getAutopilotTableQueryCount() === 0, "E2E dark evaluate queries 0 Autopilot tables");

  const completed = await seedRun({
    status: "completed",
    metadata: { agentId: "assistant", agentRole: "work", workDomain: "sales" },
  });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId,
    runId: completed.id,
  });

  const failed = await seedRun({
    status: "failed",
    errorCode: "tool_failed",
    metadata: { agentId: "assistant", workDomain: "sales" },
  });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId,
    runId: failed.id,
  });

  const cancelled = await seedRun({ status: "cancelled" });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId,
    runId: cancelled.id,
  });

  const overridden = await seedRun({ status: "completed" });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId,
    runId: overridden.id,
  });
  await projectAutopilotNotice({
    type: "event",
    orgId,
    runId: overridden.id,
    eventType: "human.override",
    sequence: 1,
    payload: { Authorization: "Bearer secret-token-value" },
  });

  const edited = await seedRun({ status: "completed" });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId,
    runId: edited.id,
  });
  await projectAutopilotNotice({
    type: "event",
    orgId,
    runId: edited.id,
    eventType: "human.edit",
    sequence: 1,
    payload: { original: "full prompt text for privacy" },
  });

  const foreign = await seedRun({
    status: "failed",
    errorCode: "tool_failed",
    org: foreignOrg.id,
    sessionId: foreignSession.id,
  });
  await projectAutopilotNotice({
    type: "run_terminal",
    orgId: foreignOrg.id,
    runId: foreign.id,
  });

  const envOn = {
    AUTOPILOT_ENABLED: "1",
    AUTOPILOT_OWNER_USER_IDS: actor.id,
    AUTOPILOT_TELEMETRY_CAPTURE_ENABLED: "1",
    AUTOPILOT_PROCESSOR_ENABLED: "1",
  };
  const listed = await getAutopilotEvaluations(owner, orgId, {
    env: envOn,
    range: "7d",
    limit: 50,
  });
  const scan = scanObserveResponse(listed);
  ok(scan.ok, "evaluations payload has no score keys / secret needles");
  ok(
    !("successRate" in listed) && !("taskSuccessRate" in listed),
    "evaluations payload has no success rate fields",
  );
  ok(listed.evaluateState === "ACTIVE", "evaluate active when capture/processor on");
  ok(listed.taskSuccessCount === 0, "taskSuccessCount stays 0");
  ok(listed.partialSuccessCount === 0, "partialSuccessCount stays 0");
  ok((listed.aiEvaluator ?? "DISABLED") === "DISABLED", "LLM evaluator still DISABLED");

  const byRun = new Map(listed.items.map((item) => [item.runId, item]));
  ok(byRun.get(completed.id)?.outcome === "UNKNOWN", "completed evaluates UNKNOWN");
  ok(byRun.get(completed.id)?.judged === false, "completed is not judged");
  ok(byRun.get(failed.id)?.outcome === "FAILURE", "failed evaluates FAILURE");
  ok(byRun.get(failed.id)?.failureType === "TOOL_FAILURE", "failed maps TOOL_FAILURE");
  ok(byRun.get(cancelled.id)?.outcome === "ABANDONED", "cancelled evaluates ABANDONED");
  ok(
    byRun.get(overridden.id)?.outcome === "HUMAN_OVERRIDE",
    "human.override evaluates HUMAN_OVERRIDE",
  );
  ok(
    byRun.get(overridden.id)?.failureType == null,
    "override does not invent HALLUCINATION/failureType",
  );
  ok(byRun.get(edited.id)?.outcome === "UNKNOWN", "human.edit stays UNKNOWN");
  ok(!byRun.has(foreign.id), "foreign org evaluation is not listed");

  const overlay = await db.autopilotRun.findUnique({
    where: { agentRunId: completed.id },
    select: { outcome: true, humanOverride: true },
  });
  ok(
    overlay?.outcome === "UNKNOWN",
    "Observe overlay outcome remains UNKNOWN for completed (not A2 persist)",
  );

  const evidence = await db.autopilotEvaluation.findUnique({
    where: {
      agentRunId_evaluatorVersion: {
        agentRunId: overridden.id,
        evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
      },
    },
    select: { evidence: true, outcome: true },
  });
  const evidenceJson = JSON.stringify(evidence?.evidence ?? {});
  ok(
    !evidenceJson.includes("Bearer secret-token-value"),
    "evaluation evidence does not store Authorization",
  );
  ok(evidence?.outcome === "HUMAN_OVERRIDE", "persisted override outcome");

  const editEvidence = await db.autopilotEvaluation.findUnique({
    where: {
      agentRunId_evaluatorVersion: {
        agentRunId: edited.id,
        evaluatorVersion: AUTOPILOT_EVALUATOR_VERSION,
      },
    },
    select: { evidence: true },
  });
  ok(
    !JSON.stringify(editEvidence?.evidence ?? {}).includes(
      "full prompt text for privacy",
    ),
    "evaluation evidence does not store prompt/output bodies",
  );

  const isolated = await getAutopilotEvaluations(owner, foreignOrg.id, {
    env: envOn,
    range: "7d",
  });
  ok(
    isolated.items.every((item) => item.runId === foreign.id) &&
      isolated.items.length >= 1,
    "foreign org query only sees foreign evaluation",
  );
  ok(
    !isolated.items.some((item) => item.runId === completed.id),
    "foreign org query does not leak home org",
  );

  const { persistLlmJudgeEvaluation } = await import("../evaluate-judge-persist");
  const { AUTOPILOT_LLM_EVALUATOR_VERSION } = await import("../types");
  const judgeEnv = {
    ...envOn,
    AUTOPILOT_LLM_JUDGE_ENABLED: "1",
  };

  await persistLlmJudgeEvaluation({
    orgId,
    agentRunId: completed.id,
    autopilotRunId: (await db.autopilotRun.findUnique({
      where: { agentRunId: completed.id },
      select: { id: true },
    }))!.id,
    status: "completed",
    env: judgeEnv,
    judge: {
      complete: async () =>
        JSON.stringify({
          outcome: "TASK_SUCCESS",
          failureType: null,
          confidence: "high",
          evidenceCode: "clean_completed_run",
          rationale: "structurally clean",
        }),
    },
  });

  const llmRow = await db.autopilotEvaluation.findUnique({
    where: {
      agentRunId_evaluatorVersion: {
        agentRunId: completed.id,
        evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
      },
    },
  });
  ok(llmRow?.outcome === "TASK_SUCCESS", "mock LLM Judge can assign TASK_SUCCESS");
  ok(llmRow?.judged === true, "accepted LLM Judge is judged");
  ok(
    !JSON.stringify(llmRow?.evidence ?? {}).includes("Bearer secret-token-value"),
    "LLM evidence has no Authorization",
  );

  let reuseCalls = 0;
  await persistLlmJudgeEvaluation({
    orgId,
    agentRunId: completed.id,
    autopilotRunId: (await db.autopilotRun.findUnique({
      where: { agentRunId: completed.id },
      select: { id: true },
    }))!.id,
    status: "completed",
    env: judgeEnv,
    judge: {
      complete: async () => {
        reuseCalls += 1;
        throw new Error("same packet must not re-call LLM");
      },
    },
  });
  const llmRowAfterReuse = await db.autopilotEvaluation.findUnique({
    where: {
      agentRunId_evaluatorVersion: {
        agentRunId: completed.id,
        evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
      },
    },
  });
  ok(reuseCalls === 0, "same structural packet skips a second LLM call");
  ok(
    llmRowAfterReuse?.outcome === "TASK_SUCCESS",
    "skipped reuse keeps accepted TASK_SUCCESS",
  );

  await persistLlmJudgeEvaluation({
    orgId,
    agentRunId: edited.id,
    autopilotRunId: (await db.autopilotRun.findUnique({
      where: { agentRunId: edited.id },
      select: { id: true },
    }))!.id,
    status: "completed",
    humanEdit: true,
    env: judgeEnv,
    judge: {
      complete: async () =>
        JSON.stringify({
          outcome: "FAILURE",
          failureType: "HALLUCINATION",
          confidence: "high",
          evidenceCode: "human_edit_after_output",
          rationale: "should not count",
        }),
    },
  });
  const llmEdit = await db.autopilotEvaluation.findUnique({
    where: {
      agentRunId_evaluatorVersion: {
        agentRunId: edited.id,
        evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
      },
    },
  });
  ok(
    llmEdit?.outcome === "UNKNOWN" &&
      llmEdit.ruleId === "LLM_JUDGE_REJECTED_SEMANTIC_FAILURE",
    "E2E rejects HALLUCINATION from human edit",
  );

  const listedWithLlm = await getAutopilotEvaluations(owner, orgId, {
    env: envOn,
    range: "7d",
    limit: 50,
  });
  const completedItem = listedWithLlm.items.find((item) => item.runId === completed.id);
  ok(completedItem?.llmOutcome === "TASK_SUCCESS", "list overlays LLM outcome");
  ok(
    (listedWithLlm.llmTaskSuccessCount ?? 0) >= 1,
    "LLM TASK_SUCCESS count is separate from deterministic success",
  );
  ok(listedWithLlm.llmJudge === "OFF", "list env without judge flag reports OFF");
  ok(scanObserveResponse(listedWithLlm).ok, "LLM overlay payload still privacy-clean");

  const noLlmOnFailed = await db.autopilotEvaluation.findUnique({
    where: {
      agentRunId_evaluatorVersion: {
        agentRunId: failed.id,
        evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
      },
    },
  });
  await persistLlmJudgeEvaluation({
    orgId,
    agentRunId: failed.id,
    autopilotRunId: (await db.autopilotRun.findUnique({
      where: { agentRunId: failed.id },
      select: { id: true },
    }))!.id,
    status: "failed",
    errorCode: "tool_failed",
    env: judgeEnv,
    judge: {
      complete: async () => {
        throw new Error("should not be called");
      },
    },
  });
  const stillNone = await db.autopilotEvaluation.findUnique({
    where: {
      agentRunId_evaluatorVersion: {
        agentRunId: failed.id,
        evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
      },
    },
  });
  ok(!noLlmOnFailed && !stillNone, "ineligible FAILURE does not call or persist LLM Judge");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
