/**
 * 运行：npx tsx src/lib/ai/model-policy/__tests__/retry.test.ts
 */
import { classifyModelError, isRetryableModelError } from "../retry";

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

expect(classifyModelError({ status: 429, message: "rate" }) === "retryable", "429 可重试");
expect(classifyModelError({ status: 500, message: "oops" }) === "retryable", "5xx 可重试");
expect(
  classifyModelError(new Error("timeout")) === "retryable",
  "timeout 可重试",
);
expect(
  classifyModelError({ status: 400, message: "unsupported parameter temperature" }) ===
    "non_retryable",
  "400 参数错误不可重试",
);
expect(
  classifyModelError({ status: 401, message: "invalid_api_key" }) ===
    "non_retryable",
  "401 不可重试",
);
expect(
  classifyModelError(new Error("model_not_found")) === "model_access",
  "model_not_found → 换模型",
);
expect(
  !isRetryableModelError({ status: 400, message: "invalid schema" }),
  "schema 失败不重试",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} gpt6-retry: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
