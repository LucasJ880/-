export const HUMAN_DECISIONS = [
  "accepted",
  "edited",
  "rejected",
  "deferred",
  "not_applicable",
] as const;
export type HumanDecision = (typeof HUMAN_DECISIONS)[number];

export const FEEDBACK_SCOPES = [
  "personal_only",
  "team_candidate",
  "do_not_learn",
] as const;
export type FeedbackScope = (typeof FEEDBACK_SCOPES)[number];

export const REASON_CODES = [
  "wrong_priority",
  "missing_context",
  "incorrect_fact",
  "tone_too_formal",
  "tone_too_casual",
  "too_long",
  "too_short",
  "wrong_channel",
  "wrong_timing",
  "compliance_risk",
  "customer_relationship_context",
  "business_judgment",
  "duplicate_action",
  "other",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const CANDIDATE_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "archived",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const PLAYBOOK_STATUSES = ["draft", "active", "retired"] as const;
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number];

export const OUTCOME_SOURCE_TYPES = [
  "business_record",
  "user_confirmed",
  "approval_result",
  "connected_source",
] as const;
export type OutcomeSourceType = (typeof OUTCOME_SOURCE_TYPES)[number];

export interface EmployeeAssistContext {
  confirmedPersonalPreferences: Record<string, unknown>;
  inferredPersonalPreferences: Record<string, unknown>;
  activeRolePlaybooks: Array<{
    id: string;
    name: string;
    version: number;
    department: string;
    roleScope: string;
    rules: unknown;
    workflows: unknown;
  }>;
  relevantApprovedRules: string[];
  doNotUse: string[];
  contextVersion: string;
  employeeAiProfileVersion: number | null;
  rolePlaybookIds: string[];
  rolePlaybookVersions: number[];
  skillVersion: number | null;
  contextHash: string;
}

/** 安全边界：个人偏好不得覆盖这些类别 */
export const NON_OVERRIDABLE_RULE_KEYS = [
  "approval_boundary",
  "compliance",
  "brand_banned_words",
  "enterprise_rules",
  "org_permissions",
  "tool_whitelist",
  "external_side_effects",
] as const;
