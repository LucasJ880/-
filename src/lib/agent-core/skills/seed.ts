/**
 * 内置技能种子 — 组织首次使用时自动创建
 *
 * 这些技能预置了经过验证的 prompt，用户可以在此基础上
 * 通过执行反馈触发自我优化。
 */

import { db } from "@/lib/db";
import type { DynamicSkillDef } from "./types";

interface BuiltinSkillSeed {
  slug: string;
  name: string;
  description: string;
  domain: string;
  tier: string;
  systemPrompt: string;
  userPromptTemplate: string;
  outputFormat: string;
  temperature: number;
  maxTokens: number;
  inputSchema: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  requiredTools: string | null;
}

const BUILTIN_SKILLS: BuiltinSkillSeed[] = [
  {
    slug: "trade-outreach-email",
    name: "外贸开发信生成",
    description: "根据客户信息和产品定位，生成专业的英文外贸开发信",
    domain: "trade",
    tier: "execution",
    systemPrompt: `你是资深外贸开发信专家，擅长撰写高回复率的 B2B 开发信。
规则：
- 开头直接说明价值主张，不要寒暄
- 正文展示具体能力和案例
- 结尾用轻松但专业的 CTA
- 整体 150-200 词，简洁有力
- 标题要能引起好奇心，避免垃圾邮件关键词`,
    userPromptTemplate: `请为以下客户生成一封开发信：

客户公司: {{companyName}}
联系人: {{contactName}}
客户行业: {{industry}}
客户需求: {{needs}}
我方优势: {{ourStrength}}
产品/服务: {{product}}

请输出 JSON 格式：
{"subject": "邮件标题", "body": "邮件正文"}`,
    outputFormat: "json",
    temperature: 0.4,
    maxTokens: 1500,
    inputSchema: {
      type: "object",
      properties: {
        companyName: { type: "string", description: "客户公司名" },
        contactName: { type: "string", description: "联系人姓名" },
        industry: { type: "string", description: "客户行业" },
        needs: { type: "string", description: "客户需求描述" },
        ourStrength: { type: "string", description: "我方核心优势" },
        product: { type: "string", description: "产品/服务描述" },
      },
      required: ["companyName", "product"],
    },
    requiredTools: null,
  },
  {
    slug: "trade-followup-strategy",
    name: "客户跟进策略",
    description: "基于客户当前状态和历史互动，生成个性化跟进策略和话术",
    domain: "trade",
    tier: "analysis",
    systemPrompt: `你是外贸客户关系管理专家。根据客户的当前状态和历史互动记录，
制定下一步跟进策略。
输出必须包含：策略建议、具体话术、最佳联系时间、注意事项。`,
    userPromptTemplate: `客户信息：
公司: {{companyName}}
当前阶段: {{stage}}
上次联系: {{lastContact}}
互动历史: {{history}}
客户回复情况: {{replyStatus}}

请分析并生成跟进策略，JSON 格式：
{
  "strategy": "策略概述",
  "talkingPoints": ["话术要点1", "话术2"],
  "bestTiming": "建议联系时间",
  "cautions": ["注意事项"],
  "priority": "high/medium/low"
}`,
    outputFormat: "json",
    temperature: 0.3,
    maxTokens: 2000,
    inputSchema: {
      type: "object",
      properties: {
        companyName: { type: "string", description: "客户公司名" },
        stage: { type: "string", description: "当前客户阶段" },
        lastContact: { type: "string", description: "上次联系时间" },
        history: { type: "string", description: "互动历史摘要" },
        replyStatus: { type: "string", description: "回复情况" },
      },
      required: ["companyName", "stage"],
    },
    requiredTools: "trade_get_prospect",
  },
  {
    slug: "trade-market-brief",
    name: "市场快报",
    description: "根据当前外贸数据生成市场分析简报",
    domain: "trade",
    tier: "analysis",
    systemPrompt: `你是外贸市场分析师。根据提供的数据概况，生成简洁的市场分析报告。
重点关注：趋势变化、机会点、风险提醒。
用数据说话，避免空泛的建议。`,
    userPromptTemplate: `以下是当前外贸业务数据：

活跃线索数: {{prospectCount}}
本周新增: {{newThisWeek}}
平均回复率: {{replyRate}}
主要行业分布: {{industries}}
重点区域: {{regions}}

请生成一份市场快报（markdown 格式），包含：
1. 数据概览
2. 趋势分析
3. 行动建议（2-3条具体的）`,
    outputFormat: "markdown",
    temperature: 0.3,
    maxTokens: 2000,
    inputSchema: {
      type: "object",
      properties: {
        prospectCount: { type: "string" },
        newThisWeek: { type: "string" },
        replyRate: { type: "string" },
        industries: { type: "string" },
        regions: { type: "string" },
      },
    },
    requiredTools: "trade_get_overview",
  },
  {
    slug: "general-task-decomposer",
    name: "任务分解助手",
    description: "将复杂任务分解为可执行的子任务列表",
    domain: "secretary",
    tier: "foundation",
    systemPrompt: `你是任务管理专家。将用户描述的复杂任务分解为清晰、可执行的子任务。
每个子任务应该：
- 有明确的交付物
- 可在 1-2 小时内完成
- 有清晰的优先级和依赖关系`,
    userPromptTemplate: `请将以下任务分解为子任务：

任务描述: {{taskDescription}}
截止日期: {{deadline}}
相关背景: {{context}}

请输出 JSON 格式：
{
  "subtasks": [
    {
      "title": "子任务标题",
      "description": "具体内容",
      "priority": "high/medium/low",
      "estimatedMinutes": 60,
      "dependsOn": []
    }
  ]
}`,
    outputFormat: "json",
    temperature: 0.2,
    maxTokens: 2000,
    inputSchema: {
      type: "object",
      properties: {
        taskDescription: { type: "string", description: "任务描述" },
        deadline: { type: "string", description: "截止日期" },
        context: { type: "string", description: "相关背景" },
      },
      required: ["taskDescription"],
      },
      requiredTools: null,
  },
  {
    slug: "product-visual-builder",
    name: "产品视觉素材生成",
    description:
      "基于真实产品照片与产品事实，生成官网/目录/报价/销售用途的产品视觉素材建议与图像生成提示词（仅建议，需人工确认）",
    domain: "creative",
    tier: "execution",
    systemPrompt: `你是产品视觉素材策划助手，服务于家纺产品（毛毯/浴袍/枕头等）的官网图、目录图、报价附图与销售素材。

铁律（不可违反）：
1. 真实产品照片是唯一事实来源。
2. 不得改变产品本体，包括结构、材质、版型、颜色、纹理、logo/标签位置、尺寸比例。
3. 严禁编造任何事实：认证、材质、尺寸、克重(GSM)、MOQ、护理说明、产地。
4. 未提供的信息必须标注为"未提供 / not provided"，不得脑补。
5. 认证只能按用户提供内容原样展示，最终以官方证书为准。
6. 输出内容必须默认 humanReviewRequired=true。
7. 第一版只生成建议和素材，不自动发布官网或客户资料。`,
    userPromptTemplate: `请基于以下信息，产出 {{useCase}} 用途、{{style}} 风格的产品视觉素材建议与图像生成提示词。
产品类型: {{productType}}
产品名称: {{productName}}
语言: {{language}}
产品事实(JSON): {{productFactsJson}}
认证(仅按原文展示): {{certificationsJson}}
硬约束(JSON): {{constraintsJson}}
源图角色(JSON): {{sourceImageRolesJson}}
仅依据以上事实，不得编造；未提供的标注 not provided。`,
    outputFormat: "json",
    temperature: 0.3,
    maxTokens: 2000,
    inputSchema: {
      type: "object",
      properties: {
        productType: {
          type: "string",
          enum: ["blanket", "bathrobe", "pillow", "other"],
          description: "产品类型",
        },
        productName: { type: "string", description: "产品名称" },
        useCase: {
          type: "string",
          enum: [
            "website",
            "catalog",
            "quote_attachment",
            "whatsapp_sales",
            "internal_review",
          ],
          description: "用途",
        },
        style: {
          type: "string",
          enum: [
            "warm_home",
            "hotel",
            "white_background",
            "spec_sheet",
            "ecommerce",
          ],
          description: "风格",
        },
        sourceImageUrls: {
          type: "array",
          items: { type: "string" },
          description: "本 org 本次上传的源图 URL",
        },
        productFacts: { type: "object", description: "产品事实（缺失标 not provided）" },
        language: {
          type: "string",
          enum: ["en", "zh", "bilingual"],
          description: "输出语言",
        },
      },
      required: ["productType", "productName", "useCase", "style", "sourceImageUrls"],
    },
    outputSchema: {
      type: "object",
      properties: {
        finalPrompt: { type: "string" },
        warnings: { type: "array", items: { type: "string" } },
        productFactsUsed: { type: "object" },
        suggestedUsage: { type: "string" },
        websitePathSuggestions: { type: "array", items: { type: "string" } },
        assetNamingSuggestions: { type: "array", items: { type: "string" } },
        humanReviewRequired: { type: "boolean" },
      },
      required: ["finalPrompt", "warnings", "humanReviewRequired"],
    },
    requiredTools: null,
  },
];

export async function seedBuiltinSkills(orgId: string): Promise<number> {
  let created = 0;

  for (const seed of BUILTIN_SKILLS) {
    const existing = await db.agentSkill.findUnique({
      where: { orgId_slug: { orgId, slug: seed.slug } },
      select: { id: true },
    });

    if (existing) continue;

    await db.agentSkill.create({
      data: {
        orgId,
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        domain: seed.domain,
        tier: seed.tier,
        systemPrompt: seed.systemPrompt,
        userPromptTemplate: seed.userPromptTemplate,
        outputFormat: seed.outputFormat,
        temperature: seed.temperature,
        maxTokens: seed.maxTokens,
        inputSchema: seed.inputSchema ? JSON.parse(JSON.stringify(seed.inputSchema)) : undefined,
        outputSchema: seed.outputSchema ? JSON.parse(JSON.stringify(seed.outputSchema)) : undefined,
        requiredTools: seed.requiredTools,
        isBuiltin: true,
        isActive: true,
      },
    });
    created++;
  }

  return created;
}
