/**
 * Matrix Account Playbook — 类型与常量（Phase B）
 */

export const PLAYBOOK_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "archived",
] as const;
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number];

export const VALIDATION_RESULTS = [
  "unchecked",
  "pass",
  "warn",
  "fail",
] as const;
export type ValidationResult = (typeof VALIDATION_RESULTS)[number];

export type MergeMode = "replace" | "append" | "merge-by-key" | "disabled";

export type FieldSource =
  | "task_input"
  | "account_playbook"
  | "group_playbook"
  | "brand_profile"
  | "marketing_brand_profile"
  | "persona_notes"
  | "group_name"
  | "campaign"
  | "none";

export type ValidationIssue = {
  code: string;
  severity: "error" | "warn" | "info";
  field: string;
  message: string;
};

export type PlaybookContentFields = {
  accountRole?: string | null;
  businessObjective?: string | null;
  positioning?: string | null;
  personaBackground?: string | null;
  personality?: string | null;
  toneOfVoice?: string | null;
  operatingLanguage?: string | null;
  operatingRegion?: string | null;
  primaryProducts?: string | null;
  targetAudienceJson?: unknown;
  contentPillarsJson?: unknown;
  contentMixJson?: unknown;
  visualStyleJson?: unknown;
  postingRulesJson?: unknown;
  ctaStrategyJson?: unknown;
  conversionPathJson?: unknown;
  kpiTargetsJson?: unknown;
  forbiddenTopicsJson?: unknown;
  exampleContentJson?: unknown;
  overridesJson?: unknown;
};

export type SourceTraceEntry = {
  field: string;
  source: FieldSource;
  mergeMode?: MergeMode;
  note?: string;
};

export type EffectiveAccountContext = {
  orgId: string;
  accountId: string;
  groupId: string | null;
  groupKey: string | null;
  groupDisplayName: string | null;
  /** 是否存在已批准且生效的账号 Playbook（后续自动发布才可依赖） */
  hasApprovedPlaybook: boolean;
  /** 本次解析是否把 draft 仅作预览 */
  usingDraftPreview: boolean;
  brandContext: {
    brandName: string | null;
    toneOfVoice: string | null;
    targetAudience: string | null;
    forbiddenClaims: string | null;
    positioning: string | null;
  };
  objective: string | null;
  targetAudience: unknown;
  contentPillars: unknown;
  toneOfVoice: string | null;
  visualStyle: unknown;
  ctaStrategy: unknown;
  conversionPath: unknown;
  forbiddenTopics: unknown;
  postingRules: unknown;
  kpiTargets: unknown;
  personaSummary: string | null;
  accountRole: string | null;
  positioning: string | null;
  effectiveContext: Record<string, unknown>;
  sourceTrace: SourceTraceEntry[];
  warnings: string[];
};

export const TEXT_FIELDS = [
  "accountRole",
  "businessObjective",
  "positioning",
  "personaBackground",
  "personality",
  "toneOfVoice",
  "operatingLanguage",
  "operatingRegion",
  "primaryProducts",
] as const;

export const JSON_FIELDS = [
  "targetAudienceJson",
  "contentPillarsJson",
  "contentMixJson",
  "visualStyleJson",
  "postingRulesJson",
  "ctaStrategyJson",
  "conversionPathJson",
  "kpiTargetsJson",
  "forbiddenTopicsJson",
  "exampleContentJson",
] as const;

export type TextField = (typeof TEXT_FIELDS)[number];
export type JsonField = (typeof JSON_FIELDS)[number];
