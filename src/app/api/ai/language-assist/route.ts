import { NextResponse } from "next/server";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import {
  getTranslatePrompt,
  getUnderstandAndReplyPrompt,
  type LanguageAssistMode,
} from "@/lib/ai/prompts";
import { withAuth } from "@/lib/common/api-helpers";

const MAX_TEXT_LENGTH = 8000;

export const POST = withAuth(async (request) => {
  if (!isAIConfigured()) {
    return NextResponse.json({ error: "AI 功能未配置" }, { status: 503 });
  }

  let body: { text?: string; mode?: string; targetLang?: string; context?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "文本内容不能为空" }, { status: 400 });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `文本过长，最多支持 ${MAX_TEXT_LENGTH} 字符` },
      { status: 400 }
    );
  }

  const mode: LanguageAssistMode =
    body.mode === "translate" ? "translate" : "understand_and_reply";
  const targetLang = body.targetLang === "en" ? "en" : "zh";
  const context = body.context?.trim() || "";

  try {
    const systemPrompt =
      mode === "translate"
        ? getTranslatePrompt(targetLang)
        : getUnderstandAndReplyPrompt(context, targetLang);

    const raw = await createCompletion({
      systemPrompt,
      userPrompt: text,
      mode: "fast",
      temperature: 0.2,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI 返回格式异常，请重试" },
        { status: 502 }
      );
    }

    const result = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      mode,
      result,
      originalLength: text.length,
      processedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[language-assist] error:", err);
    return NextResponse.json(
      { error: "AI 处理失败，请稍后重试" },
      { status: 500 }
    );
  }
});
