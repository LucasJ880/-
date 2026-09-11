/**
 * 运行：npx tsx src/lib/ai/model-policy/__tests__/reasoning.test.ts
 */
import { resolveReasoningPolicy } from "../reasoning";

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
  resolveReasoningPolicy({ role: "summarizer" }) === "low",
  "simple → low",
);
expect(resolveReasoningPolicy({ role: "chat" }) === "medium", "normal → medium");
expect(
  resolveReasoningPolicy({ role: "supervisor" }) === "high",
  "complex → high",
);
expect(
  resolveReasoningPolicy({ role: "supervisor" }) !== "max",
  "默认禁止 max",
);
expect(
  resolveReasoningPolicy({
    role: "chat",
    retrievedContextChars: 200_000,
  }) === "medium",
  "仅超长 prompt 不升级",
);
expect(
  resolveReasoningPolicy({
    role: "chat",
    retrievedContextChars: 200_000,
    toolCount: 3,
  }) === "high",
  "长检索 + 多工具才升级",
);
expect(
  resolveReasoningPolicy({
    role: "supervisor",
    supervisorEscalation: true,
    criticality: "critical",
    retryCount: 2,
  }) === "max",
  "exception 仅在升级+critical+重试后",
);
expect(
  resolveReasoningPolicy({
    role: "researcher",
    qualityMode: "high",
  }) === "xhigh",
  "用户 quality high → xhigh，仍非默认 max",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} gpt6-reasoning: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
