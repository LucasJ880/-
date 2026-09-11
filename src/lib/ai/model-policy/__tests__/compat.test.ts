/**
 * 运行：npx tsx src/lib/ai/model-policy/__tests__/compat.test.ts
 */
import { OPENAI_BUILTIN, OPENAI_GPT6_ASTRA } from "@/lib/ai/model-registry";
import {
  isGpt6Astra,
  requiresResponsesApi,
  sanitizeReasoningEffort,
} from "../compat";
import { buildTuningParams } from "@/lib/ai/client";

let total = 0;
let failed = 0;
function expect(c: boolean, m: string) {
  total++;
  if (c) console.log(`✓ ${m}`);
  else {
    failed++;
    console.error(`✗ ${m}`);
  }
}

expect(isGpt6Astra(OPENAI_GPT6_ASTRA), "识别 gpt-6-astra");
expect(!isGpt6Astra(OPENAI_BUILTIN.chat), "5.6 sol 不是 Astra");
expect(
  requiresResponsesApi(OPENAI_GPT6_ASTRA, true),
  "Astra + tools 必须 Responses",
);
expect(
  !requiresResponsesApi(OPENAI_GPT6_ASTRA, false),
  "Astra 无 tools 可走 Chat Completions",
);
expect(
  !requiresResponsesApi(OPENAI_BUILTIN.chat, true),
  "5.6 + tools 仍走 Chat Completions",
);

expect(
  sanitizeReasoningEffort({
    model: OPENAI_GPT6_ASTRA,
    effort: "none",
    hasFunctionTools: true,
  }) === "low",
  "Astra 禁止 none，tools 时改为 low",
);

expect(
  sanitizeReasoningEffort({
    model: OPENAI_BUILTIN.chat,
    effort: "high",
    hasFunctionTools: true,
  }) === "none",
  "5.6 + tools 仍为 none",
);

const astraTools = buildTuningParams(OPENAI_GPT6_ASTRA, 0.2, "high", {
  hasFunctionTools: true,
});
expect(
  astraTools.reasoning_effort === "high",
  "Astra + tools 保留 high，不写 none",
);
expect(astraTools.temperature === undefined, "Astra 不发送 temperature");

const astraMax = buildTuningParams(OPENAI_GPT6_ASTRA, 1, "max");
expect(astraMax.reasoning_effort === "max", "Astra 允许显式 max");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} gpt6-compat: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
