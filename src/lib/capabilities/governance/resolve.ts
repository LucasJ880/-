/**
 * 有效配额解析：Platform → Org → Workspace（只能收紧）
 */

import { db } from "@/lib/db";
import { PLATFORM_DEFAULT_QUOTAS } from "./defaults";
import type { EffectiveQuotaProjection, QuotaMetric } from "./types";

function toNum(v: { toString(): string } | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  return Number(v.toString());
}

/** 取更严（更小）的正数上限 */
function tighter(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.min(a, b);
}

export async function resolveEffectiveQuota(opts: {
  orgId: string;
  workspaceId?: string | null;
  metric: QuotaMetric;
  occurredAt?: Date;
}): Promise<EffectiveQuotaProjection> {
  const at = opts.occurredAt ?? new Date();
  const platform = PLATFORM_DEFAULT_QUOTAS[opts.metric];
  const sources: EffectiveQuotaProjection["sourcePolicies"] = [
    { scope: "PLATFORM", policyId: "platform-default", version: 1 },
  ];

  let warningLimit: number | null = platform.warningLimit;
  let softLimit: number | null = platform.softLimit;
  let hardLimit: number | null = platform.hardLimit;
  let period = platform.period;

  const orgPolicy = await db.capabilityQuotaPolicy.findFirst({
    where: {
      orgId: opts.orgId,
      workspaceId: null,
      metric: opts.metric,
      enabled: true,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { version: "desc" },
  });

  if (orgPolicy) {
    sources.push({
      scope: "ORGANIZATION",
      policyId: orgPolicy.id,
      version: orgPolicy.version,
    });
    period = orgPolicy.period as typeof period;
    warningLimit = tighter(warningLimit, toNum(orgPolicy.warningLimit));
    softLimit = tighter(softLimit, toNum(orgPolicy.softLimit));
    hardLimit = tighter(hardLimit, toNum(orgPolicy.hardLimit));
  }

  if (opts.workspaceId) {
    const wsPolicy = await db.capabilityQuotaPolicy.findFirst({
      where: {
        orgId: opts.orgId,
        workspaceId: opts.workspaceId,
        metric: opts.metric,
        enabled: true,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { version: "desc" },
    });
    if (wsPolicy) {
      // Workspace 不得放宽 Org/Platform hard
      const wsHard = toNum(wsPolicy.hardLimit);
      if (wsHard != null && hardLimit != null && wsHard > hardLimit) {
        // 忽略非法放宽，仍记录来源尝试
        sources.push({
          scope: "WORKSPACE",
          policyId: wsPolicy.id,
          version: wsPolicy.version,
        });
      } else {
        sources.push({
          scope: "WORKSPACE",
          policyId: wsPolicy.id,
          version: wsPolicy.version,
        });
        warningLimit = tighter(warningLimit, toNum(wsPolicy.warningLimit));
        softLimit = tighter(softLimit, toNum(wsPolicy.softLimit));
        hardLimit = tighter(hardLimit, wsHard);
        period = wsPolicy.period as typeof period;
      }
    }
  }

  return {
    metric: opts.metric,
    period,
    warningLimit,
    softLimit,
    hardLimit,
    sourcePolicies: sources,
  };
}
