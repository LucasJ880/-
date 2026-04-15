/**
 * 单条 FAQ CRUD
 *
 * PATCH  /api/sales/faqs/:id  — 更新
 * DELETE /api/sales/faqs/:id  — 归档
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

export const PATCH = withAuth(async (request, ctx, user) => {
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
});

export const DELETE = withAuth(async (request, ctx, user) => {
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
});
