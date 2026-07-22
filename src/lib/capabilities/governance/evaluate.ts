import { resolveEffectiveQuota } from "./resolve";
import { getQuotaCurrentUsage } from "./usage-counters";
import type { QuotaEvalResult, QuotaMetric } from "./types";
import { writeCapabilityAuditEvent } from "./audit";

export async function evaluateQuota(opts: {
  orgId: string;
  userId: string;
  workspaceId?: string | null;
  metric: QuotaMetric;
  requestedAmount: number;
  idempotencyKey?: string;
}): Promise<QuotaEvalResult> {
  if (!opts.orgId) {
    return {
      allowed: false,
      level: "HARD_LIMIT",
      currentUsage: 0,
      requestedAmount: opts.requestedAmount,
      projectedUsage: opts.requestedAmount,
      policySources: [],
      reasonCode: "missing_orgId",
    };
  }

  const effective = await resolveEffectiveQuota({
    orgId: opts.orgId,
    workspaceId: opts.workspaceId,
    metric: opts.metric,
  });
  const currentUsage = await getQuotaCurrentUsage({
    orgId: opts.orgId,
    workspaceId: opts.workspaceId,
    metric: opts.metric,
  });
  const projected = currentUsage + Math.max(0, opts.requestedAmount);

  let level: QuotaEvalResult["level"] = "OK";
  if (effective.hardLimit != null && projected > effective.hardLimit) {
    level = "HARD_LIMIT";
  } else if (effective.softLimit != null && projected > effective.softLimit) {
    level = "SOFT_LIMIT";
  } else if (
    effective.warningLimit != null &&
    projected > effective.warningLimit
  ) {
    level = "WARNING";
  }

  const allowed = level !== "HARD_LIMIT";
  const remaining =
    effective.hardLimit != null
      ? Math.max(0, effective.hardLimit - currentUsage)
      : null;

  if (level === "WARNING" || level === "SOFT_LIMIT" || level === "HARD_LIMIT") {
    await writeCapabilityAuditEvent({
      orgId: opts.orgId,
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      action:
        level === "HARD_LIMIT"
          ? "QUOTA_HARD_LIMIT_BLOCKED"
          : level === "SOFT_LIMIT"
            ? "QUOTA_SOFT_LIMIT_REACHED"
            : "QUOTA_WARNING",
      resourceType: "quota",
      resourceId: opts.metric,
      result: allowed ? "allowed" : "blocked",
      riskLevel: level === "HARD_LIMIT" ? "HIGH" : "MEDIUM",
      metadata: {
        metric: opts.metric,
        currentUsage,
        projected,
        hardLimit: effective.hardLimit,
      },
    });
  }

  return {
    allowed,
    level,
    currentUsage,
    requestedAmount: opts.requestedAmount,
    projectedUsage: projected,
    warningLimit: effective.warningLimit,
    softLimit: effective.softLimit,
    hardLimit: effective.hardLimit,
    remaining,
    policySources: effective.sourcePolicies,
    reasonCode: allowed ? undefined : "quota_hard_limit",
  };
}
