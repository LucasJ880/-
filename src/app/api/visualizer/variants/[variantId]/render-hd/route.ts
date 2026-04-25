import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionByVariant,
} from "@/lib/visualizer/access";
import { runImageEdit } from "@/lib/visualizer/image-ai";
import {
  parsePngDataUrl,
  putVisualizerHdRender,
} from "@/lib/visualizer/upload";

type RenderBody = { dataUrl?: string; instruction?: string };

export const POST = withAuth(async (request, ctx, user) => {
  const { variantId } = await ctx.params;
  const found = await loadSessionByVariant(variantId);
  if (!found) return NextResponse.json({ error: "方案不存在" }, { status: 404 });
  if (!canSeeVisualizerSession(found.session, user)) {
    return NextResponse.json({ error: "无权操作该方案" }, { status: 403 });
  }

  const body = await safeParseBody<RenderBody>(request);
  if (!body?.dataUrl) {
    return NextResponse.json({ error: "dataUrl 必填" }, { status: 400 });
  }
  const parsed = parsePngDataUrl(body.dataUrl);
  if (!parsed) {
    return NextResponse.json(
      { error: "dataUrl 非法（仅支持 PNG 且不超过体积上限）" },
      { status: 400 },
    );
  }

  const prompt =
    typeof body.instruction === "string" && body.instruction.trim()
      ? body.instruction.trim().slice(0, 300)
      : "Enhance this window covering preview into a high-definition photorealistic sales rendering. Preserve the room layout, window position, product shape, product color, opacity, and mounting alignment. Improve lighting, edges, shadows, realism, and image clarity. Do not change the selected window covering style.";

  const rendered = await runImageEdit({
    imageBuffer: parsed.buffer,
    imageMime: "image/png",
    prompt,
  });
  if (!rendered) {
    return NextResponse.json({ error: "高清渲染失败，请稍后重试" }, { status: 502 });
  }

  const uploaded = await putVisualizerHdRender({
    sessionId: found.session.id,
    variantId,
    buffer: rendered,
  });
  const updated = await db.visualizerVariant.update({
    where: { id: variantId },
    data: { exportImageUrl: uploaded.url },
    select: { exportImageUrl: true, updatedAt: true },
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
