/**
 * AI 对话（主助手 / 项目问青砚 / 收件箱）— 图片附件
 *
 * POST /api/ai/upload-image   (multipart/form-data: file, orgId?)
 *   png/jpg/jpeg/webp ≤ 6MB。原图存入私有 Blob（ai-chat/{orgId}/{userId}/…，
 *   浏览器经 /api/files 代理按 org 成员鉴权读取），并用 Vision 模型转成文本；
 *   浏览器随消息提交为 attachments[{ kind: "image", name, size, mime, text, blobPath }]。
 *   原图保留是为了追问时能重新看图（工具 chat_view_attachment_image）。
 *
 * DELETE /api/ai/upload-image?path=ai-chat/...&orgId=…
 *   用户在发送前移除了图片芯片 → 删掉刚上传的原图（只允许删自己 org/自己上传的路径）。
 *
 * 与文档解析接口 /api/ai/upload-file 对称；处理逻辑与外贸对话共用 src/lib/chat-attachments/upload-image.ts。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { AI_CHAT_BLOB_ROOT } from "@/lib/chat-attachments/core";
import { deleteOwnChatImage, processChatImageUpload } from "@/lib/chat-attachments/upload-image";

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
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    (typeof orgIdField === "string" ? orgIdField : null) || request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传图片" }, { status: 400 });
  }

  const result = await processChatImageUpload({
    file,
    orgId: orgRes.orgId,
    userId: user.id,
    root: AI_CHAT_BLOB_ROOT,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body);
});

export const DELETE = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;

  const result = await deleteOwnChatImage({
    path: request.nextUrl.searchParams.get("path") ?? "",
    orgId: orgRes.orgId,
    userId: user.id,
    root: AI_CHAT_BLOB_ROOT,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
});
