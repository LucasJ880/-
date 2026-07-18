import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { getActivepiecesReadiness, MARKETING_FLOW_KEYS, type MarketingFlowKey } from "@/lib/marketing/activepieces";
import { dispatchMarketingWorkflow } from "@/lib/marketing/workflows";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const runs = await db.marketingWorkflowRun.findMany({
    where: { orgId: orgRes.orgId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ readiness: getActivepiecesReadiness(), runs });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;
  const flowKey = String(body.flowKey || "") as MarketingFlowKey;
  if (!MARKETING_FLOW_KEYS.includes(flowKey)) {
    return NextResponse.json({ error: "不支持的营销自动流" }, { status: 400 });
  }
  if (flowKey === "mmm-run") {
    return NextResponse.json({ error: "MMM 必须从已版本化的数据集启动" }, { status: 400 });
  }
  try {
    const run = await dispatchMarketingWorkflow({
      orgId: orgRes.orgId,
      userId: user.id,
      flowKey,
      data: body.data && typeof body.data === "object" ? body.data : {},
    });
    await logAudit({
      userId: user.id,
      orgId: orgRes.orgId,
      action: "marketing_workflow_dispatch",
      targetType: "marketing_workflow_run",
      targetId: run.id,
      afterData: { flowKey, status: run.status },
      request,
    });
    return NextResponse.json({ run }, { status: run.status === "skipped" ? 202 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "自动流启动失败" }, { status: 502 });
  }
});
