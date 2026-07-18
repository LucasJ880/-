/**
 * 市场情报深度研究执行配置测试
 * 运行：npx tsx src/lib/market-intelligence/__tests__/research-runtime.test.ts
 */
import { getMarketResearchModelConfig } from "../research-runtime";

let total = 0;
let failed = 0;

function expect(condition: boolean, message: string) {
  total += 1;
  if (condition) {
    console.log(`✓ ${message}`);
    return;
  }
  failed += 1;
  console.error(`✗ ${message}`);
}

const defaults = getMarketResearchModelConfig({});
expect(defaults.primary.model === "gpt-5.6-sol", "默认使用深度研究主模型");
expect(defaults.primary.maxTokens === 16_000, "主模型默认输出预算为 16K");
expect(defaults.primary.perRoundTimeoutMs === 150_000, "单轮等待由 30 秒提升至 150 秒");
expect(defaults.primary.totalTimeoutMs === 180_000, "主模型最多使用 3 分钟");
expect(defaults.fallback?.model === "gpt-5.6-luna", "配置已验证可用的独立备用模型");
expect(defaults.fallback?.maxTokens === 8_000, "备用模型保留 8K 输出预算");
expect(
  defaults.primary.totalTimeoutMs + (defaults.fallback?.totalTimeoutMs ?? 0) <= 270_000,
  "主备调用为 300 秒部署上限预留至少 30 秒",
);

const clamped = getMarketResearchModelConfig({
  OPENAI_MODEL_MARKET_INTELLIGENCE: "primary-custom",
  OPENAI_MODEL_MARKET_INTELLIGENCE_FALLBACK: "fallback-custom",
  OPENAI_MAX_TOKENS_MARKET_INTELLIGENCE: "999999",
  OPENAI_TIMEOUT_MS_MARKET_INTELLIGENCE: "1000",
  OPENAI_TOTAL_TIMEOUT_MS_MARKET_INTELLIGENCE: "9999999",
});
expect(clamped.primary.model === "primary-custom", "支持研究任务专用主模型");
expect(clamped.fallback?.model === "fallback-custom", "支持研究任务专用备用模型");
expect(clamped.primary.maxTokens === 32_768, "输出预算被限制在安全上限");
expect(clamped.primary.perRoundTimeoutMs === 30_000, "单轮超时不低于安全下限");
expect(clamped.primary.totalTimeoutMs === 180_000, "主备调用为部署收尾预留时间");

const sameModel = getMarketResearchModelConfig({
  OPENAI_MODEL_MARKET_INTELLIGENCE: "same-model",
  OPENAI_MODEL_MARKET_INTELLIGENCE_FALLBACK: "same-model",
});
expect(sameModel.fallback === null, "主备模型相同时不重复调用");

console.log(`\n${failed === 0 ? "✅" : "❌"} market-research-runtime: ${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
