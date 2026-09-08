/**
 * 分析师备忘录 v1 · M4 市场价格基准（AI 建议，人审语义）
 *
 * 对标 GPT 式"预算估计"：检索同类基准产品的公开市场价 → 给出价格观察与区间提示。
 *
 * 证据铁律（比 GPT 严的地方——这是本平台的价值）：
 *  - 每个基准价必须带 sourceIndex（无效即丢弃）；LLM 只准引用片段里出现的价格数字
 *  - **绝不自动做汇率换算**（发明汇率=发明金额）：原币呈现 + 提示人工确认汇率
 *  - 检索无结果 = 明说 insufficient，绝不给"拍脑袋区间"
 *  - 输出是 AI 初步调查；目标报价永远由人（配合报价引擎 Sunny 链）拍板
 */

import { z } from "zod";
import { callStructured, createUnifiedRuntimeInvoker, type LlmInvoker } from "@/lib/tender-understanding/llm";
import { tavilySearch } from "./tavily-client";
import { hasWebSearchKey } from "./websearch";

export const MARKET_PRICING_VERSION = "tender-market-pricing/v1" as const;

const zh = (max: number) => z.preprocess((v) => String(v ?? "").slice(0, max), z.string());

export type MarketSource = { title: string; url: string; snippet: string };

export const marketBenchmarkSchema = z.object({
  productName: zh(160),
  vendor: zh(80).nullable().optional(),
  /** 片段中出现的价格原文（如 "US$1,053" / "CAD $6,220"），不做任何换算 */
  priceRaw: zh(60),
  currency: zh(8).nullable().optional(),
  unit: zh(40).nullable().optional(),
  /** 与本项目规格的可比性说明（哪些规格相符/缺哪些） */
  comparabilityZh: zh(240),
  sourceIndex: z.number().int().min(0),
});

const marketSchema = z.object({
  benchmarks: z.array(marketBenchmarkSchema).max(8),
  observationsZh: z.array(zh(300)).max(6).default([]),
  insufficientZh: zh(300).nullable().optional(),
});

export type MarketPricingIntel = {
  version: typeof MARKET_PRICING_VERSION;
  ranAt: string;
  status: "ran" | "unavailable" | "no_product";
  note?: string;
  productPhrase: string | null;
  benchmarks: Array<z.infer<typeof marketBenchmarkSchema>>;
  observationsZh: string[];
  insufficientZh: string | null;
  fxNoteZh: string;
  sources: MarketSource[];
};

const FX_NOTE = "基准价按来源原币呈现，未做汇率换算——换算与目标价测算请在报价引擎（Sunny 定价链）中以人工确认的汇率完成。";

// M1-S2 起统一走共享 client（tavily-client.ts），行为等价
async function tavily(query: string, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<MarketSource[]> {
  return tavilySearch(query, { env, fetchImpl });
}

export function deriveMarketQueries(input: { productPhrase: string | null; specHints: string[] }): string[] {
  const p = (input.productPhrase ?? "").trim();
  if (!p) return [];
  const spec = input.specHints.filter(Boolean).slice(0, 2).join(" ");
  return [
    `${p} price catalog`,
    `${p} ${spec} price USD`.trim(),
    `${p} supplier price Canada`,
  ].filter((q, i, a) => a.indexOf(q) === i);
}

export async function researchMarketPricing(input: {
  productPhrase: string | null;
  specHints: string[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  invoker?: LlmInvoker;
}): Promise<MarketPricingIntel> {
  const env = input.env ?? process.env;
  const ranAt = new Date().toISOString();
  const base: Omit<MarketPricingIntel, "status"> = { version: MARKET_PRICING_VERSION, ranAt, productPhrase: input.productPhrase ?? null, benchmarks: [], observationsZh: [], insufficientZh: null, fxNoteZh: FX_NOTE, sources: [] };
  const queries = deriveMarketQueries(input);
  if (queries.length === 0) return { ...base, status: "no_product", note: "分析摘要缺产品短语，无从检索" };
  if (!hasWebSearchKey(env)) return { ...base, status: "unavailable", note: "未配置搜索 API Key（TAVILY_API_KEY），拒绝凭空给价格区间" };
  const fetchImpl = input.fetchImpl ?? fetch;
  const found = (await Promise.all(queries.map((q) => tavily(q, env, fetchImpl)))).flat();
  const sources = [...new Map(found.map((f) => [f.url, f])).values()].slice(0, 10);
  if (sources.length === 0) return { ...base, status: "ran", insufficientZh: "检索无结果——需人工做市场询价（如向北美品牌索取目录价）", note: "search_no_result" };
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  try {
    const res = await callStructured(
      invoker,
      {
        promptName: "tender-market-pricing",
        promptVersion: "1",
        timeoutMs: 90_000,
        maxTokens: 1400,
        systemPrompt:
          "你是采购市场分析师。仅基于提供的检索片段，提取与目标产品可比的公开市场价格基准。" +
          '只输出 JSON：{"benchmarks":[{"productName","vendor","priceRaw","currency","unit","comparabilityZh","sourceIndex":数字}],"observationsZh":[...],"insufficientZh":null或说明}。' +
          "铁律：priceRaw 必须是片段中出现的价格原文（原币原样），绝不换算、绝不外推；片段里没有可用价格就写 insufficientZh 并留空 benchmarks；sourceIndex 指向片段编号。",
        userPrompt: `目标产品：${input.productPhrase}\n关键规格：${input.specHints.slice(0, 6).join("；")}\n\n检索片段：\n${sources.map((s, i) => `[${i}] ${s.title}\n${s.url}\n${s.snippet}`).join("\n\n")}`,
      },
      marketSchema,
    );
    if (!res.ok) return { ...base, status: "ran", sources, insufficientZh: "AI 归纳失败——请人工阅读来源链接", note: "llm_failed" };
    // 接地过滤：sourceIndex 无效，或 priceRaw 的数字串在对应片段中找不到 → 丢弃（绝不让编造的金额过门）
    const benchmarks = res.value.benchmarks.filter((b) => {
      if (!(b.sourceIndex >= 0 && b.sourceIndex < sources.length)) return false;
      const digits = (b.priceRaw.match(/[\d,]{2,}(?:\.\d+)?/) ?? [])[0]?.replace(/,/g, "");
      if (!digits) return false;
      const hay = sources[b.sourceIndex]!.snippet.replace(/,/g, "");
      return hay.includes(digits);
    });
    return { ...base, status: "ran", benchmarks, observationsZh: res.value.observationsZh, insufficientZh: res.value.insufficientZh ?? (benchmarks.length === 0 ? "片段中未出现可核对的价格数字" : null), sources };
  } catch {
    return { ...base, status: "ran", sources, insufficientZh: "AI 归纳异常——请人工阅读来源链接", note: "llm_error" };
  }
}

/* ────────────────────────── 两跳版（备忘录 v2） ──────────────────────────
 * 跳 1：LLM 从产品/规格生成「品牌/型号候选检索词」（仅检索词，无事实断言，无编造风险）
 * 跳 2：对每个候选词检索目录价，与直查线合并，走同一"片段逐字可核"接地门。
 */

const discoverySchema = z.object({ searchTerms: z.array(zh(80)).max(5).default([]) });

export async function researchMarketPricingTwoHop(input: {
  productPhrase: string | null;
  specHints: string[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  invoker?: LlmInvoker;
}): Promise<MarketPricingIntel> {
  const env = input.env ?? process.env;
  const ranAt = new Date().toISOString();
  const base: Omit<MarketPricingIntel, "status"> = { version: MARKET_PRICING_VERSION, ranAt, productPhrase: input.productPhrase ?? null, benchmarks: [], observationsZh: [], insufficientZh: null, fxNoteZh: FX_NOTE, sources: [] };
  if (!input.productPhrase?.trim()) return { ...base, status: "no_product", note: "缺产品短语" };
  if (!hasWebSearchKey(env)) return { ...base, status: "unavailable", note: "未配置搜索 API Key（TAVILY_API_KEY），拒绝凭空给价格区间" };
  const fetchImpl = input.fetchImpl ?? fetch;
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();

  // 跳 1：发现该品类的具体品牌/型号（检索词，非事实）
  let modelTerms: string[] = [];
  try {
    const disc = await callStructured(
      invoker,
      {
        promptName: "tender-market-pricing-discover",
        promptVersion: "1",
        timeoutMs: 60_000,
        maxTokens: 400,
        systemPrompt:
          '你是采购市场研究员。为找到目标产品的公开市场价，请给出最可能命中的「品牌+产品线」英文检索词（北美市场优先）。只输出 JSON：{"searchTerms":["...", ...]}（≤5 条，每条是可直接搜索的品牌/型号短语，不要泛词）。这些只是检索词，允许猜测品牌。',
        userPrompt: `目标产品：${input.productPhrase}\n关键规格：${input.specHints.slice(0, 6).join("；")}`,
      },
      discoverySchema,
    );
    if (disc.ok) modelTerms = disc.value.searchTerms.filter((t) => t.trim().length > 3);
  } catch {
    modelTerms = [];
  }

  // 跳 2：直查线 + 型号线合并检索
  const queries = [
    ...deriveMarketQueries({ productPhrase: input.productPhrase, specHints: input.specHints }),
    ...modelTerms.map((t) => `${t} price`),
    ...modelTerms.slice(0, 2).map((t) => `${t} catalog price list`),
  ].filter((q, i, a) => a.indexOf(q) === i).slice(0, 8);
  const found = (await Promise.all(queries.map((q) => tavily(q, env, fetchImpl)))).flat();
  const sources = [...new Map(found.map((f) => [f.url, f])).values()].slice(0, 12);
  if (sources.length === 0) return { ...base, status: "ran", insufficientZh: "两跳检索均无结果——需人工市场询价", note: "search_no_result" };
  try {
    const res = await callStructured(
      invoker,
      {
        promptName: "tender-market-pricing",
        promptVersion: "1",
        timeoutMs: 90_000,
        maxTokens: 1600,
        systemPrompt:
          "你是采购市场分析师。仅基于提供的检索片段，提取与目标产品可比的公开市场价格基准。" +
          '只输出 JSON：{"benchmarks":[{"productName","vendor","priceRaw","currency","unit","comparabilityZh","sourceIndex":数字}],"observationsZh":[...],"insufficientZh":null或说明}。' +
          "铁律：priceRaw 必须是片段中出现的价格原文（原币原样），绝不换算、绝不外推；片段里没有可用价格就写 insufficientZh 并留空 benchmarks；sourceIndex 指向片段编号。",
        userPrompt: `目标产品：${input.productPhrase}\n关键规格：${input.specHints.slice(0, 6).join("；")}\n\n检索片段：\n${sources.map((s2, i) => `[${i}] ${s2.title}\n${s2.url}\n${s2.snippet}`).join("\n\n")}`,
      },
      marketSchema,
    );
    if (!res.ok) return { ...base, status: "ran", sources, insufficientZh: "AI 归纳失败——请人工阅读来源链接", note: "llm_failed" };
    const benchmarks = res.value.benchmarks.filter((b) => {
      if (!(b.sourceIndex >= 0 && b.sourceIndex < sources.length)) return false;
      const digits = (b.priceRaw.match(/[\d,]{2,}(?:\.\d+)?/) ?? [])[0]?.replace(/,/g, "");
      if (!digits) return false;
      return sources[b.sourceIndex]!.snippet.replace(/,/g, "").includes(digits);
    });
    return { ...base, status: "ran", benchmarks, observationsZh: res.value.observationsZh, insufficientZh: res.value.insufficientZh ?? (benchmarks.length === 0 ? "片段中未出现可核对的价格数字" : null), sources };
  } catch {
    return { ...base, status: "ran", sources, insufficientZh: "AI 归纳异常——请人工阅读来源链接", note: "llm_error" };
  }
}
