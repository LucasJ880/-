/**
 * 面料纹理填充 — 可视化第二波（本地即时合成）
 *
 * 把编辑预览从"半透明色块"升级为真实面料纹理：
 * 纹理图横向铺满 region 显示宽度后 repeat，保持既有 opacity 语义；
 * 无纹理 / 加载失败一律回退 colorHex 色块（mock 产品 textureUrl 全为
 * null，因此该升级按"产品补录纹理图即点亮"的方式渐进生效，零回归）。
 *
 * 供 Konva 编辑器（fillPattern* props）与两处原生 canvas（comparison /
 * presentation 复用 CompositeStage）共用同一套比例语义，避免三处漂移。
 */

/** 纹理 pattern 缩放：让纹理原图宽度映射到目标显示宽度（横向铺满一次后 repeat） */
export function texturePatternScale(
  imageWidth: number,
  targetWidthPx: number,
): number {
  if (!Number.isFinite(imageWidth) || imageWidth <= 0) return 1;
  if (!Number.isFinite(targetWidthPx) || targetWidthPx <= 0) return 1;
  return targetWidthPx / imageWidth;
}

export interface TextureFillArgs {
  textureImage: CanvasImageSource | null;
  /** 纹理原图宽度（px）；无纹理时可传 0 */
  textureWidth: number;
  colorHex: string | null;
  opacity: number;
  /** region 在画布上的显示宽度（px） */
  targetWidth: number;
  /** pattern 原点（画布坐标，通常 = region 显示左上角） */
  originX: number;
  originY: number;
}

/**
 * 在"当前已构建好的路径"内填充：有纹理用纹理 pattern，否则回退纯色。
 * 调用方负责 save/restore 与路径构建。
 */
export function fillPathWithTexture(
  ctx: CanvasRenderingContext2D,
  args: TextureFillArgs,
): void {
  ctx.globalAlpha = Math.max(0, Math.min(1, args.opacity));
  const img = args.textureImage;
  if (img && args.textureWidth > 0) {
    try {
      const pattern = ctx.createPattern(img, "repeat");
      if (pattern) {
        const s = texturePatternScale(args.textureWidth, args.targetWidth);
        if (typeof pattern.setTransform === "function" && typeof DOMMatrix !== "undefined") {
          pattern.setTransform(
            new DOMMatrix()
              .translate(args.originX, args.originY)
              .scale(s, s),
          );
        }
        ctx.fillStyle = pattern;
        ctx.fill();
        return;
      }
    } catch {
      // 纹理 pattern 创建失败（如跨域污染）→ 回退纯色
    }
  }
  ctx.fillStyle = args.colorHex || "#cccccc";
  ctx.fill();
}
