import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { createWeeklyMmmDataset, type MmmTargetKpi } from "@/lib/marketing/mmm";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";

const TARGETS = new Set<MmmTargetKpi>(["qualifiedLeads", "wins", "revenue"]);

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const datasets = await db.mmmDatasetVersion.findMany({
    where: { orgId: orgRes.orgId },
    select: {
      id: true, name: true, periodStart: true, periodEnd: true, targetKpi: true,
      currency: true, rowCount: true, weekCount: true, status: true, checksum: true,
      qualityIssues: true, createdAt: true, _count: { select: { modelRuns: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return NextResponse.json({ datasets });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;
  const periodEnd = body.periodEnd ? new Date(body.periodEnd) : new Date();
  const periodStart = body.periodStart
    ? new Date(body.periodStart)
    : new Date(periodEnd.getTime() - 730 * 24 * 60 * 60 * 1000);
  const targetKpi = String(body.targetKpi || "qualifiedLeads") as MmmTargetKpi;
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return NextResponse.json({ error: "MMM 日期范围无效" }, { status: 400 });
  }
  if (!TARGETS.has(targetKpi)) return NextResponse.json({ error: "MMM 目标指标无效" }, { status: 400 });
  try {
    const dataset = await createWeeklyMmmDataset({
      orgId: orgRes.orgId,
      userId: user.id,
      periodStart,
      periodEnd,
      targetKpi,
      currency: String(body.currency || "CAD"),
    });
    await logAudit({
      userId: user.id,
      orgId: orgRes.orgId,
      action: "marketing_mmm_dataset_create",
      targetType: "mmm_dataset_version",
      targetId: dataset.id,
      afterData: { status: dataset.status, weekCount: dataset.weekCount, checksum: dataset.checksum },
      request,
    });
    return NextResponse.json({ dataset }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MMM 数据集生成失败" }, { status: 400 });
  }
});
