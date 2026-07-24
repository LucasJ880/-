// ============================================================
// Digital Employees — Phase 1 activation policy
// ============================================================
//
// This module centralizes rollout decisions for the existing digital employees.
// It does not execute business writes. Side effects must continue through the
// existing PendingAction / approval executors.

export type DigitalEmployeeKey =
  | "daily_brief"
  | "customer_followup"
  | "quote_risk"
  | "project_health"
  | "marketing_brief"
  | "gmail_draft"
  | "supervisor"
  | "employee_learning"
  | "product_content_image";

export interface DigitalEmployeeFlagInput {
  orgId: string;
  userId?: string | null;
  role?: string | null;
}

export interface DigitalEmployeeStatus {
  key: DigitalEmployeeKey;
  enabled: boolean;
  mode: "manual" | "proactive" | "draft_only" | "dry_run" | "disabled";
  reason: string;
}

function envBool(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "on", "yes"].includes(value.trim().toLowerCase());
}

function envList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesScope(input: DigitalEmployeeFlagInput): boolean {
  const orgAllow = envList(process.env.DIGITAL_EMPLOYEE_ORG_ALLOWLIST);
  const userAllow = envList(process.env.DIGITAL_EMPLOYEE_USER_ALLOWLIST);
  const roleAllow = envList(process.env.DIGITAL_EMPLOYEE_ROLE_ALLOWLIST);

  if (orgAllow.length > 0 && !orgAllow.includes(input.orgId)) return false;
  if (userAllow.length > 0 && (!input.userId || !userAllow.includes(input.userId))) {
    return false;
  }
  if (roleAllow.length > 0 && (!input.role || !roleAllow.includes(input.role))) {
    return false;
  }
  return true;
}

export function isDigitalEmployeeEnabled(
  key: DigitalEmployeeKey,
  input: DigitalEmployeeFlagInput,
): boolean {
  if (!envBool(process.env.DIGITAL_EMPLOYEES_ENABLED)) return false;
  if (!matchesScope(input)) return false;

  switch (key) {
    case "daily_brief":
      return envBool(process.env.DIGITAL_EMPLOYEE_DAILY_BRIEF_ENABLED);
    case "customer_followup":
      return envBool(process.env.DIGITAL_EMPLOYEE_CUSTOMER_FOLLOWUP_ENABLED);
    case "quote_risk":
      return envBool(process.env.DIGITAL_EMPLOYEE_QUOTE_RISK_ENABLED);
    case "project_health":
      return envBool(process.env.DIGITAL_EMPLOYEE_PROJECT_HEALTH_ENABLED);
    case "marketing_brief":
      return envBool(process.env.DIGITAL_EMPLOYEE_MARKETING_BRIEF_ENABLED);
    case "gmail_draft":
      return envBool(process.env.GMAIL_DRAFT_ENABLED);
    case "supervisor":
      return envBool(process.env.AGENT_SUPERVISOR_ENABLED);
    case "employee_learning":
      return envBool(process.env.EMPLOYEE_AI_LEARNING_ENABLED);
    case "product_content_image":
      return (
        envBool(process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED) &&
        !envBool(process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN)
      );
    default:
      return false;
  }
}

export function describeDigitalEmployees(
  input: DigitalEmployeeFlagInput,
): DigitalEmployeeStatus[] {
  const scoped = matchesScope(input);
  const master = envBool(process.env.DIGITAL_EMPLOYEES_ENABLED);
  const status = (
    key: DigitalEmployeeKey,
    mode: DigitalEmployeeStatus["mode"],
    reason: string,
  ): DigitalEmployeeStatus => ({
    key,
    enabled: master && scoped && isDigitalEmployeeEnabled(key, input),
    mode,
    reason: !master
      ? "DIGITAL_EMPLOYEES_ENABLED is off"
      : !scoped
        ? "user or organization is outside the rollout allowlist"
        : reason,
  });

  return [
    status("daily_brief", "proactive", "daily briefing automation flag"),
    status("customer_followup", "proactive", "customer follow-up automation flag"),
    status("quote_risk", "proactive", "quote risk automation flag"),
    status("project_health", "proactive", "project health automation flag"),
    status("marketing_brief", "manual", "marketing brief flag"),
    status("gmail_draft", "draft_only", "Gmail compose draft only; never auto-send"),
    status("supervisor", "manual", "Supervisor remains independently gated"),
    status("employee_learning", "disabled", "learning remains independently gated"),
    status(
      "product_content_image",
      envBool(process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN) ? "dry_run" : "manual",
      "real image generation requires generate enabled and dry-run disabled",
    ),
  ];
}

export function describeDigitalEmployeeRollout(): Record<string, unknown> {
  return {
    enabled: envBool(process.env.DIGITAL_EMPLOYEES_ENABLED),
    orgAllowlist: envList(process.env.DIGITAL_EMPLOYEE_ORG_ALLOWLIST),
    userAllowlist: envList(process.env.DIGITAL_EMPLOYEE_USER_ALLOWLIST),
    roleAllowlist: envList(process.env.DIGITAL_EMPLOYEE_ROLE_ALLOWLIST),
    safety: {
      automaticEmailSend: false,
      automaticHighRiskWrites: false,
      pendingActionApprovalRequired: true,
    },
  };
}
