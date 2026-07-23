/**
 * Phase 3B-A：窄意图路由（Commit 3 stub）
 *
 * 策略：宁可归 general_answer，不要误伤现有聊天。
 * 三场景完整编排在后续 Commit；本文件只做保守识别。
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
};

const BRIEF_RE =
  /(今日|今天|每日).{0,6}(简报|业务概览|工作汇总)|(给我|看看|出一份).{0,4}(今日|今天|每日).{0,4}简报|业务简报/;

const FOLLOWUP_RE =
  /(安排|创建|提醒).{0,8}跟进|(客户|商机).{0,8}(跟进|回访)|(下次跟进|跟进日期|跟进提醒)|(加入|写进|放进).{0,4}日历.{0,8}跟进/;

const GMAIL_DRAFT_RE =
  /(写|起草|生成|创建).{0,8}(邮件|gmail).{0,6}草稿|(邮件|gmail).{0,6}草稿|(draft).{0,8}(email|gmail)/i;

/** 明确越权且当前助手不承接的动作 */
const UNSUPPORTED_RE =
  /(直接|马上|立即).{0,4}(发送|发出).{0,6}(邮件|gmail)|帮我发(送)?(这封)?邮件|自动下单|批量删除客户|清空客户/;

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

  if (UNSUPPORTED_RE.test(text)) {
    return {
      intent: "unsupported_action",
      confidence: 0.85,
      reason: "explicit_disallowed_write",
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
