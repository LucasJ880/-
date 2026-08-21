/**
 * 投标要求中文化 pass（合规矩阵可用性批次）。
 *
 * 根因：v2-map 把抽取的 statement（随标书语言，加拿大标书=英文）同时填进
 * originalRequirement 与 chineseTranslation，后者名不副实——矩阵/备忘录/报告
 * 到处显示英文。本服务把 chineseTranslation 修成真中文：
 *   - 纯格式转换，不是判定：只改译文字段，绝不触碰 mandatory/complianceStatus
 *     等语义字段（AI 不代填判定的纪律不受影响）；originalRequirement 保留原文可对照。
 *   - 失败语义：任何异常/缺项/对不齐 → 该条回退保持原样，绝不阻塞管线。
 *   - 已是中文（CJK 占比达标）→ 跳过，中文标书零模型花费。
 *
 * 挂点：v2-resumable PERSIST 组装后、canonical 写入前（租约内、事务外）；
 * 存量 run 由 /api/projects/[id]/bid-fit/translate 手动补翻，共用本服务。
 */

import { z } from "zod";
import {
  callStructured,
  createUnifiedRuntimeInvoker,
  type LlmInvoker,
} from "@/lib/tender-understanding/llm";
import { needsChineseTranslation } from "./requirement-lang";

export { needsChineseTranslation };

export const REQUIREMENT_TRANSLATE_PROMPT = {
  name: "tender-requirement-translate",
  version: "1",
} as const;

/** 总量上限：条数与单条长度（超出部分保持原样，绝不静默丢条目） */
export const TRANSLATE_MAX_ITEMS = 400;
export const TRANSLATE_MAX_CHARS = 400;
/**
 * 单次模型调用批大小。真实 E2E 实测：200 条单批必超时/截断
 * （gpt-5.6 的 reasoning token 计入 max_completion_tokens——预算须宽裕），
 * 50 条/批单批 ~15-25s 稳定收敛；批间独立失败，一批坏不拖累其余。
 */
export const TRANSLATE_BATCH_SIZE = 50;

const translateResultSchema = z.object({
  items: z.array(
    z.object({
      i: z.number().int().min(0),
      zh: z.string().min(1),
    }),
  ),
});

const TRANSLATE_SYSTEM_PROMPT = `You translate procurement/tender requirement statements into Simplified Chinese for a bid team.
Rules:
- Translate faithfully; do NOT summarize, merge, reorder or drop items.
- Keep numbers, dates, currency amounts, standards (e.g. ISO 9001, CSA), form codes and proper nouns EXACTLY as written.
- Keep each translation a single concise sentence/clause; no explanations.
- Output strict JSON: {"items":[{"i":<index from input>,"zh":"<translation>"}]} covering EVERY input index exactly once.`;

export type TranslateOutcome = {
  translated: number;
  skipped: number;
  failed: number;
  /** 实际发生的模型调用次数（含 callStructured 内部重试；telemetry 口径） */
  llmCalls: number;
};

/**
 * 原地翻译：把 items[].zh 为非中文的条目批量译为中文并回写（经 apply 回调）。
 * 调用方决定回写目标（mapped.requirements 或 DB 行）。
 */
export async function translateRequirementTexts(
  texts: readonly string[],
  opts: {
    invoker?: LlmInvoker;
    timeoutMs?: number;
    /** 每条翻好后回调（idx 为 texts 下标）；只对成功翻译的条目调用 */
    apply: (idx: number, zh: string) => void;
  },
): Promise<TranslateOutcome> {
  const need: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (need.length >= TRANSLATE_MAX_ITEMS) break;
    if (needsChineseTranslation(texts[i]!)) need.push(i);
  }
  const skipped = texts.length - need.length;
  if (need.length === 0) return { translated: 0, skipped, failed: 0, llmCalls: 0 };

  const invoker = opts.invoker ?? createUnifiedRuntimeInvoker();
  // opts.timeoutMs 是总预算（默认 50 条批 × 60s 的量级封顶 240s）；
  // 每批用剩余预算，预算耗尽 → 剩余批保留原文计 failed（下次补翻会再试）。
  const deadline =
    Date.now() +
    (opts.timeoutMs ?? Math.min(240_000, Math.ceil(need.length / TRANSLATE_BATCH_SIZE) * 60_000));
  let translated = 0;
  let failed = 0;
  let llmCalls = 0;

  for (let start = 0; start < need.length; start += TRANSLATE_BATCH_SIZE) {
    const batch = need.slice(start, start + TRANSLATE_BATCH_SIZE);
    const remaining = deadline - Date.now();
    if (remaining < 8_000) {
      failed += need.length - start;
      break;
    }
    try {
      const payload = batch.map((idx, j) => ({
        i: j,
        text: texts[idx]!.slice(0, TRANSLATE_MAX_CHARS),
      }));
      const res = await callStructured(
        invoker,
        {
          promptName: REQUIREMENT_TRANSLATE_PROMPT.name,
          promptVersion: REQUIREMENT_TRANSLATE_PROMPT.version,
          systemPrompt: TRANSLATE_SYSTEM_PROMPT,
          userPrompt: JSON.stringify({ items: payload }),
          // gpt-5.6 reasoning 计入 max_completion_tokens：50 条批给 16k 宽裕预算
          maxTokens: 16_000,
          timeoutMs: Math.min(60_000, remaining),
        },
        translateResultSchema,
      );
      llmCalls += res.logs.length;
      if (!res.ok) {
        failed += batch.length;
        continue;
      }
      const seen = new Set<number>();
      let batchOk = 0;
      for (const item of res.value.items) {
        if (item.i < 0 || item.i >= batch.length || seen.has(item.i)) continue;
        seen.add(item.i);
        const zh = item.zh.trim().slice(0, TRANSLATE_MAX_CHARS + 100);
        // 反向守卫：模型返回的仍不是中文（照抄原文/翻错语言）→ 该条回退
        if (needsChineseTranslation(zh)) continue;
        opts.apply(batch[item.i]!, zh);
        batchOk += 1;
      }
      translated += batchOk;
      failed += batch.length - batchOk;
    } catch {
      // callStructured 不外抛；此兜底极少触发（如 JSON 组装错），保守计 1 次
      llmCalls += 1;
      failed += batch.length;
    }
  }
  return { translated, skipped, failed, llmCalls };
}

/* ------------------------------------------------------------------------------------------
 * 全分析中文化（要求 + 事实 claim + 关键事实槽文本）——一次合并分批，共享总预算。
 * 管线挂点与存量补翻端点共用；按 index 区间回写，失败条目保持原样。
 * ---------------------------------------------------------------------------------------- */

export type AnalysisTranslateTarget = {
  /** 要求译文槽（原地回写） */
  requirements: { chineseTranslation: string }[];
  /** 事实 claim（原地回写 contentZh） */
  facts: { contentZh: string }[];
  /** run.summaryJson.criticalFacts：{ slot: { status, text } }（原地回写 text） */
  criticalFacts: Record<string, { status?: string; text?: string | null }> | null | undefined;
};

export type AnalysisTranslateOutcome = TranslateOutcome & {
  byKind: { requirements: number; facts: number; criticalFacts: number };
};

export async function translateAnalysisZh(
  target: AnalysisTranslateTarget,
  opts: { invoker?: LlmInvoker; timeoutMs?: number } = {},
): Promise<AnalysisTranslateOutcome> {
  const texts: string[] = [];
  const apply: Array<(zh: string) => void> = [];
  for (const r of target.requirements) {
    texts.push(r.chineseTranslation);
    apply.push((zh) => {
      r.chineseTranslation = zh;
    });
  }
  for (const f of target.facts) {
    texts.push(f.contentZh);
    apply.push((zh) => {
      f.contentZh = zh;
    });
  }
  const cf = target.criticalFacts ?? null;
  if (cf) {
    for (const slot of Object.values(cf)) {
      if (!slot || typeof slot !== "object" || slot.status !== "KNOWN" || !slot.text) continue;
      texts.push(slot.text);
      apply.push((zh) => {
        slot.text = zh;
      });
    }
  }
  const byKind = { requirements: 0, facts: 0, criticalFacts: 0 };
  const nReq = target.requirements.length;
  const nFact = target.facts.length;
  const out = await translateRequirementTexts(texts, {
    invoker: opts.invoker,
    timeoutMs: opts.timeoutMs,
    apply: (idx, zh) => {
      apply[idx]!(zh);
      if (idx < nReq) byKind.requirements += 1;
      else if (idx < nReq + nFact) byKind.facts += 1;
      else byKind.criticalFacts += 1;
    },
  });
  return { ...out, byKind };
}
