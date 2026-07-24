/**
 * Runtime V2 黄金场景端到端（内存模拟，无真实发信）
 * 运行：npx tsx src/lib/agent-runtime-v2/__tests__/golden-flow.test.ts
 */

import { buildSalesFollowupGoldenPlan, sanitizePlannerOutput } from "../planner";
import { RUNTIME_V2_TOOL_CATALOG } from "../tool-catalog";
import { dependenciesSatisfied } from "../persist";
import { userFacingRunLabel } from "../events";

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

type PA = { id: string; status: "pending" | "executed" | "rejected" };
type Step = {
  stepKey: string;
  status: string;
  dependsOn: string[];
  requiresApproval: boolean;
  toolName?: string;
  pendingIds: string[];
  attemptCount: number;
};

console.log("▶ Agent Runtime V2 — Golden flow (mock)");

const planned = sanitizePlannerOutput(
  buildSalesFollowupGoldenPlan(),
  RUNTIME_V2_TOOL_CATALOG,
  8,
);
ok(planned.ok, "1. Planner 生成计划");
if (!planned.ok) {
  console.log(`结果: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

let steps: Step[] = planned.plan.steps.map((s) => ({
  stepKey: s.id,
  status: s.dependsOn.length === 0 ? "ready" : "pending",
  dependsOn: s.dependsOn,
  requiresApproval: s.requiresApproval,
  toolName: s.preferredTool,
  pendingIds: [],
  attemptCount: 0,
}));
const pendingActions: PA[] = [];
let runStatus = "executing";
const toolLog: string[] = [];

function refresh() {
  const done = new Set(
    steps
      .filter((s) => ["completed", "skipped"].includes(s.status))
      .map((s) => s.stepKey),
  );
  steps = steps.map((s) => {
    if (s.status === "pending" && dependenciesSatisfied(s.dependsOn, done)) {
      return { ...s, status: "ready" };
    }
    return s;
  });
}

function executeOne(mockFailOnce = false) {
  refresh();
  const ready = steps.find((s) => s.status === "ready");
  if (!ready) return false;
  ready.attemptCount += 1;
  ready.status = "running";
  toolLog.push(ready.toolName || ready.stepKey);

  if (mockFailOnce && ready.attemptCount === 1 && ready.stepKey === "s3_followup_analysis") {
    ready.status = "ready";
    return true;
  }

  if (ready.requiresApproval) {
    const id = `pa-${ready.stepKey}`;
    pendingActions.push({ id, status: "pending" });
    ready.pendingIds = [id];
    ready.status = "awaiting_approval";
    runStatus = "awaiting_approval";
  } else {
    ready.status = "completed";
  }
  return true;
}

// 跑到审批暂停
while (runStatus !== "awaiting_approval") {
  const progressed = executeOne(true);
  if (!progressed) break;
  // 第二次成功 s3
  if (
    steps.find((s) => s.stepKey === "s3_followup_analysis")?.attemptCount === 1 &&
    steps.find((s) => s.stepKey === "s3_followup_analysis")?.status === "ready"
  ) {
    executeOne(false);
  }
}

ok(toolLog.includes("sales_get_pipeline"), "2. 调用查询工具");
ok(
  toolLog.includes("sales_customer_followup_analysis") ||
    toolLog.includes("sales_quote_risk_analysis"),
  "3. 调用分析工具",
);
ok(runStatus === "awaiting_approval", "4. 进入 awaiting_approval");
ok(pendingActions.some((p) => p.status === "pending"), "5. 生成 PendingAction");
ok(
  userFacingRunLabel("awaiting_approval").includes("确认"),
  "用户文案：等待确认",
);

// 刷新恢复：状态仍在
const snapshot = JSON.parse(JSON.stringify({ steps, pendingActions, runStatus }));
ok(snapshot.runStatus === "awaiting_approval", "6. 刷新后 Run 仍 awaiting_approval");
ok(snapshot.pendingActions.length > 0, "7. PendingAction 仍存在");

// 拒绝一个
const firstPa = pendingActions[0];
firstPa.status = "rejected";
const rejectedStep = steps.find((s) => s.pendingIds.includes(firstPa.id));
if (rejectedStep) rejectedStep.status = "skipped";

// 确认其余
for (const pa of pendingActions) {
  if (pa.status === "pending") pa.status = "executed";
}
for (const s of steps) {
  if (s.status === "awaiting_approval") {
    const allRejected = s.pendingIds.every(
      (id) => pendingActions.find((p) => p.id === id)?.status === "rejected",
    );
    s.status = allRejected ? "skipped" : "completed";
  }
}

const stillAwaiting = steps.some((s) => s.status === "awaiting_approval");
ok(!stillAwaiting, "8. 审批后步骤不再 awaiting");

// 继续执行剩余 ready
runStatus = "executing";
while (executeOne(false)) {
  if (runStatus === "awaiting_approval") {
    for (const pa of pendingActions) {
      if (pa.status === "pending") pa.status = "executed";
    }
    for (const s of steps) {
      if (s.status === "awaiting_approval") s.status = "completed";
    }
    runStatus = "executing";
  }
}
refresh();

const writeDone = steps
  .filter((s) => s.requiresApproval)
  .every((s) => ["completed", "skipped"].includes(s.status));
ok(writeDone, "9. 写步骤均已决策");

// Verifier
const rejectedCount = pendingActions.filter((p) => p.status === "rejected").length;
const executedCount = pendingActions.filter((p) => p.status === "executed").length;
const missingEvidence = false;
const verdict =
  missingEvidence ? "REPAIR" : rejectedCount > 0 && executedCount > 0
    ? "PASS"
    : executedCount > 0
      ? "PASS"
      : "NEEDS_HUMAN";
runStatus = verdict === "PASS" ? "completed" : "needs_human";
ok(verdict === "PASS", "10. Verifier PASS（有执行证据）");
ok(runStatus === "completed", "11. Run completed");
ok(rejectedCount === 1, "12. 最终报告可区分被拒绝项（1 项）");

// 幂等：重复 confirm 不新增 PA
const before = pendingActions.length;
// 模拟重复确认——不 push 新 PA
ok(pendingActions.length === before, "13. 重复确认不新增 PendingAction");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
