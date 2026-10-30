/**
 * Playbook 权限（服务端强制）—— PERM-4b：按岗位权限键，不看平台角色
 *
 * - 读：operations.read（或 operations.manage）
 * - 新建 / 改草稿 / AI 草稿 / 提交：operations.content.draft（运营人员、运营主管）
 * - 批准 / 驳回：operations.content.approve（运营主管、老板）；批准时提交人不得自批（平台 super_admin 例外）
 * - AI：仅草稿（由服务端代写 createdBy）
 */

import type { AuthUser } from "@/lib/auth";
import {
  OPS_CONTENT_APPROVE,
  OPS_CONTENT_DRAFT,
  OPS_READ_KEYS,
  SELF_APPROVAL_MESSAGE,
  holdsOpsPermission,
  selfApprovalBlockedFor,
} from "@/lib/operations/access";

export function canApprovePlaybook(user: AuthUser, orgId: string): Promise<boolean> {
  return holdsOpsPermission(user, orgId, OPS_CONTENT_APPROVE);
}

export function canEditPlaybookDraft(user: AuthUser, orgId: string): Promise<boolean> {
  return holdsOpsPermission(user, orgId, OPS_CONTENT_DRAFT);
}

export function canSubmitPlaybook(user: AuthUser, orgId: string): Promise<boolean> {
  return holdsOpsPermission(user, orgId, OPS_CONTENT_DRAFT);
}

export function canReadPlaybook(user: AuthUser, orgId: string): Promise<boolean> {
  return holdsOpsPermission(user, orgId, OPS_READ_KEYS);
}

export async function assertCanApprovePlaybook(input: {
  user: AuthUser;
  orgId: string;
  submittedById: string | null | undefined;
  action: "approve" | "reject";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await canApprovePlaybook(input.user, input.orgId))) {
    return { ok: false, error: "需要运营批准权限（运营主管或老板岗位）才能批准 / 驳回 Playbook" };
  }
  // 驳回只撤下内容，提交人可驳回自己的；批准不得自批
  if (input.action === "approve" && selfApprovalBlockedFor(input.user, input.submittedById)) {
    return { ok: false, error: SELF_APPROVAL_MESSAGE };
  }
  return { ok: true };
}
