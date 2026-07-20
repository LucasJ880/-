/**
 * 人机协作学习 Phase1 静态验收
 * 运行：npx tsx scripts/verify-employee-ai-learning.ts
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const root = process.cwd();
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) console.log(`✓ ${msg}`);
  else {
    failed++;
    console.error(`✗ ${msg}`);
  }
}

const required = [
  "src/lib/employee-ai/flags.ts",
  "src/lib/employee-ai/profile-service.ts",
  "src/lib/employee-ai/feedback-service.ts",
  "src/lib/employee-ai/outcome-service.ts",
  "src/lib/employee-ai/preference-learner.ts",
  "src/lib/employee-ai/practice-miner.ts",
  "src/lib/employee-ai/playbook-service.ts",
  "src/lib/employee-ai/context-builder.ts",
  "src/app/api/agent-feedback/route.ts",
  "src/app/api/me/ai-profile/route.ts",
  "src/app/api/business-outcomes/route.ts",
  "src/app/api/team/candidate-practices/route.ts",
  "src/app/api/team/playbooks/route.ts",
  "src/components/agent-feedback/feedback-actions.tsx",
  "src/app/(main)/settings/digital-employees/page.tsx",
  "prisma/migrations/20260721010000_employee_ai_learning_phase1/migration.sql",
];

for (const f of required) {
  ok(existsSync(join(root, f)), `存在 ${f}`);
}

const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
for (const m of [
  "EmployeeAiProfile",
  "HumanFeedbackEvent",
  "BusinessOutcome",
  "CandidatePractice",
  "RolePlaybook",
  "AgentSkillVersion",
  "EvaluationCase",
]) {
  ok(schema.includes(`model ${m}`), `schema 含 ${m}`);
}

const envEx = readFileSync(join(root, ".env.example"), "utf8");
ok(envEx.includes("EMPLOYEE_AI_LEARNING_ENABLED"), ".env.example 含学习 Flag");

const runtime = readFileSync(
  join(root, "src/lib/agent-core/skills/runtime.ts"),
  "utf8",
);
ok(runtime.includes("buildEmployeeAssistContext"), "runSkill 注入学习上下文");

const flags = readFileSync(join(root, "src/lib/employee-ai/flags.ts"), "utf8");
ok(flags.includes('envBool(env.EMPLOYEE_AI_LEARNING_ENABLED)'), "Flag 默认依赖显式开启");

console.log(failed ? `\nFAILED ${failed}` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
