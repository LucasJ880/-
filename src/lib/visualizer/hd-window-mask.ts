/**
 * HD Render：由已确认窗户区域生成与主输入同尺寸的编辑 mask。
 * 复用 png-mask 语义（透明=可编辑，不透明=保留）。
 */

import { expandRegionPointsForMask } from "./mask-padding";
import { createMultiRegionEditMaskPng } from "./png-mask";

export const HD_MASK_ERROR = {
  SCENE_REGION_NOT_CONFIRMED: "SCENE_REGION_NOT_CONFIRMED",
  WINDOW_MASK_EMPTY: "WINDOW_MASK_EMPTY",
  WINDOW_MASK_DIMENSION_MISMATCH: "WINDOW_MASK_DIMENSION_MISMATCH",
  WINDOW_MASK_TOO_LARGE: "WINDOW_MASK_TOO_LARGE",
} as const;

export type HdMaskErrorCode = (typeof HD_MASK_ERROR)[keyof typeof HD_MASK_ERROR];

export type HdMaskRegionInput = {
  shape: "rect" | "polygon";
  points: Array<[number, number]>;
  /** 用于品类 padding；可空 */
  productCategory?: string | null;
};

export type BuildHdWindowMaskResult =
  | {
      ok: true;
      maskBuffer: Buffer;
      width: number;
      height: number;
      editablePixelEstimate: number;
      expandedRegions: Array<{
        shape: "rect" | "polygon";
        points: Array<[number, number]>;
      }>;
    }
  | {
      ok: false;
      code: HdMaskErrorCode;
      message: string;
    };

/** 粗估可编辑像素占比上限：防止整房被设为可编辑 */
const MAX_EDITABLE_AREA_RATIO = 0.72;

function parsePoints(points: Array<[number, number]>): Array<[number, number]> | null {
  if (!Array.isArray(points) || points.length < 2) return null;
  const out: Array<[number, number]> = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push([x, y]);
  }
  return out;
}

function estimateEditablePixels(
  width: number,
  height: number,
  regions: Array<{ shape: "rect" | "polygon"; points: Array<[number, number]> }>,
): number {
  // 对 rect 用面积并集近似；polygon 用 AABB。足够做「整房」防护。
  let sum = 0;
  for (const r of regions) {
    const xs = r.points.map((p) => p[0]);
    const ys = r.points.map((p) => p[1]);
    const w = Math.max(0, Math.max(...xs) - Math.min(...xs) + 1);
    const h = Math.max(0, Math.max(...ys) - Math.min(...ys) + 1);
    sum += w * h;
  }
  return Math.min(width * height, sum);
}

export function buildHdWindowMask(args: {
  width: number;
  height: number;
  regions: HdMaskRegionInput[];
}): BuildHdWindowMaskResult {
  const { width, height } = args;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return {
      ok: false,
      code: HD_MASK_ERROR.WINDOW_MASK_DIMENSION_MISMATCH,
      message: "主输入图片尺寸无效，无法生成窗户 mask",
    };
  }

  if (!args.regions.length) {
    return {
      ok: false,
      code: HD_MASK_ERROR.SCENE_REGION_NOT_CONFIRMED,
      message: "没有已确认的窗户区域，无法生成 mask",
    };
  }

  const expandedRegions: Array<{
    shape: "rect" | "polygon";
    points: Array<[number, number]>;
  }> = [];

  for (const region of args.regions) {
    const shape = region.shape === "polygon" ? "polygon" : "rect";
    const points = parsePoints(region.points);
    if (!points) {
      return {
        ok: false,
        code: HD_MASK_ERROR.SCENE_REGION_NOT_CONFIRMED,
        message: "窗户区域坐标无效",
      };
    }
    if (shape === "rect" && points.length < 2) {
      return {
        ok: false,
        code: HD_MASK_ERROR.SCENE_REGION_NOT_CONFIRMED,
        message: "矩形窗户区域坐标不完整",
      };
    }
    if (shape === "polygon" && points.length < 3) {
      return {
        ok: false,
        code: HD_MASK_ERROR.SCENE_REGION_NOT_CONFIRMED,
        message: "多边形窗户区域顶点数不足",
      };
    }

    expandedRegions.push(
      expandRegionPointsForMask({
        shape,
        points,
        category: region.productCategory,
        imageWidth: width,
        imageHeight: height,
      }),
    );
  }

  const editableEstimate = estimateEditablePixels(width, height, expandedRegions);
  if (editableEstimate <= 0) {
    return {
      ok: false,
      code: HD_MASK_ERROR.WINDOW_MASK_EMPTY,
      message: "窗户 mask 为空，请重新确认窗户区域",
    };
  }
  if (editableEstimate / (width * height) > MAX_EDITABLE_AREA_RATIO) {
    return {
      ok: false,
      code: HD_MASK_ERROR.WINDOW_MASK_TOO_LARGE,
      message: "窗户编辑区域过大，已拒绝整房编辑。请缩小确认区域后重试",
    };
  }

  try {
    const maskBuffer = createMultiRegionEditMaskPng({
      width,
      height,
      regions: expandedRegions,
    });
    return {
      ok: true,
      maskBuffer,
      width,
      height,
      editablePixelEstimate: editableEstimate,
      expandedRegions,
    };
  } catch {
    return {
      ok: false,
      code: HD_MASK_ERROR.WINDOW_MASK_EMPTY,
      message: "窗户 mask 生成失败",
    };
  }
}
