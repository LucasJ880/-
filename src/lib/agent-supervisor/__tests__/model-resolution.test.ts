/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/model-resolution.test.ts
 */
import { resolveSupervisorModel } from "../model-resolve";
import { getAIConfig } from "@/lib/ai/config";

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

const primary = getAIConfig().primaryModel;
const prev = {
  planner: process.env.AGENT_SUPERVISOR_PLANNER_MODEL,
  summary: process.env.AGENT_SUPERVISOR_SUMMARY_MODEL,
};

delete process.env.AGENT_SUPERVISOR_PLANNER_MODEL;
delete process.env.AGENT_SUPERVISOR_SUMMARY_MODEL;

const def = resolveSupervisorModel({ purpose: "planner" });
expect(def.requestedModel === primary, "未设置 env 时使用 primary 默认模型");
expect(def.source === "default", "来源为 default");
expect(def.requestedModel !== "gpt-5.6-luna" || primary === "gpt-5.6-luna", "默认不强制 luna");

process.env.AGENT_SUPERVISOR_PLANNER_MODEL = "gpt-test-custom";
const envRes = resolveSupervisorModel({ purpose: "planner" });
expect(envRes.requestedModel === "gpt-test-custom", "env 优先");
expect(envRes.source === "env", "来源为 env");
expect(envRes.fallbackModel.length > 0, "具备 fallback 模型");

process.env.AGENT_SUPERVISOR_SUMMARY_MODEL = "gpt-summary-custom";
const sum = resolveSupervisorModel({ purpose: "summary" });
expect(sum.requestedModel === "gpt-summary-custom", "summary env 生效");

if (prev.planner === undefined) delete process.env.AGENT_SUPERVISOR_PLANNER_MODEL;
else process.env.AGENT_SUPERVISOR_PLANNER_MODEL = prev.planner;
if (prev.summary === undefined) delete process.env.AGENT_SUPERVISOR_SUMMARY_MODEL;
else process.env.AGENT_SUPERVISOR_SUMMARY_MODEL = prev.summary;

console.log(
  `\n${failed === 0 ? "✅" : "❌"} model-resolution: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
