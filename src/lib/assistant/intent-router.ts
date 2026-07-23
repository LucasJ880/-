/**
 * Phase 3B-A：窄意图路由（Commit 3 / 3A）
 *
 * 策略：宁可归 general_answer，不要误伤现有聊天。
 * 邮件「发送」请求安全降级为 gmail_email_draft（requestedDirectExecution）。
 */

export type AssistantIntent =
  | "daily_business_brief"
  | "customer_followup_task"
  | "gmail_email_draft"
  | "general_answer"
  | "unsupported_action";

export type IntentRouteResult = {
  intent: AssistantIntent;
  confidence: number;
  reason: string;
  /** 用户口头要求「发送」等直接执行；场景侧仍只做草稿/确认 */
  requestedDirectExecution?: boolean;
};

const BRIEF_RE =
  /(今日|今天|每日).{0,6}(简报|业务概览|工作汇总)|(给我|看看|出一份).{0,4}(今日|今天|每日).{0,4}简报|业务简报/;

const FOLLOWUP_RE =
  /(安排|创建|提醒).{0,8}跟进|(客户|商机).{0,8}(跟进|回访)|(下次跟进|跟进日期|跟进提醒)|(加入|写进|放进).{0,4}日历.{0,8}跟进/;

const GMAIL_DRAFT_RE =
  /(写|起草|生成|创建).{0,8}(邮件|gmail).{0,6}草稿|(邮件|gmail).{0,6}草稿|(draft).{0,8}(email|gmail)/i;

/** 用户要求发邮件 / 回复客户 → 转草稿意图（优先于 unsupported） */
const EMAIL_SEND_AS_DRAFT_RE =
  /(帮我|请|麻烦)?.{0,4}(发|发送|发出|立即发出|马上发).{0,8}(邮件|gmail|这封)|把.{0,12}(邮件|gmail).{0,8}(发送|发出|发给)|帮我回复(客户|邮件)|回复客户一封邮件/i;

/** 无法安全转换为现有确认动作的高风险请求 */
const UNSUPPORTED_RE =
  /自动下单|批量删除客户|清空客户|清空数据|删除所有客户|一键删除/;

/**
 * 保守关键词路由。置信度低或不明确 → general_answer。
 */
export function routeAssistantIntent(message: string): IntentRouteResult {
  const text = message.trim();
  if (!text) {
    return {
      intent: "general_answer",
      confidence: 0,
      reason: "empty_message",
    };
  }

  // 1) 高风险不可转换动作
  if (UNSUPPORTED_RE.test(text)) {
    return {
      intent: "unsupported_action",
      confidence: 0.9,
      reason: "explicit_disallowed_write",
    };
  }

  // 2) 邮件发送类 → 安全转为草稿（不得进 unsupported）
  if (EMAIL_SEND_AS_DRAFT_RE.test(text)) {
    return {
      intent: "gmail_email_draft",
      confidence: 0.85,
      reason: "email_send_converted_to_draft",
      requestedDirectExecution: true,
    };
  }

  if (BRIEF_RE.test(text)) {
    return {
      intent: "daily_business_brief",
      confidence: 0.8,
      reason: "brief_keywords",
    };
  }

  if (GMAIL_DRAFT_RE.test(text)) {
    return {
      intent: "gmail_email_draft",
      confidence: 0.8,
      reason: "gmail_draft_keywords",
    };
  }

  if (FOLLOWUP_RE.test(text)) {
    return {
      intent: "customer_followup_task",
      confidence: 0.75,
      reason: "followup_keywords",
    };
  }

  return {
    intent: "general_answer",
    confidence: 0.5,
    reason: "default_general",
  };
}

export function isScenarioIntent(
  intent: AssistantIntent,
): intent is
  | "daily_business_brief"
  | "customer_followup_task"
  | "gmail_email_draft" {
  return (
    intent === "daily_business_brief" ||
    intent === "customer_followup_task" ||
    intent === "gmail_email_draft"
  );
}
