/**
 * P0-1 审批闸：requiresApproval=true 时绝不调用原工具 executor。
 *
 * 出口只有两个：
 * 1. 可安全映射到现有 PendingAction 类型 → createDraft（复用既有审批/执行链）
 * 2. 无法映射 → 明确失败（APPROVAL_REQUIRED_UNSUPPORTED），fail-closed
 *
 * 复用现有 PendingAction + ApprovalPort，不新建第二套审批系统。
 * 参考 Draft PR #52 approval-gate.ts，适配当前 main。
 */

import { createDraft } from "@/lib/pending-actions/drafts";
import type { PendingActionType } from "@/lib/pending-actions/types";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export const APPROVAL_REQUIRED_UNSUPPORTED = "APPROVAL_REQUIRED_UNSUPPORTED";

const MAPPABLE_PROPOSAL_TYPES: ReadonlySet<string> = new Set([
  "grader.internal_note",
  "grader.project_task",
  "grader.email_draft",
  "sales.update_followup",
  "sales.update_stage",
  "calendar.create_event",
  "marketing.activate_campaign",
  "marketing.propose_context_update",
  "marketing.create_campaign_draft",
  "marketing.approve_research_plan",
]);

export type ApprovalGateDeps = {
  createDraftFn?: typeof createDraft;
};

/**
 * 将工具调用安全映射到现有 PendingAction 类型；无法映射 → null。
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
  // 显式提案结构（工具/桥接层构造 proposal 而非直接副作用时）
  const proposal = args.pendingActionProposal;
  if (proposal && typeof proposal === "object" && !Array.isArray(proposal)) {
    const p = proposal as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type : "";
    if (MAPPABLE_PROPOSAL_TYPES.has(type)) {
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

  // 项目内部备注的最小安全映射
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
        message:
          "该操作需要人工审批。请通过对应业务界面发起，或让 AI 先生成草稿供你确认。",
      },
      error: `${APPROVAL_REQUIRED_UNSUPPORTED}: 工具 ${input.tool.name} 需要审批且无法映射到现有 PendingAction，已阻止直接执行`,
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
