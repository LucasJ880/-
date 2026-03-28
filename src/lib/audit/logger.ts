import { NextRequest } from "next/server";
import { db } from "@/lib/db";

// ============================================================
// 审计日志工具
// ============================================================

export interface AuditLogParams {
  userId: string;
  orgId?: string | null;
  projectId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  request?: NextRequest;
}

/**
 * 记录审计日志
 *
 * @example
 * await logAudit({
 *   userId: user.id,
 *   orgId: org.id,
 *   action: "create",
 *   targetType: "project",
 *   targetId: project.id,
 *   afterData: project,
 *   request,
 * });
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  const {
    userId,
    orgId,
    projectId,
    action,
    targetType,
    targetId,
    beforeData,
    afterData,
    request,
  } = params;

  try {
    await db.auditLog.create({
      data: {
        userId,
        orgId: orgId ?? undefined,
        projectId: projectId ?? undefined,
        action,
        targetType,
        targetId: targetId ?? undefined,
        beforeData: beforeData ? JSON.stringify(beforeData) : undefined,
        afterData: afterData ? JSON.stringify(afterData) : undefined,
        ip: extractIp(request),
        userAgent: request?.headers.get("user-agent") ?? undefined,
      },
    });
  } catch (err) {
    console.error("[AuditLog] Failed to write audit log:", err);
  }
}

function extractIp(request?: NextRequest): string | undefined {
  if (!request) return undefined;
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    undefined
  );
}

// --- 常用 action 常量 ---

export const AUDIT_ACTIONS = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  LOGIN: "login",
  LOGOUT: "logout",
  INVITE: "invite",
  REMOVE: "remove",
  ROLE_CHANGE: "role_change",
  STATUS_CHANGE: "status_change",
  EXPORT: "export",
  RUNTIME_RUN: "runtime_run",
  RUNTIME_TOOL: "runtime_tool",
  RUNTIME_FAIL: "runtime_fail",
  CREATE_CONVERSATION_FEEDBACK: "create_conversation_feedback",
  UPDATE_CONVERSATION_FEEDBACK: "update_conversation_feedback",
  CREATE_MESSAGE_FEEDBACK: "create_message_feedback",
  UPDATE_MESSAGE_FEEDBACK: "update_message_feedback",
  CREATE_EVALUATION_TAG: "create_evaluation_tag",
  UPDATE_EVALUATION_TAG: "update_evaluation_tag",
  EXTERNAL_SYNC: "external_sync",
  WEBHOOK_DISPATCH: "webhook_dispatch",
  ABANDON_PROJECT: "abandon_project",
  DISPATCH_PROJECT: "dispatch_project",
  ASSIGN_OWNER: "assign_owner",
  ASSIGN_MEMBERS: "assign_members",
  AI_GENERATE: "ai_generate",
  AI_SEND: "ai_send",
  AI_ANALYZE: "ai_analyze",
} as const;

// --- 常用 targetType 常量 ---

export const AUDIT_TARGETS = {
  USER: "user",
  ORG: "organization",
  ORG_MEMBER: "organization_member",
  PROJECT: "project",
  PROJECT_MEMBER: "project_member",
  ENVIRONMENT: "environment",
  TASK: "task",
  CALENDAR_EVENT: "calendar_event",
  BLINDS_ORDER: "blinds_order",
  PROMPT: "prompt",
  KNOWLEDGE_BASE: "knowledge_base",
  KNOWLEDGE_DOCUMENT: "knowledge_document",
  CONVERSATION: "conversation",
  MESSAGE: "message",
  AGENT: "agent",
  TOOL: "tool",
  TOOL_TRACE: "tool_trace",
  RUNTIME: "runtime",
  CONVERSATION_FEEDBACK: "conversation_feedback",
  MESSAGE_FEEDBACK: "message_feedback",
  EVALUATION_TAG: "evaluation_tag",
  EXTERNAL_REF: "external_reference",
  API_TOKEN: "api_token",
  WEBHOOK: "webhook_endpoint",
  PROJECT_EMAIL: "project_email",
  PROJECT_QUESTION: "project_question",
  REPORT: "report",
  QUOTE_ANALYSIS: "quote_analysis",
} as const;
