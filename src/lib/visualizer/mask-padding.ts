/**
 * HD Render 窗户区域 mask 的品类级保守扩展（原图像素空间）。
 * 不覆盖整房；有最大比例上限并 clamp 到图片边界。
 */

export type MaskPaddingInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type MaskPaddingCategoryGroup =
  | "shade"
  | "vertical"
  | "drapery"
  | "default";

/** 将 catalog productCategory 归入 padding 策略组 */
export function maskPaddingGroupForCategory(
  category: string | null | undefined
): MaskPaddingCategoryGroup {
  const c = (category ?? "").toLowerCase();
  if (
    c === "roller" ||
    c === "solar" ||
    c === "blackout_roller" ||
    c === "zebra" ||
    c === "honeycomb" ||
    c === "dual"
  ) {
    return "shade";
  }
  if (c === "vertical") return "vertical";
  if (c === "sheer" || c === "drapery" || c === "motorized") return "drapery";
  return "default";
}

/**
 * 按区域尺寸与图片尺寸计算 padding（像素）。
 * 比例相对「区域宽/高」与「整图」双重封顶，避免整房可编辑。
 */
export function computeMaskPaddingInsets(args: {
  category: string | null | undefined;
  regionWidth: number;
  regionHeight: number;
  imageWidth: number;
  imageHeight: number;
}): MaskPaddingInsets {
  const group = maskPaddingGroupForCategory(args.category);
  const rw = Math.max(1, args.regionWidth);
  const rh = Math.max(1, args.regionHeight);
  const iw = Math.max(1, args.imageWidth);
  const ih = Math.max(1, args.imageHeight);

  // 相对区域的基础比例 + 相对整图的硬顶
  const caps = {
    shade: {
      top: 0.08,
      side: 0.04,
      bottom: 0.06,
      maxFracW: 0.12,
      maxFracH: 0.12,
    },
    vertical: {
      top: 0.12,
      side: 0.1,
      bottom: 0.08,
      maxFracW: 0.18,
      maxFracH: 0.15,
    },
    drapery: {
      top: 0.18,
      side: 0.22,
      bottom: 0.35,
      maxFracW: 0.28,
      maxFracH: 0.4,
    },
    default: {
      top: 0.1,
      side: 0.08,
      bottom: 0.1,
      maxFracW: 0.15,
      maxFracH: 0.15,
    },
  }[group];

  const maxSide = Math.floor(iw * caps.maxFracW);
  const maxVert = Math.floor(ih * caps.maxFracH);

  const top = Math.min(Math.floor(rh * caps.top), maxVert);
  const left = Math.min(Math.floor(rw * caps.side), maxSide);
  const right = left;
  const bottom = Math.min(Math.floor(rh * caps.bottom), maxVert);

  return { top, right, bottom, left };
}

export function expandAxisAlignedRect(args: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  padding: MaskPaddingInsets;
  imageWidth: number;
  imageHeight: number;
}): { x1: number; y1: number; x2: number; y2: number } {
  const x1 = Math.min(args.x1, args.x2);
  const x2 = Math.max(args.x1, args.x2);
  const y1 = Math.min(args.y1, args.y2);
  const y2 = Math.max(args.y1, args.y2);
  return {
    x1: Math.max(0, Math.floor(x1 - args.padding.left)),
    y1: Math.max(0, Math.floor(y1 - args.padding.top)),
    x2: Math.min(args.imageWidth - 1, Math.ceil(x2 + args.padding.right)),
    y2: Math.min(args.imageHeight - 1, Math.ceil(y2 + args.padding.bottom)),
  };
}

/** rect / polygon 点集扩展：先取 AABB，再按 padding 扩边，polygon 外扩为扩展后的矩形包络（保守） */
export function expandRegionPointsForMask(args: {
  shape: "rect" | "polygon";
  points: Array<[number, number]>;
  category: string | null | undefined;
  imageWidth: number;
  imageHeight: number;
}): { shape: "rect" | "polygon"; points: Array<[number, number]> } {
  const xs = args.points.map((p) => p[0]);
  const ys = args.points.map((p) => p[1]);
  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  const y1 = Math.min(...ys);
  const y2 = Math.max(...ys);
  const padding = computeMaskPaddingInsets({
    category: args.category,
    regionWidth: Math.max(1, x2 - x1),
    regionHeight: Math.max(1, y2 - y1),
    imageWidth: args.imageWidth,
    imageHeight: args.imageHeight,
  });

  // 布帘接近底部时略增 bottom（保守：区域底边距画面底 < 15% 图高）
  if (maskPaddingGroupForCategory(args.category) === "drapery") {
    const distBottom = args.imageHeight - 1 - y2;
    if (distBottom < args.imageHeight * 0.15) {
      padding.bottom = Math.min(
        padding.bottom + Math.floor(args.imageHeight * 0.08),
        Math.floor(args.imageHeight * 0.45)
      );
    }
  }

  const expanded = expandAxisAlignedRect({
    x1,
    y1,
    x2,
    y2,
    padding,
    imageWidth: args.imageWidth,
    imageHeight: args.imageHeight,
  });

  if (args.shape === "rect" || args.points.length < 3) {
    return {
      shape: "rect",
      points: [
        [expanded.x1, expanded.y1],
        [expanded.x2, expanded.y2],
      ],
    };
  }

  // polygon：在原顶点基础上按中心径向外推有限比例，再与扩展 AABB 取交（简化为扩展 AABB 矩形，保守且可测）
  return {
    shape: "rect",
    points: [
      [expanded.x1, expanded.y1],
      [expanded.x2, expanded.y2],
    ],
  };
}
