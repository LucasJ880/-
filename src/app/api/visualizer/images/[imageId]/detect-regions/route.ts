import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canSeeVisualizerSession,
  loadSessionBySourceImage,
} from "@/lib/visualizer/access";
import {
  normalizeDetectedRegionCandidates,
  stripJsonFence,
} from "@/lib/visualizer/ai-detect";
import {
  detectWindowsWithGroundingDino,
  isGroundingDinoConfigured,
} from "@/lib/visualizer/grounding-dino";
import { readBlobBuffer } from "@/lib/files/blob-access";

/**
 * POST /api/visualizer/images/[imageId]/detect-regions
 *
 * 识别照片里的窗户区域，只返回草稿，不直接落库。
 * 前端需要销售点击确认后，再调用现有 POST /regions 接口保存。
 *
 * 检测路径（按优先级）：
 * 1. Grounding DINO（Replicate）— 专用检测器，坐标精确，配置 REPLICATE_API_TOKEN 即启用
 * 2. GPT 视觉回退 — 语言模型报坐标有漂移，仅在 DINO 未配置或调用失败时使用
 */
export const POST = withAuth(async (_request, ctx, user) => {
  const { imageId } = await ctx.params;

  const session = await loadSessionBySourceImage(imageId);
  if (!session) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(session, user)) {
    return NextResponse.json({ error: "无权操作该图片" }, { status: 403 });
  }

  const image = await db.visualizerSourceImage.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      fileUrl: true,
      width: true,
      height: true,
      regions: { select: { id: true } },
    },
  });
  if (!image) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }
  if (!image.width || !image.height) {
    return NextResponse.json(
      { error: "图片缺少尺寸信息，无法进行 AI 标注" },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !isGroundingDinoConfigured()) {
    return NextResponse.json(
      { error: "未配置 AI 检测所需的 API Key，无法使用 AI 识别" },
      { status: 503 },
    );
  }

  const model =
    process.env.OPENAI_VISION_MODEL ||
    process.env.OPENAI_MODEL_MINI ||
    "gpt-4o-mini";
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  const prompt = `Detect visible window openings in this window-covering site photo.

Image size: ${image.width} x ${image.height} pixels.

Return ONLY valid JSON, no markdown:
{
  "windows": [
    {
      "label": "Living room window",
      "x1": 120,
      "y1": 80,
      "x2": 640,
      "y2": 520,
      "confidence": 0.86,
      "reason": "large bright rectangular opening"
    }
  ]
}

Rules:
- Coordinates MUST be in the original image pixel coordinate system.
- Prefer the actual window glass/opening area, not the whole wall.
- Include old curtains/blinds as part of the window area if they cover the window.
- Ignore furniture, doors, mirrors, paintings, and random bright objects.
- Be conservative. Return at most 8 windows.
- If unsure, return an empty windows array.`;

  // 私有 Blob 后外部模型无法抓取存储/代理 URL，服务端先读出字节
  const imageBytes = await readBlobBuffer(image.fileUrl);
  if (!imageBytes) {
    return NextResponse.json({ error: "图片读取失败" }, { status: 502 });
  }

  // ── 主路径：Grounding DINO（专用检测器，坐标精确）──
  if (isGroundingDinoConfigured()) {
    try {
      const detections = await detectWindowsWithGroundingDino({
        imageBuffer: imageBytes.buffer,
        contentType: imageBytes.contentType,
      });
      const candidates = normalizeDetectedRegionCandidates(
        { windows: detections },
        { width: image.width, height: image.height },
      );
      return NextResponse.json({
        candidates,
        image: { id: image.id, width: image.width, height: image.height },
        existingRegionCount: image.regions.length,
        model: "grounding-dino",
      });
    } catch (err) {
      console.error(
        "Visualizer grounding-dino detect failed, fallback to VLM:",
        err,
      );
      // 继续走下方 GPT 回退路径
    }
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "AI 识别失败，请稍后重试" },
      { status: 502 },
    );
  }

  const imageDataUrl = `data:${imageBytes.contentType};base64,${imageBytes.buffer.toString("base64")}`;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: imageDataUrl, detail: "high" },
              },
            ],
          },
        ],
        temperature: 0.1,
        max_completion_tokens: 1200,
      }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      console.error("Visualizer detect regions failed:", res.status, msg);
      return NextResponse.json(
        { error: "AI 识别失败，请稍后重试" },
        { status: 502 },
      );
    }

    const data = await res.json();
    const content = String(data.choices?.[0]?.message?.content ?? "");
    const parsed = JSON.parse(stripJsonFence(content));
    const candidates = normalizeDetectedRegionCandidates(parsed, {
      width: image.width,
      height: image.height,
    });

    return NextResponse.json({
      candidates,
      image: { id: image.id, width: image.width, height: image.height },
      existingRegionCount: image.regions.length,
      model,
    });
  } catch (err) {
    console.error("Visualizer detect regions error:", err);
    return NextResponse.json(
      { error: "AI 识别失败，请稍后重试" },
      { status: 500 },
    );
  }
});
