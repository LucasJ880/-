/**
 * 运行：npx tsx src/lib/employee-ai/__tests__/feature-flags.test.ts
 */
import {
  isEmployeeAiFeedbackEnabledWithEnv,
  isEmployeeAiLearningEnabledWithEnv,
  isEmployeeAiPlaybooksEnabledWithEnv,
} from "../flags";

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

const base = {
  userId: "u1",
  role: "sales",
  orgId: "org-a",
  orgCode: "sunny-home-deco",
};

expect(
  !isEmployeeAiLearningEnabledWithEnv(base, {
    EMPLOYEE_AI_LEARNING_ENABLED: "0",
  }),
  "默认关闭",
);

expect(
  !isEmployeeAiFeedbackEnabledWithEnv(base, {
    EMPLOYEE_AI_LEARNING_ENABLED: "1",
    EMPLOYEE_AI_FEEDBACK_ENABLED: "0",
    EMPLOYEE_AI_ORG_ALLOWLIST: "sunny-home-deco",
  }),
  "子开关关闭 → 反馈关",
);

expect(
  isEmployeeAiFeedbackEnabledWithEnv(base, {
    EMPLOYEE_AI_LEARNING_ENABLED: "1",
    EMPLOYEE_AI_FEEDBACK_ENABLED: "1",
    EMPLOYEE_AI_ORG_ALLOWLIST: "sunny-home-deco",
    EMPLOYEE_AI_ROLE_ALLOWLIST: "sales,admin",
  }),
  "组织+角色命中 → 开",
);

expect(
  !isEmployeeAiPlaybooksEnabledWithEnv(base, {
    EMPLOYEE_AI_LEARNING_ENABLED: "1",
    EMPLOYEE_AI_PLAYBOOKS_ENABLED: "1",
    EMPLOYEE_AI_ORG_ALLOWLIST: "other",
  }),
  "组织不命中 → 关",
);

console.log(`\n${total - failed}/${total} passed`);
if (failed) process.exit(1);
