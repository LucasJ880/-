/**
 * GET /api/display/summary — 门口大屏只读聚合数据
 *
 * 公开路由但需展示 token（?token= 对比 DISPLAY_TOKEN 环境变量），
 * 只返回聚合数字，绝不包含客户姓名/电话/金额等明细。
 * DISPLAY_ORG_ID 可选：限定 org 隔离表的统计范围（排除测试组织）。
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const maxDuration = 30;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

export async function GET(request: NextRequest) {
  const displayToken = process.env.DISPLAY_TOKEN;
  if (!displayToken) {
    return NextResponse.json({ error: "display not configured" }, { status: 503 });
  }
  if (request.nextUrl.searchParams.get("token") !== displayToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const orgId = process.env.DISPLAY_ORG_ID || undefined;
  const orgWhere = orgId ? { orgId } : {};

  const [
    customersTotal,
    customersThisMonth,
    installsCompleted,
    ordersInProgress,
    rendersTotal,
    aiMessagesToday,
  ] = await Promise.all([
    db.salesCustomer.count({ where: { ...orgWhere } }),
    db.salesCustomer.count({
      where: { ...orgWhere, createdAt: { gte: startOfMonth() } },
    }),
    db.blindsOrder.count({ where: { status: { in: ["installed", "completed"] } } }),
    db.blindsOrder.count({
      where: { status: { in: ["confirmed", "in_production", "ready", "scheduled"] } },
    }),
    db.visualizerVariant.count(),
    db.weChatMessage.count({
      where: { ...(orgId ? { orgId } : {}), createdAt: { gte: startOfToday() } },
    }),
  ]);

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      customersTotal,
      customersThisMonth,
      installsCompleted,
      ordersInProgress,
      rendersTotal,
      aiMessagesToday,
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
