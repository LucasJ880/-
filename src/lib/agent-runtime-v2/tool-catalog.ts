import type { ToolDescriptor } from "./schemas";

/**
 * Phase 1 黄金场景可用工具描述（Planner 白名单）。
 * 实际执行优先走 ToolRegistry；若未注册则走本地 adapter。
 */
export const RUNTIME_V2_TOOL_CATALOG: ToolDescriptor[] = [
  {
    name: "sales_get_pipeline",
    description: "查询当前组织销售 Pipeline 概览与阶段分布",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_list_opportunities",
    description: "列出近期活跃商机",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_search_customers",
    description: "按名称搜索客户",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_get_customer",
    description: "读取单个客户详情",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_get_customer_interactions",
    description: "读取客户互动历史",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_get_customer_quotes",
    description: "读取客户相关报价",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_customer_followup_analysis",
    description: "运行 CustomerFollowupGrader 分析跟进优先级",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_quote_risk_analysis",
    description: "运行 QuoteRiskGrader 分析报价风险",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_update_followup",
    description: "修改商机下次跟进时间（生成 PendingAction，不直写）",
    riskLevel: "HIGH",
    readOnly: false,
    requiresApproval: true,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "grader_create_followup_task",
    description: "为客户创建 CRM 跟进任务草稿（PendingAction）",
    riskLevel: "HIGH",
    readOnly: false,
    requiresApproval: true,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "gmail_create_draft",
    description: "创建 Gmail 邮件草稿（仅 drafts.create，不发送）",
    riskLevel: "HIGH",
    readOnly: false,
    requiresApproval: true,
    supportedChannels: ["web"],
  },
  {
    name: "calendar_create_event_draft",
    description: "创建日历提醒草稿（PendingAction）",
    riskLevel: "MEDIUM",
    readOnly: false,
    requiresApproval: true,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_prioritize_followups",
    description: "根据分析证据对客户排序并选出最多 3 个高优先级跟进对象",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
];

export function listRuntimeV2ToolNames(): string[] {
  return RUNTIME_V2_TOOL_CATALOG.map((t) => t.name);
}

export function getRuntimeV2Tool(name: string): ToolDescriptor | undefined {
  return RUNTIME_V2_TOOL_CATALOG.find((t) => t.name === name);
}
