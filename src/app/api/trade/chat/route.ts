/**
 * Trade Chat Sessions API
 * GET  — 列出用户的对话
 * POST — 创建新对话
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const sessions = await db.tradeChatSession.findMany({
    where: { userId: auth.user.id, orgId: orgRes.orgId, status: "active" },
    orderBy: { updatedAt: "desc" },
    take: 20,
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, createdAt: true } },
    },
  });

  return NextResponse.json(sessions);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const session = await db.tradeChatSession.create({
    data: {
      orgId: orgRes.orgId,
      userId: auth.user.id,
      title: body.title ?? "新对话",
    },
  });

  return NextResponse.json(session, { status: 201 });
}
