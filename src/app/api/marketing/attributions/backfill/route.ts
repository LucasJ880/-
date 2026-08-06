import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";
import { syncCrmSourceAttributions } from "@/lib/marketing/crm-source-attribution";

function parseDay(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const periodStart = parseDay(body.periodStart);
  const periodEnd = parseDay(body.periodEnd, true);
  if (!periodStart || !periodEnd || periodEnd < periodStart) {
    return NextResponse.json(
      { error: "需要有效的开始和结束日期" },
      { status: 400 },
    );
  }
  if (periodEnd.getTime() - periodStart.getTime() > 10 * 366 * 24 * 3600 * 1000) {
    return NextResponse.json(
      { error: "单次 CRM 历史归总最长 10 年" },
      { status: 400 },
    );
  }

  const dryRun = body.dryRun !== false;
  const result = await syncCrmSourceAttributions({
    orgId: orgRes.orgId,
    userId: user.id,
    periodStart,
    periodEnd,
    dryRun,
  });

  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: dryRun
      ? "marketing_crm_attribution_preview"
      : "marketing_crm_attribution_backfill",
    targetType: "marketing_lead_attribution",
    targetId: orgRes.orgId,
    afterData: {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      ...result,
    },
    request,
  });

  return NextResponse.json({ result });
});
