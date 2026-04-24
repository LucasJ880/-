/**
 * Visualizer 写入接口的共享校验器
 *
 * 这些校验既被 API route 使用，也在前端表单提交前复用，
 * 用来避免前端漏传坏数据导致的 500。
 */

import type {
  VisualizerProductOptionTransform,
  VisualizerRegionShape,
} from "./types";

export const VISUALIZER_REGION_SHAPES: VisualizerRegionShape[] = ["rect", "polygon"];

/** 校验 region 的 points；返回 { ok, points } 或 { ok:false, reason } */
export function validateRegionPoints(
  shape: VisualizerRegionShape,
  raw: unknown,
): { ok: true; points: Array<[number, number]> } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "points 必须是数组" };
  }
  const pts: Array<[number, number]> = [];
  for (const pt of raw) {
    if (
      !Array.isArray(pt) ||
      pt.length !== 2 ||
      typeof pt[0] !== "number" ||
      typeof pt[1] !== "number" ||
      !Number.isFinite(pt[0]) ||
      !Number.isFinite(pt[1])
    ) {
      return { ok: false, reason: "points 必须是 [[x,y], ...] 数字对" };
    }
    pts.push([pt[0], pt[1]]);
  }
  if (shape === "rect") {
    if (pts.length !== 2) {
      return { ok: false, reason: "rect 需要恰好 2 个点" };
    }
  } else {
    if (pts.length < 3) {
      return { ok: false, reason: "polygon 至少需要 3 个点" };
    }
  }
  return { ok: true, points: pts };
}

export function validateOpacity(raw: unknown): { ok: true; value: number } | { ok: false; reason: string } {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { ok: false, reason: "opacity 必须是 0~1 的数字" };
  }
  if (raw < 0 || raw > 1) {
    return { ok: false, reason: "opacity 超出范围 0~1" };
  }
  return { ok: true, value: raw };
}

export function validateTransform(
  raw: unknown,
): { ok: true; value: VisualizerProductOptionTransform | null } | { ok: false; reason: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "object") {
    return { ok: false, reason: "transform 必须是对象" };
  }
  const t = raw as Record<string, unknown>;
  const keys = ["offsetX", "offsetY", "scaleX", "scaleY", "rotation"] as const;
  const out = {} as VisualizerProductOptionTransform;
  for (const k of keys) {
    const v = t[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, reason: `transform.${k} 必须是数字` };
    }
    out[k] = v;
  }
  // 合理范围（MVP 防御性）
  if (out.scaleX <= 0 || out.scaleY <= 0 || out.scaleX > 20 || out.scaleY > 20) {
    return { ok: false, reason: "transform.scale 超出合理范围" };
  }
  return { ok: true, value: out };
}
