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

console.log("AI tuning params: 3/3 passed");
