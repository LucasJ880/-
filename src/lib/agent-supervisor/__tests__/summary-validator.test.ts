/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/summary-validator.test.ts
 */
import { validateSupervisorSummary } from "../summary-validator";
import { buildFinalSummary } from "../summarize";
import type { SupervisorState } from "../types";
import { getSupervisorLimits } from "../config";

let total = 0;
let failed = 0;
function expect(c: boolean, m: string) {
  total++;
  if (c) console.log(`✓ ${m}`);
  else {
    failed++;
    console.error(`✗ ${m}`);
  }
}

const limits = getSupervisorLimits();
const state: SupervisorState = {
  sessionId: "s",
  runId: "r",
  orgId: "o",
  userId: "u",
  originalRequest: "分析销售",
  objective: "分析销售",
  resolvedContext: {},
  mode: "supervisor",
  plan: [
    {
      id: "step-1",
      order: 1,
      worker: "sales",
      skillSlug: "sales-pipeline-forecast",
      objective: "管道",
      input: {},
      dependsOn: [],
      status: "completed",
      mayCreatePendingAction: false,
      resultSummary: "有一笔 At Risk 机会",
    },
  ],
  currentStepIndex: 0,
  observations: [],
  artifacts: [],
  pendingActionIds: ["pa1"],
  status: "waiting_for_approval",
  stepCount: 1,
  replanCount: 0,
  skillCallCount: 1,
  maxSteps: limits.maxSteps,
  maxReplans: limits.maxReplans,
  maxSkillCalls: limits.maxSkillCalls,
  userVisibleTimeline: [],
  executedFingerprints: [],
};

const det = buildFinalSummary(state);
expect(!!det.executiveConclusion || !!det.managementSummary, "确定性摘要有结论");
expect(!/^\s*\{/.test(det.managementSummary), "结论不是原始 JSON");

const v = validateSupervisorSummary(
  {
    executiveConclusion: "应优先跟进。",
    keyFindings: [{ finding: "有逾期", evidence: [], confidence: "medium" }],
    recommendedActions: [
      {
        priority: 1,
        action: "已发送邮件给客户",
        reason: "跟进",
        approvalRequired: false,
        pendingActionId: null,
      },
    ],
    pendingApprovals: ["pa1"],
    preparedItems: [],
    missingInformation: [],
    risks: [],
    completedSteps: ["管道"],
    skippedOrFailedSteps: [],
    nextReviewSuggestion: "",
    limitations: [],
  },
  state,
);
expect(!v.ok, "禁止「已发送」用语");

const slugBad = validateSupervisorSummary(
  {
    executiveConclusion: "继续。",
    keyFindings: [],
    recommendedActions: [
      {
        priority: 1,
        action: "运行 sales-next-best-action",
        reason: "",
        approvalRequired: false,
        pendingActionId: null,
      },
    ],
    pendingApprovals: [],
    preparedItems: [],
    missingInformation: [],
    risks: [],
    completedSteps: [],
    skippedOrFailedSteps: [],
    nextReviewSuggestion: "",
    limitations: [],
  },
  { ...state, pendingActionIds: [] },
);
expect(!slugBad.ok, "禁止 slug 出现在动作标题");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} summary-validator: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
