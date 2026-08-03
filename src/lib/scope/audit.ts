/**
 * Scope / Harness / PoC 结构化审计（不写敏感正文）
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
  | "scope.harness_failure";

export async function writeQmAuditEvent(input: {
  event: QmAuditEvent;
  orgId?: string | null;
  userId?: string | null;
  projectId?: string | null;
  correlationId?: string | null;
  reason?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const userId = input.userId?.trim();
  if (!userId) {
    // AuditLog.userId 必填；无用户时跳过（测试/纯服务路径用 console 结构化替代）
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
}): Promise<void> {
  await writeQmAuditEvent({
    event: "scope.resolution_denied",
    orgId: input.orgId,
    userId: input.userId,
    projectId: input.projectId,
    correlationId: input.correlationId,
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
