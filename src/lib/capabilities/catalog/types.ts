export type CapabilityType =
  | "AGENT"
  | "SKILL"
  | "TOOL"
  | "WORKFLOW"
  | "KNOWLEDGE_BASE"
  | "INDUSTRY_PACK"
  | "PROMPT_TEMPLATE";

export type CapabilityStatus =
  | "ACTIVE"
  | "DISABLED"
  | "MISSING_CONFIG"
  | "INCOMPATIBLE"
  | "DEPRECATED"
  | "ERROR";

export type CapabilitySourceScope =
  | "PLATFORM"
  | "ORGANIZATION"
  | "WORKSPACE"
  | "PROJECT";

export type CatalogItem = {
  id: string;
  name: string;
  type: CapabilityType;
  status: CapabilityStatus;
  sourceScope: CapabilitySourceScope;
  workspaceId: string | null;
  version: string | null;
  riskLevel: string | null;
  requiresApproval: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  successRate30d: number | null;
  callCount30d: number | null;
  description?: string | null;
};

export type CatalogFilters = {
  type?: CapabilityType | "";
  status?: CapabilityStatus | "";
  workspaceId?: string;
  sourceScope?: CapabilitySourceScope | "";
  riskLevel?: string;
  requiresApproval?: boolean;
  recentlyRun?: boolean;
  q?: string;
};
