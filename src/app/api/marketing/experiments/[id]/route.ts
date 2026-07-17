import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";

export const PATCH = withAuth(async (request, context, user) => {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;
  const previous = await db.marketingExperiment.findFirst({ where: { id, orgId: orgRes.orgId } });
  if (!previous) return NextResponse.json({ error: "实验不存在" }, { status: 404 });
  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = String(body.status);
  if (body.winnerVariantKey !== undefined) data.winnerVariantKey = body.winnerVariantKey ? String(body.winnerVariantKey) : null;
  if (body.learningSummary !== undefined) data.learningSummary = body.learningSummary ? String(body.learningSummary).slice(0, 8000) : null;
  if (body.endsAt !== undefined) data.endsAt = body.endsAt ? new Date(body.endsAt) : null;
  const experiment = await db.marketingExperiment.update({ where: { id }, data });
  await logAudit({ userId: user.id, orgId: orgRes.orgId, action: "marketing_experiment_update", targetType: "marketing_experiment", targetId: id, beforeData: previous, afterData: experiment, request });
  return NextResponse.json({ experiment });
});
