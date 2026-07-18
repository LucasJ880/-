import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { requestMeridianRun } from "@/lib/marketing/mmm";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const runs = await db.mmmModelRun.findMany({
    where: { orgId: orgRes.orgId },
    include: {
      datasetVersion: { select: { id: true, name: true, status: true, weekCount: true, targetKpi: true } },
      contributions: true,
      scenarios: true,
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return NextResponse.json({ runs });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;
  try {
    const result = await requestMeridianRun({
      orgId: orgRes.orgId,
      userId: user.id,
      datasetVersionId: String(body.datasetVersionId || ""),
      exploratory: body.exploratory === true,
      config: body.config && typeof body.config === "object" ? body.config : {},
    });
    await logAudit({
      userId: user.id,
      orgId: orgRes.orgId,
      action: "marketing_mmm_run_request",
      targetType: "mmm_model_run",
      targetId: result.modelRun.id,
      afterData: { status: result.modelRun.status, exploratory: body.exploratory === true },
      request,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Meridian 运行启动失败" }, { status: 400 });
  }
});
