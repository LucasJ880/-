/**
 * 文案变体引擎
 *
 * 矩阵账号发同一条视频时，文案必须差异化（平台查重会集体降权）。
 * 一次 LLM 调用为一组账号批量生成变体：保留核心卖点与 CTA 意图，
 * 换句式、换开头钩子、换表达顺序；语气跟随账号组 persona。
 *
 * AI 未配置或调用失败时回退为母版文案（宁可重复也不阻塞发布）。
 */

import type { MatrixAccount, VideoAsset } from "@prisma/client";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";

/** 单次调用最多生成的变体数，超出则分批 */
const MAX_VARIANTS_PER_CALL = 20;

const SYSTEM_PROMPT = `你是社媒矩阵运营的文案改写引擎。给定一条母版文案和若干账号，为每个账号生成一条差异化变体。

要求：
- 保留核心卖点、事实信息和行动号召的意图，禁止编造母版中没有的功能、价格或承诺
- 每条变体之间显著不同：换开头钩子、换句式结构、换表达顺序，避免同义词替换式的伪差异
- 语言跟随母版（英文母版出英文，中文母版出中文），长度与母版相当
- 语气贴合各账号的 persona 描述；无描述则用自然、口语化的品牌声音
- 不添加母版之外的 hashtag

输出严格 JSON 数组，按输入账号顺序，每项：{"accountId": "...", "caption": "..."}，不要输出其他内容。`;

export interface CaptionVariantResult {
  /** accountId → 变体文案；未命中的账号回退母版 */
  captions: Map<string, string>;
  /** true 表示全部或部分回退了母版文案 */
  usedFallback: boolean;
}

function parseVariants(raw: string): Array<{ accountId: string; caption: string }> {
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(jsonText) as unknown;
  if (!Array.isArray(parsed)) throw new Error("变体输出不是数组");
  return parsed
    .filter(
      (it): it is { accountId: string; caption: string } =>
        typeof it === "object" &&
        it !== null &&
        typeof (it as Record<string, unknown>).accountId === "string" &&
        typeof (it as Record<string, unknown>).caption === "string" &&
        Boolean((it as Record<string, unknown>).caption),
    )
    .map((it) => ({ accountId: it.accountId, caption: it.caption.trim() }));
}

async function generateBatch(
  asset: Pick<VideoAsset, "title" | "topic" | "language">,
  baseCaption: string,
  accounts: Array<Pick<MatrixAccount, "id" | "groupName" | "personaNotes" | "platform">>,
): Promise<Map<string, string>> {
  const userPrompt = JSON.stringify(
    {
      video: { title: asset.title, topic: asset.topic, language: asset.language },
      baseCaption,
      accounts: accounts.map((a) => ({
        accountId: a.id,
        platform: a.platform,
        group: a.groupName,
        persona: a.personaNotes ?? null,
      })),
    },
    null,
    2,
  );

  const content = await createCompletion({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    mode: "normal",
    timeoutMs: 60_000,
  });

  const variants = parseVariants(content);
  const map = new Map<string, string>();
  for (const v of variants) map.set(v.accountId, v.caption);
  return map;
}

export async function generateCaptionVariants(
  asset: Pick<VideoAsset, "title" | "topic" | "language">,
  baseCaption: string,
  accounts: Array<Pick<MatrixAccount, "id" | "groupName" | "personaNotes" | "platform">>,
): Promise<CaptionVariantResult> {
  const captions = new Map<string, string>();
  if (!isAIConfigured() || accounts.length === 0) {
    for (const a of accounts) captions.set(a.id, baseCaption);
    return { captions, usedFallback: accounts.length > 0 };
  }

  let usedFallback = false;
  for (let i = 0; i < accounts.length; i += MAX_VARIANTS_PER_CALL) {
    const batch = accounts.slice(i, i + MAX_VARIANTS_PER_CALL);
    try {
      const generated = await generateBatch(asset, baseCaption, batch);
      for (const a of batch) {
        const caption = generated.get(a.id);
        if (caption) {
          captions.set(a.id, caption);
        } else {
          captions.set(a.id, baseCaption);
          usedFallback = true;
        }
      }
    } catch {
      for (const a of batch) captions.set(a.id, baseCaption);
      usedFallback = true;
    }
  }
  return { captions, usedFallback };
}
