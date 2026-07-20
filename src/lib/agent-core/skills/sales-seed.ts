/**
 * 销售数字员工技能包（Phase 1 · 5 条）
 */

import {
  ENTERPRISE_SKILL_SAFETY,
  type EnterpriseSkillSeed,
} from "./enterprise-types";

export const SALES_ENTERPRISE_SKILLS: EnterpriseSkillSeed[] = [
  {
    slug: "sales-icp-prospect-scoring",
    name: "ICP与潜客评分",
    description:
      "定义目标客户画像，对候选企业评分并分为 Tier 1/2/3/Skip，给出触达建议",
    domain: "sales",
    tier: "analysis",
    temperature: 0.2,
    maxTokens: 6000,
    outputFormat: "json",
    requiredTools: null,
    systemPrompt: `你是青砚销售数字员工的「ICP与潜客评分」专家。
${ENTERPRISE_SKILL_SAFETY}

任务：根据输入定义 ICP，并对候选账户评分分层。
评分维度至少包括：行业匹配、地区匹配、企业规模、决策人职位、项目/购买信号、历史成交相似度、支付或实施能力、排除项。
分层：Tier 1 / Tier 2 / Tier 3 / Skip。
输出必须是合法 JSON，字段：icp, scoringModel, prospects, excluded, recommendedSegments, missingData。`,
    userPromptTemplate: `本轮获客目标：
{{objective}}

销售产品或服务：
{{productOrService}}

目标地区：
{{targetGeography}}

理想客户描述：
{{idealCustomerDescription}}

候选企业或客户列表：
{{candidateAccounts}}

正向采购信号：
{{positiveSignals}}

排除条件：
{{negativeFilters}}

历史转化数据（可空）：
{{historicalConversionData}}

品牌语料：
{{brandContext}}

请输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        objective: { type: "string" },
        productOrService: { type: "string" },
        targetGeography: { type: "string" },
        idealCustomerDescription: { type: "string" },
        candidateAccounts: { type: "string" },
        positiveSignals: { type: "string" },
        negativeFilters: { type: "string" },
        historicalConversionData: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["objective", "productOrService", "candidateAccounts"],
    },
    outputSchema: {
      type: "object",
      required: [
        "icp",
        "scoringModel",
        "prospects",
        "excluded",
        "recommendedSegments",
        "missingData",
      ],
    },
  },
  {
    slug: "sales-account-research",
    name: "目标客户研究",
    description: "针对某企业生成销售前研究报告，区分事实与不确定项",
    domain: "sales",
    tier: "analysis",
    temperature: 0.3,
    maxTokens: 5000,
    outputFormat: "markdown",
    requiredTools: "sales_get_customer,sales_search_customers,org_search_knowledge",
    systemPrompt: `你是青砚销售数字员工的「目标客户研究」分析师。
${ENTERPRISE_SKILL_SAFETY}

不得根据企业名称编造公司信息。公开资料不足时写「未验证」。
输出 Markdown，结构：企业概况 / 业务模式 / 可能采购需求 / 决策人与影响人 / 当前信号 / 切入点 / 个性化触达角度 / 不确定项 / 下一步建议。`,
    userPromptTemplate: `企业名称：{{companyName}}
官网：{{website}}
已知联系人：{{knownContacts}}
我方产品：{{productOrService}}
公开资料：{{publicEvidence}}
CRM 已有记录：{{crmContext}}
品牌语料：{{brandContext}}`,
    inputSchema: {
      type: "object",
      properties: {
        companyName: { type: "string" },
        website: { type: "string" },
        knownContacts: { type: "string" },
        productOrService: { type: "string" },
        publicEvidence: { type: "string" },
        crmContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["companyName", "productOrService"],
    },
  },
  {
    slug: "sales-pipeline-forecast",
    name: "销售管道预测",
    description: "基于 CRM 真实数据评估机会：Commit/Best Case/At Risk/Nurture/Lost Risk",
    domain: "sales",
    tier: "analysis",
    temperature: 0.2,
    maxTokens: 7000,
    outputFormat: "json",
    requiredTools:
      "sales_get_pipeline_snapshot,sales_list_opportunities,sales_get_overview,sales_get_opportunity",
    systemPrompt: `你是青砚销售数字员工的「管道预测」分析师。
${ENTERPRISE_SKILL_SAFETY}

必须优先调用只读销售工具获取真实数据；工具无结果时在 missingData 中说明，禁止编造金额/阶段。
分类：Commit / Best Case / At Risk / Nurture / Lost Risk。
每个机会给出：阶段、金额、最后互动、下一步、成交概率、风险原因、缺失信息、建议动作；概率必须写评分依据。
输出 JSON：{ "asOf": "", "buckets": {}, "opportunities": [], "missingData": [], "summary": "" }`,
    userPromptTemplate: `预测范围说明：
{{scopeNote}}

额外人工备注（可空）：
{{manualNotes}}

品牌语料：
{{brandContext}}

请先用工具拉取管道快照，再输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        scopeNote: { type: "string" },
        manualNotes: { type: "string" },
        brandContext: { type: "string" },
      },
      required: [],
    },
    outputSchema: {
      type: "object",
      required: ["buckets", "opportunities", "missingData"],
    },
  },
  {
    slug: "sales-next-best-action",
    name: "销售下一最佳动作",
    description: "扫描客户/机会/报价，排出当前最应处理的动作，可提出 PendingAction 草案",
    domain: "sales",
    tier: "execution",
    temperature: 0.2,
    maxTokens: 5000,
    outputFormat: "json",
    mayProposePendingAction: true,
    requiredTools:
      "sales_get_pipeline_snapshot,sales_get_overview,sales_get_customer,sales_get_customer_interactions,sales_get_quote_summary,sales_update_followup,sales_update_stage",
    systemPrompt: `你是青砚销售数字员工的「下一最佳动作」调度员。
${ENTERPRISE_SKILL_SAFETY}

用只读工具扫描当前管道与客户互动，输出优先级列表。
副作用两条路径（二选一，均不得直接改库外效果）：
1) 调用 sales_update_followup / sales_update_stage 创建 PendingAction 草稿；
2) 或在 JSON 的 pendingActionProposal 中提议（系统会自动落库为待审批）。
允许类型：sales.update_followup / sales.update_stage / grader.email_draft / grader.internal_note / grader.project_task
输出 JSON：{ "priorities": [ { "rank", "targetType", "targetId", "customerName", "reason", "recommendedAction", "urgency", "suggestedDueAt", "pendingActionProposal" } ], "missingData": [] }`,
    userPromptTemplate: `关注重点（可空）：
{{focus}}

时间窗口偏好：
{{timeHorizon}}

品牌语料：
{{brandContext}}

请先调用工具，再输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        focus: { type: "string" },
        timeHorizon: { type: "string" },
        brandContext: { type: "string" },
      },
      required: [],
    },
    outputSchema: {
      type: "object",
      required: ["priorities"],
    },
  },
  {
    slug: "sales-proposal-roi",
    name: "销售方案与ROI论证",
    description: "把需求、报价与方案整理为客户可理解的价值说明；无可靠数据时不编造精确 ROI",
    domain: "sales",
    tier: "analysis",
    temperature: 0.3,
    maxTokens: 5000,
    outputFormat: "markdown",
    requiredTools: "sales_get_quote_summary,sales_get_customer,org_search_knowledge",
    systemPrompt: `你是青砚销售数字员工的「方案与ROI论证」顾问。
${ENTERPRISE_SKILL_SAFETY}

没有可靠数据时不得给出精确 ROI，只能给计算公式与待确认项。
输出 Markdown：客户问题 / 推荐方案 / 范围 / 价值 / ROI或回收期 / 关键假设 / 实施风险 / 不包含项 / 下一步。`,
    userPromptTemplate: `客户问题：{{customerProblem}}
推荐范围：{{proposedScope}}
报价摘要：{{quoteSummary}}
客户经济性：{{customerEconomics}}
已验证收益：{{verifiedBenefits}}
实施约束：{{implementationConstraints}}
替代方案：{{alternatives}}
品牌语料：{{brandContext}}`,
    inputSchema: {
      type: "object",
      properties: {
        customerProblem: { type: "string" },
        proposedScope: { type: "string" },
        quoteSummary: { type: "string" },
        customerEconomics: { type: "string" },
        verifiedBenefits: { type: "string" },
        implementationConstraints: { type: "string" },
        alternatives: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["customerProblem", "proposedScope"],
    },
  },
];
