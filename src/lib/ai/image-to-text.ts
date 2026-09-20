/**
 * 图片 → 文字（供对话附件使用）
 *
 * 两个入口：
 * - describeImageForChat：上传时把截图 / 产品照 / 吊牌 / 名片等转成
 *   「逐字转录 + 画面描述 + 类型判断」纯文本，作为附件正文进入对话链路，
 *   这样对话主链路（含 agent-core 工具调用）无需支持多模态消息即可分析图片。
 * - answerQuestionAboutImage：追问时按用户问题重新看原图（工具 trade_view_attachment_image 用），
 *   补足识别文本覆盖不到的视觉细节。
 *
 * 调用方式与 src/lib/trade/intelligence-label-vision.ts 保持一致（data URL 直传）；
 * 参数经 buildTuningParams 适配模型族（gpt-5.6 / gpt-6 不吃 temperature）。
 */

import { buildTuningParams } from "@/lib/ai/client";

const DESCRIBE_SYSTEM_PROMPT = `你是外贸业务的图片识别助手。你的输出会作为「附件正文」交给另一个 AI 做业务分析，所以要客观、完整、不编造。

请按下面三段输出纯文本（中文，段标题原样保留，不要 Markdown 围栏）：

【文字内容】
逐字转录图片中所有可读文字：保留原语言，不翻译；表格按行转录、单元格用 | 分隔；数字、单位、货币、日期、型号、尺寸、联系方式必须原样抄录。看不清的地方写 [不清晰]，不得猜测补全。若图片没有文字，写「（无可读文字）」。

【画面描述】
客观描述画面：产品/物体（类型、材质、颜色、结构、数量）、包装或标签、场景、截图所属的应用或网页、图表的含义。不要评价，不要推断图中没有的信息。

【类型判断】
一句话判断这张图最可能是什么（如：客户询盘截图 / 报价单 / 产品照片 / 吊牌或标签 / 名片 / 聊天记录 / 物流单据 / 其他），并说明依据。

总长度不超过 3000 字。`;

const QUESTION_SYSTEM_PROMPT = `你是外贸业务的看图助手。用户已经上传了这张图片，现在针对它追问。

规则：
1. 只根据图片中能看到的内容回答；看不清或图中没有的信息直接说「图中看不出」，不得编造。
2. 涉及文字、数字、型号、联系方式时逐字抄录。
3. 涉及颜色、材质、结构、位置、数量等视觉细节时描述要具体（如「外框深米褐色、内部浅米色」）。
4. 用简洁中文回答，先给结论再给依据；不要寒暄。`;

export interface VisionImageInput {
  buffer: Buffer;
  mime: string;
  fileName: string;
}

export interface VisionTextResult {
  text: string;
  model: string;
}

async function callVision(params: {
  systemPrompt: string;
  userText: string;
  image: VisionImageInput;
  maxTokens: number;
}): Promise<VisionTextResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY 未配置");
  }
  const { ProviderRouter } = await import("@/lib/ai/model-registry");
  const model = ProviderRouter.getVisionModel();
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const dataUrl = `data:${params.image.mime};base64,${params.image.buffer.toString("base64")}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      // gpt-5.6 / gpt-6 系推理模型不接受自定义 temperature，只认 reasoning_effort；旧模型相反
      ...buildTuningParams(model, 0.1, "low"),
      max_completion_tokens: params.maxTokens,
      messages: [
        { role: "system", content: params.systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: params.userText },
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

/** 上传时：整图转文字（逐字转录 + 画面描述 + 类型判断） */
export async function describeImageForChat(image: VisionImageInput): Promise<VisionTextResult> {
  return callVision({
    systemPrompt: DESCRIBE_SYSTEM_PROMPT,
    userText: `文件名：${image.fileName}\n请识别这张图片。`,
    image,
    maxTokens: 3000,
  });
}

/** 追问时：带着具体问题重新看原图 */
export async function answerQuestionAboutImage(
  image: VisionImageInput,
  question: string,
): Promise<VisionTextResult> {
  const q = question.trim();
  if (!q) throw new Error("question 不能为空");
  return callVision({
    systemPrompt: QUESTION_SYSTEM_PROMPT,
    userText: `文件名：${image.fileName}\n问题：${q.slice(0, 1000)}`,
    image,
    maxTokens: 1500,
  });
}
