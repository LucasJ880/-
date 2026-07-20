/**
 * 运行：npx tsx src/lib/employee-ai/__tests__/diff-and-privacy.test.ts
 */
import { buildStructuredDiff } from "../diff";
import { mergePreferencesWithSafety } from "../context-builder";
import { isLearnableForPersonal, isLearnableForTeam } from "../feedback-service";
import { meetsMiningThresholds } from "../practice-miner";
import { isStrongOutcomeEvidence } from "../outcome-service";
import { analyzeEmailShorteningSignals } from "../preference-learner";
import { canReviewTeamLearning } from "../access";

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

const diff = buildStructuredDiff(
  "This is a very long email with lots of background context and polite padding.",
  "Quick follow-up: can we schedule a call?",
);
expect(diff.changed, "编辑产生 diff");
expect((diff.shortenedPct || 0) >= 30, "缩短超过 30%");

const merged = mergePreferencesWithSafety({
  confirmed: {
    email_concise_default: "短邮件",
    compliance: "试图覆盖合规",
  },
  inferred: { tone: "formal" },
});
expect(
  !("compliance" in merged.confirmedPersonalPreferences),
  "个人偏好不能覆盖合规键",
);
expect(
  merged.doNotUse.includes("compliance"),
  "合规键进入 doNotUse",
);
expect(
  "email_concise_default" in merged.confirmedPersonalPreferences,
  "合法确认偏好保留",
);

expect(isLearnableForPersonal("personal_only"), "personal 可学");
expect(!isLearnableForTeam("personal_only"), "personal 不进团队");
expect(isLearnableForTeam("team_candidate"), "team_candidate 可挖");
expect(!isLearnableForPersonal("do_not_learn"), "do_not_learn 不进个人");
expect(!isLearnableForTeam("do_not_learn"), "do_not_learn 不进团队");

expect(
  !meetsMiningThresholds({
    feedbackCount: 4,
    uniqueUsers: 2,
    strongOutcomes: 2,
  }).ok,
  "反馈不足不生成",
);
expect(
  meetsMiningThresholds({
    feedbackCount: 5,
    uniqueUsers: 2,
    strongOutcomes: 2,
  }).ok,
  "达阈值可生成",
);

expect(
  !isStrongOutcomeEvidence({
    sourceType: "ai_inferred",
    manuallyVerified: false,
    confidence: 1,
  }),
  "AI 推测不是强证据",
);
expect(
  isStrongOutcomeEvidence({
    sourceType: "user_confirmed",
    manuallyVerified: true,
    confidence: 0.2,
  }),
  "人工确认是强证据",
);

const sug = analyzeEmailShorteningSignals(
  Array.from({ length: 8 }).map(() => ({
    humanDecision: "edited",
    feedbackScope: "personal_only",
    taskType: "email_draft",
    diffSummary: { shortenedPct: 40, notes: ["正文缩短超过30%"] },
  })),
);
expect(!!sug && sug.status === "suggested", "生成偏好候选且未自动确认");

expect(
  canReviewTeamLearning({ platformRole: "manager", memberRole: "org_member" }),
  "manager 可审核",
);
expect(
  !canReviewTeamLearning({ platformRole: "sales", memberRole: "org_member" }),
  "普通销售不能发布",
);
expect(
  canReviewTeamLearning({ platformRole: "sales", memberRole: "org_admin" }),
  "org_admin 可审核",
);

console.log(`\n${total - failed}/${total} passed`);
if (failed) process.exit(1);
