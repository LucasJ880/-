/**
 * HD Render 可单测核心：组装 Image Edit 入参，以及失败时保留旧 exportImageUrl。
 */

import { buildHdRenderPrompt } from "./hd-render-prompt";
import { resolveHdRoomSourceImage } from "./hd-source-image";
import { buildHdWindowMask } from "./hd-window-mask";
import type { HdSourceImageCandidate } from "./hd-source-image";

export type HdPrepareInput = {
  productOptions: Array<{
    regionId: string;
    productName: string;
    productCategory: string;
    color: string | null;
    colorHex: string | null;
    opacity: number;
    mountingType: string | null;
  }>;
  regions: Array<{
    id: string;
    sourceImageId: string;
    shape: string;
    pointsJson: unknown;
  }>;
  sourceImages: HdSourceImageCandidate[];
  preferredSourceImageId?: string | null;
  /** @deprecated 不得进入主输入 */
  composedDataUrl?: string | null;
  customInstruction?: string | null;
  roomImageBuffer: Buffer;
  roomImageMime: string;
  referenceImages: Array<{
    buffer: Buffer;
    mime: string;
    fileName?: string;
    role: string;
    productName: string;
    sourceType: string;
    verificationStatus?: string | null;
  }>;
};

export type HdImageEditArgs = {
  imageBuffer: Buffer;
  imageMime: string;
  maskBuffer: Buffer;
  prompt: string;
  referenceImages: Array<{
    buffer: Buffer;
    mime: string;
    fileName?: string;
  }>;
  sourceKind: "cleaned" | "original";
  sourceImageId: string;
  width: number;
  height: number;
};

export type HdPrepareResult =
  | { ok: true; edit: HdImageEditArgs }
  | { ok: false; code: string; message: string };

/** 组装 AI Image Edit 参数；主输入必须是房间原图/cleaned，绝不用 composed。 */
export function prepareHdImageEditArgs(input: HdPrepareInput): HdPrepareResult {
  const resolved = resolveHdRoomSourceImage({
    productOptionRegionIds: input.productOptions.map((o) => o.regionId),
    regions: input.regions,
    sourceImages: input.sourceImages,
    preferredSourceImageId: input.preferredSourceImageId,
    composedDataUrl: input.composedDataUrl,
  });
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, message: resolved.message };
  }

  if (!input.roomImageBuffer?.length) {
    return {
      ok: false,
      code: "SOURCE_ROOM_IMAGE_MISSING",
      message: "房间图内容为空",
    };
  }

  const regionById = new Map(input.regions.map((r) => [r.id, r]));
  const maskRegions = input.productOptions.map((option) => {
    const region = regionById.get(option.regionId);
    const points = Array.isArray(region?.pointsJson)
      ? (region!.pointsJson as Array<[number, number]>)
      : [];
    return {
      shape: (region?.shape === "polygon" ? "polygon" : "rect") as
        | "rect"
        | "polygon",
      points,
      productCategory: option.productCategory,
    };
  });

  const maskResult = buildHdWindowMask({
    width: resolved.width,
    height: resolved.height,
    regions: maskRegions,
  });
  if (!maskResult.ok) {
    return { ok: false, code: maskResult.code, message: maskResult.message };
  }

  const prompt = buildHdRenderPrompt({
    productOptions: input.productOptions,
    references: input.referenceImages.map((r, index) => ({
      index,
      role: r.role,
      productName: r.productName,
      sourceType: r.sourceType,
      verificationStatus: r.verificationStatus,
    })),
    customInstruction: input.customInstruction,
  });

  return {
    ok: true,
    edit: {
      imageBuffer: input.roomImageBuffer,
      imageMime: input.roomImageMime,
      maskBuffer: maskResult.maskBuffer,
      prompt,
      referenceImages: input.referenceImages.map((r) => ({
        buffer: r.buffer,
        mime: r.mime,
        fileName: r.fileName,
      })),
      sourceKind: resolved.kind,
      sourceImageId: resolved.sourceImageId,
      width: resolved.width,
      height: resolved.height,
    },
  };
}

/** 失败时是否应保留旧 exportImageUrl（始终 true；供测试锁定契约） */
export function shouldPreservePreviousExportOnFailure(
  previousExportImageUrl: string | null,
  failure: { exportImageUrlWritten?: boolean },
): string | null {
  if (failure.exportImageUrlWritten) {
    // 成功写入后不应走此分支
    return previousExportImageUrl;
  }
  return previousExportImageUrl;
}

/** 成功响应不得把编辑预览伪装成结果 */
export function isFakeSuccessResponse(args: {
  httpOk: boolean;
  exportImageUrl: string | null | undefined;
  usedComposedAsPrimary: boolean;
}): boolean {
  if (!args.httpOk) return false;
  if (args.usedComposedAsPrimary) return true;
  if (!args.exportImageUrl) return true;
  return false;
}
