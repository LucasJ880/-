/**
 * POST /api/marketing/metrics/bulk
 * 批量灌入周/日渠道指标（Google Ads / Meta / 小红书 / GA4）。
 * 同事手工导入、Activepieces、数字员工均可调用；幂等靠 ingestionKey。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";
import { ingestChannelMetricRows } from "@/lib/marketing/ingest-metrics";
import { normalizeProviderHint } from "@/lib/marketing/channel-providers";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const rows = Array.isArray(body.rows)
    ? body.rows
    : Array.isArray(body.snapshots)
      ? body.snapshots
      : null;
  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { error: "需要 rows 或 snapshots 数组（至少 1 条）" },
      { status: 400 },
    );
  }

  const provider = normalizeProviderHint(body.provider);
  try {
    const result = await ingestChannelMetricRows({
      orgId: orgRes.orgId,
      userId: user.id,
      provider,
      channelAccountId:
        typeof body.channelAccountId === "string" ? body.channelAccountId : null,
      externalAccountId:
        typeof body.externalAccountId === "string"
          ? body.externalAccountId
          : null,
      rows,
      externalEventId:
        typeof body.externalEventId === "string" ? body.externalEventId : null,
      maxRows: 1000,
    });

    await logAudit({
      userId: user.id,
      orgId: orgRes.orgId,
      action: "marketing_metrics_bulk_ingest",
      targetType: "marketing_metric_snapshot",
      targetId: result.channelAccountId || orgRes.orgId,
      afterData: {
        provider,
        written: result.written,
        total: rows.length,
        failed: result.results.filter((row) => !row.ok).length,
      },
      request,
    });

    const failed = result.results.filter((row) => !row.ok);
    return NextResponse.json(
      {
        written: result.written,
        failed: failed.length,
        channelAccountId: result.channelAccountId,
        results: result.results,
        note:
          "已幂等写入。MMM 使用渠道账号 provider 作为渠道键；请确保 spend 与主 KPI 齐全。",
      },
      { status: result.written > 0 ? 201 : 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量灌数失败" },
      { status: 400 },
    );
  }
});
