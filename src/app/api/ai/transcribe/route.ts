import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15MB，约 60s 高质量录音的数倍余量

/**
 * POST /api/ai/transcribe
 * 语音转文字（AI 助手语音输入）
 * multipart/form-data: file=音频（webm/mp4/wav）
 * Whisper 自动识别语言（中英混说均可）
 */
export const POST = withAuth(async (request) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI 服务未配置" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "缺少音频文件" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "录音过长，请分段说" }, { status: 413 });
  }

  const mime = file.type || "audio/webm";
  const ext = mime.includes("mp4") || mime.includes("m4a")
    ? "mp4"
    : mime.includes("wav")
      ? "wav"
      : "webm";

  const upstream = new FormData();
  upstream.append("file", file, `voice.${ext}`);
  upstream.append("model", "whisper-1");
  // 不指定 language，Whisper 自动识别（支持中英混说）

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: upstream,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[transcribe] Whisper error", res.status, detail.slice(0, 300));
    return NextResponse.json({ error: "语音识别失败，请重试" }, { status: 502 });
  }

  const data = (await res.json()) as { text?: string };
  return NextResponse.json({ text: (data.text ?? "").trim() });
});
