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
 *
 * 处理逻辑与主助手的 /api/ai/upload-image 共用 src/lib/chat-attachments/upload-image.ts。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { TRADE_CHAT_BLOB_ROOT } from "@/lib/chat-attachments/core";
import { deleteOwnChatImage, processChatImageUpload } from "@/lib/chat-attachments/upload-image";

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

  const result = await processChatImageUpload({
    file,
    orgId: orgRes.orgId,
    userId: auth.user.id,
    root: TRADE_CHAT_BLOB_ROOT,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body);
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const result = await deleteOwnChatImage({
    path: request.nextUrl.searchParams.get("path") ?? "",
    orgId: orgRes.orgId,
    userId: auth.user.id,
    root: TRADE_CHAT_BLOB_ROOT,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
