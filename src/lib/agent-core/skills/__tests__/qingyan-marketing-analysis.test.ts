/**
 * 青砚营销分析 Skill 接入测试
 * 运行：npx tsx src/lib/agent-core/skills/__tests__/qingyan-marketing-analysis.test.ts
 */
import { needsTools } from "../../streaming";
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

console.log(`\n${failed === 0 ? "✅" : "❌"} qingyan-marketing-analysis: ${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
