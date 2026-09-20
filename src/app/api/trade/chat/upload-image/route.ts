/**
 * 外贸 AI 对话 — 图片附件
 *
 * POST /api/trade/chat/upload-image   (multipart/form-data: file, orgId?)
 *   png/jpg/jpeg/webp ≤ 6MB。原图存入私有 Blob（trade-chat/{orgId}/{userId}/…，
 *   浏览器经 /api/files 代理按 org 成员鉴权读取），并用 Vision 模型转成
 *   「逐字转录 + 画面描述 + 类型判断」文本；浏览器随消息提交为
 *   attachments[{ kind: "image", name, size, mime, text, blobPath }]。
 *   原图保留是为了追问时能重新看图（工具 trade_view_attachment_image）。
 *
 * DELETE /api/trade/chat/upload-image?path=trade-chat/...
 *   用户在发送前移除了图片芯片 → 删掉刚上传的原图（只允许删自己 org/自己上传的路径）。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { validateUploadedFileAsync } from "@/lib/files/upload-guard";
import { deleteBlob, putPrivateBlob } from "@/lib/files/blob-access";
import { describeImageForChat } from "@/lib/ai/image-to-text";
import {
  attachmentBlobPathBelongsTo,
  tradeChatImageBlobPrefix,
} from "@/lib/trade/chat-attachments";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ALLOWED_EXT = ["png", "jpg", "jpeg", "webp"];
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const UPLOAD_RATE_LIMIT = {
  name: "trade-chat-upload-image",
  windowMs: 60_000,
  maxRequests: 10,
} as const;

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimitAsync(UPLOAD_RATE_LIMIT, auth.user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "上传过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }

  const orgIdField = form.get("orgId");
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof orgIdField === "string" ? orgIdField : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const file = form.get("file");
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
  // 魔数已校验；MIME 以扩展名为准，避免浏览器给的 octet-stream 进到 data URL / 代理响应头
  const mime = MIME_BY_EXT[check.ext] ?? check.mime;

  const blobPath = `${tradeChatImageBlobPrefix(orgRes.orgId, auth.user.id)}${Date.now()}_${check.safeName}`;
  let proxyUrl: string;
  try {
    const blob = await putPrivateBlob({ pathname: blobPath, body: check.buffer, contentType: mime });
    proxyUrl = blob.proxyUrl;
  } catch (e) {
    console.error("[trade/chat/upload-image] blob put failed:", e);
    return NextResponse.json({ error: "图片存储失败，请稍后再试" }, { status: 502 });
  }

  try {
    const { text } = await describeImageForChat({ buffer: check.buffer, mime, fileName: file.name });
    if (!text.trim()) {
      await deleteBlob(blobPath).catch(() => undefined);
      return NextResponse.json({ error: "图片里没有识别出可用内容" }, { status: 422 });
    }
    return NextResponse.json({
      name: file.name,
      kind: "image",
      size: file.size,
      mime,
      text,
      textLength: text.length,
      blobPath,
      fileUrl: proxyUrl,
    });
  } catch (err) {
    console.error("[trade/chat/upload-image] vision failed:", err);
    await deleteBlob(blobPath).catch(() => undefined);
    return NextResponse.json({ error: "图片识别失败，请稍后再试" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const path = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  // 只允许删「当前 org + 本人上传」前缀下的对象；已随消息落库的图片不经此接口删除
  const own = tradeChatImageBlobPrefix(orgRes.orgId, auth.user.id);
  if (!path.startsWith(own) || !attachmentBlobPathBelongsTo(path, orgRes.orgId) || path.includes("..")) {
    return NextResponse.json({ error: "路径不合法" }, { status: 400 });
  }
  await deleteBlob(path).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
