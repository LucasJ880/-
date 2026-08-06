import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveSalesOrgIdForRequest, resolveSalesScope } from "@/lib/sales/org-context";
import { summarizeSalesActionEffectiveness } from "@/lib/sales/action-effectiveness";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const scope = await resolveSalesScope(user, orgRes.orgId, "sales.opportunity.read");
  if (!scope.allowed) return NextResponse.json({ error: "无权查看销售行动效果" }, { status: 403 });

  const requestedDays = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const ownership: Prisma.SalesActionWhereInput = scope.ownOnly ? {
    OR: [
      { assignedToId: user.id },
      { createdById: user.id },
      { opportunity: { OR: [{ assignedToId: user.id }, { createdById: user.id }] } },
    ],
  } : {};
  const actions = await db.salesAction.findMany({
    where: { orgId: orgRes.orgId, createdAt: { gte: since }, ...ownership },
    select: {
      id: true,
      signalKey: true,
      status: true,
      createdAt: true,
      startedAt: true,
      dueAt: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
      opportunityId: true,
      opportunity: { select: { stage: true, wonAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const result = summarizeSalesActionEffectiveness(actions.map((action) => ({
    id: action.id,
    signalKey: action.signalKey,
    status: action.status,
    createdAt: action.createdAt,
    startedAt: action.startedAt,
    dueAt: action.dueAt,
    assignedToId: action.assignedToId,
    assignedToName: action.assignedTo?.name ?? null,
    opportunityId: action.opportunityId,
    opportunityStage: action.opportunity?.stage ?? null,
    opportunityWonAt: action.opportunity?.wonAt ?? null,
  })));
  return NextResponse.json({ days, scope: scope.ownOnly ? "own" : "organization", ...result });
});
