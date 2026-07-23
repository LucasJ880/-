/**
 * Phase 3B-A：场景编排结果类型（应用层，无新表）
 */

export type ScenarioErrorCode =
  | "CUSTOMER_NOT_FOUND"
  | "CUSTOMER_AMBIGUOUS"
  | "OPPORTUNITY_NOT_FOUND"
  | "OPPORTUNITY_AMBIGUOUS"
  | "FOLLOWUP_TIME_REQUIRED"
  | "RECIPIENT_REQUIRED"
  | "RECIPIENT_AMBIGUOUS"
  | "PERMISSION_DENIED"
  | "ORG_CONTEXT_INVALID"
  | "GRADER_FAILED"
  | "DRAFT_CREATION_FAILED"
  | "UNSUPPORTED_ASSIGNEE";

export type PendingActionPreview = {
  id: string;
  type: string;
  title: string;
  preview: string;
};

export type AssistantScenarioResult =
  | {
      kind: "completed";
      assistantContent: string;
      resultSummary: string;
      workSuggestion?: Record<string, unknown>;
    }
  | {
      kind: "approval_required";
      assistantContent: string;
      pendingActions: PendingActionPreview[];
      resultSummary: string;
    }
  | {
      kind: "clarification_required";
      assistantContent: string;
      missingFields: string[];
    }
  | {
      kind: "failed";
      assistantContent: string;
      errorCode: ScenarioErrorCode | string;
    };

export type ScenarioContext = {
  orgId: string;
  userId: string;
  role: string;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  agentRunId: string;
  message: string;
  requestedDirectExecution?: boolean;
};

export function friendlyScenarioError(code: string): string {
  switch (code) {
    case "CUSTOMER_NOT_FOUND":
      return "找不到你提到的客户，请确认客户名称或换一种说法。";
    case "CUSTOMER_AMBIGUOUS":
      return "找到多个匹配的客户，请告诉我具体是哪一个。";
    case "OPPORTUNITY_NOT_FOUND":
      return "找不到对应的商机。";
    case "OPPORTUNITY_AMBIGUOUS":
      return "该客户有多个商机，请告诉我要更新哪一个。";
    case "FOLLOWUP_TIME_REQUIRED":
      return "请提供明确的日期或时间（例如：周五下午两点）。";
    case "RECIPIENT_REQUIRED":
      return "请提供收件人邮箱，或指定唯一的客户联系人。";
    case "RECIPIENT_AMBIGUOUS":
      return "找到多个可用收件人，请指定邮箱或唯一联系人。";
    case "PERMISSION_DENIED":
      return "当前账号无权执行该操作。";
    case "ORG_CONTEXT_INVALID":
      return "组织上下文无效，请重新选择当前企业后重试。";
    case "GRADER_FAILED":
      return "生成简报时出错，请稍后再试。";
    case "DRAFT_CREATION_FAILED":
      return "创建待确认草稿失败，请稍后再试。";
    case "UNSUPPORTED_ASSIGNEE":
      return "当前阶段只能在你自己的日历创建提醒，不能替其他成员创建任务。";
    case "GMAIL_DRAFT_DISABLED":
      return "Gmail 草稿功能未开启。请联系管理员启用后再试。";
    case "GMAIL_REAUTH_REQUIRED":
      return "当前 Gmail 授权缺少草稿权限，请到设置页重新授权后再确认。";
    default:
      return "处理失败，请稍后再试。";
  }
}
