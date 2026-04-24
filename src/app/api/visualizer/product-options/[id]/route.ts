import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionByProductOption,
} from "@/lib/visualizer/access";
import { findMockProductById } from "@/lib/visualizer/mock-products";
import {
  validateOpacity,
  validateTransform,
} from "@/lib/visualizer/validators";
import type {
  UpdateProductOptionRequest,
  VisualizerProductOptionDetail,
  VisualizerProductOptionTransform,
} from "@/lib/visualizer/types";

function parseTransform(raw: unknown): VisualizerProductOptionTransform | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const keys = ["offsetX", "offsetY", "scaleX", "scaleY", "rotation"] as const;
  const out = {} as VisualizerProductOptionTransform;
  for (const k of keys) {
    const v = t[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out;
}

/** PATCH /api/visualizer/product-options/[id] */
export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const found = await loadSessionByProductOption(id);
  if (!found) {
    return NextResponse.json({ error: "产品叠加不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权操作该产品叠加" }, { status: 403 });
  }

  const body = await safeParseBody<UpdateProductOptionRequest>(request);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (body.productCatalogId !== undefined) {
    const product = findMockProductById(body.productCatalogId);
    if (!product) {
      return NextResponse.json({ error: "产品不存在" }, { status: 400 });
    }
    data.productCatalogId = product.id;
    data.productName = product.name;
    data.productCategory = product.category;
  }

  if (body.color !== undefined) data.color = body.color?.trim() || null;
  if (body.colorHex !== undefined) data.colorHex = body.colorHex?.trim() || null;
  if (body.opacity !== undefined) {
    const check = validateOpacity(body.opacity);
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
    data.opacity = check.value;
  }
  if (body.mountingType !== undefined) {
    data.mountingType = body.mountingType?.trim() || null;
  }
  if (body.transform !== undefined) {
    const check = validateTransform(body.transform);
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
    data.transformJson = check.value
      ? (check.value as unknown as Prisma.InputJsonValue)
      : null;
  }
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const updated = await db.visualizerProductOption.update({
    where: { id },
    data,
  });
  await db.visualizerSession.update({
    where: { id: found.session.id },
    data: { updatedAt: new Date() },
  });

  const detail: VisualizerProductOptionDetail = {
    id: updated.id,
    variantId: updated.variantId,
    regionId: updated.regionId,
    productCatalogId: updated.productCatalogId,
    productName: updated.productName,
    productCategory: updated.productCategory,
    color: updated.color,
    colorHex: updated.colorHex,
    opacity: updated.opacity,
    mountingType: updated.mountingType,
    transform: parseTransform(updated.transformJson),
    notes: updated.notes,
    createdAt: updated.createdAt.toISOString(),
  };
  return NextResponse.json({ productOption: detail });
});

/** DELETE /api/visualizer/product-options/[id] */
export const DELETE = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;

  const found = await loadSessionByProductOption(id);
  if (!found) {
    return NextResponse.json({ error: "产品叠加不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权删除该产品叠加" }, { status: 403 });
  }

  await db.visualizerProductOption.delete({ where: { id } });
  await db.visualizerSession.update({
    where: { id: found.session.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
