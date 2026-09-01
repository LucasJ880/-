/**
 * 分析师备忘录 v1 · M3 引用标准追查（AI 建议，人审语义）
 *
 * 招标文件常以「XX 标准 §2.11.2.8–2.11.2.12」「General Conditions C11」这类
 * 引用夹带真实要求，但不展开原文——隐藏要求（如"六面之五须实心防水"）
 * 藏在被引用文件里。本模块：
 *   ① LLM 从事实/强制要求文本里抽出外部引用（带原文出处引句，凭空即拒）
 *   ② 每个引用 Tavily 检索原文 → LLM 只基于检索片段展开条款含义
 *
 * 证据纪律（与 M2.5/策略备忘录同族）：
 *  - 只能基于提供的片段推断；检索无结果 = 明说 not_found，绝不编条款
 *  - 每条展开必须标注 sourceIndex（无效索引直接丢弃）
 *  - 无 TAVILY key = unavailable（零出站，不猜）
 *  - 输出仅是 AI 初步调查；采信永远由人完成
 */

import { z } from "zod";
import { callStructured, createUnifiedRuntimeInvoker, type LlmInvoker } from "@/lib/tender-understanding/llm";
import { tavilySearch } from "./tavily-client";
import { hasWebSearchKey } from "./websearch";

export const REFERENCED_STANDARDS_VERSION = "tender-referenced-standards/v1" as const;

const zh = (max: number) => z.preprocess((v) => String(v ?? "").slice(0, max), z.string());

export type StandardSource = { title: string; url: string; snippet: string };

export const standardRefSchema = z.object({
  refCode: zh(80),
  docName: zh(160),
  sectionRange: zh(80).nullable().optional(),
  whyRelevantZh: zh(200),
  /** 招标原文引句（防幻觉锚点：必须能在输入文本中找到近似出处） */
  sourceQuote: zh(240),
});
export type StandardRef = z.infer<typeof standardRefSchema>;

const refExtractionSchema = z.object({ refs: z.array(standardRefSchema).max(6) });

export const expandedClauseSchema = z.object({
  clauseId: zh(60),
  clauseSummaryZh: zh(400),
  /** 对本项目产品/交付的具体含义（工程判断，AI_INFERRED） */
  implicationZh: zh(400),
  sourceIndexes: z.array(z.number().int().min(0)).max(6).default([]),
});

const expansionSchema = z.object({
  clauses: z.array(expandedClauseSchema).max(10),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  /** 检索片段覆盖不到的部分（诚实缺口） */
  gapsZh: z.array(zh(200)).max(4).default([]),
});

export type ExpandedStandard = {
  ref: StandardRef;
  status: "expanded" | "not_found";
  clauses: Array<z.infer<typeof expandedClauseSchema>>;
  confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  gapsZh: string[];
  sources: StandardSource[];
};

export type ReferencedStandardsIntel = {
  version: typeof REFERENCED_STANDARDS_VERSION;
  ranAt: string;
  status: "ran" | "no_refs" | "unavailable";
  note?: string;
  standards: ExpandedStandard[];
};

// M1-S2 起统一走共享 client（tavily-client.ts），行为等价
async function tavily(query: string, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<StandardSource[]> {
  return tavilySearch(query, { env, fetchImpl });
}

/** ① 从招标文本抽外部标准引用（无 LLM key 等异常由 callStructured 内部抛出，调用方温和降级） */
export async function extractStandardRefs(input: {
  texts: string[];
  invoker?: LlmInvoker;
}): Promise<StandardRef[]> {
  const corpus = input.texts.filter(Boolean).join("\n").slice(0, 9000);
  if (corpus.trim().length < 40) return [];
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  const res = await callStructured(
    invoker,
    {
      promptName: "tender-referenced-standards-extract",
      promptVersion: "1",
      timeoutMs: 60_000,
      systemPrompt:
        "你是投标文件分析师。从给定的招标事实/要求文本中，找出**引用了外部标准/规范/通用条款但未展开原文**的引用（例如 \"MVMA PIPS sections 2.11.2.8-2.11.2.12\"、\"General Conditions C11\"、CSA/ASTM/ISO 条款号等）。" +
        '只输出 JSON：{"refs":[{"refCode","docName","sectionRange","whyRelevantZh","sourceQuote"}]}。' +
        "sourceQuote 必须是输入文本中的原句摘录（防止编造）；没有外部引用就输出空数组。最多 6 条，按重要性排序。",
      userPrompt: corpus,
      maxTokens: 900,
    },
    refExtractionSchema,
  );
  if (!res.ok) return [];
  // 防幻觉锚点：sourceQuote 必须能在语料中近似命中（取前 30 字）
  const hay = corpus.replace(/\s+/g, "");
  return res.value.refs.filter((r) => {
    const needle = r.sourceQuote.replace(/\s+/g, "").slice(0, 30);
    return needle.length >= 8 && hay.includes(needle);
  });
}

/** ② 逐引用检索并展开（片段接地；无结果 = not_found） */
export async function researchReferencedStandards(input: {
  refs: StandardRef[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  invoker?: LlmInvoker;
}): Promise<ReferencedStandardsIntel> {
  const env = input.env ?? process.env;
  const ranAt = new Date().toISOString();
  if (input.refs.length === 0) return { version: REFERENCED_STANDARDS_VERSION, ranAt, status: "no_refs", standards: [] };
  if (!hasWebSearchKey(env)) {
    return { version: REFERENCED_STANDARDS_VERSION, ranAt, status: "unavailable", note: "未配置搜索 API Key（TAVILY_API_KEY），拒绝凭空展开标准条款", standards: [] };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  const standards: ExpandedStandard[] = [];
  for (const ref of input.refs.slice(0, 4)) {
    const queries = [
      `${ref.docName} ${ref.sectionRange ?? ref.refCode}`.trim(),
      `${ref.refCode} ${ref.docName} requirements text`.trim(),
    ];
    const found = (await Promise.all(queries.map((q) => tavily(q, env, fetchImpl)))).flat();
    const sources = [...new Map(found.map((f) => [f.url, f])).values()].slice(0, 6);
    if (sources.length === 0) {
      standards.push({ ref, status: "not_found", clauses: [], confidence: null, gapsZh: ["检索无结果——请人工查阅该标准原文"], sources: [] });
      continue;
    }
    try {
      const res = await callStructured(
        invoker,
        {
          promptName: "tender-referenced-standards-expand",
          promptVersion: "1",
          timeoutMs: 90_000,
          systemPrompt:
            "你是标准/规范分析师。仅基于提供的检索片段，展开该引用条款的实际要求，并给出对本项目采购物的具体含义。" +
            '只输出 JSON：{"clauses":[{"clauseId","clauseSummaryZh","implicationZh","sourceIndexes":[数字]}],"confidence":"LOW|MEDIUM|HIGH","gapsZh":[...]}。' +
            "sourceIndexes 指向片段编号；片段覆盖不到的条款写进 gapsZh，绝不编造条款内容。",
          userPrompt: `引用：${ref.docName} ${ref.sectionRange ?? ref.refCode}（招标原文：${ref.sourceQuote}）\n\n检索片段：\n${sources.map((s, i) => `[${i}] ${s.title}\n${s.url}\n${s.snippet}`).join("\n\n")}`,
          maxTokens: 1200,
        },
        expansionSchema,
      );
      if (!res.ok) {
        standards.push({ ref, status: "not_found", clauses: [], confidence: null, gapsZh: ["AI 展开失败——请人工查阅"], sources });
        continue;
      }
      const clauses = res.value.clauses
        .map((c) => ({ ...c, sourceIndexes: c.sourceIndexes.filter((i) => i >= 0 && i < sources.length) }))
        .filter((c) => c.sourceIndexes.length > 0); // 无接地出处的条款直接丢弃
      standards.push({ ref, status: clauses.length > 0 ? "expanded" : "not_found", clauses, confidence: res.value.confidence, gapsZh: res.value.gapsZh, sources });
    } catch {
      standards.push({ ref, status: "not_found", clauses: [], confidence: null, gapsZh: ["AI 展开异常——请人工查阅"], sources });
    }
  }
  return { version: REFERENCED_STANDARDS_VERSION, ranAt, status: "ran", standards };
}
