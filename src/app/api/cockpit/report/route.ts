/**
 * 周报 API
 *
 * GET  /api/cockpit/report — 获取本周周报
 * POST /api/cockpit/report — 生成/刷新周报
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateWeeklyReport, getLatestReport } from "@/lib/cockpit/weekly-report";

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

  const report = await getLatestReport(membership.orgId);
  if (!report) {
    return NextResponse.json({ report: null, message: "本周尚未生成周报" });
  }

  return NextResponse.json({ report });
}

export async function POST(req: NextRequest) {
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

  const report = await generateWeeklyReport(membership.orgId);
  return NextResponse.json({ report });
}
