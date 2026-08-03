/**
 * Scope / Harness / PoC 结构化审计（不写敏感正文）
 *
 * - human：需要 userId
 * - service：可用 servicePrincipal，userId 可空（依赖 AuditLog.userId nullable migration）
 */

import { logAudit } from "@/lib/audit/logger";
import type { ScopeContext, ScopeResolveDeniedReason } from "./types";

export type QmAuditEvent =
  | "scope.resolution_denied"
  | "scope.cross_scope_denied"
  | "scope.tool_denied"
  | "scope.pending_action_proposed"
  | "scope.pending_action_approved"
  | "scope.pending_action_rejected"
  | "scope.kill_switch_activated"
  | "scope.automation_skipped"
  | "scope.duplicate_run_prevented"
  | "scope.harness_failure"
  | "scope.brief_claimed"
  | "scope.brief_completed"
  | "scope.brief_failed";

export async function writeQmAuditEvent(input: {
  event: QmAuditEvent;
  orgId?: string | null;
  userId?: string | null;
  projectId?: string | null;
  correlationId?: string | null;
  reason?: string;
  servicePrincipal?: string | null;
  actorType?: "human" | "service";
  meta?: Record<string, unknown>;
}): Promise<void> {
  const actorType =
    input.actorType ?? (input.servicePrincipal ? "service" : "human");
  const userId = input.userId?.trim() || undefined;
  const servicePrincipal = input.servicePrincipal?.trim() || undefined;

  if (!userId && !servicePrincipal) {
    // 既无用户也无 service principal：结构化 console（不含敏感正文）
    console.info(
      JSON.stringify({
        type: "qm_audit_skip_no_actor",
        event: input.event,
        orgId: input.orgId ?? null,
        correlationId: input.correlationId ?? null,
        reason: input.reason ?? null,
      }),
    );
    return;
  }

  await logAudit({
    action: input.event,
    userId,
    orgId: input.orgId ?? undefined,
    projectId: input.projectId ?? undefined,
    targetType: "qm_scope_phase1",
    targetId: input.correlationId ?? undefined,
    afterData: {
      actorType,
      servicePrincipal: servicePrincipal ?? null,
      correlationId: input.correlationId ?? null,
      reason: input.reason ?? null,
      ...(input.meta ?? {}),
    },
  });
}

export async function auditScopeDenied(input: {
  reason: ScopeResolveDeniedReason;
  orgId?: string | null;
  userId?: string | null;
  projectId?: string | null;
  correlationId?: string | null;
  detail?: string;
  servicePrincipal?: string | null;
}): Promise<void> {
  await writeQmAuditEvent({
    event: "scope.resolution_denied",
    orgId: input.orgId,
    userId: input.userId,
    projectId: input.projectId,
    correlationId: input.correlationId,
    servicePrincipal: input.servicePrincipal,
    reason: input.reason,
    meta: { detail: input.detail ?? null },
  });
}

export function scopeContextAuditSlice(scope: ScopeContext): Record<string, unknown> {
  return {
    orgId: scope.orgId,
    principalUserId: scope.principalUserId,
    principalRole: scope.principalRole,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    projectId: scope.projectId ?? null,
    threadId: scope.threadId ?? null,
    correlationId: scope.correlationId,
    servicePrincipal: scope.servicePrincipal ?? null,
    triggerSource: scope.triggerSource ?? null,
  };
}
