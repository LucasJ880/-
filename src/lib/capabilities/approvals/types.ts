/**
 * Phase 3A-3：统一审批 Read Model
 */

export type ApprovalSourceType =
  | "PENDING_ACTION"
  | "APPROVAL_REQUEST"
  | "PRODUCT_CONTENT"
  | "OTHER";

export type ApprovalRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ApprovalUnifiedStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"
  | "EXECUTING"
  | "EXECUTED"
  | "EXECUTION_FAILED"
  | "EXECUTION_BLOCKED";

export type ApprovalCapabilities = {
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  canRetry: boolean;
};

export type ApprovalProjection = {
  id: string;
  sourceType: ApprovalSourceType;
  sourceId: string;
  orgId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  traceId?: string | null;
  runId?: string | null;
  submittedById?: string | null;
  assignedApproverIds?: string[];
  actionType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  riskLevel: ApprovalRiskLevel;
  status: ApprovalUnifiedStatus;
  decisionRequiredBy?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  executedAt?: string | null;
  expiresAt?: string | null;
  payloadSummary?: unknown;
  payloadVersion?: number | null;
  payloadHash?: string | null;
  policyVersion?: string | null;
  executionStatus?: string | null;
  errorSummary?: string | null;
  sourceAgentSkillTool?: string | null;
  multiApprover?: boolean;
  title?: string | null;
  capabilities: ApprovalCapabilities;
};

export function makeApprovalId(
  sourceType: ApprovalSourceType,
  sourceId: string,
): string {
  return `${sourceType}:${sourceId}`;
}

export function parseApprovalId(
  id: string,
): { sourceType: ApprovalSourceType; sourceId: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const sourceType = id.slice(0, idx) as ApprovalSourceType;
  const sourceId = id.slice(idx + 1);
  if (
    !["PENDING_ACTION", "APPROVAL_REQUEST", "PRODUCT_CONTENT", "OTHER"].includes(
      sourceType,
    )
  ) {
    return null;
  }
  if (!sourceId) return null;
  return { sourceType, sourceId };
}
