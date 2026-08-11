// ============================================================
// Corporate Memory — org 级读写鉴权（T3）
//
// MEMORY_WRITE_PERMISSION = CONSERVATIVE_ADMIN_ONLY：
//   写 = platform admin（isSuperAdmin）或该 org 的 org_owner/org_admin 活跃成员；
//   读 = platform admin 或该 org 任意活跃成员。
// orgId 一律由已授权上下文显式传入并在本层复核成员资格；
// 任何 client 侧声称的 orgId（spoof）在此被拒（BUYER-05）。
// ============================================================

import { db } from "@/lib/db";
import { hasOrgRole, isSuperAdmin } from "@/lib/rbac/roles";
import { CorporateMemoryError, type MemoryActorInput } from "./types";

export interface MemoryAccessContext {
  orgId: string;
  userId: string;
  /// platform_admin | org_admin | org_member
  via: "platform_admin" | "org_admin" | "org_member";
}

interface AccessParams {
  orgId: string;
  actor: MemoryActorInput;
}

function invalidActor(message: string, forWrite: boolean): CorporateMemoryError {
  return new CorporateMemoryError(
    forWrite ? "MEMORY_WRITE_FORBIDDEN" : "MEMORY_READ_FORBIDDEN",
    message,
  );
}

async function resolveAccess(
  { orgId, actor }: AccessParams,
  forWrite: boolean,
): Promise<MemoryAccessContext> {
  if (!orgId || typeof orgId !== "string") {
    throw invalidActor("orgId 必填", forWrite);
  }
  if (!actor || typeof actor.userId !== "string" || !actor.userId.trim()) {
    throw invalidActor("actor.userId 必填", forWrite);
  }
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== "active") {
    throw invalidActor("actor 不存在或未激活", forWrite);
  }
  if (isSuperAdmin(user.role)) {
    return { orgId, userId: user.id, via: "platform_admin" };
  }
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: user.id } },
    select: { role: true, status: true },
  });
  if (!membership || membership.status !== "active") {
    throw invalidActor("actor 不是该组织的活跃成员", forWrite);
  }
  if (forWrite && !hasOrgRole(membership.role, "org_admin")) {
    throw invalidActor(
      "Corporate Memory 写入仅限组织管理员（CONSERVATIVE_ADMIN_ONLY）",
      true,
    );
  }
  return {
    orgId,
    userId: user.id,
    via: forWrite || hasOrgRole(membership.role, "org_admin") ? "org_admin" : "org_member",
  };
}

/** 写入门：platform admin 或 org_owner/org_admin；其余一律 MEMORY_WRITE_FORBIDDEN。 */
export async function requireMemoryWriteAccess(
  params: AccessParams,
): Promise<MemoryAccessContext> {
  return resolveAccess(params, true);
}

/** 读取门：platform admin 或该 org 任意活跃成员；cross-org 读取一律 MEMORY_READ_FORBIDDEN。 */
export async function requireMemoryReadAccess(
  params: AccessParams,
): Promise<MemoryAccessContext> {
  return resolveAccess(params, false);
}
