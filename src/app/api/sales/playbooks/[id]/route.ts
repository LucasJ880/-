/**
 * 单条话术 CRUD
 *
 * PATCH  /api/sales/playbooks/:id  — 更新（内容/评分/状态）
 * DELETE /api/sales/playbooks/:id  — 归档
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json();

  const existing = await db.salesPlaybook.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: "未找到" }, { status: 404 });
  }

  const updated = await db.salesPlaybook.update({
    where: { id },
    data: {
      ...(body.content !== undefined ? { content: body.content } : {}),
      ...(body.example !== undefined ? { example: body.example } : {}),
      ...(body.effectiveness !== undefined ? { effectiveness: body.effectiveness } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.scene !== undefined ? { scene: body.scene } : {}),
      ...(body.sceneLabel !== undefined ? { sceneLabel: body.sceneLabel } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;

  const existing = await db.salesPlaybook.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: "未找到" }, { status: 404 });
  }

  await db.salesPlaybook.update({
    where: { id },
    data: { status: "archived" },
  });

  return NextResponse.json({ ok: true });
}
