/**
 * Agent 流式事件协议 + 辅助（PR3）
 *
 * 给 operator 主入口提供：
 * - 流式事件类型定义
 * - 工具名到中文可感知标签的映射
 * - "是否需要工具"的轻量关键词分类器
 */

// ── 流式事件 ─────────────────────────────────────────────────────

export type AgentStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; name: string; label: string }
  | { type: "tool_result"; name: string; ok: boolean }
  | {
      type: "done";
      firstTokenMs?: number;
      rounds: number;
      toolCalls: number;
      latencyMs: number;
      model: string;
    }
  | { type: "error"; message: string };

// ── 工具中文标签 ─────────────────────────────────────────────────
// 用户看到的是"正在查询销售管道..."而不是"sales_get_pipeline"

const TOOL_LABELS: Record<string, string> = {
  // sales
  sales_ai_quote: "AI 解析报价",
  sales_create_quote: "创建报价单",
  sales_get_customer_quotes: "查询客户报价",
  sales_search_customers: "搜索客户",
  sales_get_customer: "查询客户详情",
  sales_get_pipeline: "查询销售管道",
  sales_list_opportunities: "查询商机列表",
  sales_get_overview: "查询销售概览",
  sales_advance_stage: "推进商机阶段",
  sales_compose_email: "生成邮件草稿",
  sales_refine_email: "优化邮件内容",
  sales_send_quote_email: "发送报价邮件",
  sales_create_appointment: "创建预约",
  sales_analyze_interaction: "分析沟通内容",
  sales_search_knowledge: "搜索销售知识库",
  sales_get_coaching: "生成销售建议",
  sales_get_deal_health: "分析 Deal 健康度",
  sales_record_coaching: "记录建议",
  sales_coaching_feedback: "记录反馈",

  // trade
  trade_get_overview: "查询外贸总览",
  trade_list_campaigns: "查询获客活动",
  trade_search_prospects: "搜索外贸线索",
  trade_get_prospect: "查询线索详情",
  trade_get_follow_ups: "查询待跟进线索",
  trade_list_quotes: "查询外贸报价",
  trade_get_suggestions: "生成下一步建议",

  // cockpit
  cockpit_get_metrics: "查询驾驶舱指标",
  cockpit_get_weekly_report: "查询本周周报",

  // secretary
  secretary_get_briefing: "生成今日简报",
  secretary_scan_followups: "扫描待跟进",
  secretary_generate_followup_draft: "生成跟进草稿",
  secretary_execute_action: "执行动作",

  // context
  context_search_history: "搜索历史对话",
  context_get_summaries: "查询对话摘要",
  context_index_messages: "更新搜索索引",

  // skills
  skill_list: "查询可用技能",
  skill_run: "执行技能",
  skill_create_from_description: "创建新技能",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? "处理中";
}

// ── "是否需要工具"轻量分类器 ────────────────────────────────────
// 思路：命中业务关键词 → 走 tools 分支；否则走 direct 分支
// 注意：宁可多给 direct（体感快），也不要让 tools 跑一轮空查
//       → 关键词偏保守：只收"明显业务语义"的词

const BUSINESS_TRIGGERS: readonly string[] = [
  // 名词 —— 业务实体
  "客户", "报价", "商机", "线索", "跟进", "销售", "成交",
  "订单", "预约", "日程", "安装", "量房",
  "业绩", "漏斗", "管道", "deal", "deal 健康",
  "微信", "小红书", "facebook",
  // 英文业务词
  "pipeline", "opportunity", "prospect", "lead", "quote", "campaign",
  "cockpit", "funnel", "appointment",
  // 时间 + 统计意图
  "本月", "本周", "今日", "今天", "昨天", "上月", "上周", "这个月",
  "这周", "季度", "年度",
  "多少", "几个", "几单", "多少钱", "排行", "top", "排名",
  "统计", "汇总", "概览", "总览",
  // 外贸
  "外贸", "获客", "研究报告",
  // 动词 + 指代
  "查一下", "看一下", "帮我查", "帮我看", "给我列",
  "有哪些", "哪些客户", "哪些报价",
];

/**
 * 返回 true 表示消息里带有明显业务查询意图，应该走 runAgent + 工具
 * false 表示大概率是闲聊 / 润色 / 概念题，直接流式对话更快
 */
export function needsTools(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const kw of BUSINESS_TRIGGERS) {
    if (lower.includes(kw.toLowerCase())) return true;
  }
  return false;
}
