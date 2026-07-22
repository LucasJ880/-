/**
 * Security-1：企业访问模式与切换门禁
 */

import { db } from "@/lib/db";
import type { OrgAccessMode } from "@prisma/client";
import { logAudit } from "@/lib/audit/logger";

export type OrgSwitchErrorCode =
  | "ORG_SWITCH_NOT_ALLOWED"
  | "ORG_MEMBERSHIP_REQUIRED"
  | "ORG_INACTIVE"
  | "ORG_CONTEXT_INVALID";

export type OrgAccessProfile = {
  orgAccessMode: OrgAccessMode;
  canSelfSwitchOrg: boolean;
  activeOrgId: string | null;
};

export async function getOrgAccessProfile(
  userId: string,
): Promise<OrgAccessProfile | null> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: {
      orgAccessMode: true,
      canSelfSwitchOrg: true,
      activeOrgId: true,
    },
  });
  if (!row) return null;
  return {
    orgAccessMode: row.orgAccessMode,
    canSelfSwitchOrg: row.canSelfSwitchOrg,
    activeOrgId: row.activeOrgId,
  };
}

export function canSelfSwitchOrganizations(profile: OrgAccessProfile): boolean {
  return (
    profile.orgAccessMode === "MULTI_ORG" && profile.canSelfSwitchOrg === true
  );
}

/**
 * 切换工作企业（仅 MULTI_ORG + canSelfSwitchOrg）。
 * 目标组织必须有 active membership 且 org 未归档。
 */
export async function switchUserActiveOrg(opts: {
  userId: string;
  targetOrgId: string;
  actorUserId?: string;
}): Promise<
  | { ok: true; activeOrgId: string }
  | { ok: false; code: OrgSwitchErrorCode; message: string }
> {
  const profile = await getOrgAccessProfile(opts.userId);
  if (!profile) {
    return {
      ok: false,
      code: "ORG_CONTEXT_INVALID",
      message: "用户不存在",
    };
  }
  if (!canSelfSwitchOrganizations(profile)) {
    return {
      ok: false,
      code: "ORG_SWITCH_NOT_ALLOWED",
      message: "当前账号不允许自行切换工作企业",
    };
  }

  const org = await db.organization.findUnique({
    where: { id: opts.targetOrgId },
    select: { id: true, status: true, name: true },
  });
  if (!org || org.status === "archived" || org.status === "inactive") {
    return {
      ok: false,
      code: "ORG_INACTIVE",
      message: "目标企业不存在或已停用",
    };
  }

  const membership = await db.organizationMember.findUnique({
    where: {
      orgId_userId: { orgId: opts.targetOrgId, userId: opts.userId },
    },
    select: { status: true, role: true },
  });
  if (!membership || membership.status !== "active") {
    return {
      ok: false,
      code: "ORG_MEMBERSHIP_REQUIRED",
      message: "您不是该企业的有效成员",
    };
  }

  const before = profile.activeOrgId;
  await db.user.update({
    where: { id: opts.userId },
    data: { activeOrgId: opts.targetOrgId },
  });

  await logAudit({
    userId: opts.actorUserId ?? opts.userId,
    orgId: opts.targetOrgId,
    action: "org.switch_active",
    targetType: "organization",
    targetId: opts.targetOrgId,
    beforeData: { activeOrgId: before },
    afterData: {
      activeOrgId: opts.targetOrgId,
      orgAccessMode: profile.orgAccessMode,
    },
  }).catch(() => undefined);

  return { ok: true, activeOrgId: opts.targetOrgId };
}

/** FIXED 用户：若仅有一个 active membership，自动修复 activeOrgId */
export async function ensureFixedUserActiveOrg(
  userId: string,
): Promise<string | null> {
  const profile = await getOrgAccessProfile(userId);
  if (!profile) return null;
  if (profile.orgAccessMode !== "FIXED") {
    return profile.activeOrgId;
  }

  const memberships = await db.organizationMember.findMany({
    where: { userId, status: "active", org: { status: "active" } },
    select: { orgId: true },
    take: 5,
  });
  if (memberships.length === 0) return null;
  if (memberships.length === 1) {
    const only = memberships[0]!.orgId;
    if (profile.activeOrgId !== only) {
      await db.user.update({
        where: { id: userId },
        data: { activeOrgId: only },
      });
    }
    return only;
  }
  // 多 membership 但仍 FIXED：保持 activeOrgId（若无效则清空由调用方处理）
  if (
    profile.activeOrgId &&
    memberships.some((m) => m.orgId === profile.activeOrgId)
  ) {
    return profile.activeOrgId;
  }
  return null;
}
