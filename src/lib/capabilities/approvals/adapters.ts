/**
 * 审批源 → ApprovalProjection（统一状态仅用于展示）
 */

import type { PendingAction, ProductContentApproval } from "@prisma/client";
import {
  computePayloadHash,
  summarizePayload,
} from "./integrity";
import type {
  ApprovalCapabilities,
  ApprovalProjection,
  ApprovalRiskLevel,
  ApprovalUnifiedStatus,
} from "./types";
import { makeApprovalId } from "./types";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function mapRisk(raw: string | null | undefined): ApprovalRiskLevel {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("critical") || s === "l3" || s === "l3_strong") return "CRITICAL";
  if (s.includes("high") || s === "l2" || s === "l2_soft") return "HIGH";
  if (s.includes("medium") || s === "l1") return "MEDIUM";
  return "LOW";
}

function paStatus(
  status: string,
  expiresAt: Date,
  failureReason: string | null,
): ApprovalUnifiedStatus {
  if (status === "pending" && expiresAt.getTime() < Date.now()) return "EXPIRED";
  if (status === "pending") return "PENDING";
  if (status === "approved") return "APPROVED";
  if (status === "rejected") return "REJECTED";
  if (status === "executed") return "EXECUTED";
  if (status === "failed") {
    if (failureReason?.includes("过期")) return "EXPIRED";
    if (failureReason?.includes("BLOCKED") || failureReason?.includes("阻止")) {
      return "EXECUTION_BLOCKED";
    }
    return "EXECUTION_FAILED";
  }
  if (status === "cancelled") return "CANCELLED";
  return "PENDING";
}

function arStatus(status: string): ApprovalUnifiedStatus {
  const s = status.toLowerCase();
  if (s === "pending") return "PENDING";
  if (s === "approved") return "APPROVED";
  if (s === "rejected") return "REJECTED";
  if (s === "expired") return "EXPIRED";
  if (s === "escalated") return "PENDING";
  return "PENDING";
}

function pcStatus(status: string): ApprovalUnifiedStatus {
  const s = status.toLowerCase();
  if (s === "pending") return "PENDING";
  if (s === "approved" || s === "auto_allowed") return "APPROVED";
  if (s === "rejected") return "REJECTED";
  return "PENDING";
}

export function projectPendingActionApproval(
  row: PendingAction & { payloadHash?: string | null; payloadVersion?: number | null; policyVersion?: string | null; workspaceId?: string | null },
  opts: {
    canDecide: boolean;
    visibility: "full" | "metadata" | "aggregate";
  },
): ApprovalProjection | null {
  if (!row.orgId) return null;
  const payload = asRecord(row.payload);
  const ws =
    row.workspaceId ??
    (typeof payload?.workspaceId === "string" ? payload.workspaceId : null);
  const status = paStatus(row.status, row.expiresAt, row.failureReason);
  const hash =
    row.payloadHash ??
    (payload ? computePayloadHash(payload) : null);

  const caps: ApprovalCapabilities = {
    canApprove: opts.canDecide && status === "PENDING",
    canReject: opts.canDecide && status === "PENDING",
    canCancel: opts.canDecide && status === "PENDING",
    canRetry:
      opts.canDecide &&
      (status === "EXECUTION_FAILED" || status === "EXECUTION_BLOCKED"),
  };

  const summary =
    opts.visibility === "aggregate"
      ? null
      : opts.visibility === "metadata"
        ? { title: row.title, type: row.type }
        : summarizePayload(payload);

  return {
    id: makeApprovalId("PENDING_ACTION", row.id),
    sourceType: "PENDING_ACTION",
    sourceId: row.id,
    orgId: row.orgId,
    workspaceId: ws,
    projectId: row.projectId,
    runId: row.agentRunId,
    traceId: null,
    submittedById: row.createdById,
    assignedApproverIds: row.approverUserId ? [row.approverUserId] : [],
    actionType: row.type,
    resourceType: typeof payload?.resourceType === "string" ? payload.resourceType : null,
    resourceId: typeof payload?.resourceId === "string" ? payload.resourceId : null,
    riskLevel: mapRisk(
      typeof payload?.riskLevel === "string" ? payload.riskLevel : null,
    ),
    status,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    payloadSummary: summary,
    payloadVersion: row.payloadVersion ?? 1,
    payloadHash: hash,
    policyVersion: row.policyVersion ?? null,
    executionStatus: row.status,
    errorSummary:
      opts.visibility === "aggregate"
        ? row.failureReason
          ? "有错误（明细已隐藏）"
          : null
        : row.failureReason,
    sourceAgentSkillTool: row.type,
    multiApprover: false,
    title: row.title,
    capabilities: caps,
  };
}

export function projectApprovalRequestApproval(
  row: {
    id: string;
    actionType: string;
    riskLevel: string;
    status: string;
    previewJson: string | null;
    riskReason: string | null;
    approverUserId: string | null;
    decidedAt: Date | null;
    createdAt: Date;
    deadlineAt: Date | null;
    task: {
      id: string;
      createdById: string;
      project: { id: string; orgId: string | null; workspaceId: string | null; name: string };
    };
    step: { id: string; title: string; skillId: string };
  },
  opts: {
    canDecide: boolean;
    visibility: "full" | "metadata" | "aggregate";
  },
): ApprovalProjection | null {
  const orgId = row.task.project.orgId;
  if (!orgId) return null;
  const status = arStatus(row.status);
  const caps: ApprovalCapabilities = {
    canApprove: opts.canDecide && status === "PENDING",
    canReject: opts.canDecide && status === "PENDING",
    canCancel: false,
    canRetry: false,
  };

  let preview: unknown = null;
  if (opts.visibility !== "aggregate") {
    try {
      preview = row.previewJson ? JSON.parse(row.previewJson) : row.riskReason;
    } catch {
      preview = row.riskReason;
    }
    if (opts.visibility === "metadata") {
      preview = { actionType: row.actionType };
    } else {
      preview = summarizePayload(preview);
    }
  }

  return {
    id: makeApprovalId("APPROVAL_REQUEST", row.id),
    sourceType: "APPROVAL_REQUEST",
    sourceId: row.id,
    orgId,
    workspaceId: row.task.project.workspaceId,
    projectId: row.task.project.id,
    submittedById: row.task.createdById,
    assignedApproverIds: row.approverUserId ? [row.approverUserId] : [],
    actionType: row.actionType,
    resourceType: "AgentTaskStep",
    resourceId: row.step.id,
    riskLevel: mapRisk(row.riskLevel),
    status,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    expiresAt: row.deadlineAt?.toISOString() ?? null,
    payloadSummary: preview,
    payloadVersion: 1,
    payloadHash: row.previewJson
      ? computePayloadHash(row.previewJson)
      : null,
    executionStatus: row.status,
    errorSummary: null,
    sourceAgentSkillTool: row.step.skillId || row.step.title,
    multiApprover: false,
    title: row.step.title,
    capabilities: caps,
  };
}

export function projectProductContentApproval(
  row: ProductContentApproval,
  opts: {
    canDecide: boolean;
    visibility: "full" | "metadata" | "aggregate";
  },
): ApprovalProjection {
  const status = pcStatus(row.status);
  const caps: ApprovalCapabilities = {
    canApprove: opts.canDecide && status === "PENDING",
    canReject: opts.canDecide && status === "PENDING",
    canCancel: false,
    canRetry: false,
  };
  const summary =
    opts.visibility === "aggregate"
      ? null
      : opts.visibility === "metadata"
        ? { actionKey: row.actionKey }
        : summarizePayload(row.payloadJson);

  return {
    id: makeApprovalId("PRODUCT_CONTENT", row.id),
    sourceType: "PRODUCT_CONTENT",
    sourceId: row.id,
    orgId: row.orgId,
    projectId: null,
    workspaceId: null,
    submittedById: row.requestedById,
    assignedApproverIds: [],
    actionType: row.actionKey,
    resourceType: "ProductContentJob",
    resourceId: row.jobId,
    riskLevel: row.policy === "MANUAL_ONLY" ? "HIGH" : "MEDIUM",
    status,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    payloadSummary: summary,
    payloadVersion: 1,
    payloadHash: row.payloadJson
      ? computePayloadHash(row.payloadJson)
      : null,
    policyVersion: row.policy,
    executionStatus: row.status,
    errorSummary: null,
    sourceAgentSkillTool: `product_content:${row.actionKey}`,
    multiApprover: false,
    title: row.actionKey,
    capabilities: caps,
  };
}
