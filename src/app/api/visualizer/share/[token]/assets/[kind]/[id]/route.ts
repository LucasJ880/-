/**
 * GET /api/visualizer/share/[token]/assets/[kind]/[id] — 分享页无登录读图（B1）
 *
 * Blob 私有化后，公开分享页的图片不再直接用 Blob URL，改走本通道：
 * - 仅凭 shareToken 鉴权（middleware 已将 /api/visualizer/share 列入白名单）
 * - kind=source  → VisualizerSourceImage.fileUrl（必须属于该 session）
 * - kind=variant → VisualizerVariant.exportImageUrl（必须属于该 session）
 * - token 无效 404、过期 410、资产不属于该 session 404
 *
 * 注意：本端点公开可达，绝不接受任意 pathname，只按资产 id 反查 DB 中的 URL。
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isShareLive } from "@/lib/visualizer/share";
import { readBlobStream } from "@/lib/files/blob-access";

const notFound = () => NextResponse.json({ error: "文件不存在" }, { status: 404 });

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ token: string; kind: string; id: string }> },
) {
  const { token, kind, id } = await ctx.params;
  if (!token || token.length < 16 || !id) return notFound();
  if (kind !== "source" && kind !== "variant") return notFound();

  const session = await db.visualizerSession.findUnique({
    where: { shareToken: token },
    select: { id: true, shareToken: true, shareExpiresAt: true },
  });
  if (!session) return notFound();
  if (!isShareLive(session.shareToken, session.shareExpiresAt)) {
    return NextResponse.json({ error: "链接已过期" }, { status: 410 });
  }

  let fileUrl: string | null = null;
  if (kind === "source") {
    const img = await db.visualizerSourceImage.findFirst({
      where: { id, sessionId: session.id },
      select: { fileUrl: true },
    });
    fileUrl = img?.fileUrl ?? null;
  } else {
    const variant = await db.visualizerVariant.findFirst({
      where: { id, sessionId: session.id },
      select: { exportImageUrl: true },
    });
    fileUrl = variant?.exportImageUrl ?? null;
  }
  if (!fileUrl) return notFound();

  const blob = await readBlobStream(fileUrl);
  if (!blob) return notFound();

  const headers = new Headers({
    "Content-Type": blob.contentType,
    // 分享链接本身有 TTL；图片内容不可变，允许短时缓存减少重复拉取
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });
  if (blob.size != null) headers.set("Content-Length", String(blob.size));

  return new NextResponse(blob.stream, { status: 200, headers });
}
