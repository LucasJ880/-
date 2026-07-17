import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { build30DayPlan } from "@/lib/marketing/plan";
import { logAudit } from "@/lib/audit/logger";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const plans = await db.marketingPlan.findMany({ where: { orgId: orgRes.orgId }, include: { items: { orderBy: [{ dayOffset: "asc" }, { priority: "asc" }] } }, orderBy: { createdAt: "desc" }, take: 10 });
  return NextResponse.json({ plans });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;
  const profile = await db.marketingBrandProfile.findUnique({ where: { orgId: orgRes.orgId }, select: { validationStatus: true } });
  if (profile?.validationStatus !== "valid") return NextResponse.json({ error: "企业事实中心校验通过后才能生成推广计划" }, { status: 409 });

  const startDate = body.startDate ? new Date(body.startDate) : new Date();
  startDate.setHours(0, 0, 0, 0);
  if (Number.isNaN(startDate.getTime())) return NextResponse.json({ error: "startDate 无效" }, { status: 400 });
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 29);
  const findings = await db.marketingFinding.findMany({ where: { orgId: orgRes.orgId, status: { in: ["open", "tasked"] } }, orderBy: { createdAt: "desc" }, take: 100 });
  const generated = build30DayPlan(findings, startDate);
  const plan = await db.marketingPlan.create({
    data: {
      orgId: orgRes.orgId,
      name: String(body.name || `${startDate.toISOString().slice(0, 10)} 30 天推广计划`).slice(0, 200),
      objective: String(body.objective || "修复高优先级营销问题并验证有效线索增长").slice(0, 1000),
      startDate,
      endDate,
      createdById: user.id,
      items: { create: generated.map((item) => ({ orgId: orgRes.orgId, ...item })) },
    },
    include: { items: { orderBy: { dayOffset: "asc" } } },
  });
  await logAudit({ userId: user.id, orgId: orgRes.orgId, action: "marketing_plan_generate", targetType: "marketing_plan", targetId: plan.id, afterData: { itemCount: plan.items.length }, request });
  return NextResponse.json({ plan }, { status: 201 });
});
