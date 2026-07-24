/**
 * Runtime V2 Workbench UI 契约
 * 运行：npx tsx src/lib/assistant/__tests__/runtime-v2-workbench-ui.test.ts
 */

import assert from "node:assert/strict";
import {
  countAwaitingApprovalSteps,
  extractPrioritizedCustomers,
  formatRuntimeV2ActionCounts,
  preferRuntimeV2Steps,
  runtimeV2StepStatusLabel,
  topReasons,
  trimDuplicatedRuntimeV2Body,
  RUNTIME_V2_STEP_STATUS_LABEL,
} from "@/lib/assistant/runtime-v2-ui";
import { attachRunsToAssistantMessages } from "@/lib/assistant/attach-runs";
import { assistantRunCardSummary } from "@/components/assistant/assistant-task-card";
import type { AssistantRunStatusDto } from "@/lib/assistant/run-status-types";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("runtime-v2-workbench-ui");

const EIGHT_STEPS = [
  { title: "理解目标", status: "completed", preferredTool: "planner" },
  { title: "拉取商机", status: "completed", preferredTool: "sales_list" },
  { title: "跟进分析", status: "completed", preferredTool: "grader_followup" },
  { title: "报价风险", status: "completed", preferredTool: "grader_quote" },
  {
    title: "选出最多 3 个优先客户",
    status: "completed",
    preferredTool: "prioritize",
    stepKey: "s5_prioritize",
  },
  {
    title: "创建跟进任务",
    status: "awaiting_approval",
    preferredTool: "calendar.create_event",
    requiresApproval: true,
    attemptCount: 1,
  },
  {
    title: "调整跟进日期",
    status: "pending",
    preferredTool: "sales.update_followup",
    requiresApproval: true,
  },
  {
    title: "准备邮件草稿",
    status: "pending",
    preferredTool: "gmail_create_draft",
    requiresApproval: true,
  },
];

ok(
  "8 个状态均有用户文案",
  Object.keys(RUNTIME_V2_STEP_STATUS_LABEL).length >= 9 &&
    runtimeV2StepStatusLabel("awaiting_approval") === "等待确认" &&
    runtimeV2StepStatusLabel("partially_executed") === "部分完成" &&
    runtimeV2StepStatusLabel("pending") === "等待前序步骤",
);

ok(
  "preferRuntimeV2Steps：有 V2 steps 时优先",
  preferRuntimeV2Steps({
    runtimeVersion: "v2",
    runtimeSteps: EIGHT_STEPS,
  }) &&
    !preferRuntimeV2Steps({
      runtimeVersion: "v2",
      runtimeSteps: [],
    }) &&
    !preferRuntimeV2Steps({
      runtimeVersion: null,
      runtimeSteps: EIGHT_STEPS,
    }),
);

ok(
  "Legacy Task 不覆盖 V2：有 runtimeSteps 时不计 Legacy 步数",
  preferRuntimeV2Steps({ runtimeVersion: "v2", runtimeSteps: EIGHT_STEPS }) &&
    EIGHT_STEPS.length === 8,
);

ok(
  "awaiting_approval 步骤计数",
  countAwaitingApprovalSteps(EIGHT_STEPS) === 1,
);

ok(
  "数量文案含步骤与 PendingAction",
  formatRuntimeV2ActionCounts({
    awaitingApprovalSteps: 1,
    pendingActions: 3,
    executedActions: 0,
    rejectedActions: 0,
    failedActions: 0,
  }).includes("等待确认 1 个步骤，共 3 个待确认动作") &&
    formatRuntimeV2ActionCounts({
      awaitingApprovalSteps: 1,
      pendingActions: 3,
      executedActions: 2,
      rejectedActions: 1,
      failedActions: 0,
    }).includes("已执行 2") &&
    formatRuntimeV2ActionCounts({
      awaitingApprovalSteps: 1,
      pendingActions: 3,
      executedActions: 2,
      rejectedActions: 1,
      failedActions: 0,
    }).includes("已拒绝 1"),
);

const prioritized = extractPrioritizedCustomers({
  prioritized: [
    {
      customerName: "A",
      score: 88,
      reasons: ["r1", "r2", "r3", "r4"],
      evidenceRefs: ["s3:x", "s4:y"],
    },
    {
      customerName: "B",
      score: 70,
      reasons: ["only"],
      evidenceRefs: [],
    },
    {
      customerName: "C",
      score: 60,
      reason: "legacy",
      evidenceRefs: ["s2:1"],
    },
  ],
});

ok(
  "priority 含 score/reasons/evidenceRefs，reasons 最多 3",
  prioritized.length === 3 &&
    prioritized[0].score === 88 &&
    topReasons(prioritized[0].reasons, 3).length === 3 &&
    prioritized[0].evidenceRefs.includes("s3:x") &&
    prioritized[2].reasons[0] === "legacy",
);

ok(
  "正文去重去掉等待确认重复句",
  trimDuplicatedRuntimeV2Body(
    "分析结论\n\n写操作：等待确认 1，已执行 0，跳过 0\n\n上述动作正在等待确认。确认后我会验证。\n",
    { hasRuntimeCard: true, hasApprovalCards: true },
  ).includes("分析结论") &&
    !trimDuplicatedRuntimeV2Body(
      "分析结论\n\n写操作：等待确认 1，已执行 0，跳过 0\n",
      { hasRuntimeCard: true, hasApprovalCards: true },
    ).includes("写操作：等待确认"),
);

const runDto: AssistantRunStatusDto = {
  runId: "run_1",
  conversationId: "thread_1",
  organizationId: "org_1",
  initiatedByPrincipalId: "user_1",
  userMessageId: "um_1",
  assistantMessageId: "am_1",
  pendingActionIds: ["pa1", "pa2", "pa3"],
  status: "waiting_for_confirmation",
  intent: "sales_followup_triage",
  currentStep: null,
  errorCode: null,
  resultSummary: null,
  startedAt: null,
  updatedAt: new Date().toISOString(),
  completedAt: null,
  runtimeVersion: "v2",
  runtimeSteps: EIGHT_STEPS,
  awaitingApprovalStepCount: 1,
  actionSummary: {
    total: 3,
    pending: 3,
    approved: 0,
    executed: 0,
    rejected: 0,
    failed: 0,
    expired: 0,
  },
  prioritizedCustomers: prioritized,
};

ok(
  "任务卡 summary 不为「等待确认 1」单字段",
  (() => {
    const s = assistantRunCardSummary(runDto);
    return (
      !!s &&
      s.includes("等待确认 1 个步骤") &&
      s.includes("共 3 个待确认动作") &&
      s !== "等待确认 1"
    );
  })(),
);

ok(
  "刷新挂载：assistantMessageId 精确关联",
  (() => {
    const msgs = attachRunsToAssistantMessages(
      [
        { id: "am_1", role: "assistant", content: "x" },
        { id: "am_other", role: "assistant", content: "y" },
      ],
      [runDto],
    );
    return (
      msgs[0].assistantRun?.runId === "run_1" &&
      msgs[1].assistantRun === undefined
    );
  })(),
);

ok(
  "刷新挂载：workSuggestion.runId 回退",
  (() => {
    const msgs = attachRunsToAssistantMessages(
      [
        {
          id: "am_orphan",
          role: "assistant",
          content: "x",
          workSuggestion: { runId: "run_1", runtimeVersion: "v2" },
        },
      ],
      [{ ...runDto, assistantMessageId: null }],
    );
    return msgs[0].assistantRun?.runId === "run_1";
  })(),
);

ok(
  "375px 约定：步骤列表可换行（契约：不强制 truncate 优先客户原因）",
  topReasons(["很长的原因文案用于移动端换行展示测试"], 3).length === 1,
);

console.log(`结果: ${passed} passed`);
