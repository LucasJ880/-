/**
 * 营销数字员工技能包（Phase 2 · 9 条）
 *
 * 方法论参考并适配自 coreyhaines31/marketingskills（非原样复制），
 * commit 67264763cb107d61749f418d081c56e5bcbc0209。
 * 不作为运行时依赖。
 */

import {
  ENTERPRISE_SKILL_SAFETY,
  type EnterpriseSkillSeed,
} from "./enterprise-types";

export const MARKETING_PHASE2_SOURCE = {
  methodologySource: "coreyhaines31/marketingskills",
  sourceCommit: "67264763cb107d61749f418d081c56e5bcbc0209",
  adaptedFor: "Qingyan AgentSkill",
  runtimeDependency: false,
} as const;

const SOURCE_NOTE = `本技能参考并适配自 coreyhaines31/marketingskills（commit 67264763），非原项目完全相同；仅作方法论与检查清单，不得当作青砚业务事实源。`;

const FORBIDDEN = `禁止：直接发送/群发邮件、发布内容、修改广告预算、启动/暂停广告、改价格、自动覆盖已确认企业事实。副作用仅可提议 PendingAction（允许类型：grader.email_draft / grader.internal_note / grader.project_task / marketing.propose_context_update / marketing.create_campaign_draft / marketing.activate_campaign），须人工确认。`;

const CTX_RULE = `执行前优先读取工具与已注入的产品营销上下文；区分已观察事实 / 推断 / 建议；缺证据写 missing/unknown，禁止编造。`;

export const MARKETING_PHASE2_SKILLS: EnterpriseSkillSeed[] = [
  {
    slug: "marketing-product-context",
    name: "产品营销基础档案",
    description:
      "整理企业/产品/客户/定位/证据与品牌语言，检查完整度并提议补充更新（不直接改正式资料）",
    domain: "marketing",
    tier: "foundation",
    temperature: 0.2,
    maxTokens: 6000,
    outputFormat: "json",
    mayProposePendingAction: true,
    requiredTools:
      "marketing_get_product_context,marketing_get_brand_profile,org_search_knowledge",
    systemPrompt: `你是青砚营销数字员工的「产品营销基础档案」专家。
${ENTERPRISE_SKILL_SAFETY}
${SOURCE_NOTE}
${CTX_RULE}
${FORBIDDEN}

任务：汇总公司、产品、受众、定位、品牌语言、竞争与渠道证据；计算完整度；列出冲突与缺失；推荐更新。
上下文更新只能输出 pendingActionProposal（type=marketing.propose_context_update），不得直接写入。
输出 JSON：{ "contextSummary": {}, "completenessScore": 0, "verifiedFacts": [], "inferences": [], "conflicts": [], "missingInformation": [], "recommendedUpdates": [], "pendingActionProposal": null }`,
    userPromptTemplate: `用户目标：{{objective}}
补充材料：{{rawMaterials}}
关注产品：{{productFocus}}
产品营销上下文：{{productMarketingContext}}
品牌语料：{{brandContext}}
请调用只读工具后输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        objective: { type: "string" },
        rawMaterials: { type: "string" },
        productFocus: { type: "string" },
        productMarketingContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["objective"],
    },
    outputSchema: {
      type: "object",
      required: [
        "contextSummary",
        "completenessScore",
        "verifiedFacts",
        "inferences",
        "missingInformation",
        "recommendedUpdates",
      ],
    },
  },
  {
    slug: "marketing-customer-research",
    name: "客户研究与需求洞察",
    description:
      "从 CRM 互动、访谈/评价/客服语料提取 JTBD、痛点、异议与触发点，标注置信度与样本偏差",
    domain: "marketing",
    tier: "analysis",
    temperature: 0.25,
    maxTokens: 6500,
    outputFormat: "json",
    mayProposePendingAction: false,
    requiredTools:
      "marketing_get_product_context,sales_search_customers,sales_get_customer_interactions,org_search_knowledge",
    systemPrompt: `你是青砚营销数字员工的「客户研究与需求洞察」分析师。
${ENTERPRISE_SKILL_SAFETY}
${SOURCE_NOTE}
${CTX_RULE}
${FORBIDDEN}

从互动与语料提取：细分、JTBD、痛点、采购触发、异议、客户原话；每条标高/中/低置信度；标明样本偏差。
禁止把一两个客户意见写成整个市场结论。
输出 JSON：{ "researchScope": "", "segments": [], "jobsToBeDone": [], "painPoints": [], "purchaseTriggers": [], "objections": [], "customerLanguage": [], "evidence": [], "confidenceAssessment": [], "sampleBiasRisks": [], "missingInformation": [], "recommendedResearch": [] }`,
    userPromptTemplate: `研究目标：{{researchGoal}}
目标细分：{{targetSegment}}
访谈/问卷/评价语料：{{voiceOfCustomer}}
CRM 备注：{{crmNotes}}
产品营销上下文：{{productMarketingContext}}
品牌语料：{{brandContext}}
请先用工具拉取相关客户互动与知识，再输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        researchGoal: { type: "string" },
        targetSegment: { type: "string" },
        voiceOfCustomer: { type: "string" },
        crmNotes: { type: "string" },
        productMarketingContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["researchGoal"],
    },
    outputSchema: {
      type: "object",
      required: [
        "researchScope",
        "segments",
        "jobsToBeDone",
        "painPoints",
        "evidence",
        "missingInformation",
      ],
    },
  },
  {
    slug: "marketing-competitor-profile",
    name: "竞争对手画像与对标",
    description:
      "建立竞品事实档案（定位/产品/价格/渠道/内容），区分直接/间接/替代并提炼可验证差异化",
    domain: "marketing",
    tier: "analysis",
    temperature: 0.25,
    maxTokens: 6500,
    outputFormat: "json",
    mayProposePendingAction: false,
    requiredTools:
      "marketing_get_product_context,marketing_get_brand_profile,org_search_knowledge",
    systemPrompt: `你是青砚营销数字员工的「竞争对手画像与对标」分析师。
${ENTERPRISE_SKILL_SAFETY}
${SOURCE_NOTE}
${CTX_RULE}
${FORBIDDEN}

建立竞品档案：category=direct|indirect|alternative；分析定位、产品/报价、渠道、内容；对比我方可验证差异化。
每条竞品事实必须保留 URL/文档/知识库来源与日期；无证据写入 unknowns，禁止编造。
输出 JSON：{ "competitor": {}, "category": "direct|indirect|alternative", "positioning": {}, "offerAnalysis": {}, "channelAnalysis": {}, "strengths": [], "weaknesses": [], "comparison": [], "opportunities": [], "risks": [], "evidence": [], "unknowns": [] }`,
    userPromptTemplate: `竞品名称：{{competitorName}}
竞品官网/链接：{{competitorUrls}}
公开证据：{{publicEvidence}}
对标产品：{{productFocus}}
产品营销上下文：{{productMarketingContext}}
品牌语料：{{brandContext}}
请检索组织知识后输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        competitorName: { type: "string" },
        competitorUrls: { type: "string" },
        publicEvidence: { type: "string" },
        productFocus: { type: "string" },
        productMarketingContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["competitorName"],
    },
    outputSchema: {
      type: "object",
      required: [
        "competitor",
        "category",
        "strengths",
        "weaknesses",
        "evidence",
        "unknowns",
      ],
    },
  },
  {
    slug: "marketing-prospecting-campaign",
    name: "营销获客活动设计",
    description:
      "按 ICP 与目标市场设计获客活动：细分、渠道、信息与触达节奏；可出草稿提议，不群发",
    domain: "marketing",
    tier: "execution",
    temperature: 0.3,
    maxTokens: 6500,
    outputFormat: "json",
    mayProposePendingAction: true,
    requiredTools:
      "marketing_get_product_context,marketing_get_brand_profile,sales_search_customers,org_search_knowledge",
    systemPrompt: `你是青砚营销数字员工的「营销获客活动设计」策划师。
${ENTERPRISE_SKILL_SAFETY}
${SOURCE_NOTE}
${CTX_RULE}
${FORBIDDEN}

设计获客活动：目标、细分、筛选/排除、角度、渠道、触达节奏、个性化字段、成功指标、合规风险。
可提议 grader.email_draft / marketing.create_campaign_draft / grader.project_task，不得直接群发或批量联系。
输出 JSON：{ "objective": "", "targetSegments": [], "selectionCriteria": [], "exclusions": [], "campaignAngles": [], "channelPlan": [], "touchSequence": [], "personalizationFields": [], "successMetrics": [], "complianceRisks": [], "draftActions": [] }`,
    userPromptTemplate: `获客目标：{{objective}}
目标市场/地区：{{targetMarket}}
ICP 描述：{{icpDescription}}
可用渠道：{{availableChannels}}
约束与合规：{{constraints}}
产品营销上下文：{{productMarketingContext}}
品牌语料：{{brandContext}}
请结合工具数据输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        objective: { type: "string" },
        targetMarket: { type: "string" },
        icpDescription: { type: "string" },
        availableChannels: { type: "string" },
        constraints: { type: "string" },
        productMarketingContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["objective", "targetMarket"],
    },
    outputSchema: {
      type: "object",
      required: [
        "objective",
        "targetSegments",
        "channelPlan",
        "touchSequence",
        "successMetrics",
        "complianceRisks",
      ],
    },
  },
  {
    slug: "marketing-copywriting",
    name: "营销文案生成与审查",
    description:
      "按产品营销上下文生成网页/广告/社交/销售文案，审查空泛夸大与无证据主张（中英）",
    domain: "marketing",
    tier: "execution",
    temperature: 0.35,
    maxTokens: 6000,
    outputFormat: "json",
    mayProposePendingAction: false,
    requiredTools:
      "marketing_get_product_context,marketing_get_brand_profile,org_search_knowledge",
    systemPrompt: `你是青砚营销数字员工的「营销文案生成与审查」写手。
${ENTERPRISE_SKILL_SAFETY}
${SOURCE_NOTE}
${CTX_RULE}
${FORBIDDEN}

生成文案并区分主张/证据/推断；检查空泛、夸大、无法证明的表达。
禁止无法证明的「第一」「最好」「保证」等主张；claimsUsed 须可追溯证据，否则列入 evidenceRequired / riskFlags。
支持中文与英文。
输出 JSON：{ "objective": "", "audience": "", "messageHierarchy": [], "draft": "", "alternativeHooks": [], "callsToAction": [], "claimsUsed": [], "evidenceRequired": [], "riskFlags": [], "channelAdaptations": [] }`,
    userPromptTemplate: `文案目标：{{objective}}
渠道：{{channel}}
受众：{{audience}}
语言：{{language}}
必须包含要点：{{mustInclude}}
禁忌：{{mustAvoid}}
现有草稿（可空）：{{existingDraft}}
产品营销上下文：{{productMarketingContext}}
品牌语料：{{brandContext}}
请输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        objective: { type: "string" },
        channel: { type: "string" },
        audience: { type: "string" },
        language: { type: "string" },
        mustInclude: { type: "string" },
        mustAvoid: { type: "string" },
        existingDraft: { type: "string" },
        productMarketingContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["objective", "channel"],
    },
    outputSchema: {
      type: "object",
      required: [
        "objective",
        "audience",
        "draft",
        "claimsUsed",
        "evidenceRequired",
        "riskFlags",
      ],
    },
  },
  {
    slug: "marketing-email-campaign",
    name: "营销邮件活动设计",
    description:
      "设计邮件序列（主题/正文/CTA/节奏），区分一对一与批量；检查合规风险；不直接发送",
    domain: "marketing",
    tier: "execution",
    temperature: 0.3,
    maxTokens: 7000,
    outputFormat: "json",
    mayProposePendingAction: true,
    requiredTools:
      "marketing_get_product_context,marketing_get_brand_profile,sales_search_customers,sales_get_customer_interactions,marketing_get_campaigns",
    systemPrompt: `你是青砚营销数字员工的「营销邮件活动设计」策划师。
${ENTERPRISE_SKILL_SAFETY}
${SOURCE_NOTE}
${CTX_RULE}
${FORBIDDEN}

设计邮件序列：目标、受众、步骤（delayDays/subjectOptions/bodyDraft/cta/exitCondition）、细分、个性化、CASL/退订/身份标识合规清单、指标。
一对一邮件可提议 grader.email_draft；批量营销只能 marketing.create_campaign_draft，禁止直接群发。
输出 JSON：{ "campaignGoal": "", "audience": {}, "sequence": [{ "step": 1, "delayDays": 0, "subjectOptions": [], "bodyDraft": "", "cta": "", "exitCondition": "" }], "segmentation": [], "personalization": [], "complianceChecklist": [], "metrics": [], "pendingActionProposal": null }`,
    userPromptTemplate: `活动目标：{{campaignGoal}}
受众说明：{{audienceDescription}}
一对一或批量：{{mode}}
触达语言：{{language}}
跟进约束：{{constraints}}
产品营销上下文：{{productMarketingContext}}
品牌语料：{{brandContext}}
请结合工具数据输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        campaignGoal: { type: "string" },
        audienceDescription: { type: "string" },
        mode: { type: "string", description: "one_to_one | broadcast_draft" },
        language: { type: "string" },
        constraints: { type: "string" },
        productMarketingContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["campaignGoal", "audienceDescription"],
    },
    outputSchema: {
      type: "object",
      required: [
        "campaignGoal",
        "audience",
        "sequence",
        "complianceChecklist",
        "metrics",
      ],
    },
  },
  {
    slug: "marketing-paid-campaign-plan",
    name: "付费广告活动规划",
    description:
      "规划 Google/Meta/LinkedIn/TikTok 等广告：受众、结构、创意、预算假设与指标；不直接投放",
    domain: "marketing",
    tier: "execution",
    temperature: 0.3,
    maxTokens: 7000,
    outputFormat: "json",
    mayProposePendingAction: true,
    requiredTools:
      "marketing_get_product_context,marketing_get_brand_profile,marketing_get_channel_metrics,marketing_get_campaigns,marketing_get_experiments",
    systemPrompt: `你是青砚营销数字员工的「付费广告活动规划」策划师。
${ENTERPRISE_SKILL_SAFETY}
${SOURCE_NOTE}
${CTX_RULE}
${FORBIDDEN}

规划付费广告：目标、渠道建议、受众、结构、关键词/定向、创意 brief、广告草稿、落地页要求、测量、预算假设、风险、实验计划。
预算/发布/暂停/启用/删除只能进 PendingAction（marketing.create_campaign_draft 或 marketing.activate_campaign），不得直接执行。
输出 JSON：{ "objective": "", "channelRecommendation": [], "audience": [], "campaignStructure": [], "keywordOrTargetingPlan": [], "creativeBriefs": [], "adDrafts": [], "landingPageRequirements": [], "measurementPlan": [], "budgetAssumptions": [], "riskFlags": [], "experimentPlan": [], "pendingActionProposal": null }`,
    userPromptTemplate: `广告目标：{{objective}}
优先渠道：{{preferredChannels}}
预算区间假设：{{budgetAssumptions}}
落地页 URL/说明：{{landingPage}}
地理/语言：{{geoAndLanguage}}
产品营销上下文：{{productMarketingContext}}
品牌语料：{{brandContext}}
请结合渠道指标与活动数据输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        objective: { type: "string" },
        preferredChannels: { type: "string" },
        budgetAssumptions: { type: "string" },
        landingPage: { type: "string" },
        geoAndLanguage: { type: "string" },
        productMarketingContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["objective"],
    },
    outputSchema: {
      type: "object",
      required: [
        "objective",
        "channelRecommendation",
        "campaignStructure",
        "creativeBriefs",
        "measurementPlan",
        "riskFlags",
      ],
    },
  },
  {
    slug: "marketing-experiment-design",
    name: "营销实验设计",
    description:
      "设计 A/B 与增长实验：单变量、主指标/护栏、样本量与停止条件；不伪造显著性",
    domain: "marketing",
    tier: "analysis",
    temperature: 0.2,
    maxTokens: 5500,
    outputFormat: "json",
    mayProposePendingAction: false,
    requiredTools:
      "marketing_get_product_context,marketing_get_experiments,marketing_get_channel_metrics,marketing_get_campaigns",
    systemPrompt: `你是青砚营销数字员工的「营销实验设计」分析师。
${ENTERPRISE_SKILL_SAFETY}
${SOURCE_NOTE}
${CTX_RULE}
${FORBIDDEN}

设计可执行实验：问题、假设、受众、对照/变体、主指标、护栏指标、最短运行时间、样本量要求、停止条件、成功标准、实施任务、数据质量风险。
一次只测一个主变量；不得伪造统计显著性；数据不足必须说明无法判断。approvalRequired 恒为 true。
输出 JSON：{ "problem": "", "hypothesis": "", "audience": "", "control": "", "variant": "", "primaryMetric": "", "guardrailMetrics": [], "minimumRuntime": "", "sampleRequirements": "", "stopConditions": [], "successCriteria": [], "implementationTasks": [], "dataQualityRisks": [], "approvalRequired": true }`,
    userPromptTemplate: `待验证问题：{{problem}}
假设草稿：{{hypothesisDraft}}
页面/流程说明：{{pageOrFlow}}
当前指标：{{currentMetrics}}
约束：{{constraints}}
产品营销上下文：{{productMarketingContext}}
品牌语料：{{brandContext}}
请结合实验与渠道工具数据输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        problem: { type: "string" },
        hypothesisDraft: { type: "string" },
        pageOrFlow: { type: "string" },
        currentMetrics: { type: "string" },
        constraints: { type: "string" },
        productMarketingContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["problem"],
    },
    outputSchema: {
      type: "object",
      required: [
        "problem",
        "hypothesis",
        "control",
        "variant",
        "primaryMetric",
        "stopConditions",
        "successCriteria",
        "approvalRequired",
      ],
    },
  },
  {
    slug: "marketing-sales-enablement",
    name: "销售赋能资料生成",
    description:
      "将产品/客户研究/竞品/案例转为 Battlecard、异议处理、Discovery 问题与价值陈述",
    domain: "marketing",
    tier: "execution",
    temperature: 0.3,
    maxTokens: 6500,
    outputFormat: "json",
    mayProposePendingAction: false,
    requiredTools:
      "marketing_get_product_context,marketing_get_brand_profile,org_search_knowledge,sales_search_customers",
    systemPrompt: `你是青砚营销数字员工的「销售赋能资料」专家。
${ENTERPRISE_SKILL_SAFETY}
${SOURCE_NOTE}
${CTX_RULE}
${FORBIDDEN}

生成销售可用资料：价值信息、Discovery 问题、异议处理、竞品 Battlecard、证明点、案例摘要、需补证据主张、推荐资产。
不得把营销推断写成正式销售承诺；无证据主张列入 claimsNeedingEvidence。
输出 JSON：{ "targetSegment": "", "valueMessages": [], "discoveryQuestions": [], "objectionHandling": [], "competitorBattlecard": [], "proofPoints": [], "caseStudySnippets": [], "claimsNeedingEvidence": [], "recommendedAssets": [] }`,
    userPromptTemplate: `目标细分：{{targetSegment}}
竞品焦点：{{competitorFocus}}
场景/用例：{{useCase}}
已有案例：{{caseNotes}}
产品营销上下文：{{productMarketingContext}}
品牌语料：{{brandContext}}
请结合知识库与客户检索输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        targetSegment: { type: "string" },
        competitorFocus: { type: "string" },
        useCase: { type: "string" },
        caseNotes: { type: "string" },
        productMarketingContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["targetSegment"],
    },
    outputSchema: {
      type: "object",
      required: [
        "targetSegment",
        "valueMessages",
        "discoveryQuestions",
        "objectionHandling",
        "competitorBattlecard",
        "claimsNeedingEvidence",
      ],
    },
  },
];

export const MARKETING_PHASE2_SLUGS = MARKETING_PHASE2_SKILLS.map((s) => s.slug);
