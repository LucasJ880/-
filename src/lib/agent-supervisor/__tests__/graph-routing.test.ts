/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/graph-routing.test.ts
 */
import { compileSupervisorGraph } from "../graph";

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

async function main() {
  const graph = compileSupervisorGraph();

  const direct = await graph.invoke({
    originalRequest: "生成今天最重要的销售跟进",
    mode: "direct",
    complexityReason: "",
    planStepCount: 1,
    currentStep: 0,
    skillCallCount: 0,
    maxSkillCalls: 6,
    maxSteps: 5,
    replanCount: 0,
    maxReplans: 2,
    decision: "",
    status: "",
    candidateSkills: ["sales-next-best-action"],
  });
  expect(direct.status === "completed", "DIRECT 图路径完成");
  expect((direct.skillCallCount || 0) >= 1, "DIRECT 至少一次 execute");

  const multi = await graph.invoke({
    originalRequest:
      "分析Sunny本月销售情况，找出最值得推进的客户，并准备本周行动",
    mode: "direct",
    complexityReason: "",
    planStepCount: 0,
    currentStep: 0,
    skillCallCount: 0,
    maxSkillCalls: 6,
    maxSteps: 5,
    replanCount: 0,
    maxReplans: 2,
    decision: "",
    status: "",
    candidateSkills: [
      "sales-pipeline-forecast",
      "sales-next-best-action",
      "sales-account-research",
    ],
  });
  expect(multi.mode === "supervisor", "多步请求图内识别为 supervisor");
  expect(multi.status === "completed", "SUPERVISOR 图路径完成");
  expect(
    (multi.skillCallCount || 0) <= 6,
    "不超过 maxSkillCalls",
  );

  console.log(
    `\n${failed === 0 ? "✅" : "❌"} graph-routing: ${total - failed}/${total}`,
  );
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
