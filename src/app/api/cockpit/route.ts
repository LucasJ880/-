/**
 * 驾驶舱数据 API
 *
 * GET  /api/cockpit — 获取完整驾驶舱数据
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeCockpitData } from "@/lib/cockpit/metrics-engine";
import { withAuth } from "@/lib/common/api-helpers";

export const GET = withAuth(async (request, ctx, user) => {
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  const data = await computeCockpitData(membership.orgId);
  return NextResponse.json(data);
});
