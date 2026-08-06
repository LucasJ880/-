/**
 * 可选 LLM enrichment —— 仅显式 TENDER_ANALYSIS_LLM=1 时开启。
 * 默认关闭：确定性抽取 + 模板报告，避免生产因存在 API Key 自动触发 16 章润色。
 */

export function shouldUseTenderAnalysisLlm(): boolean {
  return process.env.TENDER_ANALYSIS_LLM === "1";
}

/**
 * 预留 enrichment 入口：当前确定性路径已覆盖 RCMP fixture；
 * 开启时尝试轻量补全中文表述，失败则静默返回原 facts。
 */
export async function maybeEnrichFactsWithLlm<T>(facts: T[]): Promise<T[]> {
  if (!shouldUseTenderAnalysisLlm()) return facts;
  try {
    const { createCompletion } = await import("@/lib/ai/client");
    // 仅做安全加固：不让 LLM 引入历史中标/工厂名；实际以确定性结果为准。
    // 为控制成本与稳定性，MVP 只做可用性探测，不改写已核验事实。
    await createCompletion({
      systemPrompt:
        "You are a tender analyst. Do NOT invent awards, suppliers, or factory names. Reply OK.",
      userPrompt: "OK",
      mode: "fast",
      maxTokens: 16,
      timeoutMs: 8_000,
    });
    return facts;
  } catch {
    return facts;
  }
}
