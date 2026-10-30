/**
 * 按动作类型的批准角色门（认领前判定）— 纯函数，无 DB
 *
 * 通用门 canDecideTeamApproval（超管 / 指定审批人 / 组织所有者 / org_admin / 项目负责人）之外，
 * 少数类型还要求额外权限（商务事实提案：平台 super_admin 或企业内 trade.settings.manage）。必须在 CAS 认领之前判定：认领后才失败会把审批变成 failed，等于替人驳回。
 * 只管批准；驳回仍走既有审批权限（rejectPendingAction）。
 *
 * 平台角色必须按 userId 读 User.role：调用方传进执行器的 ctx.role 不统一——
 * 审批中心（capabilities/approvals/decision.ts）传的是组织成员角色 org_owner / org_admin / org_member，
 * 助手收件箱传的是平台角色。拿 ctx.role 判会让审批中心里谁都批不了。
 */

import { isSuperAdmin } from "@/lib/rbac/roles";
import type { PendingActionType } from "./types";

/** B-2：商务事实提案 */
export const FACT_PROPOSAL_ACTION_TYPE = "revenue_spine.propose_commercial_fact" as const satisfies PendingActionType;
export const FACT_PROPOSAL_DENIED = "仅企业负责人或管理员可批准商务事实提案";
/**
 * 与 PUT /api/revenue/policy 同源（PERM-6c 起该接口按 trade.settings.manage）：企业负责人 / 管理员岗位持有此键。
 * 与 trade/access 的 TRADE_SETTINGS_MANAGE 相同（测试断言），这里写字面量以保持本文件无 DB / 无服务端依赖。
 */
export const FACT_PROPOSAL_APPROVER_PERMISSION = "trade.settings.manage" as const;

/** 批准人事实：平台角色（User.role）+ 是否在动作所属企业持 FACT_PROPOSAL_APPROVER_PERMISSION（调用方按 userId + orgId 判定） */
export interface FactApproverFacts {
  platformRole: string | null | undefined;
  holdsSettingsKey: boolean;
}

/** 平台 super_admin，或在该企业持 trade.settings.manage（合并 PERM-6c / 7b 后：平台 admin 已退役，平台 boss 不再单独放行） */
export function canApproveCommercialFact(approver: FactApproverFacts): boolean {
  return isSuperAdmin(approver.platformRole) || approver.holdsSettingsKey;
}

/** 该类型批准时是否要按批准人的平台角色 + 岗位键再判一次 */
export function requiresApproverPermissionGate(type: string): boolean {
  return type === FACT_PROPOSAL_ACTION_TYPE;
}

/** 无权批准时返回给调用方的错误文案；有权或该类型没有额外权限门时返回 null */
export function approverRoleDenial(type: string, approver: FactApproverFacts): string | null {
  if (type === FACT_PROPOSAL_ACTION_TYPE && !canApproveCommercialFact(approver)) return FACT_PROPOSAL_DENIED;
  return null;
}
