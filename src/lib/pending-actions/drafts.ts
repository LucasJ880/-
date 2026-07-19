/**
 * PR4 — 创建 PendingAction 草稿的 helper
 *
 * 工具层统一通过 createDraft() 创建待审批草稿，
 * 职责：
 * - 落库
 * - 写审计日志
 * - 可选关联 AgentRun（取消 Run 时联动拒绝）
 * - 返回 ToolExecutionResult 给 LLM
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import type { ToolExecutionResult } from "@/lib/agent-core/types";
import type { PendingActionType } from "./types";
import { toPendingApprovalResult } from "./types";

const DEFAULT_TTL_HOURS = 24;

export interface CreateDraftInput {
  type: PendingActionType;
  title: string;
  preview: string;
  payload: Record<string, unknown>;
  userId: string;
  orgId?: string;
  projectId?: string;
  approverUserId?: string;
  requiredRole?: string;
  threadId?: string;
  messageId?: string;
  /** 关联 AgentRun.id */
  agentRunId?: string;
  /** 过期小时数（默认 24） */
  ttlHours?: number;
}

/**
 * 落草稿 → 返回给 LLM 的结构化结果。
 * 调用方直接把返回值作为 ToolExecutionResult 返回即可。
 */
export async function createDraft(
  input: CreateDraftInput,
): Promise<ToolExecutionResult> {
  const ttl = input.ttlHours ?? DEFAULT_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttl * 3600 * 1000);

  const action = await db.pendingAction.create({
    data: {
      type: input.type,
      title: input.title,
      preview: input.preview,
      payload: input.payload as object,
      status: "pending",
      createdById: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
      approverUserId: input.approverUserId,
      requiredRole: input.requiredRole,
      threadId: input.threadId,
      messageId: input.messageId,
      agentRunId: input.agentRunId || null,
      expiresAt,
    },
    select: { id: true, type: true, title: true, preview: true, agentRunId: true },
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    action: "ai_draft_create",
    targetType: "pending_action",
    targetId: action.id,
    afterData: {
      type: action.type,
      title: action.title,
      payload: input.payload,
      agentRunId: action.agentRunId,
    },
  });

  if (action.agentRunId && input.orgId) {
    const { markAgentRunAwaitingApproval } = await import(
      "@/lib/agent-runtime/pending-link"
    );
    await markAgentRunAwaitingApproval(input.orgId, action.agentRunId).catch(
      () => {},
    );
  }

  return {
    success: true,
    data: toPendingApprovalResult(action),
  };
}
