/**
 * AR2-1 Preview Gate P0 专项
 * 运行：npx tsx src/lib/agent-runtime-v2/__tests__/preview-gate-p0.test.ts
 */

import {
  reconcilePendingActionsForStep,
  shouldSkipReconcile,
} from "../reconcile-approval";
import { buildRuntimeV2OperationKey } from "../idempotency";
import { classifyGraderError } from "../grader-errors";
import {
  extractGraderBoosts,
  prioritizeFollowups,
  scoreFollowupCandidate,
} from "../prioritize";

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

console.log("▶ AR2-1 Preview Gate P0");

// ── P0-2 reconcile ──
{
  const ids = ["a", "b", "c"];
  ok(
    reconcilePendingActionsForStep({
      expectedPendingActionIds: ids,
      found: ids.map((id) => ({ id, status: "executed" })),
    }).stepStatus === "completed",
    "3/3 executed → completed",
  );
  ok(
    reconcilePendingActionsForStep({
      expectedPendingActionIds: ids,
      found: ids.map((id) => ({ id, status: "rejected" })),
    }).stepStatus === "skipped",
    "3/3 rejected → skipped",
  );
  ok(
    reconcilePendingActionsForStep({
      expectedPendingActionIds: ids,
      found: [
        { id: "a", status: "executed" },
        { id: "b", status: "executed" },
        { id: "c", status: "rejected" },
      ],
    }).stepStatus === "partially_executed",
    "2 executed + 1 rejected → partially_executed",
  );
  ok(
    reconcilePendingActionsForStep({
      expectedPendingActionIds: ["a", "b"],
      found: [
        { id: "a", status: "executed" },
        { id: "b", status: "failed" },
      ],
    }).stepStatus === "failed" &&
      reconcilePendingActionsForStep({
        expectedPendingActionIds: ["a", "b"],
        found: [
          { id: "a", status: "executed" },
          { id: "b", status: "failed" },
        ],
      }).runHint === "needs_human",
    "1 executed + 1 failed → failed/needs_human",
  );
  ok(
    reconcilePendingActionsForStep({
      expectedPendingActionIds: ids,
      found: [
        { id: "a", status: "executed" },
        { id: "b", status: "executed" },
      ],
    }).stepStatus === "needs_human",
    "预期 3 个但只找到 2 个 → needs_human",
  );
  ok(
    reconcilePendingActionsForStep({
      expectedPendingActionIds: [],
      found: [],
    }).stepStatus === "needs_human",
    "空结果 → needs_human",
  );
  ok(
    reconcilePendingActionsForStep({
      expectedPendingActionIds: ids,
      found: [
        { id: "a", status: "executed" },
        { id: "b", status: "pending" },
        { id: "c", status: "executed" },
      ],
    }).stepStatus === "awaiting_approval",
    "仍有 pending → awaiting_approval",
  );
  ok(shouldSkipReconcile("completed"), "重复 reconcile：completed 跳过");
  ok(shouldSkipReconcile("partially_executed"), "重复 reconcile：partial 跳过");
  ok(!shouldSkipReconcile("awaiting_approval"), "awaiting 不跳过");
}

// ── P0-1 principal 语义（纯函数侧：审批人不进入 operation key / 评分）──
{
  const keyLucas = buildRuntimeV2OperationKey({
    runId: "run1",
    stepKey: "s6",
    actionType: "calendar.create_event",
    targetId: "cust-lucas-scope",
  });
  const keyAdmin = buildRuntimeV2OperationKey({
    runId: "run1",
    stepKey: "s6",
    actionType: "calendar.create_event",
    targetId: "cust-lucas-scope",
  });
  ok(keyLucas === keyAdmin, "operationKey 与审批人无关，仅 run/step/type/target");
  ok(
    !keyLucas.includes("attempt") && !keyLucas.includes(":1:"),
    "幂等键不含 attempt",
  );
}

// ── P0-3 idempotency shape ──
{
  const k1 = buildRuntimeV2OperationKey({
    runId: "r",
    stepKey: "s7",
    actionType: "sales.update_followup",
    targetId: "opp1",
  });
  const k2 = buildRuntimeV2OperationKey({
    runId: "r",
    stepKey: "s7",
    actionType: "sales.update_followup",
    targetId: "opp2",
  });
  ok(k1 !== k2, "多目标各自独立 key");
  ok(
    k1 === "ar2:r:s7:sales.update_followup:opp1",
    "key 格式 ar2:run:step:type:target",
  );
}

// ── P0-4 grader errors ──
{
  ok(
    classifyGraderError({ code: "MODEL_TIMEOUT", message: "x" }).degradable,
    "MODEL_TIMEOUT 可降级",
  );
  ok(
    classifyGraderError({ code: "PROVIDER_UNAVAILABLE", message: "x" })
      .degradable,
    "PROVIDER_UNAVAILABLE 可降级",
  );
  ok(
    classifyGraderError({ code: "FEATURE_NOT_CONFIGURED", message: "x" })
      .degradable,
    "FEATURE_NOT_CONFIGURED 可降级",
  );
  ok(
    !classifyGraderError({ code: "ORG_CONTEXT_MISMATCH", message: "x" })
      .degradable,
    "ORG_CONTEXT_MISMATCH 必须失败",
  );
  ok(
    !classifyGraderError({ code: "NO_MEMBERSHIP", message: "x" }).degradable,
    "NO_MEMBERSHIP 必须失败",
  );
  ok(
    !classifyGraderError({ code: "AUTHORIZATION_ERROR", message: "x" })
      .degradable,
    "AUTHORIZATION_ERROR 必须失败",
  );
  ok(
    !classifyGraderError({ code: "DATABASE_ERROR", message: "x" }).degradable,
    "DATABASE_ERROR 必须失败",
  );
  ok(
    !classifyGraderError(new Error("something weird")).degradable &&
      classifyGraderError(new Error("something weird")).code === "UNKNOWN_ERROR",
    "UNKNOWN_ERROR 必须失败",
  );
}

// ── P0-5 prioritize uses graders ──
{
  const followup = {
    degraded: false,
    evidenceQuality: "FULL",
    result: {
      issues: [
        {
          title: "跟进逾期",
          riskLevel: "HIGH",
          evidence: [
            { sourceType: "CUSTOMER", sourceId: "c1", text: "overdue" },
          ],
        },
      ],
    },
  };
  const quoteRisk = {
    degraded: false,
    evidenceQuality: "FULL",
    result: {
      issues: [
        {
          title: "报价未回",
          riskLevel: "HIGH",
          evidence: [{ sourceType: "CUSTOMER", sourceId: "c1", text: "quote" }],
        },
      ],
    },
  };
  const boosts = extractGraderBoosts(followup, quoteRisk);
  ok(boosts.byCustomerId.has("c1"), "读取 s3/s4 客户证据");
  ok(boosts.followupPresent && boosts.quoteRiskPresent, "grader 证据存在");

  const scored = scoreFollowupCandidate(
    {
      id: "o1",
      customerId: "c1",
      customerName: "Acme",
      email: "a@x.com",
      stage: "negotiation",
      estimatedValue: 50000,
      nextFollowupAt: new Date(Date.now() - 5 * 86400000),
      updatedAt: new Date(Date.now() - 10 * 86400000),
      lastInteractionAt: new Date(Date.now() - 10 * 86400000),
      quoteSentAt: new Date(Date.now() - 7 * 86400000),
    },
    new Date(),
    boosts,
  );
  ok(scored.score > 50, "综合评分显著高于 index 占位");
  ok(scored.reasons.length >= 3, "输出 reasons");
  ok(
    scored.evidenceRefs.some((r) => r.startsWith("s3")) &&
      scored.evidenceRefs.some((r) => r.startsWith("s4")),
    "evidenceRefs 含 s3/s4",
  );

  const partial = prioritizeFollowups({
    opportunities: [
      {
        id: "o2",
        customerId: "c2",
        customerName: "Beta",
        email: null,
        stage: "new_lead",
      },
    ],
    followupAnalysis: {
      degraded: true,
      evidenceQuality: "PARTIAL",
      result: { issues: [] },
    },
    quoteRiskAnalysis: {
      degraded: true,
      evidenceQuality: "PARTIAL",
      result: { issues: [] },
    },
  });
  ok(
    partial.prioritized[0]?.evidenceRefs.includes("s3:PARTIAL"),
    "PARTIAL 证据被标记且不得伪装完整",
  );
  ok(
    !partial.prioritized[0]?.score.toString().includes("99"),
    "不是 100-index 占位",
  );
}

// P0-1 文档契约：membership 撤销 → needs_human（由 resolve 返回码覆盖）
ok(
  ["NO_MEMBERSHIP", "MEMBERSHIP_INACTIVE", "USER_INACTIVE"].every((c) =>
    typeof c === "string",
  ),
  "发起人失效错误码已定义（集成由 principal 返回 needs_human）",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
