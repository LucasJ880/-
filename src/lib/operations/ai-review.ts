/**
 * AI 预审 — 发布文案按品牌档案打分标注（先于人工，后于确定性规则）
 *
 * 与规则层的分工：
 * - content-rules（正则）：确定性红线，可 block，不可绕过
 * - AI 预审：语气不符 / 卖点跑偏 / 疑似夸大等模糊问题，只标 review 不 block，
 *   命中的任务滞留审核队列并附理由，帮审核员秒判
 *
 * 保守降级：AI 未配置或调用失败时全部放行（规则层已兜底红线），不阻塞发布。
 */

import type { VideoAsset } from "@prisma/client";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";

/** 单次调用最多审的文案数，超出分批 */
const MAX_CAPTIONS_PER_CALL = 20;

const SYSTEM_PROMPT = `你是社媒内容的品牌合规预审员。给定品牌档案和若干条待发布文案，逐条判断是否需要人工复核。

只在以下情况标记 flag（需要人工看）：
- 出现品牌档案「内容禁忌」中列出的表述或承诺
- 语气与品牌声音明显冲突（如品牌要求温暖专业，文案却浮夸叫卖）
- 卖点与品牌档案不符或疑似编造（文案声称了档案中不存在的能力/服务）
- 疑似夸大但未被硬规则覆盖的表述（暗示性承诺、误导性对比）

判断原则：
- 宁可放行，不要过度标记；普通的口语化、创意表达、正常营销话术一律 pass
- 理由必须具体到哪句话有什么问题，一条理由不超过 30 字
- 没有品牌档案的维度不要凭空推断

输出严格 JSON 数组，按输入顺序，每项：
{"accountId": "...", "verdict": "pass" | "flag", "reasons": ["..."]}
pass 时 reasons 为空数组。不要输出其他内容。`;

export interface AiReviewItem {
  verdict: "pass" | "flag";
  reasons: string[];
}

export interface AiReviewResult {
  /** accountId → 预审结果；降级时所有账号 pass */
  items: Map<string, AiReviewItem>;
  /** true 表示 AI 未配置或调用失败，走了保守放行 */
  degraded: boolean;
}

function parseReview(raw: string): Array<{ accountId: string } & AiReviewItem> {
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(jsonText) as unknown;
  if (!Array.isArray(parsed)) throw new Error("预审输出不是数组");
  return parsed
    .filter(
      (it): it is { accountId: string; verdict: string; reasons: unknown } =>
        typeof it === "object" &&
        it !== null &&
        typeof (it as Record<string, unknown>).accountId === "string",
    )
    .map((it) => ({
      accountId: it.accountId,
      verdict: it.verdict === "flag" ? "flag" : "pass",
      reasons: Array.isArray(it.reasons)
        ? it.reasons.filter((r): r is string => typeof r === "string").slice(0, 5)
        : [],
    }));
}

async function reviewBatch(
  asset: Pick<VideoAsset, "title" | "topic" | "language">,
  captions: Array<{ accountId: string; caption: string }>,
  brandContext: string,
): Promise<Map<string, AiReviewItem>> {
  const userPrompt = JSON.stringify(
    {
      video: { title: asset.title, topic: asset.topic, language: asset.language },
      captions,
    },
    null,
    2,
  );

  const content = await createCompletion({
    systemPrompt: `${SYSTEM_PROMPT}\n\n【品牌档案】\n${brandContext}`,
    userPrompt,
    mode: "structured",
    timeoutMs: 60_000,
  });

  const map = new Map<string, AiReviewItem>();
  for (const item of parseReview(content)) {
    map.set(item.accountId, { verdict: item.verdict, reasons: item.reasons });
  }
  return map;
}

/**
 * 批量预审一组账号文案。
 * 无品牌档案时直接全放行（没有口径可依据，避免 AI 凭空推断）。
 */
export async function reviewCaptionsAgainstBrand(
  asset: Pick<VideoAsset, "title" | "topic" | "language">,
  captions: Array<{ accountId: string; caption: string }>,
  brandContext: string | null,
): Promise<AiReviewResult> {
  const items = new Map<string, AiReviewItem>();
  const passAll = () => {
    for (const c of captions) items.set(c.accountId, { verdict: "pass", reasons: [] });
  };

  if (!brandContext || !isAIConfigured() || captions.length === 0) {
    passAll();
    return { items, degraded: Boolean(brandContext) && captions.length > 0 };
  }

  let degraded = false;
  for (let i = 0; i < captions.length; i += MAX_CAPTIONS_PER_CALL) {
    const batch = captions.slice(i, i + MAX_CAPTIONS_PER_CALL);
    try {
      const reviewed = await reviewBatch(asset, batch, brandContext);
      for (const c of batch) {
        items.set(c.accountId, reviewed.get(c.accountId) ?? { verdict: "pass", reasons: [] });
      }
    } catch {
      for (const c of batch) items.set(c.accountId, { verdict: "pass", reasons: [] });
      degraded = true;
    }
  }
  return { items, degraded };
}
