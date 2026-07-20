export const AUTOMATION_TIMEZONE = "America/Toronto";

export interface AutomationDefinition {
  key: string;
  name: string;
  category: "projects" | "sales" | "service" | "marketing" | "operations";
  cadence: string;
  timezone: string;
  requiredEnv?: string[];
}

export const AUTOMATION_REGISTRY = [
  { key: "project-inspection", name: "项目智能巡检", category: "projects", cadence: "每日", timezone: "UTC" },
  { key: "daily-brief", name: "每日经营简报", category: "sales", cadence: "每日 07:00", timezone: AUTOMATION_TIMEZONE },
  { key: "approval-timeout", name: "审批超时检查", category: "operations", cadence: "每 2 小时", timezone: "UTC" },
  { key: "trade-followup", name: "客户跟进建议", category: "sales", cadence: "每日 09:00、14:00", timezone: AUTOMATION_TIMEZONE },
  { key: "wechat-push", name: "微信消息补推", category: "sales", cadence: "每日 07:30", timezone: AUTOMATION_TIMEZONE },
  { key: "progress-summary", name: "项目进度摘要", category: "projects", cadence: "每日", timezone: "UTC" },
  { key: "service-inbox-sla", name: "客服 SLA 提醒", category: "service", cadence: "每 10 分钟", timezone: AUTOMATION_TIMEZONE },
  { key: "market-intelligence", name: "市场情报分析", category: "marketing", cadence: "每 15 分钟", timezone: "UTC", requiredEnv: ["FIRECRAWL_API_KEY"] },
  { key: "marketing-channel-sync", name: "增长中心渠道同步", category: "marketing", cadence: "每日 4 次，Activepieces 执行", timezone: AUTOMATION_TIMEZONE, requiredEnv: ["ACTIVEPIECES_WEBHOOK_SECRET", "ACTIVEPIECES_MARKETING_SYNC_WEBHOOK_URL"] },
  { key: "marketing-health", name: "增长中心健康检查", category: "marketing", cadence: "每日 07:00，Activepieces 执行", timezone: AUTOMATION_TIMEZONE, requiredEnv: ["ACTIVEPIECES_WEBHOOK_SECRET", "ACTIVEPIECES_MARKETING_HEALTH_WEBHOOK_URL"] },
  { key: "marketing-daily-brief", name: "微信推广日报", category: "marketing", cadence: "每日 08:00，Activepieces 执行", timezone: AUTOMATION_TIMEZONE, requiredEnv: ["ACTIVEPIECES_WEBHOOK_SECRET", "ACTIVEPIECES_MARKETING_DAILY_BRIEF_WEBHOOK_URL"] },
  { key: "marketing-experiment-review", name: "营销实验复盘", category: "marketing", cadence: "每周一 09:00，Activepieces 执行", timezone: AUTOMATION_TIMEZONE, requiredEnv: ["ACTIVEPIECES_WEBHOOK_SECRET", "ACTIVEPIECES_MARKETING_EXPERIMENT_WEBHOOK_URL"] },
  { key: "marketing-mmm", name: "Meridian MMM", category: "marketing", cadence: "按需/月度", timezone: AUTOMATION_TIMEZONE, requiredEnv: ["ACTIVEPIECES_WEBHOOK_SECRET", "ACTIVEPIECES_MMM_RUN_WEBHOOK_URL"] },
  { key: "aivora-sync", name: "Aivora 视频同步", category: "operations", cadence: "每小时", timezone: "UTC", requiredEnv: ["AIVORA_ORG_ID"] },
  { key: "trade-daily", name: "外贸每日检查", category: "sales", cadence: "每日 08:00", timezone: AUTOMATION_TIMEZONE },
  { key: "proactive-scan", name: "主动工作提醒", category: "projects", cadence: "每小时", timezone: AUTOMATION_TIMEZONE },
  { key: "agent-runs", name: "Agent 后台任务队列", category: "operations", cadence: "每 2 分钟", timezone: "UTC" },
  {
    key: "employee-ai-practice-miner",
    name: "数字员工候选方法挖掘",
    category: "operations",
    cadence: "每周一",
    timezone: "UTC",
  },
] as const satisfies readonly AutomationDefinition[];

export type AutomationKey = (typeof AUTOMATION_REGISTRY)[number]["key"];

export function getAutomationReadiness() {
  return AUTOMATION_REGISTRY.map((definition) => {
    const requiredEnv = "requiredEnv" in definition ? definition.requiredEnv : [];
    const missingEnv = requiredEnv.filter(
      (name) => !process.env[name]?.trim(),
    );
    return {
      ...definition,
      configured: missingEnv.length === 0,
      missingEnv,
    };
  });
}
