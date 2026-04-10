/**
 * 单条 FAQ CRUD
 *
 * PATCH  /api/sales/faqs/:id  — 更新
 * DELETE /api/sales/faqs/:id  — 归档
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

  const existing = await db.salesFAQ.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: "未找到" }, { status: 404 });
  }

  const updated = await db.salesFAQ.update({
    where: { id },
    data: {
      ...(body.question !== undefined ? { question: body.question } : {}),
      ...(body.answer !== undefined ? { answer: body.answer } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.categoryLabel !== undefined ? { categoryLabel: body.categoryLabel } : {}),
      ...(body.productTags !== undefined ? { productTags: body.productTags } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;

  const existing = await db.salesFAQ.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: "未找到" }, { status: 404 });
  }

  await db.salesFAQ.update({
    where: { id },
    data: { status: "archived" },
  });

  return NextResponse.json({ ok: true });
}
