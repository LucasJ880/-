/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/complexity-router.test.ts
 */
import { routeComplexity } from "../complexity-router";

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
  routeComplexity({ content: "生成今天最重要的销售跟进" }).mode === "direct",
  "单技能销售 → DIRECT",
);
expect(
  routeComplexity({ content: "分析这个项目是否值得投" }).mode === "direct",
  "单一投标 → DIRECT",
);
expect(
  routeComplexity({
    content: "判断这个项目是否值得投，找出全部强制条件，并告诉我接下来怎么开始",
  }).mode === "supervisor",
  "投标多步 → SUPERVISOR",
);
expect(
  routeComplexity({
    content: "分析Sunny本月销售情况，找出最值得推进的客户，并准备本周行动",
  }).mode === "supervisor",
  "销售主管场景 → SUPERVISOR",
);
expect(
  routeComplexity({
    content: "分析Sunny本月销售情况，找出最值得推进的客户，并准备本周行动",
  }).candidateSkills.includes("sales-pipeline-forecast"),
  "销售主管场景含管道技能候选",
);
expect(
  routeComplexity({
    content: "为多伦多商业窗帘业务制定一套获客计划，并准备第一批执行草稿",
  }).mode === "supervisor",
  "营销主管场景 → SUPERVISOR",
);
expect(
  routeComplexity({ content: "hi", forceMode: "supervisor" }).mode ===
    "supervisor",
  "强制主管模式",
);
expect(
  routeComplexity({ content: "安排本周工作", forceMode: "quick" }).mode ===
    "direct",
  "强制快速模式",
);
expect(
  routeComplexity({
    content: "生成今天最重要的销售跟进。",
    forceMode: "quick",
  }).candidateSkills[0] === "sales-next-best-action",
  "强制快速模式仍解析候选技能",
);
expect(
  routeComplexity({
    content: "判断这个项目是否值得投。",
    forceMode: "quick",
  }).candidateSkills[0] === "tender-bid-no-bid",
  "强制快速模式投标技能可解析",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} complexity-router: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
