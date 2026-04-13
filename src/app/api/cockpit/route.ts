/**
 * 驾驶舱数据 API
 *
 * GET  /api/cockpit — 获取完整驾驶舱数据
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeCockpitData } from "@/lib/cockpit/metrics-engine";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  const data = await computeCockpitData(membership.orgId);
  return NextResponse.json(data);
}
