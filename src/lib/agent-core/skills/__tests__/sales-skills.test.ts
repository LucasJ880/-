/**
 * 销售数字员工技能 — 业务约束与 Fixture 形状
 * 运行：npx tsx src/lib/agent-core/skills/__tests__/sales-skills.test.ts
 */

import { SALES_ENTERPRISE_SKILLS } from "../sales-seed";

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

const bySlug = Object.fromEntries(SALES_ENTERPRISE_SKILLS.map((s) => [s.slug, s]));

expect(SALES_ENTERPRISE_SKILLS.length === 5, "销售技能 5 条");
expect(Boolean(bySlug["sales-icp-prospect-scoring"]), "ICP 评分技能存在");
expect(Boolean(bySlug["sales-account-research"]), "客户研究技能存在");
expect(Boolean(bySlug["sales-pipeline-forecast"]), "管道预测技能存在");
expect(Boolean(bySlug["sales-next-best-action"]), "下一动作技能存在");
expect(Boolean(bySlug["sales-proposal-roi"]), "ROI 技能存在");

const icp = bySlug["sales-icp-prospect-scoring"];
expect(icp.outputFormat === "json", "ICP 输出 JSON");
expect(icp.systemPrompt.includes("Tier 1"), "ICP 含分层");
expect(
  ["行业匹配", "地区匹配", "企业规模"].every((k) => icp.systemPrompt.includes(k)),
  "ICP 含核心评分维度",
);

const research = bySlug["sales-account-research"];
expect(research.systemPrompt.includes("不得根据企业名称编造"), "客户研究禁止编造");

const forecast = bySlug["sales-pipeline-forecast"];
expect(
  forecast.requiredTools?.includes("sales_get_pipeline_snapshot") === true,
  "管道预测绑定管道快照工具",
);
expect(
  ["Commit", "Best Case", "At Risk", "Nurture", "Lost Risk"].every((b) =>
    forecast.systemPrompt.includes(b),
  ),
  "管道预测含五类分桶",
);

const nba = bySlug["sales-next-best-action"];
expect(nba.mayProposePendingAction === true, "下一动作可提议 PendingAction");
expect(nba.systemPrompt.includes("sales.update_followup"), "允许跟进更新提案");
expect(
  nba.requiredTools?.includes("sales_update_followup") === true,
  "下一动作可调用跟进草稿工具",
);
expect(nba.systemPrompt.includes("不得执行") || nba.systemPrompt.includes("PendingAction"), "不得直接执行");

const roi = bySlug["sales-proposal-roi"];
expect(roi.systemPrompt.includes("不得给出精确 ROI") || roi.systemPrompt.includes("计算公式"), "ROI 无数据不编造");

// Sunny 风格 Fixture：形状校验（不调用 LLM）
const prospectFixture = {
  objective: "多伦多 GTA 智能遮阳预约量房",
  productOrService: "电机斑马帘 + 量房安装",
  candidateAccounts: [
    { name: "North York Condo Corp", industry: "物业", region: "Toronto", size: "中" },
    { name: "Random Cafe", industry: "餐饮", region: "Ottawa", size: "小" },
  ],
};
expect(prospectFixture.candidateAccounts.length === 2, "潜客评分 Fixture 就绪");

const oppFixture = {
  opportunities: [
    {
      id: "opp_1",
      stage: "quoted",
      estimatedValue: 8500,
      lastInteractionDays: 12,
      bucketHint: "At Risk",
    },
  ],
};
expect(oppFixture.opportunities[0].bucketHint === "At Risk", "管道预测 Fixture 含 At Risk");

const roiFixture = {
  customerProblem: "客厅西晒，需要遮光与智能场景",
  proposedScope: "3 套电机斑马帘 + 安装",
  quoteSummary: "grandTotal CAD 4200（仅报价摘要，无历史 ROI）",
  verifiedBenefits: "",
};
expect(!roiFixture.verifiedBenefits, "ROI Fixture 故意缺少已验证收益");

console.log(`\n${failed === 0 ? "✅" : "❌"} sales-skills: ${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
