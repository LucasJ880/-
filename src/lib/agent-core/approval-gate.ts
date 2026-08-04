/**
 * requiresApproval 执行前闸：不调用原工具 executor，只创建 PendingAction 或拒绝。
 */

import { createDraft } from "@/lib/pending-actions/drafts";
import type { PendingActionType } from "@/lib/pending-actions/types";
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./types";

export const APPROVAL_REQUIRED_UNSUPPORTED = "APPROVAL_REQUIRED_UNSUPPORTED";

export type ApprovalGateDeps = {
  createDraftFn?: typeof createDraft;
};

/**
 * 将工具调用安全映射到现有 PendingAction 类型。
 * 无法安全映射 → null（调用方返回 APPROVAL_REQUIRED_UNSUPPORTED）。
 */
export function mapToolCallToPendingAction(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): {
  type: PendingActionType;
  title: string;
  preview: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
} | null {
  // 显式提案结构（工具若仅构造提案而未执行副作用时可由 LLM/桥接传入）
  const proposal = args.pendingActionProposal;
  if (proposal && typeof proposal === "object" && !Array.isArray(proposal)) {
    const p = proposal as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type : "";
    if (
      type === "grader.internal_note" ||
      type === "grader.project_task" ||
      type === "grader.email_draft" ||
      type === "sales.update_followup" ||
      type === "sales.update_stage" ||
      type === "calendar.create_event" ||
      type === "marketing.activate_campaign" ||
      type === "marketing.propose_context_update" ||
      type === "marketing.create_campaign_draft" ||
      type === "marketing.approve_research_plan"
    ) {
      const title =
        typeof p.title === "string" && p.title.trim()
          ? p.title.trim()
          : `待审批：${type}`;
      const preview =
        typeof p.preview === "string" && p.preview.trim()
          ? p.preview.trim()
          : title;
      const payload =
        p.payload && typeof p.payload === "object" && !Array.isArray(p.payload)
          ? (p.payload as Record<string, unknown>)
          : { ...p, type: undefined, title: undefined, preview: undefined };
      const idempotencyKey =
        typeof p.idempotencyKey === "string" && p.idempotencyKey.trim()
          ? p.idempotencyKey.trim()
          : `approval-gate:${ctx.orgId}:${toolName}:${type}:${ctx.agentRunId ?? ctx.sessionId ?? "na"}`;
      return {
        type: type as PendingActionType,
        title,
        preview,
        payload: {
          ...payload,
          metadata: {
            ...((payload.metadata as object) ?? {}),
            orgId: ctx.orgId,
            source: "APPROVAL_GATE",
            toolName,
          },
        },
        idempotencyKey,
      };
    }
  }

  // 项目内部备注的最小安全映射（args 已含 note + projectId）
  if (
    (toolName.includes("internal_note") || toolName.endsWith(".add_note")) &&
    typeof args.note === "string" &&
    (typeof args.projectId === "string" || ctx.scopeGuard?.projectId)
  ) {
    const projectId =
      (typeof args.projectId === "string" && args.projectId) ||
      ctx.scopeGuard?.projectId ||
      "";
    if (!projectId) return null;
    return {
      type: "grader.internal_note",
      title: "待审批：项目内部备注",
      preview: String(args.note).slice(0, 280),
      payload: {
        targetType: "PROJECT",
        targetId: projectId,
        note: String(args.note),
        source: "GRADER",
        metadata: { orgId: ctx.orgId, projectId },
      },
      idempotencyKey: `approval-gate:${ctx.orgId}:${toolName}:grader.internal_note:${projectId}:${ctx.agentRunId ?? "na"}`,
    };
  }

  return null;
}

/**
 * 执行前审批闸：绝不调用 tool.execute。
 */
export async function handleRequiresApproval(input: {
  tool: ToolDefinition;
  ctx: ToolExecutionContext;
  deps?: ApprovalGateDeps;
}): Promise<ToolExecutionResult> {
  const mapped = mapToolCallToPendingAction(
    input.tool.name,
    input.ctx.args ?? {},
    input.ctx,
  );

  if (!mapped) {
    return {
      success: false,
      data: {
        code: APPROVAL_REQUIRED_UNSUPPORTED,
        tool: input.tool.name,
      },
      error: `${APPROVAL_REQUIRED_UNSUPPORTED}: 工具 ${input.tool.name} 需要审批但无法映射到现有 PendingAction`,
    };
  }

  const create = input.deps?.createDraftFn ?? createDraft;
  return create({
    type: mapped.type,
    title: mapped.title,
    preview: mapped.preview,
    payload: mapped.payload,
    userId: input.ctx.userId,
    orgId: input.ctx.orgId,
    projectId:
      input.ctx.scopeGuard?.projectId ??
      (typeof input.ctx.args?.projectId === "string"
        ? input.ctx.args.projectId
        : undefined),
    agentRunId: input.ctx.agentRunId,
    idempotencyKey: mapped.idempotencyKey,
  });
}
