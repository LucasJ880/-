/**
 * 营销数字员工自然语言 → AgentSkill slug 路由（规则优先，不引入第二套 Runtime）
 *
 * 仅做意图匹配与建议；真正执行仍走 runSkill / PendingAction。
 */

export const MARKETING_PHASE2_TASKS = [
  {
    slug: "marketing-product-context",
    title: "完善产品营销档案",
    description: "整理企业、产品、客户、定位与证据，检查完整度并提议补充。",
  },
  {
    slug: "marketing-customer-research",
    title: "研究目标客户",
    description: "从互动与语料提取 JTBD、痛点、异议与采购触发点。",
  },
  {
    slug: "marketing-competitor-profile",
    title: "分析竞争对手",
    description: "建立竞品事实档案，找出可验证差异化。",
  },
  {
    slug: "marketing-prospecting-campaign",
    title: "设计获客活动",
    description: "按 ICP 划分细分、渠道与触达节奏（不直接群发）。",
  },
  {
    slug: "marketing-copywriting",
    title: "生成营销文案",
    description: "生成网页/广告/社交文案，并检查夸大与证据缺口。",
  },
  {
    slug: "marketing-email-campaign",
    title: "设计邮件活动",
    description: "设计邮件序列与合规清单，一对一可提议草稿，不群发。",
  },
  {
    slug: "marketing-paid-campaign-plan",
    title: "规划广告活动",
    description: "规划付费广告结构、创意与指标，不直接投放或改预算。",
  },
  {
    slug: "marketing-experiment-design",
    title: "设计 A/B 实验",
    description: "设计单变量实验、成功/停止条件与实施任务。",
  },
  {
    slug: "marketing-sales-enablement",
    title: "生成销售赋能资料",
    description: "生成 Battlecard、异议处理与价值陈述（非正式承诺）。",
  },
  {
    slug: "marketing-geo-audit",
    title: "检查网站 GEO",
    description: "审计站点对 AI/搜索可见性的结构化与内容信号。",
  },
  {
    slug: "marketing-cro-audit",
    title: "检查转化路径",
    description: "审计落地页与漏斗摩擦，提出可审批的实验建议。",
  },
] as const;

export type MarketingTaskSlug = (typeof MARKETING_PHASE2_TASKS)[number]["slug"];

export interface MarketingSkillRouteResult {
  slug: MarketingTaskSlug | null;
  confidence: number;
  reason: string;
  requiresApproval: boolean;
}

const RULES: Array<{
  slug: MarketingTaskSlug;
  patterns: RegExp[];
  requiresApproval?: boolean;
  reason: string;
}> = [
  {
    slug: "marketing-product-context",
    patterns: [
      /产品定位|产品档案|营销档案|营销上下文|product marketing context|完善.*定位|品牌定位档案/,
      /完善.*(产品|品牌).*(档案|资料|上下文)/,
    ],
    reason: "完善产品/定位档案",
  },
  {
    slug: "marketing-customer-research",
    patterns: [
      /客户为什么(买|购买)|客户研究|需求洞察|JTBD|痛点|采购触发|为什么购买/,
      /分析.*(客户|买家).*(原因|洞察|需求)/,
    ],
    reason: "客户研究与需求洞察",
  },
  {
    slug: "marketing-competitor-profile",
    patterns: [
      /竞争对[手家]|竞品|对标|Select Blinds|Blinds\.ca|竞争对手画像/,
      /研究.*(竞品|竞争)/,
    ],
    reason: "竞争对手画像",
  },
  {
    slug: "marketing-prospecting-campaign",
    patterns: [
      /获客活动|prospecting|目标客户.*(活动|触达)|商业窗帘.*获客|获客.*设计/,
      /设计.*(获客|触达).*(活动|战役)/,
    ],
    reason: "获客活动设计",
  },
  {
    slug: "marketing-copywriting",
    patterns: [
      /写.*(文案|landing|落地页)|营销文案|更有说服力的文案|copywriting|文案.*(生成|审查)/,
    ],
    reason: "营销文案",
  },
  {
    slug: "marketing-email-campaign",
    patterns: [
      /邮件(活动|序列|跟进)|email campaign|报价.*没成交.*邮件|未成交.*邮件/,
      /设计.*(营销)?邮件/,
    ],
    requiresApproval: true,
    reason: "营销邮件活动（副作用须审批）",
  },
  {
    slug: "marketing-paid-campaign-plan",
    patterns: [
      /Google Ads|Meta 广告|LinkedIn|TikTok.*广告|付费广告|广告活动|投放计划/,
      /规划.*(广告|投放).*(但不要|不要直接|不上线)?/,
    ],
    requiresApproval: true,
    reason: "付费广告规划（不直接上线）",
  },
  {
    slug: "marketing-experiment-design",
    patterns: [
      /A\/B|AB测试|a\/b|实验设计|增长实验|落地页.*测试/,
      /设计.*(实验|测试)/,
    ],
    requiresApproval: true,
    reason: "营销实验设计",
  },
  {
    slug: "marketing-sales-enablement",
    patterns: [
      /Battlecard|battlecard|销售赋能|异议处理|销售资料|优势整理成销售/,
    ],
    reason: "销售赋能资料",
  },
  {
    slug: "marketing-geo-audit",
    patterns: [/GEO|AI搜索|生成式引擎|geo.?audit|网站.*可见性/i],
    reason: "GEO 审计",
  },
  {
    slug: "marketing-cro-audit",
    patterns: [/CRO|转化路径|转化率|落地页审计|转化漏斗/i],
    reason: "CRO 审计",
  },
];

/** 高风险动作关键词：命中则不得自动执行副作用 */
const HIGH_RISK =
  /直接(发送|群发|发布|上线|投放)|改预算|启动广告|暂停广告|改价格|自动覆盖/;

/**
 * 从用户自然语言匹配营销技能。
 * 保守：多命中时取第一条高置信规则；无法判断返回 null。
 */
export function routeMarketingSkillIntent(
  content: string,
): MarketingSkillRouteResult {
  const text = (content || "").trim();
  if (!text || text.length < 4) {
    return {
      slug: null,
      confidence: 0,
      reason: "输入过短",
      requiresApproval: false,
    };
  }

  const highRisk = HIGH_RISK.test(text);

  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return {
        slug: rule.slug,
        confidence: 0.82,
        reason: rule.reason,
        requiresApproval: highRisk || Boolean(rule.requiresApproval),
      };
    }
  }

  return {
    slug: null,
    confidence: 0,
    reason: "未匹配营销任务",
    requiresApproval: highRisk,
  };
}

export function isMarketingSkillSlug(slug: string): boolean {
  return MARKETING_PHASE2_TASKS.some((t) => t.slug === slug);
}
