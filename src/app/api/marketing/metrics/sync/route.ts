/**
 * POST /api/marketing/metrics/sync
 * 触发 Activepieces sync-metrics，按 provider 拉取外部广告/分析数据后回调灌入。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";
import { dispatchMarketingWorkflow } from "@/lib/marketing/workflows";
import {
  isSyncableMetricProvider,
  normalizeProviderHint,
  SYNCABLE_METRIC_PROVIDERS,
} from "@/lib/marketing/channel-providers";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const providersRaw: Array<string | null> = Array.isArray(body.providers)
    ? body.providers.map((item: unknown) => normalizeProviderHint(item))
    : body.provider
      ? [normalizeProviderHint(body.provider)]
      : ["google_ads", "meta", "xiaohongshu"];

  const providers = [
    ...new Set(
      providersRaw.filter(
        (item): item is string =>
          typeof item === "string" && isSyncableMetricProvider(item),
      ),
    ),
  ];
  if (providers.length === 0) {
    return NextResponse.json(
      {
        error: `providers 无效，可选：${SYNCABLE_METRIC_PROVIDERS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const mode = body.mode === "backfill" ? "backfill" : "incremental";
  const periodStart = typeof body.periodStart === "string" ? body.periodStart.slice(0, 10) : null;
  const periodEnd = typeof body.periodEnd === "string" ? body.periodEnd.slice(0, 10) : null;
  if (mode === "backfill") {
    const start = periodStart ? new Date(`${periodStart}T00:00:00.000Z`) : null;
    const end = periodEnd ? new Date(`${periodEnd}T00:00:00.000Z`) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return NextResponse.json({ error: "历史回填需要有效的开始和结束日期" }, { status: 400 });
    }
    if (end.getTime() - start.getTime() > 37 * 31 * 24 * 3600 * 1000) {
      return NextResponse.json({ error: "单次细粒度回填最长 37 个月；更早数据请按月 CSV 导入" }, { status: 400 });
    }
  }

  const run = await dispatchMarketingWorkflow({
    orgId: orgRes.orgId,
    userId: user.id,
    flowKey: "sync-metrics",
    data: {
      providers,
      channelAccountId:
        typeof body.channelAccountId === "string" ? body.channelAccountId : null,
      lookbackDays:
        typeof body.lookbackDays === "number" ? Math.max(1, Math.min(90, body.lookbackDays)) : 7,
      mode,
      periodStart: mode === "backfill" ? periodStart : null,
      periodEnd: mode === "backfill" ? periodEnd : null,
    },
  });

  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: "marketing_metrics_sync_request",
    targetType: "marketing_workflow_run",
    targetId: run.id,
    afterData: { providers, status: run.status, mode, periodStart, periodEnd },
    request,
  });

  return NextResponse.json(
    {
      run,
      providers,
      mode,
      note:
        run.status === "skipped"
          ? "未配置 ACTIVEPIECES_MARKETING_SYNC_WEBHOOK_URL。可先用批量灌数 API / 指标页手工导入。"
          : "已请求同步。Activepieces 拉数后应回调 marketing.metrics.upsert。",
    },
    { status: run.status === "skipped" ? 202 : 201 },
  );
});
