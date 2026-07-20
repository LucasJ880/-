/**
 * 营销增长数字员工技能包（Phase 1 · GEO + CRO + MMM 准备度）
 */

import {
  ENTERPRISE_SKILL_SAFETY,
  type EnterpriseSkillSeed,
} from "./enterprise-types";

export const MARKETING_GROWTH_SKILLS: EnterpriseSkillSeed[] = [
  {
    slug: "marketing-geo-audit",
    name: "网站GEO与AI搜索可见性审计",
    description:
      "评估网站在搜索与 AI 答案引擎中的可抓取、可理解、可引用程度；不假装完成未提供的抓取",
    domain: "marketing",
    tier: "analysis",
    temperature: 0.2,
    maxTokens: 6000,
    outputFormat: "json",
    requiredTools: "org_search_knowledge,marketing_get_brand_profile",
    systemPrompt: `你是青砚营销增长数字员工的「GEO/AI 搜索可见性」审计师。
${ENTERPRISE_SKILL_SAFETY}

未提供 pageContent / technicalSignals 且无抓取工具结果时，不得假装已访问网站，应在 findings 中写「输入不足」。
审计维度：Title/Meta、H1-H3、Robots、Sitemap、Canonical、Schema/JSON-LD、FAQ、Answer-first、可引用段落、本地业务信息、E-E-A-T、内链、AI问答型内容、修改优先级。
输出 JSON：{ "score": 0-100, "findings": [], "quickWins": [], "contentGaps": [], "schemaRecommendations": [], "implementationTasks": [], "missingData": [] }`,
    userPromptTemplate: `网站：{{websiteUrl}}
页面内容：{{pageContent}}
技术信号：{{technicalSignals}}
目标关键词：{{targetKeywords}}
目标问题：{{targetQuestions}}
竞品示例：{{competitorExamples}}
目标地区：{{targetGeography}}
品牌语料：{{brandContext}}`,
    inputSchema: {
      type: "object",
      properties: {
        websiteUrl: { type: "string" },
        pageContent: { type: "string" },
        technicalSignals: { type: "string" },
        targetKeywords: { type: "string" },
        targetQuestions: { type: "string" },
        competitorExamples: { type: "string" },
        targetGeography: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["websiteUrl"],
    },
    outputSchema: {
      type: "object",
      required: ["score", "findings", "quickWins", "implementationTasks"],
    },
  },
  {
    slug: "marketing-cro-audit",
    name: "营销转化路径审计",
    description: "审计广告→落地页→表单/预约→报价路径，最多给出三个实验合同",
    domain: "marketing",
    tier: "analysis",
    temperature: 0.25,
    maxTokens: 6000,
    outputFormat: "json",
    mayProposePendingAction: true,
    requiredTools:
      "marketing_get_channel_metrics,marketing_get_experiments,marketing_get_growth_summary",
    systemPrompt: `你是青砚营销增长数字员工的「转化路径（CRO）」审计师。
${ENTERPRISE_SKILL_SAFETY}

检查：广告-落地页一致性、主CTA、信任证明、表单摩擦、价格透明度、手机端、速度信号、预约/跟进路径、流失环节。
最多输出 3 个实验，每个必须含：假设、目标人群、修改内容、主要指标、保护指标、持续时间、停止条件、成功条件、人工审批点。
任何投放启用只能提议 PendingAction marketing.activate_campaign 或研究计划审批，不得直接执行。
输出 JSON：{ "diagnosis": {}, "dropOffs": [], "experiments": [], "missingData": [] }`,
    userPromptTemplate: `活动目标：{{campaignObjective}}
流量来源：{{trafficSource}}
广告信息：{{adMessage}}
落地页内容：{{landingPageContent}}
转化动作：{{conversionAction}}
漏斗指标：{{funnelMetrics}}
客户反馈：{{customerFeedback}}
设备情境：{{deviceContext}}
品牌语料：{{brandContext}}`,
    inputSchema: {
      type: "object",
      properties: {
        campaignObjective: { type: "string" },
        trafficSource: { type: "string" },
        adMessage: { type: "string" },
        landingPageContent: { type: "string" },
        conversionAction: { type: "string" },
        funnelMetrics: { type: "string" },
        customerFeedback: { type: "string" },
        deviceContext: { type: "string" },
        brandContext: { type: "string" },
      },
      required: ["campaignObjective", "landingPageContent"],
    },
    outputSchema: {
      type: "object",
      required: ["diagnosis", "experiments"],
    },
  },
  {
    slug: "mmm-data-readiness",
    name: "MMM数据准备度检查",
    description:
      "检查营销组合模型（Meridian）数据是否就绪；本技能不运行模型，不伪造结果",
    domain: "analytics",
    tier: "analysis",
    temperature: 0.1,
    maxTokens: 4000,
    outputFormat: "json",
    requiredTools: "marketing_get_mmm_summary,marketing_get_channel_metrics",
    systemPrompt: `你是青砚数据分析数字员工的「MMM 数据准备度」检查员。
${ENTERPRISE_SKILL_SAFETY}

本技能只做数据准备度评估，禁止声称已运行 Meridian 或输出伪模型系数。
检查：周数、渠道连续性、KPI一致性、Spend 零值比例、共线性风险、季节性/控制变量、地区维度、缺失。
输出 JSON：{ "ready": false, "readinessScore": 0, "blockingIssues": [], "warnings": [], "channelCoverage": [], "recommendedControls": [], "recommendedGranularity": "weekly", "minimumNextSteps": [] }`,
    userPromptTemplate: `数据集说明（可空，优先用工具）：
{{datasetNotes}}

关注渠道：
{{channelsFocus}}

品牌语料：
{{brandContext}}

请调用 MMM/渠道只读工具后输出 JSON。`,
    inputSchema: {
      type: "object",
      properties: {
        datasetNotes: { type: "string" },
        channelsFocus: { type: "string" },
        brandContext: { type: "string" },
      },
      required: [],
    },
    outputSchema: {
      type: "object",
      required: [
        "ready",
        "readinessScore",
        "blockingIssues",
        "warnings",
        "minimumNextSteps",
      ],
    },
  },
];
