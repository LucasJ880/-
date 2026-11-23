/**
 * CHAIN-2c 更换项目负责人：服务端读取（调用人的身份、新负责人是否合格、带条件的写入）
 * 纯判定与文字在 owner-change.ts。
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";
import { hasOrgRole, isSuperAdmin } from "@/lib/rbac/roles";
import { resolveFinancePrivilege } from "@/lib/project-finance/access";
import { checkNewOwner, decideOwnerChange, OWNER_CHANGE_TEXT, type OwnerChangeActor } from "./owner-change";

type ActorUser = Parameters<typeof resolveFinancePrivilege>[0];

/**
 * 调用人在这个项目上的身份。财务特权用 resolveFinancePrivilege(user, orgId, null).privileged
 * （不把「是负责人」算进去：平台超级管理员或组织范围 project.finance.manage），与项目财务接口同一口径。
 * isManager 不传时按「本组织 org_admin 以上的有效成员」算；执行项目接口传入它自己的「能管理执行项目」。
 */
export async function resolveOwnerChangeActor(user: ActorUser, orgId: string | null, opts: { isManager?: boolean } = {}): Promise<OwnerChangeActor> {
  const superAdmin = isSuperAdmin(user.role);
  if (!orgId) return { actorUserId: user.id, isSuperAdmin: superAdmin, hasFinancePrivilege: superAdmin, isManager: false, hasOrg: false };
  const [finance, membership] = await Promise.all([
    resolveFinancePrivilege(user, orgId, null),
    opts.isManager === undefined ? getOrgMembership(user.id, orgId) : Promise.resolve(null),
  ]);
  const isManager = opts.isManager ?? (membership?.status === "active" && hasOrgRole(membership.role, "org_admin"));
  return { actorUserId: user.id, isSuperAdmin: superAdmin, hasFinancePrivilege: finance.privileged, isManager, hasOrg: true };
}

/** 新负责人：在用的用户；有组织时还要是该组织的有效成员 */
export async function checkNewOwnerInDb(targetUserId: string, orgId: string | null) {
  const [target, member] = await Promise.all([
    db.user.findUnique({ where: { id: targetUserId }, select: { status: true } }),
    orgId ? db.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId: targetUserId } }, select: { status: true } }) : Promise.resolve(null),
  ]);
  return checkNewOwner({ hasOrg: !!orgId, userActive: target?.status === "active", orgMemberActive: member?.status === "active" });
}

/**
 * 先判权限（403）再判新负责人（400）；负责人不变返回 { changed: false }。
 * 返回 NextResponse 表示整个请求要以它结束。
 */
export async function guardOwnerChange(input: {
  user: ActorUser;
  orgId: string | null;
  currentOwnerId: string;
  targetUserId: string;
  isManager?: boolean;
  /** 加成员接口自己先校验目标（沿用原来的话），这里只判权限 */
  skipTargetCheck?: boolean;
}): Promise<{ changed: boolean } | NextResponse> {
  if (input.targetUserId === input.currentOwnerId) return { changed: false };
  const actor = await resolveOwnerChangeActor(input.user, input.orgId, { isManager: input.isManager });
  const d = decideOwnerChange(actor, input.currentOwnerId, input.targetUserId);
  if (!d.ok) return NextResponse.json({ error: d.messageZh, code: d.code }, { status: d.status });
  if (input.skipTargetCheck) return { changed: true };
  const target = await checkNewOwnerInDb(input.targetUserId, input.orgId);
  if (!target.ok) return NextResponse.json({ error: target.messageZh, code: target.code }, { status: target.status });
  return { changed: true };
}

export class OwnerChangeConflict extends Error {}

/** 只在负责人还是 expectedOwnerId 时写入；同时有人改过 → 抛 OwnerChangeConflict（调用方回 409） */
export async function writeOwnerIfUnchanged(tx: Prisma.TransactionClient, projectId: string, expectedOwnerId: string, newOwnerId: string): Promise<void> {
  const r = await tx.project.updateMany({ where: { id: projectId, ownerId: expectedOwnerId }, data: { ownerId: newOwnerId } });
  if (r.count !== 1) throw new OwnerChangeConflict(projectId);
}

export function ownerConflictResponse(): NextResponse {
  return NextResponse.json({ error: OWNER_CHANGE_TEXT.conflict, code: "OWNER_CONFLICT" }, { status: 409 });
}
