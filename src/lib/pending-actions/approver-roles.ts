/**
 * 按动作类型的批准角色门（认领前判定）— 纯函数，无 DB
 *
 * 通用门 canDecideTeamApproval（超管 / 指定审批人 / 组织所有者 / org_admin / 项目负责人）之外，
 * 少数类型还要求平台角色。必须在 CAS 认领之前判定：认领后才失败会把审批变成 failed，等于替人驳回。
 * 只管批准；驳回仍走既有审批权限（rejectPendingAction）。
 */

import { isAdmin } from "@/lib/rbac/roles";
import type { PendingActionType } from "./types";

/** B-2：商务事实提案（D-3：审批角色 admin / boss） */
export const FACT_PROPOSAL_ACTION_TYPE = "revenue_spine.propose_commercial_fact" as const satisfies PendingActionType;
export const FACT_PROPOSAL_DENIED = "仅企业负责人或管理员可批准商务事实提案";

/** 与 PUT /api/revenue/policy 同一规则：平台 admin / super_admin / boss */
export function canApproveCommercialFact(role: string | null | undefined): boolean {
  return isAdmin(role) || role === "boss";
}

/** 无权批准时返回给调用方的错误文案；有权或该类型没有额外角色门时返回 null */
export function approverRoleDenial(type: string, role: string | null | undefined): string | null {
  if (type === FACT_PROPOSAL_ACTION_TYPE && !canApproveCommercialFact(role)) return FACT_PROPOSAL_DENIED;
  return null;
}
