import { strict as assert } from "node:assert";
import { buildTuningParams } from "../client";
import { OPENAI_BUILTIN } from "@/lib/ai/model-registry";

const chatModel = OPENAI_BUILTIN.chat;

assert.deepEqual(buildTuningParams(chatModel, 0.5, "medium"), {
  reasoning_effort: "medium",
});

assert.deepEqual(
  buildTuningParams(chatModel, 0.5, "medium", {
    hasFunctionTools: true,
  }),
  { reasoning_effort: "none" },
);

// 旧模型族仍走 temperature 路径（回归保护）
assert.deepEqual(
  buildTuningParams("gpt-4o", 0.3, "high", {
    hasFunctionTools: true,
  }),
  { temperature: 0.3 },
);

// GPT-6 系：同为推理模型，永不发 temperature；工具轮次不得发 "none"（Astra 返回 400），降为 "low"
assert.deepEqual(buildTuningParams("gpt-6-astra", 0.1, "low"), {
  reasoning_effort: "low",
});
assert.deepEqual(buildTuningParams("gpt-6-astra", 0.5, "high"), {
  reasoning_effort: "high",
});
assert.deepEqual(
  buildTuningParams("gpt-6-astra", 0.5, "medium", { hasFunctionTools: true }),
  { reasoning_effort: "low" },
);
assert.deepEqual(
  buildTuningParams("GPT-6-astra-2026-09-01", 0.5, "medium"),
  { reasoning_effort: "medium" },
);

console.log("AI tuning params: 7/7 passed");
