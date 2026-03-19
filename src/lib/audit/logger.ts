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
} as const;
