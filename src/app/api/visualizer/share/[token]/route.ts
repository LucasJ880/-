/**
 * GET /api/visualizer/share/[token]
 *
 * 公开只读：客户在销售离开后通过链接查看方案。
 * - 不要求登录
 * - 校验 shareToken + shareExpiresAt
 * - 输出剥离价格 / 内部 notes / createdById / salesOwnerId 等敏感字段
 * - 支持以 anonId（query/cookie）查询当前访客已选 variant
 *
 * 注意：本端点直接 NextResponse.json，不走 withAuth。
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isShareLive } from "@/lib/visualizer/share";
import type {
  VisualizerProductOptionTransform,
  VisualizerRegionShape,
  VisualizerSharePublicDetail,
  VisualizerSharePublicImage,
  VisualizerSharePublicVariant,
} from "@/lib/visualizer/types";

function parsePoints(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[number, number]> = [];
  for (const pt of raw) {
    if (
      Array.isArray(pt) &&
      pt.length === 2 &&
      typeof pt[0] === "number" &&
      typeof pt[1] === "number" &&
      Number.isFinite(pt[0]) &&
      Number.isFinite(pt[1])
    ) {
      out.push([pt[0], pt[1]]);
    }
  }
  return out;
}

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

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "链接无效" }, { status: 404 });
  }

  const session = await db.visualizerSession.findUnique({
    where: { shareToken: token },
    include: {
      customer: { select: { name: true } },
      sourceImages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fileUrl: true,
          width: true,
          height: true,
          roomLabel: true,
          regions: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              sourceImageId: true,
              shape: true,
              pointsJson: true,
            },
          },
        },
      },
      variants: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          exportImageUrl: true,
          sortOrder: true,
          productOptions: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              regionId: true,
              productCatalogId: true,
              productName: true,
              productCategory: true,
              color: true,
              colorHex: true,
              opacity: true,
              transformJson: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "链接无效" }, { status: 404 });
  }
  if (!isShareLive(session.shareToken, session.shareExpiresAt)) {
    return NextResponse.json({ error: "链接已过期" }, { status: 410 });
  }

  const url = new URL(request.url);
  const anonId = url.searchParams.get("anonId");

  let selectedVariantId: string | null = null;
  if (anonId) {
    const sel = await db.visualizerSelection.findFirst({
      where: {
        selectedBy: "customer",
        note: anonId.startsWith("anon:") ? anonId : `anon:${anonId}`,
        variant: { sessionId: session.id },
      },
      orderBy: { createdAt: "desc" },
      select: { variantId: true },
    });
    selectedVariantId = sel?.variantId ?? null;
  }

  const sourceImages: VisualizerSharePublicImage[] = session.sourceImages.map((img) => ({
    id: img.id,
    fileUrl: img.fileUrl,
    width: img.width,
    height: img.height,
    roomLabel: img.roomLabel,
    regions: img.regions.map((r) => ({
      id: r.id,
      sourceImageId: r.sourceImageId,
      shape: (r.shape === "rect" ? "rect" : "polygon") as VisualizerRegionShape,
      points: parsePoints(r.pointsJson),
    })),
  }));

  const variants: VisualizerSharePublicVariant[] = session.variants.map((v) => ({
    id: v.id,
    name: v.name,
    exportImageUrl: v.exportImageUrl,
    sortOrder: v.sortOrder,
    productOptions: v.productOptions.map((po) => ({
      id: po.id,
      regionId: po.regionId,
      productCatalogId: po.productCatalogId,
      productName: po.productName,
      productCategory: po.productCategory,
      color: po.color,
      colorHex: po.colorHex,
      opacity: po.opacity,
      transform: parseTransform(po.transformJson),
    })),
  }));

  const detail: VisualizerSharePublicDetail = {
    sessionId: session.id,
    title: session.title,
    customerName: session.customer.name,
    expiresAt: session.shareExpiresAt!.toISOString(),
    sourceImages,
    variants,
    selectedVariantId,
  };

  return NextResponse.json(detail, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
