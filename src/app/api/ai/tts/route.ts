import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TEXT_CHARS = 4000;

/**
 * POST /api/ai/tts
 * 文字转语音（AI 回复播报）
 * body: { text: string }
 * 返回 audio/mpeg 流
 */
export const POST = withAuth(async (request) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI 服务未配置" }, { status: 503 });
  }

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "缺少文本" }, { status: 400 });
  }

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.OPENAI_TTS_VOICE || "nova",
      input: text.slice(0, MAX_TEXT_CHARS),
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[tts] OpenAI error", res.status, detail.slice(0, 300));
    return NextResponse.json({ error: "语音合成失败" }, { status: 502 });
  }

  const audio = await res.arrayBuffer();
  return new NextResponse(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
});
