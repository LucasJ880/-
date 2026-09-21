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

// GPT-6 系无工具轮次：永不发 temperature，档位透传；带日期后缀的 id 同样识别
assert.deepEqual(buildTuningParams("gpt-6-astra", 0.1, "low"), {
  reasoning_effort: "low",
});
assert.deepEqual(buildTuningParams("gpt-6-astra", 0.5, "high"), {
  reasoning_effort: "high",
});
assert.deepEqual(
  buildTuningParams("GPT-6-astra-2026-09-01", 0.5, "medium"),
  { reasoning_effort: "medium" },
);

console.log("AI tuning params: 8/8 passed");
