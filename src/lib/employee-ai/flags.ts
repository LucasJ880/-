/**
 * Employee AI Learning Feature Flags（默认全关；不自动开生产）
 *
 * 总开关：EMPLOYEE_AI_LEARNING_ENABLED
 * 子开关：FEEDBACK / OUTCOME_TRACKING / PLAYBOOKS
 * Allowlist：ORG / USER / ROLE / DEPARTMENT（与 Supervisor 同序）
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((x) => x.trim()).filter(Boolean);
}

export interface EmployeeAiFlagInput {
  userId: string;
  role?: string | null;
  orgId?: string | null;
  orgCode?: string | null;
  department?: string | null;
}

export type EmployeeAiFlagEnv = Record<string, string | undefined>;

function allowlistGate(
  input: EmployeeAiFlagInput,
  env: EmployeeAiFlagEnv,
  enabledKey: string,
): boolean {
  if (!envBool(env.EMPLOYEE_AI_LEARNING_ENABLED)) return false;
  if (!envBool(env[enabledKey])) return false;

  const orgAllow = envList(env.EMPLOYEE_AI_ORG_ALLOWLIST);
  const orgHit =
    (!!input.orgId && orgAllow.includes(input.orgId)) ||
    (!!input.orgCode && orgAllow.includes(input.orgCode));
  if (orgAllow.length > 0 && !orgHit) return false;

  const roleAllow = envList(env.EMPLOYEE_AI_ROLE_ALLOWLIST);
  const roleHit = Boolean(input.role && roleAllow.includes(input.role));
  if (roleAllow.length > 0 && !roleHit) return false;

  const userAllow = envList(env.EMPLOYEE_AI_USER_ALLOWLIST);
  if (userAllow.length > 0 && !userAllow.includes(input.userId)) return false;

  const deptAllow = envList(env.EMPLOYEE_AI_DEPARTMENT_ALLOWLIST);
  if (deptAllow.length > 0) {
    if (!input.department || !deptAllow.includes(input.department)) return false;
  }

  return true;
}

export function isEmployeeAiLearningEnabledWithEnv(
  input: EmployeeAiFlagInput,
  env: EmployeeAiFlagEnv = process.env,
): boolean {
  return allowlistGate(input, env, "EMPLOYEE_AI_LEARNING_ENABLED");
}

export function isEmployeeAiFeedbackEnabledWithEnv(
  input: EmployeeAiFlagInput,
  env: EmployeeAiFlagEnv = process.env,
): boolean {
  return allowlistGate(input, env, "EMPLOYEE_AI_FEEDBACK_ENABLED");
}

export function isEmployeeAiOutcomeEnabledWithEnv(
  input: EmployeeAiFlagInput,
  env: EmployeeAiFlagEnv = process.env,
): boolean {
  return allowlistGate(input, env, "EMPLOYEE_AI_OUTCOME_TRACKING_ENABLED");
}

export function isEmployeeAiPlaybooksEnabledWithEnv(
  input: EmployeeAiFlagInput,
  env: EmployeeAiFlagEnv = process.env,
): boolean {
  return allowlistGate(input, env, "EMPLOYEE_AI_PLAYBOOKS_ENABLED");
}

export function isEmployeeAiLearningEnabled(input: EmployeeAiFlagInput): boolean {
  return isEmployeeAiLearningEnabledWithEnv(input, process.env);
}

export function isEmployeeAiFeedbackEnabled(input: EmployeeAiFlagInput): boolean {
  return isEmployeeAiFeedbackEnabledWithEnv(input, process.env);
}

export function isEmployeeAiOutcomeEnabled(input: EmployeeAiFlagInput): boolean {
  return isEmployeeAiOutcomeEnabledWithEnv(input, process.env);
}

export function isEmployeeAiPlaybooksEnabled(input: EmployeeAiFlagInput): boolean {
  return isEmployeeAiPlaybooksEnabledWithEnv(input, process.env);
}

export function describeEmployeeAiFlags(): Record<string, unknown> {
  return {
    learning: envBool(process.env.EMPLOYEE_AI_LEARNING_ENABLED),
    feedback: envBool(process.env.EMPLOYEE_AI_FEEDBACK_ENABLED),
    outcome: envBool(process.env.EMPLOYEE_AI_OUTCOME_TRACKING_ENABLED),
    playbooks: envBool(process.env.EMPLOYEE_AI_PLAYBOOKS_ENABLED),
    orgAllowlist: envList(process.env.EMPLOYEE_AI_ORG_ALLOWLIST),
    userAllowlist: envList(process.env.EMPLOYEE_AI_USER_ALLOWLIST),
    roleAllowlist: envList(process.env.EMPLOYEE_AI_ROLE_ALLOWLIST),
    departmentAllowlist: envList(process.env.EMPLOYEE_AI_DEPARTMENT_ALLOWLIST),
  };
}
