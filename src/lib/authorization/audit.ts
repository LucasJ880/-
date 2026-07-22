/**
 * Security-1：授权相关审计（不记录密钥 / token）
 */

import { logAudit } from "@/lib/audit/logger";

export async function logAuthorizationChange(params: {
  actorUserId: string;
  orgId: string;
  action: string;
  targetType: string;
  targetPrincipalId?: string | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await logAudit({
    userId: params.actorUserId,
    orgId: params.orgId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetPrincipalId ?? undefined,
    beforeData: params.before,
    afterData: params.after,
  });
}
