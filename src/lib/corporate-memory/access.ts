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
import {
  CorporateMemoryError,
  MEMBER_VISIBLE_ACCESS_CLASSES,
  MEMORY_ACCESS_CLASSES,
  type MemoryAccessClass,
  type MemoryActorInput,
} from "./types";

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

/**
 * Server-authoritative 可见分级集（§35 强化）：由已鉴权上下文的角色决定，
 * **不接受任何 client 输入**。org_admin / platform_admin = 全部分级；
 * org_member = 仅 PUBLIC_SOURCE + INTERNAL_COMPANY。
 */
export function serverAllowedAccessClasses(
  ctx: MemoryAccessContext,
): MemoryAccessClass[] {
  if (ctx.via === "platform_admin" || ctx.via === "org_admin") {
    return [...MEMORY_ACCESS_CLASSES];
  }
  return [...MEMBER_VISIBLE_ACCESS_CLASSES];
}

/**
 * 有效可见分级 = server 授权集 ∩ caller 请求（**caller 只能收窄，绝不可扩展**）。
 * caller 未传 → 用 server 授权集；caller 传入越权分级 → 被交集自然剔除
 * （不报错、不泄漏，返回相应缩小集；请求纯越权集时为空集 → 零结果）。
 */
export function effectiveAccessClasses(
  ctx: MemoryAccessContext,
  callerRequested?: readonly MemoryAccessClass[] | null,
): MemoryAccessClass[] {
  const server = serverAllowedAccessClasses(ctx);
  if (!callerRequested) return server;
  const serverSet = new Set<MemoryAccessClass>(server);
  return callerRequested.filter((c) => serverSet.has(c));
}
