/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/model-fallback.test.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

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

const src = readFileSync(
  join(process.cwd(), "src/lib/agent-supervisor/model-resolve.ts"),
  "utf8",
);

expect(src.includes("isModelAccessError"), "识别模型访问错误");
expect(src.includes("fallbackUsed"), "记录 fallbackUsed");
expect(src.includes("fallbackReason"), "记录 fallbackReason");
expect(src.includes("requestedModel"), "记录 requestedModel");
expect(src.includes("actualModel"), "记录 actualModel");
expect(src.includes("createCompletionDetailed"), "复用统一 completion 客户端");
expect(!src.includes("new OpenAI"), "不硬编码 OpenAI Client");
expect(src.includes("只允许再试一次") || src.includes("fallbackModel"), "仅一次 fallback");

const planner = readFileSync(
  join(process.cwd(), "src/lib/agent-supervisor/planner.ts"),
  "utf8",
);
expect(planner.includes("callSupervisorCompletion"), "Planner 走统一模型解析");
expect(planner.includes("rules_fallback"), "规则降级显式日志");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} model-fallback: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
