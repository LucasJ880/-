import type { AspectRatio, Resolution } from "./types";

export const ALL_ASPECT_RATIOS: AspectRatio[] = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
];

export const ALL_RESOLUTIONS: Resolution[] = ["1K", "2K"];

export const DEFAULT_ASPECT_RATIO: AspectRatio = "3:4";
export const DEFAULT_RESOLUTION: Resolution = "1K";

/** OpenAI images edits 常见 size；无法映射时回退 auto */
export function mapAspectRatioToImageSize(
  aspectRatio: AspectRatio,
  resolution: Resolution,
): string {
  // 当前 Image Edit 对自定义尺寸支持不稳定，统一 auto，比例靠 prompt 约束
  void aspectRatio;
  void resolution;
  return "auto";
}

export function framingPromptSuffix(
  aspectRatio: AspectRatio,
  resolution: Resolution,
): string {
  const resHint =
    resolution === "2K"
      ? "Deliver sharp high-resolution detail suitable for 2K export."
      : "Deliver clean 1K e-commerce resolution, crisp product texture.";
  return `Compose and crop for ${aspectRatio} framing (safe margins, subject well placed for this aspect ratio). ${resHint}`;
}

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === "string" && ALL_ASPECT_RATIOS.includes(value as AspectRatio);
}

export function isResolution(value: unknown): value is Resolution {
  return typeof value === "string" && ALL_RESOLUTIONS.includes(value as Resolution);
}
