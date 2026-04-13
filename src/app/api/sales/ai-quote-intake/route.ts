/**
 * AI 报价接收端点
 *
 * 接受文本 / 语音 / 截图输入，返回结构化的报价行项预览。
 * 兼容 Sunny Quote 前端的调用格式。
 *
 * POST body:
 *   - prompt: string (自然语言描述)
 *   - image_data_url?: string (截图 base64)
 *   - audio?: base64 string (语音录音)
 *   - audio_mime?: string (音频 MIME 类型)
 *   - current_product?: string
 *   - current_fabric?: string
 *   - replace_quote?: boolean
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  parseGptQuotePlan,
  parseLocalQuotePlan,
  transcribeVoice,
} from "@/lib/sales/ai-quote-parser";
import { calculateQuoteTotal } from "@/lib/blinds/pricing-engine";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      prompt,
      image_data_url,
      audio,
      audio_mime,
      current_product,
      current_fabric,
    } = body as {
      prompt?: string;
      image_data_url?: string;
      audio?: string;
      audio_mime?: string;
      current_product?: string;
      current_fabric?: string;
    };

    let textPrompt = prompt || "";

    if (audio && audio_mime) {
      const audioBuffer = Buffer.from(audio, "base64");
      const transcription = await transcribeVoice(audioBuffer, audio_mime);
      textPrompt = transcription;
    }

    if (!textPrompt && !image_data_url) {
      return NextResponse.json(
        { error: "请提供文本描述、语音录音或截图" },
        { status: 400 },
      );
    }

    const plan = await parseGptQuotePlan(textPrompt, {
      imageDataUrl: image_data_url,
      currentProduct: current_product,
      currentFabric: current_fabric,
    });

    if (plan.items.length === 0 && !image_data_url) {
      const localPlan = parseLocalQuotePlan(textPrompt);
      if (localPlan.items.length > plan.items.length) {
        Object.assign(plan, localPlan);
      }
    }

    const preview = plan.items.length > 0
      ? calculateQuoteTotal({
          items: plan.items,
          addons: plan.addons,
          installMode: plan.installMode,
        })
      : null;

    return NextResponse.json({
      plan,
      preview,
      transcription: audio ? textPrompt : undefined,
      parseMethod: plan.parseMethod,
    });
  } catch (err) {
    console.error("AI quote intake error:", err);
    return NextResponse.json(
      { error: "AI 解析失败，请重试" },
      { status: 500 },
    );
  }
}
