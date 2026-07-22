/**
 * GET/POST /api/capabilities/governance/quotas
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  capabilitiesErrorResponse,
  requireCapabilitiesAccess,
} from "@/lib/capabilities/http";
import {
  assertCanReadGovernance,
  assertCanWriteOrgQuota,
  assertCanWriteWorkspaceQuota,
  createQuotaPolicy,
  listQuotaPolicies,
  resolveEffectiveQuota,
  ALL_QUOTA_METRICS,
} from "@/lib/capabilities/governance";
import type { QuotaMetric, QuotaPeriod } from "@/lib/capabilities/governance";
import { isOrgAdminRole } from "@/lib/capabilities/access";

export async function GET(request: NextRequest) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    await assertCanReadGovernance(access);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");

    const policies = await listQuotaPolicies(
      access.orgId,
      workspaceId === null
        ? undefined
        : workspaceId === ""
          ? null
          : workspaceId,
    );

    // 非 org_admin：仅本 WS / 企业级只读
    const filtered = isOrgAdminRole(access.orgRole)
      ? policies
      : policies.filter(
          (p) =>
            !p.workspaceId || access.workspaceIds.includes(p.workspaceId),
        );

    const effective = await Promise.all(
      ALL_QUOTA_METRICS.map((metric) =>
        resolveEffectiveQuota({
          orgId: access.orgId,
          workspaceId: workspaceId || null,
          metric,
        }),
      ),
    );

    return NextResponse.json({
      orgId: access.orgId,
      policies: filtered,
      effective,
    });
  } catch (err) {
    return capabilitiesErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const access = await requireCapabilitiesAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const body = (await request.json()) as {
      workspaceId?: string | null;
      metric?: string;
      period?: string;
      warningLimit?: number | null;
      softLimit?: number | null;
      hardLimit?: number | null;
    };

    if (!body.metric || !body.period) {
      return NextResponse.json(
        { error: "metric / period 必填" },
        { status: 400 },
      );
    }

    const metric = body.metric as QuotaMetric;
    if (!ALL_QUOTA_METRICS.includes(metric)) {
      return NextResponse.json({ error: "不支持的 metric" }, { status: 400 });
    }

    if (body.workspaceId) {
      await assertCanWriteWorkspaceQuota(access, body.workspaceId);
    } else {
      assertCanWriteOrgQuota(access);
    }

    const row = await createQuotaPolicy({
      orgId: access.orgId,
      userId: access.userId,
      workspaceId: body.workspaceId ?? null,
      metric,
      period: body.period as QuotaPeriod,
      warningLimit: body.warningLimit,
      softLimit: body.softLimit,
      hardLimit: body.hardLimit,
    });

    return NextResponse.json({ policy: row }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "创建失败";
    if (msg.includes("不得高于")) {
      return NextResponse.json({ error: msg, code: "POLICY_RELAX_DENIED" }, { status: 400 });
    }
    return capabilitiesErrorResponse(err);
  }
}
