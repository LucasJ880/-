import { after, NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionByVariant,
} from "@/lib/visualizer/access";
import {
  fetchBuffer,
  runImageEditDetailed,
} from "@/lib/visualizer/image-ai";
import { putVisualizerHdRender } from "@/lib/visualizer/upload";
import {
  evaluateReferenceQuality,
  pickCatalogReferencesForRender,
} from "@/lib/visualizer/catalog-reference";
import { resolveHdRoomSourceImage } from "@/lib/visualizer/hd-source-image";
import { buildHdWindowMask } from "@/lib/visualizer/hd-window-mask";
import { buildHdRenderPrompt } from "@/lib/visualizer/hd-render-prompt";
import {
  RENDER_JOB_STALE_MS,
  normalizeRenderTier,
  renderTierToImageQuality,
} from "@/lib/visualizer/render-job";
import type { VisualizerRegionShape } from "@/lib/visualizer/types";

// AI 渲染 1–2 分钟：请求本身立即返回，after() 后置执行需要完整时长
export const maxDuration = 300;

type RenderBody = {
  /** @deprecated 仅兼容旧客户端；不得作为 AI 主输入 */
  dataUrl?: string;
  instruction?: string;
  /** 编辑器当前选中房间图（可选偏好） */
  sourceImageId?: string;
  /** 渲染档位：fast=快速预览（medium），fine=精修（high）；缺省 fast */
  tier?: string;
};

/**
 * POST /api/visualizer/variants/[variantId]/render-hd
 *
 * 异步模式：前置校验通过后立即 202 返回并标记 renderJobStatus=rendering，
 * 真正的 AI 生成在 after() 里执行，客户端轮询 GET /variants/[variantId]。
 * 弱网/切页/锁屏不再导致渲染作废；防重入靠原子 claim + 陈旧阈值。
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { variantId } = await ctx.params;
  const found = await loadSessionByVariant(variantId);
  if (!found) return NextResponse.json({ error: "方案不存在" }, { status: 404 });
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权操作该方案" }, { status: 403 });
  }

  const body = (await safeParseBody<RenderBody>(request)) ?? {};
  if (body.dataUrl) {
    console.info(
      "[render-hd] ignoring deprecated composed dataUrl for AI primary input",
      { variantId, dataUrlBytes: body.dataUrl.length },
    );
  }
  const tier = normalizeRenderTier(body.tier);

  const variant = await db.visualizerVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      exportImageUrl: true,
      renderJobStatus: true,
      renderJobStartedAt: true,
      productOptions: {
        select: {
          regionId: true,
          productCatalogId: true,
          productName: true,
          productCategory: true,
          color: true,
          colorHex: true,
          opacity: true,
          mountingType: true,
        },
      },
    },
  });
  if (!variant) {
    return NextResponse.json({ error: "方案不存在" }, { status: 404 });
  }

  const previousExportImageUrl = variant.exportImageUrl;

  if (variant.productOptions.length === 0) {
    return NextResponse.json(
      {
        error: "请先为方案窗户选择产品并确认区域后再高清渲染",
        code: "SCENE_REGION_NOT_CONFIRMED",
      },
      { status: 400 },
    );
  }

  const regionIds = [...new Set(variant.productOptions.map((o) => o.regionId))];
  const regions = await db.visualizerWindowRegion.findMany({
    where: { id: { in: regionIds } },
    select: {
      id: true,
      sourceImageId: true,
      shape: true,
      pointsJson: true,
    },
  });

  const sourceImages = await db.visualizerSourceImage.findMany({
    where: { sessionId: found.session.id },
    select: {
      id: true,
      fileUrl: true,
      mimeType: true,
      width: true,
      height: true,
      note: true,
      fileName: true,
      createdAt: true,
    },
  });

  const resolved = resolveHdRoomSourceImage({
    productOptionRegionIds: variant.productOptions.map((o) => o.regionId),
    regions,
    sourceImages,
    preferredSourceImageId: body.sourceImageId ?? null,
    composedDataUrl: body.dataUrl ?? null,
  });
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.message, code: resolved.code },
      { status: 400 },
    );
  }

  // 区域坐标挂在 regionSourceImage；若选用 cleaned 必须与区域图同尺寸
  const regionSource = sourceImages.find(
    (i) => i.id === resolved.regionSourceImageId,
  );
  let primary = resolved;
  if (
    resolved.sourceImageId !== resolved.regionSourceImageId &&
    (!regionSource?.width ||
      !regionSource.height ||
      regionSource.width !== resolved.width ||
      regionSource.height !== resolved.height)
  ) {
    if (
      !regionSource?.fileUrl ||
      !regionSource.width ||
      !regionSource.height
    ) {
      return NextResponse.json(
        {
          error: "找不到客户房间原图，无法进行高清渲染",
          code: "SOURCE_ROOM_IMAGE_MISSING",
        },
        { status: 400 },
      );
    }
    primary = {
      ok: true,
      sourceImageId: regionSource.id,
      fileUrl: regionSource.fileUrl,
      mimeType: regionSource.mimeType || "image/png",
      width: regionSource.width,
      height: regionSource.height,
      kind: "original",
      regionSourceImageId: regionSource.id,
    };
  }

  const regionById = new Map(regions.map((r) => [r.id, r]));
  const maskRegions = variant.productOptions.map((option) => {
    const region = regionById.get(option.regionId);
    const points = Array.isArray(region?.pointsJson)
      ? (region!.pointsJson as Array<[number, number]>)
      : [];
    return {
      shape: (region?.shape === "polygon" ? "polygon" : "rect") as VisualizerRegionShape,
      points,
      productCategory: option.productCategory,
    };
  });

  const maskResult = buildHdWindowMask({
    width: primary.width,
    height: primary.height,
    regions: maskRegions,
  });
  if (!maskResult.ok) {
    return NextResponse.json(
      {
        error: maskResult.message,
        code: maskResult.code,
        exportImageUrl: previousExportImageUrl,
      },
      { status: 400 },
    );
  }

  const catalogIds = [
    ...new Set(variant.productOptions.map((option) => option.productCatalogId)),
  ];
  const products =
    catalogIds.length > 0
      ? await db.visualizerCatalogProduct.findMany({
          where: { id: { in: catalogIds }, archived: false },
          include: { assets: true },
        })
      : [];

  const referenceCandidates = products
    .flatMap((product) => {
      const picked = pickCatalogReferencesForRender(product.assets, 8);
      return picked.map((asset) => ({ product, asset }));
    })
    .slice(0, 8);

  const effectiveQuality = evaluateReferenceQuality(
    referenceCandidates.map(({ asset }) => asset),
  );

  // ── 原子 claim：已有活跃任务则拒绝（陈旧 rendering 允许覆盖重试） ──
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - RENDER_JOB_STALE_MS);
  const claimed = await db.visualizerVariant.updateMany({
    where: {
      id: variantId,
      OR: [
        { renderJobStatus: null },
        { renderJobStatus: { notIn: ["rendering"] } },
        { renderJobStartedAt: null },
        { renderJobStartedAt: { lt: staleCutoff } },
      ],
    },
    data: {
      renderJobStatus: "rendering",
      renderJobQuality: tier,
      renderJobError: null,
      renderJobStartedAt: now,
    },
  });
  if (claimed.count === 0) {
    return NextResponse.json(
      {
        error: "该方案正在渲染中，请等它完成或失败后再试",
        code: "RENDER_ALREADY_RUNNING",
        renderJob: {
          status: "rendering",
          startedAt: variant.renderJobStartedAt?.toISOString() ?? null,
        },
      },
      { status: 409 },
    );
  }

  const sessionId = found.session.id;
  const instruction = body.instruction;
  const productOptions = variant.productOptions;
  const referenceMeta = referenceCandidates;

  const failJob = async (message: string, code: string) => {
    await db.visualizerVariant
      .update({
        where: { id: variantId },
        data: {
          renderJobStatus: "failed",
          renderJobError: `${message}（${code}）`,
        },
      })
      .catch((e) => console.error("[render-hd] fail-state write failed:", e));
  };

  // ── 慢工作后置：下载图片 → AI 生成 → 上传 → 落库 ──
  after(async () => {
    try {
      const roomBuffer = await fetchBuffer(primary.fileUrl);
      if (!roomBuffer) {
        await failJob("房间图下载失败", "SOURCE_ROOM_IMAGE_MISSING");
        return;
      }

      const loadedReferences = await Promise.all(
        referenceMeta.map(async ({ product, asset }) => {
          const buffer = await fetchBuffer(asset.fileUrl);
          return buffer ? { product, asset, buffer } : null;
        }),
      );
      const usableReferences = loadedReferences.filter(
        (item): item is NonNullable<typeof item> => item !== null,
      );

      const prompt = buildHdRenderPrompt({
        productOptions,
        references: usableReferences.map(({ product, asset }, index) => ({
          index,
          role: asset.role,
          productName: product.name,
          sourceType: asset.sourceType,
          verificationStatus: asset.verificationStatus,
        })),
        customInstruction: instruction,
      });

      const rendered = await runImageEditDetailed({
        imageBuffer: roomBuffer,
        imageMime: primary.mimeType,
        maskBuffer: maskResult.maskBuffer,
        prompt,
        referenceImages: usableReferences.map(({ asset, buffer }) => ({
          buffer,
          mime: asset.mimeType,
          fileName: asset.fileName,
        })),
        quality: renderTierToImageQuality(tier),
      });

      if (!rendered.buffer) {
        await failJob(
          "AI 渲染失败，当前画面仍为编辑预览，并非最终效果图。请重试。",
          rendered.providerErrorCode ?? "AI_RENDER_FAILED",
        );
        return;
      }

      const uploaded = await putVisualizerHdRender({
        sessionId,
        variantId,
        buffer: rendered.buffer,
      });
      if (!uploaded?.url) {
        await failJob(
          "效果图保存失败，当前画面仍为编辑预览。请重试。",
          "HD_BLOB_SAVE_FAILED",
        );
        return;
      }

      await db.visualizerVariant.update({
        where: { id: variantId },
        data: {
          exportImageUrl: uploaded.url,
          renderJobStatus: "done",
          renderJobError: null,
        },
      });
      await db.visualizerSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });
    } catch (err) {
      console.error("[render-hd] async render failed:", err);
      await failJob(
        "AI 渲染失败，当前画面仍为编辑预览，并非最终效果图。请重试。",
        "AI_RENDER_FAILED",
      );
    }
  });

  return NextResponse.json(
    {
      jobStarted: true,
      renderJob: {
        status: "rendering",
        tier,
        startedAt: now.toISOString(),
      },
      referenceQuality: effectiveQuality.referenceQuality,
      warning: effectiveQuality.warning,
      warningCode: effectiveQuality.warningCode,
      sourceImage: {
        id: primary.sourceImageId,
        kind: primary.kind,
        width: primary.width,
        height: primary.height,
      },
      mask: {
        width: maskResult.width,
        height: maskResult.height,
        regionCount: maskResult.expandedRegions.length,
      },
    },
    { status: 202 },
  );
});
