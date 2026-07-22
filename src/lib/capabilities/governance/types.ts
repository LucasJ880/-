export type QuotaMetric =
  | "MONTHLY_AI_COST"
  | "DAILY_AGENT_RUNS"
  | "DAILY_HIGH_RISK_TOOL_CALLS"
  | "DAILY_IMAGE_GENERATIONS"
  | "MAX_CONCURRENT_RUNS"
  | "SINGLE_RUN_ESTIMATED_COST";

export type QuotaPeriod = "PER_RUN" | "DAILY" | "MONTHLY" | "CONCURRENT";

export type QuotaLevel = "OK" | "WARNING" | "SOFT_LIMIT" | "HARD_LIMIT";

export type EffectiveQuotaProjection = {
  metric: QuotaMetric;
  period: QuotaPeriod;
  warningLimit: number | null;
  softLimit: number | null;
  hardLimit: number | null;
  sourcePolicies: Array<{
    scope: "PLATFORM" | "ORGANIZATION" | "WORKSPACE";
    policyId?: string;
    version?: number;
  }>;
};

export type QuotaEvalResult = {
  allowed: boolean;
  level: QuotaLevel;
  currentUsage: number;
  requestedAmount: number;
  projectedUsage: number;
  warningLimit?: number | null;
  softLimit?: number | null;
  hardLimit?: number | null;
  remaining?: number | null;
  policySources: EffectiveQuotaProjection["sourcePolicies"];
  reasonCode?: string;
};

export type GovernanceProjection = {
  orgId: string;
  workspaceId?: string | null;
  industryPack: {
    id?: string | null;
    status: "OK" | "MISSING" | "INVALID" | "INCOMPATIBLE";
  };
  modules: Array<{ key: string; enabled: boolean; sourceScope: string }>;
  toolPolicies: Array<{
    toolKey: string;
    riskLevel: string;
    allowed: boolean;
    requiresApproval: boolean;
    sourceScope: string;
    version?: number | null;
  }>;
  visibilityPolicy: {
    value: "AGGREGATE_ONLY" | "METADATA_ONLY" | "FULL";
    sourceScope: string;
  };
  providerStatus: Array<{
    provider: string;
    status: "ACTIVE" | "NOT_CONFIGURED" | "DISABLED" | "ERROR" | "NOT_IMPLEMENTED";
    models: string[];
  }>;
  quotas: EffectiveQuotaProjection[];
};
