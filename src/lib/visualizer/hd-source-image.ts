/**
 * HD Render 主输入房间图解析（无 Schema 变更）。
 *
 * 优先级：
 * 1. 与 Variant 产品区域对应、用户明确生成的 cleaned 图
 * 2. 客户原始上传图
 * 3. 绝不静默回退到带产品色块的 composed canvas
 */

export const HD_SOURCE_ERROR = {
  SOURCE_ROOM_IMAGE_MISSING: "SOURCE_ROOM_IMAGE_MISSING",
  SCENE_REGION_NOT_CONFIRMED: "SCENE_REGION_NOT_CONFIRMED",
  SOURCE_IMAGE_AMBIGUOUS: "SOURCE_IMAGE_AMBIGUOUS",
} as const;

export type HdSourceErrorCode =
  (typeof HD_SOURCE_ERROR)[keyof typeof HD_SOURCE_ERROR];

export type HdSourceImageKind = "cleaned" | "original";

export type HdSourceImageCandidate = {
  id: string;
  fileUrl: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  note: string | null;
  fileName: string;
  createdAt: Date | string;
};

export type HdRegionRef = {
  id: string;
  sourceImageId: string;
};

export type ResolveHdRoomSourceResult =
  | {
      ok: true;
      sourceImageId: string;
      fileUrl: string;
      mimeType: string;
      width: number;
      height: number;
      kind: HdSourceImageKind;
      /** 产品选项所在底图（区域挂载图）；可能与最终主输入不同（若选用 cleaned 衍生图） */
      regionSourceImageId: string;
    }
  | {
      ok: false;
      code: HdSourceErrorCode;
      message: string;
    };

export function isAiCleanedSourceImage(image: {
  note?: string | null;
  fileName?: string | null;
}): boolean {
  if (image.note?.includes("AI cleaned from")) return true;
  if (image.fileName?.includes("_ai_cleaned")) return true;
  return false;
}

/** note: `AI cleaned from source image ${id}` */
export function cleanedFromSourceImageId(
  note: string | null | undefined,
): string | null {
  if (!note) return null;
  const m = note.match(/AI cleaned from source image\s+(\S+)/i);
  return m?.[1] ?? null;
}

function asTime(v: Date | string): number {
  return typeof v === "string" ? Date.parse(v) : v.getTime();
}

/**
 * 从 Variant 的产品选项区域解析 HD 主输入房间图。
 * `composedDataUrl` 参数刻意不参与选择，仅允许调用方作调试废弃字段。
 */
export function resolveHdRoomSourceImage(args: {
  productOptionRegionIds: string[];
  regions: HdRegionRef[];
  sourceImages: HdSourceImageCandidate[];
  /** 编辑器当前选中图：若属于同一血缘且可用，可作偏好 */
  preferredSourceImageId?: string | null;
  /** @deprecated 不得作为 AI 主输入 */
  composedDataUrl?: string | null;
}): ResolveHdRoomSourceResult {
  void args.composedDataUrl;

  if (args.productOptionRegionIds.length === 0) {
    return {
      ok: false,
      code: HD_SOURCE_ERROR.SCENE_REGION_NOT_CONFIRMED,
      message: "请先为方案窗户选择产品并确认区域后再高清渲染",
    };
  }

  const regionById = new Map(args.regions.map((r) => [r.id, r]));
  const linked: HdRegionRef[] = [];
  for (const regionId of args.productOptionRegionIds) {
    const region = regionById.get(regionId);
    if (!region) {
      return {
        ok: false,
        code: HD_SOURCE_ERROR.SCENE_REGION_NOT_CONFIRMED,
        message: "方案关联的窗户区域不存在或未确认",
      };
    }
    linked.push(region);
  }

  const sourceIds = [...new Set(linked.map((r) => r.sourceImageId))];
  if (sourceIds.length !== 1) {
    return {
      ok: false,
      code: HD_SOURCE_ERROR.SOURCE_IMAGE_AMBIGUOUS,
      message: "同一方案的产品分布在多张房间图上，请拆成不同方案后再渲染",
    };
  }

  const regionSourceImageId = sourceIds[0]!;
  const imagesById = new Map(args.sourceImages.map((img) => [img.id, img]));
  const regionImage = imagesById.get(regionSourceImageId);
  if (!regionImage?.fileUrl) {
    return {
      ok: false,
      code: HD_SOURCE_ERROR.SOURCE_ROOM_IMAGE_MISSING,
      message: "找不到客户房间原图，无法进行高清渲染",
    };
  }

  const usable = (img: HdSourceImageCandidate | undefined) =>
    !!img?.fileUrl &&
    typeof img.width === "number" &&
    img.width > 0 &&
    typeof img.height === "number" &&
    img.height > 0;

  const cleanedDerivatives = args.sourceImages
    .filter((img) => cleanedFromSourceImageId(img.note) === regionSourceImageId)
    .filter(usable)
    .sort((a, b) => asTime(b.createdAt) - asTime(a.createdAt));

  const preferred = args.preferredSourceImageId
    ? imagesById.get(args.preferredSourceImageId)
    : undefined;

  let chosen: HdSourceImageCandidate | null = null;

  // 偏好：当前选中 cleaned，且与区域图同血缘（自身或衍生）
  if (
    preferred &&
    usable(preferred) &&
    isAiCleanedSourceImage(preferred) &&
    (preferred.id === regionSourceImageId ||
      cleanedFromSourceImageId(preferred.note) === regionSourceImageId ||
      (isAiCleanedSourceImage(regionImage) && preferred.id === regionSourceImageId))
  ) {
    chosen = preferred;
  } else if (isAiCleanedSourceImage(regionImage) && usable(regionImage)) {
    // 产品已挂在 cleaned 图上
    chosen = regionImage;
  } else if (cleanedDerivatives[0]) {
    // 原图上挂产品，但用户已明确生成同尺寸 cleaned → 优先 cleaned
    const best = cleanedDerivatives[0];
    if (
      best.width === regionImage.width &&
      best.height === regionImage.height
    ) {
      chosen = best;
    }
  }

  if (!chosen) {
    chosen = usable(regionImage) ? regionImage : null;
  }

  if (!chosen || !usable(chosen)) {
    return {
      ok: false,
      code: HD_SOURCE_ERROR.SOURCE_ROOM_IMAGE_MISSING,
      message: "房间图缺少有效像素尺寸或文件地址，无法高清渲染",
    };
  }

  return {
    ok: true,
    sourceImageId: chosen.id,
    fileUrl: chosen.fileUrl,
    mimeType: chosen.mimeType || "image/png",
    width: chosen.width!,
    height: chosen.height!,
    kind: isAiCleanedSourceImage(chosen) ? "cleaned" : "original",
    regionSourceImageId,
  };
}
