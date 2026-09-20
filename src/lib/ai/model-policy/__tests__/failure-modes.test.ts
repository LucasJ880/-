/**
 * Failure / recovery 契约。运行：npx tsx src/lib/ai/model-policy/__tests__/failure-modes.test.ts
 */
import { OPENAI_GPT6_ASTRA } from "@/lib/ai/model-registry";
import { classifyModelError } from "../retry";
import { assertFiniteLoop, capToolResultPayload } from "../guardrails";
import { mapResponsesToChatCompat } from "@/lib/ai/responses-client";
import { sanitizeReasoningEffort } from "../compat";

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

expect(
  classifyModelError({ status: 504, message: "gateway timeout" }) === "retryable",
  "GPT-6 timeout → retryable",
);
expect(
  classifyModelError({ status: 429, message: "rate limit exceeded" }) === "retryable",
  "429 → retryable",
);
expect(
  classifyModelError(new Error("Client aborted")) === "retryable",
  "user/supervisor cancellation 视为可中断，不无限重试（由 maxRetries 收口）",
);
expect(
  classifyModelError({
    status: 400,
    message: "Invalid schema for response_format",
  }) === "non_retryable",
  "invalid structured output 不重试风暴",
);
expect(
  classifyModelError({
    status: 400,
    message: "Unsupported parameter: temperature",
  }) === "non_retryable",
  "不兼容参数 400 不重试",
);

expect(
  sanitizeReasoningEffort({
    model: OPENAI_GPT6_ASTRA,
    effort: "none",
    hasFunctionTools: true,
  }) !== "none",
  "Astra 工具轮禁止 none，避免 400",
);

const mapped = mapResponsesToChatCompat({
  id: "resp_1",
  model: OPENAI_GPT6_ASTRA,
  output: [
    {
      type: "function_call",
      call_id: "call_1",
      name: "sales_get_pipeline",
      arguments: "{not json",
    },
    {
      type: "message",
      content: [{ type: "output_text", text: "partial" }],
    },
  ],
  usage: {
    input_tokens: 10,
    output_tokens: 4,
    total_tokens: 14,
    input_tokens_details: { cached_tokens: 2 },
  },
});
expect(mapped.choices[0].finish_reason === "tool_calls", "Responses tool 映射");
expect(
  mapped.choices[0].message.tool_calls?.[0].function.arguments === "{not json",
  "malformed tool arguments 原样交给服务端 JSON.parse 兜底",
);
expect(mapped.usage?.prompt_tokens_details?.cached_tokens === 2, "cached tokens 可观测");

const loop = assertFiniteLoop({ turns: 8, toolCalls: 12, retries: 2 });
expect(loop.ok === true, "边界值仍允许");
expect(
  assertFiniteLoop({ turns: 8, toolCalls: 13, retries: 2 }).ok === false,
  "tool 风暴阻断",
);

const oversized = capToolResultPayload({ blob: "n".repeat(80_000) });
expect(oversized.includes("[truncated"), "oversized tool result 截断");

expect(
  classifyModelError({ status: 401, message: "incorrect api key" }) ===
    "non_retryable",
  "fallback 模型若 auth 失败不得再重试",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} gpt6-failure-modes: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
