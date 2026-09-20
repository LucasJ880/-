/**
 * 图片 → 文字（供对话附件使用）
 *
 * 把用户拖进对话框的截图 / 产品照 / 吊牌 / 名片等图片，用 Vision 模型转成
 * 「逐字转录 + 画面描述 + 类型判断」的纯文本，再作为附件正文进入对话链路。
 * 这样对话主链路（含 agent-core 工具调用）无需支持多模态消息即可分析图片。
 *
 * 调用方式与 src/lib/trade/intelligence-label-vision.ts 保持一致（data URL 直传）。
 */

import { buildTuningParams } from "@/lib/ai/client";

const SYSTEM_PROMPT = `你是外贸业务的图片识别助手。你的输出会作为「附件正文」交给另一个 AI 做业务分析，所以要客观、完整、不编造。

请按下面三段输出纯文本（中文，段标题原样保留，不要 Markdown 围栏）：

【文字内容】
逐字转录图片中所有可读文字：保留原语言，不翻译；表格按行转录、单元格用 | 分隔；数字、单位、货币、日期、型号、尺寸、联系方式必须原样抄录。看不清的地方写 [不清晰]，不得猜测补全。若图片没有文字，写「（无可读文字）」。

【画面描述】
客观描述画面：产品/物体（类型、材质、颜色、结构、数量）、包装或标签、场景、截图所属的应用或网页、图表的含义。不要评价，不要推断图中没有的信息。

【类型判断】
一句话判断这张图最可能是什么（如：客户询盘截图 / 报价单 / 产品照片 / 吊牌或标签 / 名片 / 聊天记录 / 物流单据 / 其他），并说明依据。

总长度不超过 3000 字。`;

export interface DescribeImageParams {
  buffer: Buffer;
  mime: string;
  fileName: string;
}

export interface DescribeImageResult {
  text: string;
  model: string;
}

export async function describeImageForChat(
  params: DescribeImageParams,
): Promise<DescribeImageResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY 未配置");
  }
  const { ProviderRouter } = await import("@/lib/ai/model-registry");
  const model = ProviderRouter.getVisionModel();
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const dataUrl = `data:${params.mime};base64,${params.buffer.toString("base64")}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      // gpt-5.6 系推理模型不接受自定义 temperature，只认 reasoning_effort；旧模型相反
      ...buildTuningParams(model, 0.1, "low"),
      max_completion_tokens: 3000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `文件名：${params.fileName}\n请识别这张图片。` },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`图片识别请求失败 ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = String(data.choices?.[0]?.message?.content ?? "").trim();
  return { text, model };
}
