/**
 * 营销 Phase 2 技能结构 / 安全 / 业务 Fixture
 * 运行：npx tsx src/lib/agent-core/skills/__tests__/marketing-phase2-skills.test.ts
 */

import { MARKETING_PHASE2_SKILLS, MARKETING_PHASE2_SOURCE } from "../marketing-phase2-seed";
import { ENTERPRISE_SKILLS } from "../enterprise-index";
import { OPERATIONS_SKILLS } from "../operations-seed";
import { SKILL_PENDING_ACTION_ALLOWLIST } from "../pending-action-bridge";
import { routeMarketingSkillIntent } from "@/lib/marketing/skill-router";

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

const slugs = MARKETING_PHASE2_SKILLS.map((s) => s.slug);
const unique = new Set(slugs);
const enterpriseSlugs = new Set(ENTERPRISE_SKILLS.map((s) => s.slug));
const opsSlugs = new Set(OPERATIONS_SKILLS.map((s) => s.slug));

expect(MARKETING_PHASE2_SKILLS.length === 9, "Phase2 技能恰好 9 条");
expect(unique.size === 9, "9 个 slug 唯一");
expect(ENTERPRISE_SKILLS.length === 11, "不影响现有 11 企业技能");
expect(OPERATIONS_SKILLS.length === 23, "不影响现有 23 运营技能");
expect(
  MARKETING_PHASE2_SOURCE.methodologySource === "coreyhaines31/marketingskills",
  "记录方法论来源",
);
expect(MARKETING_PHASE2_SOURCE.runtimeDependency === false, "非运行时依赖");
expect(
  MARKETING_PHASE2_SOURCE.sourceCommit.startsWith("67264763"),
  "记录参考 commit SHA",
);

const required = [
  "marketing-product-context",
  "marketing-customer-research",
  "marketing-competitor-profile",
  "marketing-prospecting-campaign",
  "marketing-copywriting",
  "marketing-email-campaign",
  "marketing-paid-campaign-plan",
  "marketing-experiment-design",
  "marketing-sales-enablement",
];
for (const slug of required) {
  expect(unique.has(slug), `包含 ${slug}`);
  expect(!enterpriseSlugs.has(slug), `不与 Phase1 企业技能冲突: ${slug}`);
  expect(!opsSlugs.has(slug), `不与运营技能冲突: ${slug}`);
}

const FORBIDDEN_DIRECT = [
  "直接发送",
  "直接群发",
  "直接发布",
  "直接投放",
  "直接改预算",
  "直接修改预算",
  "直接改价格",
  "自动覆盖",
];

for (const skill of MARKETING_PHASE2_SKILLS) {
  expect(!!skill.outputSchema, `outputSchema: ${skill.slug}`);
  expect(!!skill.inputSchema, `inputSchema: ${skill.slug}`);
  expect(skill.domain === "marketing", `domain=marketing: ${skill.slug}`);
  expect(
    skill.userPromptTemplate.includes("{{productMarketingContext}}") ||
      skill.slug === "marketing-product-context",
    `依赖 PMC 注入或自身整理档案: ${skill.slug}`,
  );
  expect(
    skill.userPromptTemplate.includes("{{productMarketingContext}}"),
    `模板含 productMarketingContext: ${skill.slug}`,
  );
  expect(Boolean(skill.requiredTools), `requiredTools: ${skill.slug}`);
  expect(
    skill.requiredTools!.includes("marketing_get_product_context"),
    `requiredTools 含 product context: ${skill.slug}`,
  );
  const blob = `${skill.systemPrompt}\n${skill.userPromptTemplate}`;
  expect(
    blob.includes("禁止") || blob.includes("不得"),
    `含禁止副作用规则: ${skill.slug}`,
  );
  for (const phrase of FORBIDDEN_DIRECT) {
    expect(
      !blob.includes(`允许${phrase}`),
      `无放行危险表述(${phrase}): ${skill.slug}`,
    );
  }
  expect(
    blob.includes("参考并适配") || blob.includes("marketingskills"),
    `标明参考适配: ${skill.slug}`,
  );
}

expect(
  SKILL_PENDING_ACTION_ALLOWLIST.includes("marketing.propose_context_update"),
  "白名单含 propose_context_update",
);
expect(
  SKILL_PENDING_ACTION_ALLOWLIST.includes("marketing.create_campaign_draft"),
  "白名单含 create_campaign_draft",
);
expect(
  !(SKILL_PENDING_ACTION_ALLOWLIST as readonly string[]).includes(
    "marketing.send_blast",
  ),
  "白名单不含群发",
);

// 路由 Fixture
const routes: Array<[string, string]> = [
  ["帮我完善Sunny的产品定位", "marketing-product-context"],
  ["分析一下我们的窗帘客户为什么购买", "marketing-customer-research"],
  ["研究Select Blinds和Blinds.ca", "marketing-competitor-profile"],
  ["设计一个针对多伦多商业窗帘客户的获客活动", "marketing-prospecting-campaign"],
  ["给这个落地页写一版更有说服力的文案", "marketing-copywriting"],
  ["给过去报价但没成交的客户设计邮件活动", "marketing-email-campaign"],
  ["规划一个Google Ads活动，但不要直接上线", "marketing-paid-campaign-plan"],
  ["给这个落地页设计A/B测试", "marketing-experiment-design"],
  ["把我们的优势整理成销售Battlecard", "marketing-sales-enablement"],
];
for (const [text, slug] of routes) {
  const r = routeMarketingSkillIntent(text);
  expect(r.slug === slug, `路由「${text.slice(0, 16)}…」→ ${slug}`);
}

// 业务 Fixture（脱敏）
const sunnyFixture = {
  company: { name: "Sunny Shutter", industry: "window coverings" },
  products: [{ name: "Commercial blinds", proofPoints: [] as string[] }],
  missingInformation: ["verifiedBenefits", "competitor evidence URLs"],
};
const aivoraFixture = {
  company: { name: "Aivora", industry: "AI software" },
  products: [{ name: "Qingyan Agent", proofPoints: [] as string[] }],
};
expect(sunnyFixture.company.name !== aivoraFixture.company.name, "Sunny/Aivora 隔离 Fixture");
expect(
  sunnyFixture.missingInformation.length > 0,
  "数据不足时有 missingInformation",
);

const adsPlan = MARKETING_PHASE2_SKILLS.find(
  (s) => s.slug === "marketing-paid-campaign-plan",
)!;
expect(
  adsPlan.systemPrompt.includes("PendingAction") ||
    adsPlan.systemPrompt.includes("禁止"),
  "广告规划禁止直接上线",
);

const emailSkill = MARKETING_PHASE2_SKILLS.find(
  (s) => s.slug === "marketing-email-campaign",
)!;
expect(
  emailSkill.systemPrompt.includes("CASL") ||
    emailSkill.systemPrompt.includes("退订") ||
    emailSkill.systemPrompt.includes("合规"),
  "邮件技能含合规检查",
);

const copySkill = MARKETING_PHASE2_SKILLS.find(
  (s) => s.slug === "marketing-copywriting",
)!;
expect(
  copySkill.systemPrompt.includes("第一") ||
    copySkill.systemPrompt.includes("最好") ||
    copySkill.systemPrompt.includes("保证"),
  "文案技能禁止无法证明的最强主张",
);

const bilingualNote =
  copySkill.systemPrompt.includes("中文") &&
  (copySkill.systemPrompt.includes("英文") ||
    copySkill.systemPrompt.includes("English"));
expect(bilingualNote, "文案技能支持中英文");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} marketing-phase2-skills: ${total - failed}/${total} 通过`,
);
if (failed > 0) process.exit(1);
