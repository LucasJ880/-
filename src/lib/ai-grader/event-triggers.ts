/**
 * Grader 业务事件触发入口（第一阶段）
 *
 * 原则：
 * - 主聊天链路不再无条件跑四个 Grader
 * - 仅在用户明确询问时由 gateway 意图分类同步调用
 * - 业务事件侧通过本文件的 service 函数异步触发（TODO：接真实事件总线）
 *
 * 调用方应在对应业务写路径（报价更新、项目状态变更、跟进记录变更、定时任务）
 * 中调用下方函数，而不是在每条微信消息里硬编码。
 */

import { logger } from "@/lib/common/logger";

/** DailyBusinessBrief — 应由定时任务触发 */
export async function triggerDailyBusinessBriefOnSchedule(input: {
  orgId: string;
}): Promise<void> {
  // TODO(phase-2): 接入 cron / queue，调用 runDailyBriefForWeChat 或内部 brief 生成
  logger.info("grader.trigger.daily_brief.todo", { orgId: input.orgId });
}

/** CustomerFollowup — 客户/跟进数据变化或定时扫描 */
export async function triggerCustomerFollowupOnBusinessEvent(input: {
  orgId: string;
  customerId?: string;
  reason: "customer_updated" | "followup_created" | "schedule_scan";
}): Promise<void> {
  logger.info("grader.trigger.customer_followup.todo", {
    orgId: input.orgId,
    customerId: input.customerId,
    reason: input.reason,
  });
}

/** QuoteRisk — 报价新增或更新 */
export async function triggerQuoteRiskOnQuoteChange(input: {
  orgId: string;
  quoteId: string;
  reason: "quote_created" | "quote_updated";
}): Promise<void> {
  logger.info("grader.trigger.quote_risk.todo", {
    orgId: input.orgId,
    quoteId: input.quoteId,
    reason: input.reason,
  });
}

/** ProjectHealth — 项目/任务/截止日期/状态变化 */
export async function triggerProjectHealthOnProjectChange(input: {
  orgId: string;
  projectId: string;
  reason: "project_updated" | "task_changed" | "deadline_changed";
}): Promise<void> {
  logger.info("grader.trigger.project_health.todo", {
    orgId: input.orgId,
    projectId: input.projectId,
    reason: input.reason,
  });
}
