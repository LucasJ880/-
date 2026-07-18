/**
 * 青砚营销分析 Skill 接入测试
 * 运行：npx tsx src/lib/agent-core/skills/__tests__/qingyan-marketing-analysis.test.ts
 */
import { classifyLongRunningMarketingResearch, needsTools } from "../../streaming";
import { OPERATIONS_SKILLS } from "../operations-seed";

let total = 0;
let failed = 0;

function expect(condition: boolean, message: string) {
  total += 1;
  if (condition) {
    console.log(`✓ ${message}`);
    return;
  }
  failed += 1;
  console.error(`✗ ${message}`);
}

const marketingSkill = OPERATIONS_SKILLS.find(
  (skill) => skill.slug === "qingyan-marketing-analysis",
);
const uniqueSlugs = new Set(OPERATIONS_SKILLS.map((skill) => skill.slug));

expect(OPERATIONS_SKILLS.length === 23, "运营技能包包含 23 条定义");
expect(uniqueSlugs.size === OPERATIONS_SKILLS.length, "运营技能 slug 无重复");
expect(Boolean(marketingSkill), "存在 qingyan-marketing-analysis");
expect(marketingSkill?.tier === "analysis", "营销 Skill 属于分析层");
expect(marketingSkill?.outputFormat === "markdown", "营销 Skill 输出 Markdown");
expect(marketingSkill?.maxTokens === 16000, "市场深度研究输出预算提升至 16K");
expect(
  marketingSkill?.systemPrompt.includes("已观察事实") === true &&
    marketingSkill.systemPrompt.includes("基于事实的推断") &&
    marketingSkill.systemPrompt.includes("待执行建议"),
  "提示词强制区分事实、推断和建议",
);
expect(
  marketingSkill?.systemPrompt.includes("不能据此推断实际花费") === true,
  "广告情报不会被误当作竞品效果数据",
);
expect(
  marketingSkill?.userPromptTemplate.includes("## 第一个增长实验") === true,
  "输出包含可验证的首个增长实验",
);
expect(
  Array.isArray(marketingSkill?.inputSchema?.required) &&
    marketingSkill.inputSchema.required.includes("objective"),
  "objective 是唯一必填决策输入",
);

for (const trigger of [
  "帮我做市场情报",
  "分析这个竞品",
  "看看 Google Ads 和 Instagram 怎么投",
  "使用 qingyan-marketing-analysis Skill",
]) {
  expect(needsTools(trigger), `业务分流命中：${trigger}`);
}

for (const [request, expectedKind] of [
  ["请做一份多伦多窗饰市场的深度研究报告", "market"],
  ["帮我做市场情报", "market"],
  ["分析 Select Blinds，给我完整竞品分析报告", "competitor"],
  ["分析这个竞品", "competitor"],
  ["运行 MMM 营销组合模型并做预算优化", "mmm"],
  ["深入分析 Google Ads 和 Meta Ads，制定方案", "channel"],
] as const) {
  expect(
    classifyLongRunningMarketingResearch(request)?.kind === expectedKind,
    `深度营销任务后台分流：${expectedKind}`,
  );
}

for (const request of ["查看竞品监听", "市场情报概览", "今天有哪些营销任务"]) {
  expect(
    classifyLongRunningMarketingResearch(request) === null,
    `普通只读查询保持即时响应：${request}`,
  );
}

console.log(`\n${failed === 0 ? "✅" : "❌"} qingyan-marketing-analysis: ${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
