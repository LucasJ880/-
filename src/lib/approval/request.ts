/**
 * QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 canonical approval CREATION facade.
 *
 * R0 found approval creation fragmented across 11 sites while ApprovalPort
 * (port.ts) unifies only list/approve/reject/expire. From R1 on, ALL NEW
 * approval integrations must create approvals through requestApproval();
 * direct db.pendingAction writes and new imports of the legacy creation
 * helpers fail CI (NEW_APPROVAL_BYPASS_FORBIDDEN — see
 * src/lib/runtime-architecture/guards.ts). Existing sites are baselined and
 * migrate in R2-C6, not here.
 *
 * Scope decisions (R1):
 * - Delegates to the existing pending-actions/drafts createDraftBatch —
 *   storage model, audit write, AgentRun linkage and idempotency semantics
 *   are UNCHANGED (no schema change, no behavior change for existing paths).
 * - Creates PendingAction only. ApprovalRequest belongs to the frozen
 *   AgentTask/flow-runner legacy stack (see runtime-architecture/manifest.ts
 *   area "agent-task-legacy"): by definition no NEW code integrates with it,
 *   so the canonical creation facade does not mint ApprovalRequest rows.
 * - Canonical risk is REQUIRED (fail-closed vocabulary in
 *   runtime-architecture/risk.ts) and preserved into payload.metadata for
 *   audit; PendingAction has no risk column and R1 adds none.
 *
 * REQUIRES_APPROVAL_CONTRACT (runtime-architecture/risk.ts): calling this
 * facade is the ONLY legal reaction to requiresApproval=true besides a
 * fail-closed refusal — it never executes the side effect.
 */

import {
  createDraftBatch,
  type CreateDraftInput,
} from "@/lib/pending-actions/drafts";
import type { PendingActionType } from "@/lib/pending-actions/types";
import {
  normalizeToolRisk,
  type NormalizedRisk,
  type RiskSource,
} from "@/lib/runtime-architecture/risk";

export interface CanonicalApprovalRequestInput {
  /** Tenant scope — REQUIRED for all new approvals (legacy rows may be org-less; new ones must not be). */
  orgId: string;
  /** The human principal the draft belongs to (PendingAction.createdById). */
  principal: {
    userId: string;
    /** Informational; recorded in payload metadata for audit. */
    actorType?: "user" | "agent";
  };
  /** Business action type — must be an executor-supported PendingActionType. */
  actionType: PendingActionType;
  title: string;
  preview: string;
  /** Full parameters the executor needs on approve. */
  payload: Record<string, unknown>;
  /**
   * Risk in ANY known vocabulary; normalized fail-closed to the canonical
   * vocabulary and preserved verbatim for audit.
   */
  risk: RiskSource;
  /** Source runtime linkage. */
  source: {
    /** Stable module identifier of the creator (e.g. "agent-runtime-v2.executor"). */
    module: string;
    runId?: string;
    stepKey?: string;
    toolName?: string;
    threadId?: string;
    messageId?: string;
  };
  /** Business context columns (existing PendingAction columns only). */
  business?: {
    projectId?: string;
    workspaceId?: string;
  };
  /** Approver routing (existing columns; requiredRole is recorded but — R0 finding — not yet enforced anywhere). */
  approver?: {
    approverUserId?: string;
    requiredRole?: string;
  };
  /** Expiration; defaults to the drafts-layer default (24h) when omitted. */
  ttlHours?: number;
  /**
   * Stable business idempotency key — REQUIRED for new code (R0 found
   * legacy sites creating duplicate drafts without keys).
   */
  idempotencyKey: string;
  policyVersion?: string;
  resourceVersion?: string;
}

export type RequestApprovalResult =
  | {
      ok: true;
      kind: "pending_action";
      actionIds: string[];
      normalizedRisk: NormalizedRisk;
    }
  | { ok: false; kind: "pending_action"; errorCode: "DRAFT_CREATION_FAILED" | "INVALID_REQUEST"; error: string };

/**
 * Pure mapper — unit-testable without a database. Builds the drafts-layer
 * input and embeds canonical risk + source linkage into payload.metadata
 * (audit-preserving; no schema change).
 */
export function buildPendingActionDraftInput(
  input: CanonicalApprovalRequestInput,
): { draft: CreateDraftInput; normalizedRisk: NormalizedRisk } {
  const normalizedRisk = normalizeToolRisk(input.risk);
  const priorMetadata =
    typeof input.payload.metadata === "object" && input.payload.metadata !== null
      ? (input.payload.metadata as Record<string, unknown>)
      : {};
  const draft: CreateDraftInput = {
    type: input.actionType,
    title: input.title,
    preview: input.preview,
    payload: {
      ...input.payload,
      metadata: {
        ...priorMetadata,
        orgId: input.orgId,
        requestedVia: "approval-port.requestApproval",
        sourceModule: input.source.module,
        sourceStepKey: input.source.stepKey,
        sourceToolName: input.source.toolName,
        principalActorType: input.principal.actorType ?? "user",
        canonicalRisk: normalizedRisk.canonical,
        originalRisk: normalizedRisk.original,
        riskFailClosed: normalizedRisk.failClosed,
        requiresApproval: true,
      },
    },
    userId: input.principal.userId,
    orgId: input.orgId,
    projectId: input.business?.projectId,
    workspaceId: input.business?.workspaceId,
    approverUserId: input.approver?.approverUserId,
    requiredRole: input.approver?.requiredRole,
    threadId: input.source.threadId,
    messageId: input.source.messageId,
    agentRunId: input.source.runId,
    ttlHours: input.ttlHours,
    policyVersion: input.policyVersion,
    resourceVersion: input.resourceVersion,
    idempotencyKey: input.idempotencyKey,
  };
  return { draft, normalizedRisk };
}

/** Pure validation — returns a human-readable problem or null. */
export function validateApprovalRequestInput(
  input: CanonicalApprovalRequestInput,
): string | null {
  if (!input.orgId?.trim()) return "orgId is required";
  if (!input.principal?.userId?.trim()) return "principal.userId is required";
  if (!input.title?.trim()) return "title is required";
  if (!input.preview?.trim()) return "preview is required";
  if (!input.idempotencyKey?.trim())
    return "idempotencyKey is required for canonical approval creation";
  if (!input.source?.module?.trim()) return "source.module is required";
  return null;
}

/**
 * Canonical creation entry. Never executes the side effect; only creates a
 * pending draft (or reuses the existing one for the same idempotency key —
 * drafts-layer semantics, unchanged).
 */
export async function requestApproval(
  input: CanonicalApprovalRequestInput,
): Promise<RequestApprovalResult> {
  const problem = validateApprovalRequestInput(input);
  if (problem) {
    return {
      ok: false,
      kind: "pending_action",
      errorCode: "INVALID_REQUEST",
      error: problem,
    };
  }
  const { draft, normalizedRisk } = buildPendingActionDraftInput(input);
  const batch = await createDraftBatch([draft]);
  if (!batch.success || batch.actions.length === 0) {
    return {
      ok: false,
      kind: "pending_action",
      errorCode: "DRAFT_CREATION_FAILED",
      error: "创建待确认草稿失败",
    };
  }
  return {
    ok: true,
    kind: "pending_action",
    actionIds: batch.actions.map((a) => a.actionId),
    normalizedRisk,
  };
}
