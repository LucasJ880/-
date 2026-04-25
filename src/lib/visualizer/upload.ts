/**
 * Visualizer 图片上传 helper
 *
 * 职责：
 * - 限制 / 校验图片（png / jpg / jpeg / webp，≤ 5MB）
 * - 从 buffer 中直接解析宽高（不引入 sharp 等重依赖）
 * - 写入 @vercel/blob，固定 key 前缀
 *
 * 约束：保存到 DB 的 width/height 就用这里解析出来的值，
 * 前端不再需要上传 dimension 字段（避免被前端伪造）。
 */

import { put } from "@vercel/blob";

export const VISUALIZER_MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const VISUALIZER_ALLOWED_IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"] as const;
export const VISUALIZER_ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

export const VISUALIZER_BLOB_PREFIX = "visualizer";

function readUInt32BE(buf: Buffer, off: number): number {
  return (
    (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]
  ) >>> 0;
}

function readUInt16BE(buf: Buffer, off: number): number {
  return ((buf[off] << 8) | buf[off + 1]) & 0xffff;
}

function readUInt16LE(buf: Buffer, off: number): number {
  return (buf[off] | (buf[off + 1] << 8)) & 0xffff;
}

function readUInt32LE(buf: Buffer, off: number): number {
  return (
    (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24))
  ) >>> 0;
}

/** PNG: IHDR 紧跟 signature 之后，8 字节 signature + 4 字节 length + 4 字节 "IHDR" + 宽(4)+高(4) */
function parsePngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const sig = buf.slice(0, 8).toString("hex");
  if (sig !== "89504e470d0a1a0a") return null;
  const type = buf.slice(12, 16).toString("ascii");
  if (type !== "IHDR") return null;
  const width = readUInt32BE(buf, 16);
  const height = readUInt32BE(buf, 20);
  if (!width || !height) return null;
  return { width, height };
}

/** JPEG: 跳过 SOI（FFD8），扫描 SOFn marker（C0-C3/C5-C7/C9-CB/CD-CF），Y=2+2，X=2+4 */
function parseJpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off < buf.length - 8) {
    if (buf[off] !== 0xff) return null;
    // skip 0xFF fill bytes
    while (buf[off] === 0xff && off < buf.length) off++;
    const marker = buf[off];
    off += 1;
    if (marker === 0xd8 || marker === 0xd9) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (off + 7 >= buf.length) return null;
      const height = readUInt16BE(buf, off + 3);
      const width = readUInt16BE(buf, off + 5);
      if (!width || !height) return null;
      return { width, height };
    }
    const segLen = readUInt16BE(buf, off);
    if (segLen < 2) return null;
    off += segLen;
  }
  return null;
}

/** WebP: RIFF....WEBP, 容器有 VP8 / VP8L / VP8X，分别解析宽高 */
function parseWebpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  if (buf.slice(0, 4).toString("ascii") !== "RIFF") return null;
  if (buf.slice(8, 12).toString("ascii") !== "WEBP") return null;
  const chunk = buf.slice(12, 16).toString("ascii");
  if (chunk === "VP8 ") {
    const sig = buf.slice(23, 26);
    if (sig[0] !== 0x9d || sig[1] !== 0x01 || sig[2] !== 0x2a) return null;
    const width = readUInt16LE(buf, 26) & 0x3fff;
    const height = readUInt16LE(buf, 28) & 0x3fff;
    return { width, height };
  }
  if (chunk === "VP8L") {
    const b = buf;
    if (b[20] !== 0x2f) return null;
    const b0 = b[21];
    const b1 = b[22];
    const b2 = b[23];
    const b3 = b[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (chunk === "VP8X") {
    // VP8X canvas width/height: offset 24 / 27，3 字节小端，真实值要 +1
    const w = readUInt32LE(buf, 24) & 0xffffff;
    const h = readUInt32LE(buf, 27) & 0xffffff;
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

export function parseImageSize(
  buffer: Buffer,
  ext: string,
): { width: number; height: number } | null {
  switch (ext) {
    case "png":
      return parsePngSize(buffer);
    case "jpg":
    case "jpeg":
      return parseJpegSize(buffer);
    case "webp":
      return parseWebpSize(buffer);
    default:
      return null;
  }
}

/**
 * 上传到 @vercel/blob，返回 { url, pathname, contentType }
 */
export async function putVisualizerImage(args: {
  sessionId: string;
  safeName: string;
  buffer: Buffer;
  contentType: string;
}): Promise<{ url: string; pathname: string }> {
  const ts = Date.now();
  const pathname = `${VISUALIZER_BLOB_PREFIX}/sessions/${args.sessionId}/images/${ts}_${args.safeName}`;
  const blob = await put(pathname, args.buffer, {
    access: "public",
    contentType: args.contentType,
  });
  return { url: blob.url, pathname };
}

export async function putVisualizerCleanedImage(args: {
  sessionId: string;
  sourceImageId: string;
  buffer: Buffer;
  contentType: string;
}): Promise<{ url: string; pathname: string }> {
  const ts = Date.now();
  const pathname = `${VISUALIZER_BLOB_PREFIX}/sessions/${args.sessionId}/ai-cleaned/${args.sourceImageId}_${ts}.png`;
  const blob = await put(pathname, args.buffer, {
    access: "public",
    contentType: args.contentType,
  });
  return { url: blob.url, pathname };
}

/** 导出 PNG 的 base64 payload 上限（约 10MB base64 ≈ 7.5MB 原图） */
export const VISUALIZER_MAX_EXPORT_BASE64 = 10 * 1024 * 1024;

/**
 * 解析客户端传来的 PNG dataURL，校验格式与体积，返回 buffer。
 * - 仅接受 image/png（导出统一走 PNG）
 * - 不合格返回 null（由调用方转为 400）
 */
export function parsePngDataUrl(
  dataUrl: string,
): { buffer: Buffer } | null {
  if (typeof dataUrl !== "string") return null;
  if (!dataUrl.startsWith("data:image/png;base64,")) return null;
  const base64 = dataUrl.slice("data:image/png;base64,".length);
  if (!base64 || base64.length > VISUALIZER_MAX_EXPORT_BASE64) return null;
  try {
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length < 8) return null;
    // PNG 签名校验：89 50 4e 47 0d 0a 1a 0a
    const sig = buffer.slice(0, 8).toString("hex");
    if (sig !== "89504e470d0a1a0a") return null;
    return { buffer };
  } catch {
    return null;
  }
}

/**
 * 上传 variant 导出图（PNG）到 blob。
 * 路径：visualizer/sessions/{sessionId}/variants/{variantId}/export_{ts}.png
 */
export async function putVisualizerExport(args: {
  sessionId: string;
  variantId: string;
  buffer: Buffer;
}): Promise<{ url: string; pathname: string }> {
  const ts = Date.now();
  const pathname = `${VISUALIZER_BLOB_PREFIX}/sessions/${args.sessionId}/variants/${args.variantId}/export_${ts}.png`;
  const blob = await put(pathname, args.buffer, {
    access: "public",
    contentType: "image/png",
  });
  return { url: blob.url, pathname };
}

export async function putVisualizerHdRender(args: {
  sessionId: string;
  variantId: string;
  buffer: Buffer;
}): Promise<{ url: string; pathname: string }> {
  const ts = Date.now();
  const pathname = `${VISUALIZER_BLOB_PREFIX}/sessions/${args.sessionId}/variants/${args.variantId}/hd_${ts}.png`;
  const blob = await put(pathname, args.buffer, {
    access: "public",
    contentType: "image/png",
  });
  return { url: blob.url, pathname };
}
