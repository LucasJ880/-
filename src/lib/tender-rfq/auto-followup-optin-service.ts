/**
 * RFQ-AUTO-3 个人开关「自动起草的轮次带跟进授权」（DB 侧）
 *
 * 两个功能开关（跟进授权、自动起草）对该组织都打开时这个开关才生效、才能开启；
 * 关闭任何时候都可以（哪怕功能开关关着——不能让一个开着的同意没法撤回）。
 * 本文件不发信、不建审批卡：它只决定之后自动起草的卡「带不带」授权；授权仍然写在卡上、由人批准才生效。
 */
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { isRfqAutoDraftEnabledForOrg } from "./auto-draft-flags";
import {
  AUTO_DRAFT_OPTIN_AUDIT_ACTION,
  AUTO_DRAFT_OPTIN_TARGET,
  optInAuditData,
  optInNeedsWrite,
  optInState,
  parseOptInRecord,
  type OptInState,
} from "./auto-followup-optin";
import { chaseTemplateHash } from "./chase-pure";
import { isRfqFollowUpPreapprovalEnabledForOrg } from "./followup-flags";

/** 这个组织里这个开关现在能不能生效（两个功能开关都打开） */
export function isAutoDraftFollowUpOptInAvailable(orgId: string | null | undefined): boolean {
  return isRfqFollowUpPreapprovalEnabledForOrg(orgId) && isRfqAutoDraftEnabledForOrg(orgId);
}

/** 这个人在这个组织里的开关状态：读他最近一条记录（只读他自己的、只读这个组织的） */
export async function loadAutoDraftFollowUpOptInState(orgId: string, userId: string): Promise<OptInState> {
  const latest = await db.auditLog.findFirst({
    where: { orgId, userId, action: AUTO_DRAFT_OPTIN_AUDIT_ACTION, targetType: AUTO_DRAFT_OPTIN_TARGET, targetId: userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { afterData: true },
  });
  return optInState(parseOptInRecord(latest?.afterData), chaseTemplateHash());
}

/** 自动起草时用：触发起草的这个人的开关现在是否生效。功能开关任一关闭 → false，且不查库。 */
export async function loadAutoDraftFollowUpOptIn(orgId: string, userId: string): Promise<boolean> {
  if (!isAutoDraftFollowUpOptInAvailable(orgId)) return false;
  return (await loadAutoDraftFollowUpOptInState(orgId, userId)) === "on";
}

export type SetOptInResult =
  | { ok: true; state: OptInState; changed: boolean }
  | { ok: false; errorCode: "DISABLED"; message: string };

/**
 * 开启 / 关闭本人的开关。调用方负责项目写权限与「userId 就是登录的那个人」。
 * 开启要求两个功能开关都打开；关闭不要求。状态已经是想要的那样就不写。
 * 写入 = 追加一条记录（记录即状态）：写不进去就算失败，不用吞错的 logAudit。
 */
export async function setAutoDraftFollowUpOptIn(input: { orgId: string; projectId: string; userId: string; enabled: boolean }): Promise<SetOptInResult> {
  if (input.enabled && !isAutoDraftFollowUpOptInAvailable(input.orgId)) {
    return { ok: false, errorCode: "DISABLED", message: "这个开关还没有对你的组织开放。" };
  }
  const current = await loadAutoDraftFollowUpOptInState(input.orgId, input.userId);
  if (!optInNeedsWrite(current, input.enabled)) return { ok: true, state: current, changed: false };
  await writeAuditLog(db, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    action: AUTO_DRAFT_OPTIN_AUDIT_ACTION,
    targetType: AUTO_DRAFT_OPTIN_TARGET,
    targetId: input.userId,
    beforeData: { state: current },
    afterData: optInAuditData(input.enabled, chaseTemplateHash()),
  });
  return { ok: true, state: input.enabled ? "on" : "off", changed: true };
}
