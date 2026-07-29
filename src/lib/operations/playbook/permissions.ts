/**
 * Playbook 权限（服务端强制）
 *
 * - Boss/Admin：创建、修改、提交、批准、驳回、归档
 * - Operations：创建、修改草稿、AI 生成、提交；不得批准
 * - Sales：默认只读
 * - AI：仅草稿（由服务端代写 createdBy）
 */

import { isAdmin, isBoss } from "@/lib/rbac/roles";

export function canApprovePlaybook(role: string | null | undefined): boolean {
  return isAdmin(role ?? "") || isBoss(role);
}

export function canEditPlaybookDraft(role: string | null | undefined): boolean {
  if (canApprovePlaybook(role)) return true;
  return role === "operations" || role === "manager";
}

export function canSubmitPlaybook(role: string | null | undefined): boolean {
  return canEditPlaybookDraft(role);
}

export function canReadPlaybook(role: string | null | undefined): boolean {
  if (canEditPlaybookDraft(role)) return true;
  return (
    role === "sales" ||
    role === "trade" ||
    role === "user" ||
    role === "manager" ||
    Boolean(role)
  );
}

export function assertCanApprovePlaybook(input: {
  role: string | null | undefined;
  actorUserId: string;
  submittedById: string | null | undefined;
}): { ok: true } | { ok: false; error: string } {
  if (!canApprovePlaybook(input.role)) {
    return {
      ok: false,
      error: "仅 Boss/Admin 可批准/驳回 Playbook（运营人员不可批准，含不可自批）",
    };
  }
  // 防御：即使角色误配，operations 也不得自批
  if (
    input.role === "operations" &&
    input.submittedById &&
    input.actorUserId === input.submittedById
  ) {
    return { ok: false, error: "运营人员不得批准自己的 Playbook" };
  }
  return { ok: true };
}
