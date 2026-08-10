import type { ToolDescriptor } from "./schemas";
import { isRuntimeV2ToolExecutable } from "./adapters";

/**
 * Runtime V2 工具描述目录（descriptor 事实源：风险/审批/渠道元数据）。
 *
 * P0 Execution Alignment（#88）核心不变量：
 *   PLANNER_VISIBLE_TOOLS ⊆ EXECUTABLE_TOOLS
 * 可执行事实源是 adapters.ts 的 handler map（isRuntimeV2ToolExecutable）；
 * Planner 只能看到 plannerVisibleRuntimeV2Tools() 投影——目录中任何
 * 没有真实 server 执行路径的条目都会被投影过滤（fail-closed），
 * 不可能再出现 planner 合法可选、执行必失败的 ghost tool。
 * 反向（EXECUTABLE ⊋ PLANNER_VISIBLE，即 internal-only 工具）允许。
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
    description: "检索组织内活跃客户（按最近更新排序，最多 20 条）",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_get_customer",
    description:
      "读取客户详情（优先读取上游任务证据中定位的客户；无上游线索时返回组织内近期客户）",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_get_customer_interactions",
    description:
      "读取客户互动历史（优先按上游证据定位客户；无线索时返回组织内近期互动，最多 20 条）",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_get_customer_quotes",
    description:
      "读取报价记录（优先按上游证据定位客户；无线索时返回组织内近期报价，最多 20 条，含状态分布）",
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
    description:
      "为优先客户创建日历提醒草稿（PendingAction，审批后才执行日历写入）",
    riskLevel: "MEDIUM",
    readOnly: false,
    requiresApproval: true,
    supportedChannels: ["web", "wechat"],
  },
  {
    name: "sales_prioritize_followups",
    description:
      "综合上游跟进分析与报价风险证据对客户排序，选出最多 3 个高优先级跟进对象（必须依赖已完成的分析任务）",
    riskLevel: "LOW",
    readOnly: true,
    requiresApproval: false,
    supportedChannels: ["web", "wechat"],
  },
];

/**
 * Planner 可见工具投影（#88 §6–§7）：目录 ∩ 可执行。
 * 任何进入 Planner 视野的工具都保证有真实 server execution path。
 */
export function plannerVisibleRuntimeV2Tools(): ToolDescriptor[] {
  return RUNTIME_V2_TOOL_CATALOG.filter((t) =>
    isRuntimeV2ToolExecutable(t.name),
  );
}

export function listRuntimeV2ToolNames(): string[] {
  return RUNTIME_V2_TOOL_CATALOG.map((t) => t.name);
}

export function getRuntimeV2Tool(name: string): ToolDescriptor | undefined {
  return RUNTIME_V2_TOOL_CATALOG.find((t) => t.name === name);
}
