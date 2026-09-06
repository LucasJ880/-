/**
 * PendingAction 系统性作废（SYSTEM SUPERSESSION）— 内部服务端原语，非审批端点。
 *
 * 语义：不是"某人拒绝了草稿"，而是"一条更新的、已核实的真实事件（人工外发 / 客户新来信）
 * 使旧草稿客观上不可再执行，系统据此终止它"。
 *
 * 与既有过期原语（approval/port expireOverdueApprovals、executor 过期分支）同一约定：
 *   status → "failed"，failureReason = 机器可读原因，**不写 decidedById / decidedAt**
 *   （这两列是人类批准/拒绝的决策字段；系统终止绝不伪造或替代人类主体）。
 *
 * 授权来源：调用方路由已认证真实操作者并按 org 作用域校验了线索/商机，且 canonical 的
 * outbound / inbound CustomerInteraction 已存在——不是冒用草稿审批人的身份。
 *
 * B2 风格：pending → failed 的原子 CAS（updateMany where status="pending"）；重复调用与并发
 * 失败方得到确定性结果，绝不产生外部副作用。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import type { PendingActionType } from "./types";

export const SYSTEM_SUPERSESSION_REASON_CODES = [
  "SUPERSEDED_BY_MANUAL_REPLY",
  "SUPERSEDED_BY_NEWER_INBOUND",
] as const;
export type SystemSupersessionReasonCode = (typeof SYSTEM_SUPERSESSION_REASON_CODES)[number];

export const APPROVAL_SYSTEM_SUPERSEDED_AUDIT_ACTION = "APPROVAL_SYSTEM_SUPERSEDED";

export interface SupersessionEvidence {
  /** Trade 侧真实外发消息 */
  tradeMessageId?: string | null;
  /** Revenue Spine 的 outbound CustomerInteraction */
  outboundInteractionId?: string | null;
  /** 客户新来信（inbound CustomerInteraction） */
  inboundInteractionId?: string | null;
  /** 触发作废的 FDE run（若有） */
  agentRunId?: string | null;
}

export interface SupersedePendingActionInput {
  pendingActionId: string;
  orgId: string;
  /** 只允许作废预期类型（防误伤其它审批） */
  expectedType: PendingActionType;
  reasonCode: SystemSupersessionReasonCode;
  /** 真实因果操作者（人工外发的操作者）；客户来信触发时为 null */
  triggeredByUserId: string | null;
  /**
   * AuditLog.userId 有外键、不可空：无真实操作者时用 run 主体等服务端主体承载审计行，
   * 并在 afterData.auditActorSemantics 明示"该用户并未执行动作"。
   */
  auditActorUserId: string;
  evidence: SupersessionEvidence;
}

export type SupersedePendingActionResult =
  | { ok: true; status: "failed"; duplicate: false; reason: string }
  | { ok: true; status: string; duplicate: true; errorCode: "ALREADY_SUPERSEDED" | "ALREADY_REJECTED" | "ALREADY_FAILED" }
  | {
      ok: false;
      errorCode: "NOT_FOUND" | "TYPE_MISMATCH" | "RUN_LINKED" | "EXECUTION_IN_PROGRESS" | "ALREADY_EXECUTED" | "CAS_LOST";
      error: string;
      status?: string;
    };

/** 机器可读 failureReason：`<REASON_CODE> key=value …`（无值的证据省略） */
export function buildSupersessionReason(
  reasonCode: SystemSupersessionReasonCode,
  triggeredByUserId: string | null,
  evidence: SupersessionEvidence,
): string {
  const parts: string[] = [reasonCode];
  if (evidence.tradeMessageId) parts.push(`tradeMessageId=${evidence.tradeMessageId}`);
  if (evidence.outboundInteractionId) parts.push(`outboundInteractionId=${evidence.outboundInteractionId}`);
  if (evidence.inboundInteractionId) parts.push(`inboundInteractionId=${evidence.inboundInteractionId}`);
  if (evidence.agentRunId) parts.push(`agentRunId=${evidence.agentRunId}`);
  parts.push(`triggeredBy=${triggeredByUserId ?? "none"}`);
  parts.push("terminationMode=system_superseded");
  return parts.join(" ");
}

export function isSystemSupersessionReason(failureReason: string | null | undefined): boolean {
  if (!failureReason) return false;
  return SYSTEM_SUPERSESSION_REASON_CODES.some((code) => failureReason.startsWith(code));
}

function duplicateResult(status: string, failureReason: string | null): SupersedePendingActionResult {
  switch (status) {
    case "failed":
      return isSystemSupersessionReason(failureReason)
        ? { ok: true, status, duplicate: true, errorCode: "ALREADY_SUPERSEDED" }
        : { ok: true, status, duplicate: true, errorCode: "ALREADY_FAILED" };
    case "rejected":
      return { ok: true, status, duplicate: true, errorCode: "ALREADY_REJECTED" };
    case "executed":
      return { ok: false, errorCode: "ALREADY_EXECUTED", error: "草稿已执行，客户已收到该回复，无法作废", status };
    case "approved":
      return { ok: false, errorCode: "EXECUTION_IN_PROGRESS", error: "草稿正在执行中，无法作废（executor 发送前另有 STALE_DRAFT 闸）", status };
    default:
      return { ok: false, errorCode: "CAS_LOST", error: `草稿状态为 ${status}，无法作废`, status };
  }
}

export async function supersedePendingAction(input: SupersedePendingActionInput): Promise<SupersedePendingActionResult> {
  const row = await db.pendingAction.findFirst({
    where: { id: input.pendingActionId, orgId: input.orgId },
    select: { id: true, type: true, status: true, agentRunId: true, failureReason: true },
  });
  // 跨组织 / 不存在：fail-closed，不泄露存在性
  if (!row) return { ok: false, errorCode: "NOT_FOUND", error: "草稿不存在或不属于本组织" };
  if (row.type !== input.expectedType) {
    return { ok: false, errorCode: "TYPE_MISMATCH", error: `草稿类型 ${row.type} 不是预期的 ${input.expectedType}`, status: row.status };
  }
  // 挂在会话 run 上的草稿由 run 生命周期（取消 / reconcile）终止，本原语不介入
  if (row.agentRunId) {
    return { ok: false, errorCode: "RUN_LINKED", error: "草稿关联 AgentRun，由 run 生命周期终止", status: row.status };
  }
  if (row.status !== "pending") return duplicateResult(row.status, row.failureReason);

  const reason = buildSupersessionReason(input.reasonCode, input.triggeredByUserId, input.evidence);
  const res = await db.pendingAction.updateMany({
    where: { id: row.id, orgId: input.orgId, type: input.expectedType, status: "pending" },
    data: { status: "failed", failureReason: reason },
  });
  if (res.count !== 1) {
    const latest = await db.pendingAction.findUnique({ where: { id: row.id }, select: { status: true, failureReason: true } });
    if (!latest) return { ok: false, errorCode: "NOT_FOUND", error: "草稿不存在" };
    return duplicateResult(latest.status, latest.failureReason);
  }

  await logAudit({
    userId: input.auditActorUserId,
    orgId: input.orgId,
    action: APPROVAL_SYSTEM_SUPERSEDED_AUDIT_ACTION,
    targetType: "pending_action",
    targetId: row.id,
    beforeData: { status: "pending" },
    afterData: {
      terminationMode: "system_superseded",
      reasonCode: input.reasonCode,
      triggeredByUserId: input.triggeredByUserId,
      auditActorSemantics: input.triggeredByUserId ? "triggered_by_user" : "run_principal_not_actor",
      decidedById: null,
      expectedType: input.expectedType,
      tradeMessageId: input.evidence.tradeMessageId ?? null,
      outboundInteractionId: input.evidence.outboundInteractionId ?? null,
      inboundInteractionId: input.evidence.inboundInteractionId ?? null,
      agentRunId: input.evidence.agentRunId ?? null,
      newStatus: "failed",
      failureReason: reason,
    },
  });

  return { ok: true, status: "failed", duplicate: false, reason };
}
