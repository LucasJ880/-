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

assert.deepEqual(
  buildTuningParams("gpt-6-astra", 0.2, "high", {
    hasFunctionTools: true,
  }),
  { reasoning_effort: "high" },
);

assert.equal(
  buildTuningParams("gpt-6-astra", 0.2, "none", {
    hasFunctionTools: true,
  }).reasoning_effort,
  "low",
);

console.log("AI tuning params: 5/5 passed");
