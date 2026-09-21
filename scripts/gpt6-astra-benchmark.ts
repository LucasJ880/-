/**
 * 离线/在线 GPT-6 vs 当前模型对照。
 * 默认只打印用例清单；设置 GPT6_ASTRA_BENCHMARK=1 且存在 OPENAI_API_KEY 才打真实 API。
 *
 * 运行：npx tsx scripts/gpt6-astra-benchmark.ts
 */
import { GPT6_BENCHMARK_CASES } from "../src/lib/ai/model-policy/benchmark-fixtures";
import { OPENAI_BUILTIN, OPENAI_GPT6_ASTRA } from "../src/lib/ai/model-registry";
import { GPT6_DEFAULT_ROLES, resolveReasoningPolicy } from "../src/lib/ai/model-policy";

function main() {
  console.log("═══ Qyane GPT-6 Astra Benchmark ═══");
  console.log(`cases: ${GPT6_BENCHMARK_CASES.length}`);
  console.log(`current chat: ${OPENAI_BUILTIN.chat}`);
  console.log(`current reasoning: ${OPENAI_BUILTIN.reasoning}`);
  console.log(`candidate: ${OPENAI_GPT6_ASTRA}`);
  console.log("");
  console.log(
    [
      "id",
      "band",
      "workflow",
      "role",
      "current_model",
      "gpt6_model",
      "reasoning",
    ].join("\t"),
  );
  for (const c of GPT6_BENCHMARK_CASES) {
    const current =
      c.role === "supervisor" || c.role === "researcher" || c.role === "coder"
        ? OPENAI_BUILTIN.reasoning
        : c.role === "summarizer" || c.role === "fast"
          ? OPENAI_BUILTIN.chat
          : OPENAI_BUILTIN.chat;
    const effort = resolveReasoningPolicy({ role: c.role });
    const phase1 = (GPT6_DEFAULT_ROLES as readonly string[]).includes(c.role);
    const gpt6 =
      phase1 && c.band !== "simple" ? OPENAI_GPT6_ASTRA : current;
    console.log(
      [c.id, c.band, c.workflow, c.role, current, gpt6, effort].join("\t"),
    );
  }
  console.log("");
  if (process.env.GPT6_ASTRA_BENCHMARK === "1" && process.env.OPENAI_API_KEY) {
    console.log(
      "LIVE_LANE: 未在 CI 自动跑真实对照。请在隔离环境按 docs/QYANE_GPT6_ASTRA_BENCHMARK.md 执行。",
    );
  } else {
    console.log(
      "LIVE_LANE skipped（需要 GPT6_ASTRA_BENCHMARK=1 且 OPENAI_API_KEY）。表格基线已写入文档。",
    );
  }
}

main();
