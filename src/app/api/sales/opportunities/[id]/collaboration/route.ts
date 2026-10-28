/**
 * GET /api/sales/opportunities/:id/collaboration — 商机协作追踪（TASKFLOW S3）
 *
 * 询问、回复与 Muse 跟进按时间排成一条线。读权限与商机健康度接口同口径：
 * 销售只能看自己创建或负责的商机。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { loadFollowups } from "@/lib/muse-bridge/followup";
import { collaborationTrail } from "@/lib/muse-bridge/followup-pure";
import { loadInquiries } from "@/lib/muse-bridge/inquiry";
import { resolveSalesOrgIdForRequest, resolveSalesScope } from "@/lib/sales/org-context";

export const GET = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const opp = await db.salesOpportunity.findFirst({
    where: { id, orgId: orgRes.orgId },
    select: { id: true, createdById: true, assignedToId: true },
  });
  if (!opp) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const { ownOnly } = await resolveSalesScope(user, orgRes.orgId);
  if (ownOnly && opp.createdById !== user.id && opp.assignedToId !== user.id) {
    return NextResponse.json({ error: "无权访问该机会" }, { status: 403 });
  }

  const [inquiries, followups] = await Promise.all([loadInquiries(opp.id), loadFollowups(opp.id)]);
  return NextResponse.json({ items: collaborationTrail(inquiries, followups) });
});
