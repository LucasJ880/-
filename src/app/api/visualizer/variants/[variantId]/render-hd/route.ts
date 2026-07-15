import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionByVariant,
} from "@/lib/visualizer/access";
import { fetchBuffer, runImageEdit } from "@/lib/visualizer/image-ai";
import {
  parsePngDataUrl,
  putVisualizerHdRender,
} from "@/lib/visualizer/upload";

type RenderBody = { dataUrl?: string; instruction?: string };

const ASSET_ROLE_PRIORITY: Record<string, number> = {
  installed: 0,
  texture: 1,
  detail: 2,
  swatch: 3,
  style_reference: 4,
};

export const POST = withAuth(async (request, ctx, user) => {
  const { variantId } = await ctx.params;
  const found = await loadSessionByVariant(variantId);
  if (!found) return NextResponse.json({ error: "方案不存在" }, { status: 404 });
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权操作该方案" }, { status: 403 });
  }

  const body = await safeParseBody<RenderBody>(request);
  if (!body?.dataUrl) {
    return NextResponse.json({ error: "dataUrl 必填" }, { status: 400 });
  }
  const parsed = parsePngDataUrl(body.dataUrl);
  if (!parsed) {
    return NextResponse.json(
      { error: "dataUrl 非法（仅支持 PNG 且不超过体积上限）" },
      { status: 400 },
    );
  }

  const productOptions = await db.visualizerProductOption.findMany({
    where: { variantId },
    select: {
      productCatalogId: true,
      productName: true,
      productCategory: true,
      color: true,
      colorHex: true,
      opacity: true,
      mountingType: true,
    },
  });
  const catalogIds = [...new Set(productOptions.map((option) => option.productCatalogId))];
  const products =
    catalogIds.length > 0
      ? await db.visualizerCatalogProduct.findMany({
          where: { id: { in: catalogIds }, archived: false },
          include: { assets: true },
        })
      : [];

  const referenceCandidates = products.flatMap((product) => {
    const sorted = [...product.assets].sort((a, b) => {
      const roleDiff = (ASSET_ROLE_PRIORITY[a.role] ?? 99) - (ASSET_ROLE_PRIORITY[b.role] ?? 99);
      if (roleDiff !== 0) return roleDiff;
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
    const seenRoles = new Set<string>();
    return sorted.filter((asset) => {
      if (seenRoles.has(asset.role)) return false;
      seenRoles.add(asset.role);
      return true;
    }).map((asset) => ({ product, asset }));
  }).slice(0, 8);

  const loadedReferences = await Promise.all(
    referenceCandidates.map(async ({ product, asset }) => {
      const buffer = await fetchBuffer(asset.fileUrl);
      return buffer ? { product, asset, buffer } : null;
    }),
  );
  const usableReferences = loadedReferences.filter(
    (item): item is NonNullable<typeof item> => item !== null,
  );
  const referenceGuide = usableReferences.map(
    ({ product, asset }, index) =>
      `Input image ${index + 2}: ${asset.role} reference for product "${product.name}"; source=${asset.sourceType}.`,
  );
  const selectedProductGuide = productOptions.map(
    (option) =>
      `Use ${option.productName} (${option.productCategory}), color ${option.color ?? "default"} ${option.colorHex ?? ""}, ` +
      `opacity ${Math.round(option.opacity * 100)}%, mounting ${option.mountingType ?? "unspecified"}.`,
  );
  const customInstruction =
    typeof body.instruction === "string" && body.instruction.trim()
      ? `Sales instruction: ${body.instruction.trim().slice(0, 500)}.`
      : "";
  const prompt = [
    "Create a high-definition photorealistic window covering sales visualization.",
    "Input image 1 is the customer's room composite and is the only scene to edit.",
    ...referenceGuide,
    ...selectedProductGuide,
    "Use later input images only as product identity, construction, texture, material, and style references. Do not copy their rooms or backgrounds.",
    "Preserve the customer's room layout, camera angle, perspective, walls, floor, furniture, window frame, glass area, and lighting direction.",
    "Replace only the indicated window-covering areas. Keep every other pixel visually consistent with input image 1.",
    "Match the selected product category, band pattern or folds, hardware, mounting, material texture, opacity, and color as closely as possible.",
    "Add realistic edges, natural shadows, and physically plausible light transmission through sheer or translucent fabric.",
    "Do not add windows, furniture, decor, people, text, logos, watermarks, or a different time of day.",
    customInstruction,
    "Output one photorealistic image with the same aspect ratio as input image 1.",
  ].filter(Boolean).join(" ");

  const rendered = await runImageEdit({
    imageBuffer: parsed.buffer,
    imageMime: "image/png",
    prompt,
    referenceImages: usableReferences.map(({ asset, buffer }) => ({
      buffer,
      mime: asset.mimeType,
      fileName: asset.fileName,
    })),
    quality: "high",
  });
  if (!rendered) {
    return NextResponse.json({ error: "高清渲染失败，请稍后重试" }, { status: 502 });
  }

  const uploaded = await putVisualizerHdRender({
    sessionId: found.session.id,
    variantId,
    buffer: rendered,
  });
  const updated = await db.visualizerVariant.update({
    where: { id: variantId },
    data: { exportImageUrl: uploaded.url },
    select: { exportImageUrl: true, updatedAt: true },
  });
  await db.visualizerSession.update({
    where: { id: found.session.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({
    exportImageUrl: updated.exportImageUrl,
    updatedAt: updated.updatedAt.toISOString(),
  });
});
