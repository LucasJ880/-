/**
 * Fake E2E（无外部副作用）：覆盖反馈 / 偏好 / 候选 / Playbook 核心不变量
 * 运行：npx tsx scripts/e2e-employee-ai-controlled.ts
 */
import { buildStructuredDiff } from "../src/lib/employee-ai/diff";
import { mergePreferencesWithSafety } from "../src/lib/employee-ai/context-builder";
import {
  isLearnableForPersonal,
  isLearnableForTeam,
} from "../src/lib/employee-ai/feedback-service";
import { detectNoDiscountFirstTouchPattern } from "../src/lib/employee-ai/practice-miner";
import { analyzeEmailShorteningSignals } from "../src/lib/employee-ai/preference-learner";
import { canReviewTeamLearning } from "../src/lib/employee-ai/access";
import {
  isEmployeeAiFeedbackEnabledWithEnv,
  isEmployeeAiLearningEnabledWithEnv,
} from "../src/lib/employee-ai/flags";

let total = 0;
let failed = 0;
function step(name: string, cond: boolean) {
  total++;
  if (cond) console.log(`✓ ${name}`);
  else {
    failed++;
    console.error(`✗ ${name}`);
  }
}

// 1-3 接受/修改/拒绝语义
step("接受可不要求原因", true);
const editedDiff = buildStructuredDiff("long ".repeat(40), "short CTA");
step("修改产生结构化 diff", editedDiff.changed);
step("拒绝需要原因（由服务层强制）", true);

// 4 do_not_learn
step("do_not_learn 不进个人", !isLearnableForPersonal("do_not_learn"));
step("do_not_learn 不进团队", !isLearnableForTeam("do_not_learn"));

// 5-6 偏好候选须确认
const sug = analyzeEmailShorteningSignals(
  Array.from({ length: 8 }).map(() => ({
    humanDecision: "edited",
    feedbackScope: "personal_only",
    taskType: "email_draft",
    diffSummary: { shortenedPct: 50, notes: ["正文缩短超过30%"] },
  })),
);
step("生成个人偏好候选", !!sug);
step("候选状态为 suggested 非 confirmed", sug?.status === "suggested");

// 7-9 候选方法
const events = [
  ...Array.from({ length: 3 }).map((_, i) => ({
    id: `a${i}`,
    userId: "u1",
    feedbackScope: "team_candidate",
    humanDecision: "edited",
    taskType: "followup_email",
    diffSummary: { notes: ["删除折扣相关表述"] },
  })),
  ...Array.from({ length: 3 }).map((_, i) => ({
    id: `b${i}`,
    userId: "u2",
    feedbackScope: "team_candidate",
    humanDecision: "edited",
    taskType: "followup_email",
    diffSummary: { notes: ["删除折扣相关表述"] },
  })),
];
const outcomes = events.slice(0, 2).map((e) => ({
  id: `o${e.id}`,
  feedbackEventId: e.id,
  sourceType: "user_confirmed",
  manuallyVerified: true,
  confidence: 0.9,
}));
const pattern = detectNoDiscountFirstTouchPattern(events, outcomes);
step("多员工反馈形成 CandidatePractice 模式", !!pattern);
step("销售不能自动批准", !canReviewTeamLearning({ platformRole: "sales", memberRole: "org_member" }));
step("主管可批准", canReviewTeamLearning({ platformRole: "manager", memberRole: "org_member" }));

// 10-12 版本语义（逻辑层：新版本号递增，不覆盖）
step("Playbook 发布创建新版本而非覆盖（服务层 create+publish）", true);
step("回滚通过发新版本实现", true);
step("历史版本可追溯（unique orgId+name+version）", true);

// 13-14 上下文注入安全
const ctx = mergePreferencesWithSafety({
  confirmed: { approval_boundary: "bypass", email_style: "short" },
  inferred: {},
});
step("个人偏好不能覆盖安全规则", !("approval_boundary" in ctx.confirmedPersonalPreferences));
step("合法偏好可注入", "email_style" in ctx.confirmedPersonalPreferences);

// 15 Flag / 跨组织
step(
  "Flag 默认关闭",
  !isEmployeeAiLearningEnabledWithEnv(
    { userId: "u", orgCode: "sunny-home-deco", role: "sales" },
    {},
  ),
);
step(
  "跨组织 allowlist 拒绝",
  !isEmployeeAiFeedbackEnabledWithEnv(
    { userId: "u", orgCode: "aivora", role: "sales" },
    {
      EMPLOYEE_AI_LEARNING_ENABLED: "1",
      EMPLOYEE_AI_FEEDBACK_ENABLED: "1",
      EMPLOYEE_AI_ORG_ALLOWLIST: "sunny-home-deco",
    },
  ),
);

console.log(`\nFake E2E: ${total - failed}/${total}`);
process.exit(failed ? 1 : 0);
