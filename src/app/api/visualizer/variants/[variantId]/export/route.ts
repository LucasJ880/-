import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionByVariant,
} from "@/lib/visualizer/access";
import {
  parsePngDataUrl,
  putVisualizerExport,
} from "@/lib/visualizer/upload";

/**
 * POST /api/visualizer/variants/[variantId]/export
 *
 * 客户端在画布上用 Konva Stage.toDataURL 拿到的 PNG dataURL 传上来。
 * 服务端：
 *  1) 权限：variantId → variant.session → canSeeVisualizerSession
 *  2) 体积 / 格式校验（只允许 image/png）
 *  3) put 到 @vercel/blob（public）
 *  4) 写回 VisualizerVariant.exportImageUrl 作为方案封面
 *
 * Body: { dataUrl: string }  // "data:image/png;base64,..."
 * Returns: { exportImageUrl: string; updatedAt: string }
 */

interface ExportBody {
  dataUrl?: string;
}

export const POST = withAuth(async (request, ctx, user) => {
  const { variantId } = await ctx.params;

  const found = await loadSessionByVariant(variantId);
  if (!found) {
    return NextResponse.json({ error: "方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权操作该方案" }, { status: 403 });
  }

  const body = await safeParseBody<ExportBody>(request);
  if (!body || typeof body.dataUrl !== "string") {
    return NextResponse.json({ error: "dataUrl 必填" }, { status: 400 });
  }

  const parsed = parsePngDataUrl(body.dataUrl);
  if (!parsed) {
    return NextResponse.json(
      { error: "dataUrl 非法（仅支持 PNG 且不超过体积上限）" },
      { status: 400 },
    );
  }

  const uploaded = await putVisualizerExport({
    sessionId: found.session.id,
    variantId,
    buffer: parsed.buffer,
  });

  const updated = await db.visualizerVariant.update({
    where: { id: variantId },
    data: { exportImageUrl: uploaded.url },
    select: { id: true, exportImageUrl: true, updatedAt: true },
  });
  await db.visualizerSession.update({
    where: { id: found.session.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({
    exportImageUrl: updated.exportImageUrl,
    updatedAt: updated.updatedAt.toISOString(),
  });
});
