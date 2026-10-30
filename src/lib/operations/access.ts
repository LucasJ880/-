/**
 * PERM-4b：运营 / 增长中心权限判定（唯一入口，路由只调这里）
 *
 * - 判定只看岗位权限键（authorize）；平台 super_admin 由平台管理员绑定覆盖，平台 admin / boss / operations 不带隐含权限
 * - 运营配置：读 operations.read、写 operations.manage
 * - 运营内容：起草 / 提交 operations.content.draft；批准 / 驳回 operations.content.approve（批准不得自批）
 */

import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";

export const OPS_READ = "operations.read";
export const OPS_MANAGE = "operations.manage";
export const OPS_CONTENT_DRAFT = "operations.content.draft";
export const OPS_CONTENT_APPROVE = "operations.content.approve";

/** 持任一键即允许（读接口常写成 [OPS_READ, OPS_MANAGE]） */
export async function holdsOpsPermission(
  user: AuthUser,
  orgId: string,
  keys: string | readonly string[],
): Promise<boolean> {
  for (const permission of typeof keys === "string" ? [keys] : keys) {
    const decision = await authorize({ principal: humanPrincipal(user, orgId), orgId, permission });
    if (decision.allowed) return true;
  }
  return false;
}

/** 无权 → 403 响应；有权 → null */
export async function requireOpsPermission(
  user: AuthUser,
  orgId: string,
  keys: string | readonly string[],
  message: string,
): Promise<NextResponse | null> {
  if (await holdsOpsPermission(user, orgId, keys)) return null;
  return NextResponse.json({ error: message, code: "OPS_PERMISSION_REQUIRED" }, { status: 403 });
}

export const OPS_READ_KEYS = [OPS_READ, OPS_MANAGE] as const;

/**
 * 批准时的自批判定（纯函数）：操作者是提交人 / 创建人 → 拦截；只有平台 super_admin 例外。
 * 作者未知（null）不拦截。
 */
export function selfApprovalBlocked(input: {
  actorId: string;
  authorId: string | null | undefined;
  isPlatformSuperAdmin: boolean;
}): boolean {
  if (input.isPlatformSuperAdmin) return false;
  return Boolean(input.authorId) && input.authorId === input.actorId;
}

export function selfApprovalBlockedFor(user: AuthUser, authorId: string | null | undefined): boolean {
  return selfApprovalBlocked({ actorId: user.id, authorId, isPlatformSuperAdmin: isPlatformSuperAdmin(user.role) });
}

export const SELF_APPROVAL_MESSAGE = "不能批准自己提交 / 创建的内容，请由另一位持批准权的人（运营主管或老板）处理";
