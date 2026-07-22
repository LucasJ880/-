/**
 * OpenAI 调用发生时的费用估算（pricingVersion 固定，历史不重算）
 * 金额单位：USD；无精确账单时标记 ESTIMATED
 */

export const OPENAI_PRICING_VERSION = "openai-usd-2026-07-v1";

/** 每 1M tokens 的 USD 单价 */
type TokenRates = { inputPerM: number; outputPerM: number };

const OPENAI_TEXT_RATES: Record<string, TokenRates> = {
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "gpt-4.1": { inputPerM: 2, outputPerM: 8 },
  "gpt-4.1-mini": { inputPerM: 0.4, outputPerM: 1.6 },
  "gpt-4.1-nano": { inputPerM: 0.1, outputPerM: 0.4 },
  o3: { inputPerM: 10, outputPerM: 40 },
  "o4-mini": { inputPerM: 1.1, outputPerM: 4.4 },
};

const EMBEDDING_PER_M: Record<string, number> = {
  "text-embedding-3-small": 0.02,
  "text-embedding-3-large": 0.13,
};

const DEFAULT_TEXT: TokenRates = { inputPerM: 2.5, outputPerM: 10 };

export function isOpenAiProvider(provider: string): boolean {
  return provider.toLowerCase() === "openai";
}

/** 未接入 Provider 不得展示为可用 */
export function isProviderBillableInUi(provider: string): boolean {
  return isOpenAiProvider(provider);
}

export function estimateOpenAiTextCostUsd(opts: {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
}): { costAmount: number; pricingMode: "estimated"; pricingVersion: string } {
  const rates = OPENAI_TEXT_RATES[opts.model] ?? DEFAULT_TEXT;
  const cached = opts.cachedInputTokens ?? 0;
  const input = Math.max(0, (opts.inputTokens ?? 0) - cached);
  const output = Math.max(0, opts.outputTokens ?? 0);
  // 缓存输入按半价粗估
  const cost =
    (input / 1_000_000) * rates.inputPerM +
    (cached / 1_000_000) * rates.inputPerM * 0.5 +
    (output / 1_000_000) * rates.outputPerM;
  return {
    costAmount: roundUsd(cost),
    pricingMode: "estimated",
    pricingVersion: OPENAI_PRICING_VERSION,
  };
}

export function estimateOpenAiEmbeddingCostUsd(opts: {
  model: string;
  inputTokens?: number | null;
}): { costAmount: number; pricingMode: "estimated"; pricingVersion: string } {
  const perM = EMBEDDING_PER_M[opts.model] ?? 0.02;
  const tokens = Math.max(0, opts.inputTokens ?? 0);
  return {
    costAmount: roundUsd((tokens / 1_000_000) * perM),
    pricingMode: "estimated",
    pricingVersion: OPENAI_PRICING_VERSION,
  };
}

export function centsToUsd(cents: number): number {
  return roundUsd(cents / 100);
}

export function roundUsd(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}
