import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionByVariant,
} from "@/lib/visualizer/access";
import {
  buildDefaultProductOption,
  findMockProductById,
} from "@/lib/visualizer/mock-products";
import {
  validateOpacity,
  validateTransform,
} from "@/lib/visualizer/validators";
import type {
  CreateProductOptionRequest,
  VisualizerProductOptionDetail,
} from "@/lib/visualizer/types";

/**
 * POST /api/visualizer/variants/[variantId]/product-options
 * body: CreateProductOptionRequest
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { variantId } = await ctx.params;

  const found = await loadSessionByVariant(variantId);
  if (!found) {
    return NextResponse.json({ error: "方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权操作该方案" }, { status: 403 });
  }

  const body = await safeParseBody<CreateProductOptionRequest>(request);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  if (!body.regionId || typeof body.regionId !== "string") {
    return NextResponse.json({ error: "regionId 必填" }, { status: 400 });
  }
  if (!body.productCatalogId || typeof body.productCatalogId !== "string") {
    return NextResponse.json({ error: "productCatalogId 必填" }, { status: 400 });
  }

  const product = findMockProductById(body.productCatalogId);
  if (!product) {
    return NextResponse.json({ error: "产品不存在" }, { status: 400 });
  }

  // 确认 region 属于同一个 session
  const region = await db.visualizerWindowRegion.findUnique({
    where: { id: body.regionId },
    select: {
      id: true,
      sourceImage: { select: { sessionId: true } },
    },
  });
  if (!region) {
    return NextResponse.json({ error: "窗户区域不存在" }, { status: 400 });
  }
  if (region.sourceImage.sessionId !== found.session.id) {
    return NextResponse.json(
      { error: "窗户区域与方案不属于同一个可视化工作区" },
      { status: 400 },
    );
  }

  const base = buildDefaultProductOption(product);

  let opacity = base.opacity;
  if (body.opacity !== undefined) {
    const check = validateOpacity(body.opacity);
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
    opacity = check.value;
  }

  let transform = null;
  if (body.transform !== undefined) {
    const check = validateTransform(body.transform);
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
    transform = check.value;
  }

  const created = await db.visualizerProductOption.create({
    data: {
      variantId,
      regionId: body.regionId,
      productCatalogId: product.id,
      productName: product.name,
      productCategory: product.category,
      color: body.color?.trim() || base.color,
      colorHex: body.colorHex?.trim() || base.colorHex,
      opacity,
      mountingType: body.mountingType?.trim() || base.mountingType,
      transformJson: transform
        ? (transform as unknown as Prisma.InputJsonValue)
        : undefined,
      notes: body.notes?.trim() || null,
    },
  });
  await db.visualizerSession.update({
    where: { id: found.session.id },
    data: { updatedAt: new Date() },
  });

  const detail: VisualizerProductOptionDetail = {
    id: created.id,
    variantId: created.variantId,
    regionId: created.regionId,
    productCatalogId: created.productCatalogId,
    productName: created.productName,
    productCategory: created.productCategory,
    color: created.color,
    colorHex: created.colorHex,
    opacity: created.opacity,
    mountingType: created.mountingType,
    transform,
    notes: created.notes,
    createdAt: created.createdAt.toISOString(),
  };

  return NextResponse.json({ productOption: detail }, { status: 201 });
});
