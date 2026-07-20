/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/summary-degraded-knowledge.test.ts
 */
import { formatSummaryForUser, buildFinalSummary } from "../summarize";
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
  originalRequest: "获客",
  objective: "获客计划",
  resolvedContext: {},
  mode: "supervisor",
  plan: [
    {
      id: "1",
      order: 1,
      worker: "marketing",
      skillSlug: "marketing-product-context",
      objective: "上下文",
      input: {},
      dependsOn: [],
      status: "completed",
      mayCreatePendingAction: false,
      resultSummary: "基于品牌档案",
    },
  ],
  currentStepIndex: 0,
  observations: [],
  artifacts: [],
  pendingActionIds: [],
  status: "completed",
  stepCount: 1,
  replanCount: 0,
  skillCallCount: 1,
  maxSteps: limits.maxSteps,
  maxReplans: limits.maxReplans,
  maxSkillCalls: limits.maxSkillCalls,
  userVisibleTimeline: [],
  executedFingerprints: [],
  knowledgeRetrieval: {
    status: "unavailable",
    reason: "embedding 403",
    sourcesUsed: ["CRM", "项目", "结构化业务数据"],
  },
};

const text = formatSummaryForUser({
  ...state,
  finalSummary: buildFinalSummary(state),
});
expect(text.includes("企业知识库检索暂不可用"), "显式知识库降级说明");
expect(!/已综合企业知识库/.test(text), "不声称已综合知识库");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} summary-degraded-knowledge: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
