/**
 * Security-1：统一授权类型（兼容未来数字员工 / Group）
 */

export type PrincipalType = "HUMAN" | "DIGITAL_EMPLOYEE";

export type PrincipalRef = {
  type: PrincipalType;
  id: string;
  orgId: string;
  /** 数字员工赞助人（本阶段未实现） */
  sponsorUserId?: string;
};

export type DataScope =
  | "NONE"
  | "PRINCIPAL"
  | "SPONSOR"
  | "ASSIGNED"
  | "GROUP"
  | "TEAM"
  | "WORKSPACE"
  | "ORG"
  | "EXPLICIT";

/** 本阶段实际启用的 Scope */
export const ACTIVE_DATA_SCOPES: readonly DataScope[] = [
  "NONE",
  "PRINCIPAL",
  "ASSIGNED",
  "ORG",
] as const;

/** 仅枚举预留、遇到时 fail-closed */
export const RESERVED_DATA_SCOPES: readonly DataScope[] = [
  "SPONSOR",
  "GROUP",
  "TEAM",
  "WORKSPACE",
  "EXPLICIT",
] as const;

export type AuthzRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PermissionDefinition = {
  key: string;
  resource: string;
  action: string;
  label: string;
  description: string;
  allowedPrincipalTypes: PrincipalType[];
  supportedScopes: DataScope[];
  riskLevel: AuthzRiskLevel;
};

export type AuthorizeResource = {
  type: string;
  id?: string;
  ownerId?: string | null;
  assignedToId?: string | null;
  orgId: string;
};

export type AuthorizeResult = {
  allowed: boolean;
  permission: string;
  scopes: DataScope[];
  matchedScope?: DataScope;
  sourceBindings: string[];
  reasonCode: string;
};

export type BindingEffect = "ALLOW" | "DENY";
