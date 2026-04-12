/**
 * Trade Chat Sessions API
 * GET  — 列出用户的对话
 * POST — 创建新对话
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const sessions = await db.tradeChatSession.findMany({
    where: { userId: auth.user.id, status: "active" },
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

  const session = await db.tradeChatSession.create({
    data: {
      orgId: body.orgId ?? "default",
      userId: auth.user.id,
      title: body.title ?? "新对话",
    },
  });

  return NextResponse.json(session, { status: 201 });
}
