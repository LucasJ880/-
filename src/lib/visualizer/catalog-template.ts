/**
 * AI 标准安装模板生成服务
 *
 * - 中性房间底图（环境变量）作为 Image Edit 第一张图
 * - 产品 texture/detail/swatch 作为后续参考图
 * - 输出保存为 style_reference + ai_generated + ai_reference
 */

import { db } from "@/lib/db";
import { getAIConfig } from "@/lib/ai/config";
import { fetchBuffer, runImageEditDetailed } from "@/lib/visualizer/image-ai";
import { putVisualizerCatalogPreview } from "@/lib/visualizer/upload";
import { evaluateCatalogReadiness } from "@/lib/visualizer/catalog-readiness";
import { toCatalogDetail } from "@/lib/visualizer/catalog";
import type {
  VisualizerCatalogProductDetail,
  VisualizerCatalogTemplateType,
} from "@/lib/visualizer/types";

export const CATALOG_TEMPLATE_PROMPT_VERSION = "catalog-template-v1";

export const CATALOG_TEMPLATE_TYPES: VisualizerCatalogTemplateType[] = [
  "standard_floor_to_ceiling_day",
  "modern_living_room_day",
];

/** 每种模板最多保留的 AI 图数量 */
export const MAX_AI_TEMPLATES_PER_TYPE = 2;

const SOURCE_ROLES = new Set(["texture", "detail", "swatch"]);

export class CatalogTemplateError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "CatalogTemplateError";
  }
}

export function isCatalogTemplateType(
  v: unknown,
): v is VisualizerCatalogTemplateType {
  return (
    typeof v === "string" &&
    (CATALOG_TEMPLATE_TYPES as string[]).includes(v)
  );
}

export function resolveTemplateRoomUrl(
  templateType: VisualizerCatalogTemplateType,
): string | null {
  const key =
    templateType === "standard_floor_to_ceiling_day"
      ? "VISUALIZER_TEMPLATE_STANDARD_ROOM_URL"
      : "VISUALIZER_TEMPLATE_LIVING_ROOM_URL";
  const url = (process.env[key] ?? "").trim();
  if (!url) return null;
  // 仅允许本系统私有 Blob 代理路径或已配置的绝对私有路径；禁止随意第三方 URL 入库为业务来源
  if (
    url.startsWith("/api/files/") ||
    url.includes(".blob.vercel-storage.com") ||
    url.startsWith("visualizer/")
  ) {
    return url;
  }
  return null;
}

export function buildCatalogTemplatePrompt(input: {
  category: string;
  name: string;
  referenceCount: number;
}): string {
  const categoryHint = categoryPromptHint(input.category);
  const refLines = Array.from({ length: input.referenceCount }, (_, i) => {
    return `Input image ${i + 2} is a product reference only (texture, detail, or swatch).`;
  });

  return [
    "Create a standardized photorealistic installation reference image for a window-covering product.",
    "Input image 1 is the neutral room scene and is the only scene to edit.",
    ...refLines,
    "Install the referenced window-covering product on the main window.",
    "Preserve the room architecture, camera angle, walls, floor, window geometry and lighting.",
    `Product name: ${input.name}. Category: ${input.category}.`,
    "Accurately reproduce the supplied product's category and construction, material texture, color, opacity and light transmission, fold or band pattern, and mounting/hardware details.",
    "Do not copy the background or room from any product reference image.",
    "Do not add people, text, logos, watermarks or unrelated decor.",
    categoryHint,
    "The output is an AI-generated product reference, not a real completed project photograph.",
  ]
    .filter(Boolean)
    .join(" ");
}

function categoryPromptHint(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("sheer")) {
    return "Sheer: Show realistic translucent fabric and natural daylight transmission.";
  }
  if (c.includes("zebra")) {
    return "Zebra: Accurately preserve alternating sheer and opaque horizontal bands.";
  }
  if (c.includes("roller") || c.includes("solar") || c.includes("blackout")) {
    return "Roller: Show a clean straight roller shade with correct top hardware and a level bottom bar.";
  }
  if (c.includes("honeycomb")) {
    return "Honeycomb: Show consistent cellular pleats and realistic fabric thickness.";
  }
  if (c.includes("drapery") || c.includes("dual") || c.includes("vertical")) {
    return "Drapery: Show realistic fabric folds, natural draping, proper track placement and physically plausible shadows.";
  }
  return "Show realistic fabric construction, natural draping or panel geometry, and physically plausible shadows.";
}

export async function generateCatalogInstallTemplate(input: {
  productId: string;
  orgId: string;
  userId: string;
  templateType: VisualizerCatalogTemplateType;
}): Promise<{
  product: VisualizerCatalogProductDetail;
  jobId: string;
  assetId: string;
}> {
  if (!isCatalogTemplateType(input.templateType)) {
    throw new CatalogTemplateError("INVALID_TEMPLATE_TYPE", "模板类型无效", 400);
  }

  const roomUrl = resolveTemplateRoomUrl(input.templateType);
  if (!roomUrl) {
    throw new CatalogTemplateError(
      "TEMPLATE_ROOM_NOT_CONFIGURED",
      "AI 标准场景底图尚未配置，请联系管理员。",
      503,
    );
  }

  const product = await db.visualizerCatalogProduct.findUnique({
    where: { id: input.productId },
    include: { assets: { orderBy: [{ role: "asc" }, { sortOrder: "asc" }] } },
  });
  if (!product) {
    throw new CatalogTemplateError("NOT_FOUND", "产品不存在", 404);
  }
  if (product.orgId === null) {
    throw new CatalogTemplateError(
      "PLATFORM_IMMUTABLE",
      "平台预置产品不可修改",
      403,
    );
  }
  if (product.orgId !== input.orgId) {
    throw new CatalogTemplateError("FORBIDDEN", "该产品不属于当前组织", 403);
  }
  if (product.archived) {
    throw new CatalogTemplateError("ARCHIVED", "已归档产品不可生成模板", 400);
  }

  const readiness = evaluateCatalogReadiness(product.assets);
  if (!readiness.canGenerateTemplate) {
    throw new CatalogTemplateError(
      "SOURCE_INCOMPLETE",
      "请至少上传一张面料纹理图、色卡图或结构细节图，完成后才能生成 AI 标准安装模板。",
      400,
    );
  }

  // 防连点：同类型 running 任务
  const running = await db.visualizerCatalogTemplateJob.findFirst({
    where: {
      productId: product.id,
      templateType: input.templateType,
      status: { in: ["queued", "running"] },
    },
  });
  if (running) {
    throw new CatalogTemplateError(
      "JOB_IN_PROGRESS",
      "该模板正在生成中，请稍候",
      409,
    );
  }

  const cfg = getAIConfig();
  const job = await db.visualizerCatalogTemplateJob.create({
    data: {
      productId: product.id,
      templateType: input.templateType,
      status: "queued",
      requestedModel: cfg.imageModel,
      promptVersion: CATALOG_TEMPLATE_PROMPT_VERSION,
      createdById: input.userId,
    },
  });

  await db.visualizerCatalogTemplateJob.update({
    where: { id: job.id },
    data: { status: "running", startedAt: new Date() },
  });

  try {
    const roomBuffer = await fetchBuffer(roomUrl);
    if (!roomBuffer) {
      throw new CatalogTemplateError(
        "TEMPLATE_ROOM_UNREADABLE",
        "AI 标准场景底图无法读取，请联系管理员检查配置。",
        503,
      );
    }

    const sourceAssets = product.assets
      .filter((a) => SOURCE_ROLES.has(a.role) && a.sourceType === "real")
      .sort((a, b) => {
        const order = { texture: 0, detail: 1, swatch: 2 } as Record<
          string,
          number
        >;
        const d = (order[a.role] ?? 9) - (order[b.role] ?? 9);
        if (d !== 0) return d;
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return a.sortOrder - b.sortOrder;
      })
      .slice(0, 7);

    const references: Array<{ buffer: Buffer; mime: string; fileName?: string }> =
      [];
    for (const asset of sourceAssets) {
      const buf = await fetchBuffer(asset.fileUrl);
      if (buf) {
        references.push({
          buffer: buf,
          mime: asset.mimeType || "image/jpeg",
          fileName: asset.fileName,
        });
      }
    }
    if (references.length === 0) {
      throw new CatalogTemplateError(
        "SOURCE_UNREADABLE",
        "基础素材无法读取，请重新上传后再试",
        400,
      );
    }

    const prompt = buildCatalogTemplatePrompt({
      category: product.category,
      name: product.name,
      referenceCount: references.length,
    });

    const result = await runImageEditDetailed({
      imageBuffer: roomBuffer,
      imageMime: "image/jpeg",
      prompt,
      referenceImages: references,
      quality: "high",
    });

    if (!result.buffer) {
      throw new CatalogTemplateError(
        "IMAGE_MODEL_FAILED",
        "图片模型未能生成标准安装模板，请稍后重试",
        502,
      );
    }

    const safeName = `ai-template-${input.templateType}.png`;
    const uploaded = await putVisualizerCatalogPreview({
      orgId: input.orgId,
      buffer: result.buffer,
      safeName,
      contentType: "image/png",
    });

    // 超额 AI 模板：删除最旧的超出数量资产（不删真实图）
    const existingAi = await db.visualizerCatalogAsset.findMany({
      where: {
        productId: product.id,
        role: "style_reference",
        sourceType: "ai_generated",
      },
      orderBy: { createdAt: "asc" },
    });
    const maxTotal = MAX_AI_TEMPLATES_PER_TYPE * CATALOG_TEMPLATE_TYPES.length;
    if (existingAi.length >= maxTotal) {
      const toRemove = existingAi.slice(0, existingAi.length - maxTotal + 1);
      await db.visualizerCatalogAsset.deleteMany({
        where: { id: { in: toRemove.map((a) => a.id) } },
      });
    }

    const asset = await db.visualizerCatalogAsset.create({
      data: {
        productId: product.id,
        role: "style_reference",
        fileUrl: uploaded.url,
        fileName: safeName,
        mimeType: "image/png",
        width: null,
        height: null,
        bytes: result.buffer.length,
        sortOrder: existingAi.length,
        isPrimary: false,
        sourceType: "ai_generated",
        verificationStatus: "ai_reference",
        createdById: input.userId,
      },
    });

    // 无真实安装图时，用 AI 模板回填 preview 以便列表缩略图可见
    const hasRealInstalled = product.assets.some(
      (a) => a.role === "installed" && a.sourceType === "real",
    );
    if (!hasRealInstalled && !product.previewImageUrl) {
      await db.visualizerCatalogProduct.update({
        where: { id: product.id },
        data: { previewImageUrl: uploaded.url },
      });
    }

    await db.visualizerCatalogTemplateJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        outputAssetId: asset.id,
        resolvedModel: result.execution?.resolvedModel ?? cfg.imageModel,
      },
    });

    const refreshed = await db.visualizerCatalogProduct.findUniqueOrThrow({
      where: { id: product.id },
      include: { assets: { orderBy: [{ role: "asc" }, { sortOrder: "asc" }] } },
    });

    return {
      product: toCatalogDetail(refreshed, { currentOrgId: input.orgId }),
      jobId: job.id,
      assetId: asset.id,
    };
  } catch (err) {
    const code =
      err instanceof CatalogTemplateError ? err.code : "TEMPLATE_FAILED";
    const message =
      err instanceof Error ? err.message : "生成标准安装模板失败";
    await db.visualizerCatalogTemplateJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorCode: code,
        errorMessage: message.slice(0, 2000),
      },
    });
    if (err instanceof CatalogTemplateError) throw err;
    throw new CatalogTemplateError(code, message, 500);
  }
}
