/**
 * 销售话术库 API
 *
 * GET  /api/sales/playbooks       — 查询话术列表
 * POST /api/sales/playbooks       — 手动创建话术
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(request.url);
  const channel = url.searchParams.get("channel");
  const scene = url.searchParams.get("scene");
  const status = url.searchParams.get("status") || "active";
  const search = url.searchParams.get("q");

  const playbooks = await db.salesPlaybook.findMany({
    where: {
      userId: user.id,
      ...(channel ? { channel } : {}),
      ...(scene ? { scene } : {}),
      status,
      ...(search
        ? {
            OR: [
              { content: { contains: search, mode: "insensitive" } },
              { sceneLabel: { contains: search, mode: "insensitive" } },
              { tags: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ effectiveness: "desc" }, { usageCount: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  return NextResponse.json(playbooks);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();

  if (!body.channel || !body.scene || !body.content) {
    return NextResponse.json(
      { error: "缺少必填字段: channel, scene, content" },
      { status: 400 }
    );
  }

  const playbook = await db.salesPlaybook.create({
    data: {
      userId: user.id,
      channel: body.channel,
      language: body.language || "zh",
      scene: body.scene,
      sceneLabel: body.sceneLabel || body.scene,
      content: body.content,
      example: body.example || null,
      tags: body.tags || null,
      effectiveness: body.effectiveness || 0,
      status: "active",
    },
  });

  return NextResponse.json(playbook, { status: 201 });
}
