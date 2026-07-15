import { strict as assert } from "node:assert";
import { buildTuningParams } from "../client";

assert.deepEqual(buildTuningParams("gpt-5.6-sol", 0.5, "medium"), {
  reasoning_effort: "medium",
});

assert.deepEqual(
  buildTuningParams("gpt-5.6-sol", 0.5, "medium", {
    hasFunctionTools: true,
  }),
  { reasoning_effort: "none" },
);

assert.deepEqual(
  buildTuningParams("gpt-4o", 0.3, "high", {
    hasFunctionTools: true,
  }),
  { temperature: 0.3 },
);

console.log("AI tuning params: 3/3 passed");
