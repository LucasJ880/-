/**
 * 单条话术 CRUD
 *
 * PATCH  /api/sales/playbooks/:id  — 更新（内容/评分/状态）
 * DELETE /api/sales/playbooks/:id  — 归档
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

export const PATCH = withAuth(async (request, ctx, user) => {
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
});

export const DELETE = withAuth(async (_request, ctx, user) => {
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
});
