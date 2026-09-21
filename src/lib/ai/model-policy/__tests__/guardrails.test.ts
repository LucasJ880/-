/**
 * 运行：npx tsx src/lib/ai/model-policy/__tests__/guardrails.test.ts
 */
import {
  assertFiniteLoop,
  capToolResultPayload,
  MODEL_GUARDRAILS,
} from "../guardrails";

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

expect(MODEL_GUARDRAILS.maxRetries === 2, "max retries = 2");
expect(MODEL_GUARDRAILS.maxAgentTurns === 8, "max turns bounded");
expect(
  assertFiniteLoop({ turns: 9, toolCalls: 1, retries: 0 }).ok === false,
  "超轮次阻断",
);
expect(
  assertFiniteLoop({ turns: 1, toolCalls: 1, retries: 3 }).ok === false,
  "超重试阻断",
);
expect(
  assertFiniteLoop({ turns: 1, toolCalls: 1, retries: 0 }).ok === true,
  "正常循环放行",
);

const big = "x".repeat(MODEL_GUARDRAILS.maxToolResultChars + 50);
const capped = capToolResultPayload(big);
expect(capped.includes("[truncated"), "超大 tool result 截断");
expect(
  capped.length < big.length,
  "截断后短于原文",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} gpt6-guardrails: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
