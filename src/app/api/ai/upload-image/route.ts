/**
 * POST /api/ai/upload-image — 对话附件：图片 → 文字
 *
 * multipart: file（png/jpg/jpeg/webp，≤ 6MB）
 * 不落盘；用 Vision 模型转成「逐字转录 + 画面描述 + 类型判断」文本返回，
 * 浏览器随消息提交为 attachments[{ kind: "image", name, size, text }]。
 * 与 /api/ai/upload-file（文档 → 文字）对称。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { validateUploadedFileAsync } from "@/lib/files/upload-guard";
import { describeImageForChat } from "@/lib/ai/image-to-text";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ALLOWED_EXT = ["png", "jpg", "jpeg", "webp"];
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const UPLOAD_RATE_LIMIT = {
  name: "ai-upload-image",
  windowMs: 60_000,
  maxRequests: 10,
} as const;

export const POST = withAuth(async (request, _ctx, user) => {
  const rl = await checkRateLimitAsync(UPLOAD_RATE_LIMIT, user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "上传过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传图片" }, { status: 400 });
  }

  const check = await validateUploadedFileAsync(file, {
    maxSize: MAX_IMAGE_BYTES,
    allowedExtensions: ALLOWED_EXT,
    allowedMimeTypes: Object.values(MIME_BY_EXT),
    checkMagicBytes: true,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }
  // 魔数已校验过；MIME 以扩展名为准，避免浏览器给出的 octet-stream 进到 data URL
  const mime = MIME_BY_EXT[check.ext] ?? check.mime;

  try {
    const { text } = await describeImageForChat({
      buffer: check.buffer,
      mime,
      fileName: file.name,
    });
    if (!text.trim()) {
      return NextResponse.json({ error: "图片里没有识别出可用内容" }, { status: 422 });
    }
    return NextResponse.json({
      fileName: file.name,
      fileSize: file.size,
      kind: "image",
      textLength: text.length,
      textPreview: text.slice(0, 500),
      text,
    });
  } catch (err) {
    console.error("[ai/upload-image] Error:", err);
    return NextResponse.json({ error: "图片识别失败，请稍后再试" }, { status: 502 });
  }
});
