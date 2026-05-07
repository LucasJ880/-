/**
 * 客户端图片压缩（仅在浏览器调用）
 *
 * 原因：手机原图（10–20MB）会超 VISUALIZER_MAX_IMAGE_SIZE = 5MB；
 * 在客户家弱网环境下大文件直接上传体验差。
 *
 * 策略：
 * - 长边 ≤ maxLongEdge（默认 2048px），按比例缩
 * - JPEG quality 0.85（兼顾清晰与体积）
 * - 若原文件已 ≤ minSkipBytes 且不强制，直接返回原文件
 * - PNG 透明图保留原 mime（不压成 jpeg），仅缩放
 *
 * 注意：不在 SSR / Node 调用，无 sharp 等依赖。
 */

const DEFAULT_MAX_LONG_EDGE = 2048;
const DEFAULT_QUALITY = 0.85;
const DEFAULT_MIN_SKIP_BYTES = 800 * 1024; // 800KB 以下默认跳过压缩

export interface ResizeOptions {
  maxLongEdge?: number;
  quality?: number;
  minSkipBytes?: number;
  /** 强制压缩，即便 ≤ minSkipBytes */
  force?: boolean;
}

export interface ResizeResult {
  file: File;
  /** true 表示返回的是原文件 */
  skipped: boolean;
  width: number;
  height: number;
  originalBytes: number;
  resultBytes: number;
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法加载图片"));
    img.src = url;
  });
}

/**
 * 在浏览器内压缩图片。
 * 失败时返回原文件 + skipped:true，避免阻塞主流程。
 */
export async function resizeImageForUpload(
  file: File,
  options: ResizeOptions = {},
): Promise<ResizeResult> {
  const maxLongEdge = options.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const minSkipBytes = options.minSkipBytes ?? DEFAULT_MIN_SKIP_BYTES;

  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      file,
      skipped: true,
      width: 0,
      height: 0,
      originalBytes: file.size,
      resultBytes: file.size,
    };
  }

  if (!options.force && file.size <= minSkipBytes) {
    return {
      file,
      skipped: true,
      width: 0,
      height: 0,
      originalBytes: file.size,
      resultBytes: file.size,
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(url);
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    if (!naturalW || !naturalH) {
      return {
        file,
        skipped: true,
        width: 0,
        height: 0,
        originalBytes: file.size,
        resultBytes: file.size,
      };
    }

    const longEdge = Math.max(naturalW, naturalH);
    const ratio = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
    const targetW = Math.round(naturalW * ratio);
    const targetH = Math.round(naturalH * ratio);

    if (ratio === 1 && file.size <= minSkipBytes * 4) {
      return {
        file,
        skipped: true,
        width: naturalW,
        height: naturalH,
        originalBytes: file.size,
        resultBytes: file.size,
      };
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        file,
        skipped: true,
        width: naturalW,
        height: naturalH,
        originalBytes: file.size,
        resultBytes: file.size,
      };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const isPng = file.type === "image/png";
    const outMime = isPng ? "image/png" : "image/jpeg";
    const outQuality = isPng ? undefined : quality;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), outMime, outQuality);
    });
    if (!blob) {
      return {
        file,
        skipped: true,
        width: naturalW,
        height: naturalH,
        originalBytes: file.size,
        resultBytes: file.size,
      };
    }

    if (blob.size >= file.size && ratio === 1) {
      return {
        file,
        skipped: true,
        width: naturalW,
        height: naturalH,
        originalBytes: file.size,
        resultBytes: file.size,
      };
    }

    const newName = file.name.replace(/\.[^.]+$/, "") + (isPng ? ".png" : ".jpg");
    const out = new File([blob], newName, { type: outMime, lastModified: Date.now() });
    return {
      file: out,
      skipped: false,
      width: targetW,
      height: targetH,
      originalBytes: file.size,
      resultBytes: out.size,
    };
  } catch {
    return {
      file,
      skipped: true,
      width: 0,
      height: 0,
      originalBytes: file.size,
      resultBytes: file.size,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
