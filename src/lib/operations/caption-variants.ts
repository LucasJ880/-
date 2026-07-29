/**
 * 文案变体引擎（Phase C）
 *
 * 必须依据每账号 effective Playbook 上下文生成真实差异化结构：
 * hook / title / body / cta / hashtags / firstComment / platformFields
 * 禁止仅同义词/emoji/换账号名。
 */

import type { VideoAsset } from "@prisma/client";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";

const MAX_VARIANTS_PER_CALL = 12;
export const CAPTION_PROMPT_VERSION = "matrix-caption-diff-v2";

const SYSTEM_PROMPT = `你是社媒矩阵差异化文案引擎。同一视频母版扇出到多个账号时，必须为每个账号生成**显著不同**的完整文案结构。

硬性要求：
- 保留母版事实与卖点意图，禁止编造价格、业绩、承诺
- 禁止只做同义词替换、随机句式微调、增删 emoji、只改账号名、同正文不同 hashtag
- Hook、正文结构、CTA 表达必须因账号 Playbook（角色/语气/支柱/CTA 策略）而不同
- 语言跟随母版
- 输出严格 JSON 数组，按输入顺序

每项字段：
{
  "accountId": "",
  "hook": "",
  "title": "",
  "body": "",
  "cta": "",
  "hashtags": ["#a"],
  "firstComment": "",
  "platformFields": {}
}`;

export type AccountCaptionBrief = {
  accountId: string;
  platform: string;
  handle: string;
  playbookSummary: {
    accountRole?: string | null;
    positioning?: string | null;
    toneOfVoice?: string | null;
    personaSummary?: string | null;
    contentPillars?: unknown;
    ctaStrategy?: unknown;
    forbiddenTopics?: unknown;
    hasApprovedPlaybook: boolean;
  };
};

export type StructuredCaption = {
  accountId: string;
  hook: string;
  title: string;
  body: string;
  cta: string;
  hashtags: string[];
  firstComment: string;
  platformFields: Record<string, unknown>;
};

export type CaptionVariantResult = {
  variants: Map<string, StructuredCaption>;
  usedFallback: boolean;
  promptVersion: string;
  model: string | null;
};

function parseVariants(raw: string): StructuredCaption[] {
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(jsonText) as unknown;
  if (!Array.isArray(parsed)) throw new Error("变体输出不是数组");
  const out: StructuredCaption[] = [];
  for (const it of parsed) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    if (typeof o.accountId !== "string") continue;
    const body =
      typeof o.body === "string"
        ? o.body.trim()
        : typeof o.caption === "string"
          ? o.caption.trim()
          : "";
    if (!body) continue;
    out.push({
      accountId: o.accountId,
      hook: typeof o.hook === "string" ? o.hook.trim() : "",
      title: typeof o.title === "string" ? o.title.trim() : "",
      body,
      cta: typeof o.cta === "string" ? o.cta.trim() : "",
      hashtags: Array.isArray(o.hashtags)
        ? o.hashtags.filter((h): h is string => typeof h === "string")
        : [],
      firstComment:
        typeof o.firstComment === "string" ? o.firstComment.trim() : "",
      platformFields:
        o.platformFields && typeof o.platformFields === "object"
          ? (o.platformFields as Record<string, unknown>)
          : {},
    });
  }
  return out;
}

function fallbackVariant(
  accountId: string,
  baseCaption: string,
  baseHashtags?: string,
): StructuredCaption {
  return {
    accountId,
    hook: "",
    title: "",
    body: baseCaption,
    cta: "",
    hashtags: baseHashtags
      ? baseHashtags.split(/[\s,]+/).filter(Boolean)
      : [],
    firstComment: "",
    platformFields: {},
  };
}

async function generateBatch(
  asset: Pick<VideoAsset, "title" | "topic" | "language">,
  baseCaption: string,
  baseHashtags: string | undefined,
  accounts: AccountCaptionBrief[],
): Promise<Map<string, StructuredCaption>> {
  const userPrompt = JSON.stringify(
    {
      video: { title: asset.title, topic: asset.topic, language: asset.language },
      baseCaption,
      baseHashtags: baseHashtags ?? null,
      accounts,
    },
    null,
    2,
  );

  const content = await createCompletion({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    mode: "normal",
    timeoutMs: 90_000,
  });

  const variants = parseVariants(content);
  const map = new Map<string, StructuredCaption>();
  for (const v of variants) map.set(v.accountId, v);
  return map;
}

/**
 * @deprecated 保留签名兼容；新代码请用 generateStructuredCaptionVariants
 */
export async function generateCaptionVariants(
  asset: Pick<VideoAsset, "title" | "topic" | "language">,
  baseCaption: string,
  accounts: Array<{
    id: string;
    groupName: string;
    personaNotes: string | null;
    platform: string;
  }>,
  _brandContext: string | null = null,
): Promise<{ captions: Map<string, string>; usedFallback: boolean }> {
  const briefs: AccountCaptionBrief[] = accounts.map((a) => ({
    accountId: a.id,
    platform: a.platform,
    handle: a.id,
    playbookSummary: {
      personaSummary: a.personaNotes,
      hasApprovedPlaybook: false,
    },
  }));
  const result = await generateStructuredCaptionVariants(
    asset,
    baseCaption,
    undefined,
    briefs,
  );
  const captions = new Map<string, string>();
  for (const [id, v] of result.variants) captions.set(id, v.body);
  return { captions, usedFallback: result.usedFallback };
}

export async function generateStructuredCaptionVariants(
  asset: Pick<VideoAsset, "title" | "topic" | "language">,
  baseCaption: string,
  baseHashtags: string | undefined,
  accounts: AccountCaptionBrief[],
): Promise<CaptionVariantResult> {
  const variants = new Map<string, StructuredCaption>();
  if (!isAIConfigured() || accounts.length === 0) {
    for (const a of accounts) {
      variants.set(a.accountId, fallbackVariant(a.accountId, baseCaption, baseHashtags));
    }
    return {
      variants,
      usedFallback: accounts.length > 0,
      promptVersion: CAPTION_PROMPT_VERSION,
      model: null,
    };
  }

  let usedFallback = false;
  for (let i = 0; i < accounts.length; i += MAX_VARIANTS_PER_CALL) {
    const batch = accounts.slice(i, i + MAX_VARIANTS_PER_CALL);
    try {
      const generated = await generateBatch(
        asset,
        baseCaption,
        baseHashtags,
        batch,
      );
      for (const a of batch) {
        const v = generated.get(a.accountId);
        if (v) variants.set(a.accountId, v);
        else {
          variants.set(
            a.accountId,
            fallbackVariant(a.accountId, baseCaption, baseHashtags),
          );
          usedFallback = true;
        }
      }
    } catch {
      for (const a of batch) {
        variants.set(
          a.accountId,
          fallbackVariant(a.accountId, baseCaption, baseHashtags),
        );
      }
      usedFallback = true;
    }
  }

  return {
    variants,
    usedFallback,
    promptVersion: CAPTION_PROMPT_VERSION,
    model: isAIConfigured() ? "configured" : null,
  };
}

export function structuredToCaptionText(v: StructuredCaption): string {
  return [v.hook, v.title, v.body, v.cta].filter(Boolean).join("\n\n");
}

export function structuredHashtags(v: StructuredCaption, fallback?: string): string {
  if (v.hashtags.length) return v.hashtags.join(" ");
  return fallback ?? "";
}
