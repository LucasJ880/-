/**
 * PERM-5b：数字员工发起的审批（design D5）
 *
 * - 先解析数字员工主体（Agent active / 本企业 / sponsor 是 active 成员），失败不建审批
 * - PendingAction 归属与审批人都是 sponsor（人），执行者类型 agent；审批人永远不是 Agent id
 * - payload.metadata._digitalEmployee 记录 Agent / 岗位 / sponsor，供审计与审批中心展示
 * 批准前零出站：这里只建 PendingAction，副作用仍由 pending-actions/executor 在批准后执行。
 */

import {
  resolveDigitalEmployeePrincipal,
  isDigitalEmployeePositionKey,
  type DigitalEmployeeResolveFailure,
} from "@/lib/authorization/digital-employee";
import {
  buildPendingActionDraftInput,
  requestApproval,
  type CanonicalApprovalRequestInput,
  type RequestApprovalResult,
} from "./request";

export type DigitalEmployeeApprovalInput = Omit<CanonicalApprovalRequestInput, "principal" | "approver"> & {
  agentId: string;
  positionKey: string;
};

export type DigitalEmployeeApprovalResult =
  | RequestApprovalResult
  | {
      ok: false;
      kind: "pending_action";
      errorCode: DigitalEmployeeResolveFailure | "POSITION_NOT_ALLOWED";
      error: string;
    };

/** 纯映射：把数字员工审批落成 canonical 输入（归属 / 审批人 = sponsor） */
export function buildDigitalEmployeeApprovalInput(
  input: DigitalEmployeeApprovalInput,
  resolved: { agentId: string; agentName: string; sponsorUserId: string },
): CanonicalApprovalRequestInput {
  const { positionKey, ...withAgent } = input;
  const rest: Omit<DigitalEmployeeApprovalInput, "agentId" | "positionKey"> = {
    ...withAgent,
  };
  delete (rest as { agentId?: string }).agentId;
  const priorMetadata =
    typeof rest.payload.metadata === "object" && rest.payload.metadata !== null
      ? (rest.payload.metadata as Record<string, unknown>)
      : {};
  return {
    ...rest,
    principal: { userId: resolved.sponsorUserId, actorType: "agent" },
    approver: { approverUserId: resolved.sponsorUserId },
    payload: {
      ...rest.payload,
      metadata: {
        ...priorMetadata,
        _digitalEmployee: {
          agentId: resolved.agentId,
          agentName: resolved.agentName,
          positionKey,
          sponsorUserId: resolved.sponsorUserId,
        },
      },
    },
  };
}

export async function requestDigitalEmployeeApproval(
  input: DigitalEmployeeApprovalInput,
): Promise<DigitalEmployeeApprovalResult> {
  if (!isDigitalEmployeePositionKey(input.positionKey)) {
    return { ok: false, kind: "pending_action", errorCode: "POSITION_NOT_ALLOWED", error: `数字员工不能代岗位 ${input.positionKey}` };
  }
  const resolved = await resolveDigitalEmployeePrincipal({ agentId: input.agentId, orgId: input.orgId });
  if (!resolved.ok) {
    return { ok: false, kind: "pending_action", errorCode: resolved.reasonCode, error: `数字员工不可用：${resolved.reasonCode}` };
  }
  const sponsorUserId = resolved.principal.sponsorUserId!;
  const canonical = buildDigitalEmployeeApprovalInput(input, {
    agentId: resolved.agent.id,
    agentName: resolved.agent.name,
    sponsorUserId,
  });
  // 防御：审批人永远是人（sponsor），不可能是 Agent 本身
  if (buildPendingActionDraftInput(canonical).draft.approverUserId === input.agentId) {
    return { ok: false, kind: "pending_action", errorCode: "INVALID_REQUEST", error: "审批人不能是数字员工" };
  }
  return requestApproval(canonical);
}
