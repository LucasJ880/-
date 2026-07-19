import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";
import { writeMarketingMetricSnapshot } from "@/lib/marketing/metrics";
import { normalizeProviderHint } from "@/lib/marketing/channel-providers";
import {
  buildPaidMediaIngestionKey,
  isPaidMediaProvider,
  mapPaidMediaRowToMetricValues,
  weekEndFromStart,
} from "@/lib/marketing/providers/paid-media-mapper";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;
  const snapshots = await db.marketingMetricSnapshot.findMany({
    where: { orgId: orgRes.orgId },
    orderBy: { capturedAt: "desc" },
    take: 100,
  });
  const accountIds = [
    ...new Set(
      snapshots
        .map((row) => row.channelAccountId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const accounts = accountIds.length
    ? await db.marketingChannelAccount.findMany({
        where: { orgId: orgRes.orgId, id: { in: accountIds } },
        select: { id: true, name: true, provider: true },
      })
    : [];
  const accountMap = new Map(accounts.map((row) => [row.id, row]));
  return NextResponse.json({
    snapshots: snapshots.map((row) => ({
      ...row,
      channelAccount: row.channelAccountId
        ? accountMap.get(row.channelAccountId) || null
        : null,
    })),
  });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const providerHint = normalizeProviderHint(body.provider || body.source);
  let values: Record<string, unknown> = { ...body };
  let source = String(body.source || providerHint || "manual");
  let ingestionKey =
    typeof body.ingestionKey === "string" ? body.ingestionKey : null;

  if (isPaidMediaProvider(providerHint)) {
    values = mapPaidMediaRowToMetricValues(body, providerHint);
    if (body.channelAccountId) values.channelAccountId = body.channelAccountId;
    source = providerHint;
    const weekStart = String(values.periodStart || values.capturedAt).slice(0, 10);
    if (!values.periodEnd) values.periodEnd = weekEndFromStart(weekStart);
    ingestionKey =
      ingestionKey ||
      buildPaidMediaIngestionKey({
        provider: providerHint,
        weekStart,
        channelAccountId:
          typeof body.channelAccountId === "string" ? body.channelAccountId : null,
        externalAccountId:
          typeof body.externalAccountId === "string"
            ? body.externalAccountId
            : null,
      });
  } else if (body.granularity === "weekly" && body.capturedAt) {
    values.periodStart = body.periodStart || body.capturedAt;
    values.periodEnd =
      body.periodEnd || weekEndFromStart(String(body.capturedAt).slice(0, 10));
    values.granularity = "weekly";
  }

  let snapshot;
  try {
    snapshot = await writeMarketingMetricSnapshot({
      orgId: orgRes.orgId,
      userId: user.id,
      source,
      ingestionKey,
      values,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "渠道数据无效" },
      { status: 400 },
    );
  }
  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: "marketing_metric_manual_create",
    targetType: "marketing_metric_snapshot",
    targetId: snapshot.id,
    afterData: snapshot,
    request,
  });
  return NextResponse.json({ snapshot }, { status: 201 });
});
