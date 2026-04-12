/**
 * 供应商 AI 分类 API
 *
 * POST /api/suppliers/:id/classify — 触发单个供应商的 AI 自动分类
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { classifySupplier } from "@/lib/supplier/classifier";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;

  try {
    const result = await classifySupplier(id);
    return NextResponse.json({
      supplierId: id,
      tags: result.tags,
      capabilities: result.capabilities,
      mainCategory: result.mainCategory,
      subCategories: result.subCategories,
      confidence: result.confidence,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "分类失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
