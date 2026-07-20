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
  | {
      type: "tool_result";
      name: string;
      ok: boolean;
      /** PR4：工具返回的数据 payload（透给上层识别 pending_approval 等） */
      data?: unknown;
    }
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
  sales_get_pipeline_snapshot: "查询销售管道快照",
  sales_get_opportunity: "查询商机详情",
  sales_get_customer_interactions: "查询客户互动",
  sales_get_quote_summary: "查询报价摘要",
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
  trade_search_knowledge: "检索组织产品知识库",
  trade_list_campaigns: "查询获客活动",
  trade_search_prospects: "搜索外贸线索",
  trade_get_prospect: "查询线索详情",
  trade_get_follow_ups: "查询待跟进线索",
  trade_list_quotes: "查询外贸报价",
  trade_get_suggestions: "生成下一步建议",
  trade_run_prospect_research: "执行线索研究与打分",

  // cockpit
  cockpit_get_metrics: "查询驾驶舱指标",
  cockpit_get_weekly_report: "查询本周周报",

  // secretary
  secretary_get_briefing: "生成今日简报",
  secretary_scan_followups: "扫描待跟进",
  secretary_generate_followup_draft: "生成跟进草稿",
  secretary_execute_action: "执行动作",
  calendar_create_event_draft: "准备日历事件",

  // context
  context_search_history: "搜索历史对话",
  context_get_summaries: "查询对话摘要",
  context_index_messages: "更新搜索索引",

  // skills
  skill_list: "查询可用技能",
  skill_run: "执行技能",
  skill_create_from_description: "创建新技能",

  // marketing
  marketing_get_growth_summary: "读取增长中心摘要",
  marketing_run_health_scan: "检查营销健康度",
  marketing_analyze: "提交后台市场研究",
  marketing_get_mmm_summary: "读取 MMM 分析",
  marketing_get_channel_metrics: "读取渠道指标",
  marketing_get_experiments: "读取营销实验",
  marketing_get_brand_profile: "读取品牌档案",
  marketing_list_channel_accounts: "列出营销渠道账号",
  marketing_request_data_sync: "同步营销渠道数据",
  marketing_ingest_channel_metrics: "写入渠道周指标",
  org_search_knowledge: "检索组织知识库",
  knowledge_search_org: "检索组织知识库",
  knowledge_search_project: "检索项目知识",
  project_get_tender_summary: "查询招投标摘要",
  project_get_project_documents: "查询项目文档",
  project_get_project_requirements: "查询项目需求要点",
  project_get_project_inquiries: "查询项目询价",
  project_get_project_quotes: "查询项目报价",
  project_search_similar_projects: "检索相似项目",
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
  "订单", "预约", "日程", "日历", "会议", "提醒", "安装", "量房",
  "业绩", "漏斗", "管道", "deal", "deal 健康",
  "微信", "小红书", "facebook",
  "市场情报", "营销分析", "竞品", "对标", "电商", "网购",
  "google ads", "meta ads", "instagram", "qingyan-marketing-analysis",
  // 英文业务词
  "pipeline", "opportunity", "prospect", "lead", "quote", "campaign", "calendar", "meeting", "reminder",
  "cockpit", "funnel", "appointment",
  // 时间 + 统计意图
  "本月", "本周", "今日", "今天", "昨天", "上月", "上周", "这个月",
  "这周", "季度", "年度",
  "多少", "几个", "几单", "多少钱", "排行", "top", "排名",
  "统计", "汇总", "概览", "总览",
  // 外贸
  "外贸", "获客", "研究报告", "背调", "调研这家公司", "研究一下", "重新研究", "评估这家",
  "待研究", "列线索", "prospect",
  // 动词 + 指代
  "查一下", "看一下", "帮我查", "帮我看", "给我列", "加到日历", "加入日历", "创建日程",
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

export type LongRunningMarketingResearch = {
  kind: "market" | "competitor" | "mmm" | "channel";
  outputType:
    | "comprehensive"
    | "competitor-profile"
    | "market-brief"
    | "channel-plan";
};

const EXPLICIT_MARKETING_RESEARCH_PHRASES = [
  "深度市场研究",
  "市场研究报告",
  "市场调研报告",
  "市场情报研究",
  "帮我做市场情报",
  "生成市场报告",
  "竞品研究报告",
  "竞品分析报告",
  "深度竞品分析",
  "竞品监听分析",
  "qingyan-marketing-analysis",
];

const RESEARCH_ACTIONS = [
  "研究", "调研", "分析", "深度研究", "研究报告", "调研报告", "分析报告", "系统分析", "全面分析",
  "深入分析", "归因分析", "预算优化", "投放复盘", "制定方案",
  "research", "deep dive", "analysis report",
];

const MARKET_SUBJECTS = ["市场", "营销", "增长", "market", "marketing", "growth"];
const COMPETITOR_SUBJECTS = ["竞品", "竞争对手", "对标", "竞品监听", "competitor"];
const MMM_SUBJECTS = ["mmm", "marketing mix", "营销组合模型", "媒体组合模型"];
const CHANNEL_SUBJECTS = [
  "google ads", "meta ads", "facebook", "instagram", "tiktok", "渠道", "广告投放",
];

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

/**
 * 识别不应在主 AI 请求内同步等待的深度营销任务。
 * 普通的“查看竞品/市场概览”不会命中，仍由 Agent 的只读工具即时回答。
 */
export function classifyLongRunningMarketingResearch(
  text: string,
): LongRunningMarketingResearch | null {
  const lower = text.trim().toLowerCase();
  if (!lower) return null;

  const explicit = includesAny(lower, EXPLICIT_MARKETING_RESEARCH_PHRASES);
  const hasResearchAction = explicit || includesAny(lower, RESEARCH_ACTIONS);

  if (includesAny(lower, MMM_SUBJECTS) && (hasResearchAction || lower.includes("运行"))) {
    return { kind: "mmm", outputType: "comprehensive" };
  }
  if (includesAny(lower, COMPETITOR_SUBJECTS) && hasResearchAction) {
    return { kind: "competitor", outputType: "competitor-profile" };
  }
  if (includesAny(lower, CHANNEL_SUBJECTS) && hasResearchAction) {
    return { kind: "channel", outputType: "channel-plan" };
  }
  if (explicit || (includesAny(lower, MARKET_SUBJECTS) && hasResearchAction)) {
    return { kind: "market", outputType: "market-brief" };
  }
  return null;
}

const CALENDAR_NOUNS = ["日历", "日程", "会议", "calendar", "meeting", "reminder"];
const CALENDAR_WRITE_ACTIONS = [
  "加", "添加", "新增", "创建", "安排", "提醒", "记到", "放到", "➕",
  "add", "create", "schedule", "remind",
];

/** 明确要求新增个人日历事项；此类请求可安全绕过 Operator 灰度，因为仍需本人审批。 */
export function requestsCalendarWrite(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    CALENDAR_NOUNS.some((keyword) => lower.includes(keyword)) &&
    CALENDAR_WRITE_ACTIONS.some((keyword) => lower.includes(keyword))
  );
}
