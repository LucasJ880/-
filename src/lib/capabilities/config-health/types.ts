export type ConfigHealthStatus =
  | "HEALTHY"
  | "WARNING"
  | "ERROR"
  | "MISSING"
  | "INCOMPATIBLE";

export type ConfigHealthSeverity =
  | "CRITICAL"
  | "ERROR"
  | "WARNING"
  | "INFO";

export type ConfigHealthScope =
  | "PLATFORM"
  | "ORGANIZATION"
  | "WORKSPACE"
  | "PROJECT";

export type ConfigHealthIssue = {
  code: string;
  severity: ConfigHealthSeverity;
  status: ConfigHealthStatus;
  scope: ConfigHealthScope;
  scopeId?: string;
  title: string;
  message: string;
  recommendedAction?: string;
  actionHref?: string;
};

export type ConfigHealthReport = {
  orgId: string;
  overall: ConfigHealthStatus;
  checkedAt: string;
  issues: ConfigHealthIssue[];
  summary: {
    healthy: number;
    warning: number;
    error: number;
    missing: number;
    incompatible: number;
  };
};
