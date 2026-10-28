/**
 * Security-1：为单个企业 seed 系统 RoleProfile / PositionTemplate / 负责人绑定
 */

import { db } from "@/lib/db";
import {
  SYSTEM_POSITION_TEMPLATES,
  SYSTEM_ROLE_PROFILES,
  positionTemplatesForIndustryPack,
  profilesForIndustryPack,
} from "./role-defaults";

export async function seedOrgAuthorizationProfiles(orgId: string): Promise<{
  profiles: number;
  bindings: number;
  positions: number;
  ownerAssigned: boolean;
}> {
  let profiles = 0;
  let bindings = 0;
  let positions = 0;

  const profileIdByKey = new Map<string, string>();

  // PERM-1：行业包岗位模板集（窗饰企业追加 owner / pricing_lead / ... ；非窗饰企业为空）
  const orgRow = await db.organization.findUnique({
    where: { id: orgId },
    select: { industryPackId: true },
  });
  const industryPackId = orgRow?.industryPackId ?? null;
  const allProfiles = [...SYSTEM_ROLE_PROFILES, ...profilesForIndustryPack(industryPackId)];
  const allTemplates = [...SYSTEM_POSITION_TEMPLATES, ...positionTemplatesForIndustryPack(industryPackId)];

  for (const p of allProfiles) {
    const row = await db.roleProfile.upsert({
      where: { orgId_key: { orgId, key: p.key } },
      create: {
        orgId,
        key: p.key,
        name: p.name,
        description: p.description,
        principalType: "HUMAN",
        isSystem: true,
        status: "active",
      },
      update: {
        name: p.name,
        description: p.description,
        status: "active",
        isSystem: true,
      },
    });
    profileIdByKey.set(p.key, row.id);
    profiles += 1;

    for (const b of p.bindings) {
      await db.rolePermissionBinding.upsert({
        where: {
          roleProfileId_permissionKey_dataScope: {
            roleProfileId: row.id,
            permissionKey: b.permissionKey,
            dataScope: b.dataScope,
          },
        },
        create: {
          orgId,
          roleProfileId: row.id,
          permissionKey: b.permissionKey,
          dataScope: b.dataScope,
          effect: b.effect ?? "ALLOW",
        },
        update: {
          effect: b.effect ?? "ALLOW",
        },
      });
      bindings += 1;
    }
  }

  for (const t of allTemplates) {
    const roleProfileId = profileIdByKey.get(t.roleProfileKey) ?? null;
    await db.positionTemplate.upsert({
      where: { orgId_key: { orgId, key: t.key } },
      create: {
        orgId,
        key: t.key,
        name: t.name,
        principalType: "HUMAN",
        isSystem: true,
        status: "active",
        primaryRoleProfileId: roleProfileId,
      },
      update: {
        name: t.name,
        status: "active",
        primaryRoleProfileId: roleProfileId,
      },
    });
    positions += 1;
  }

  // 绑定 org_owner membership → org_owner RoleProfile
  let ownerAssigned = false;
  const owners = await db.organizationMember.findMany({
    where: { orgId, role: "org_owner", status: "active" },
    select: { userId: true },
  });
  const ownerProfileId = profileIdByKey.get("org_owner");
  if (ownerProfileId) {
    for (const o of owners) {
      const existing = await db.principalRoleBinding.findFirst({
        where: {
          orgId,
          principalType: "HUMAN",
          principalId: o.userId,
          roleProfileId: ownerProfileId,
          status: "active",
        },
      });
      if (!existing) {
        await db.principalRoleBinding.create({
          data: {
            orgId,
            principalType: "HUMAN",
            principalId: o.userId,
            roleProfileId: ownerProfileId,
            status: "active",
          },
        });
      }
      ownerAssigned = true;
    }
  }

  // org_admin membership → org_admin profile
  const adminProfileId = profileIdByKey.get("org_admin");
  if (adminProfileId) {
    const admins = await db.organizationMember.findMany({
      where: { orgId, role: "org_admin", status: "active" },
      select: { userId: true },
    });
    for (const a of admins) {
      await ensurePrincipalBinding(orgId, a.userId, adminProfileId);
    }
  }

  // 平台 role=sales 的 active org_member → sales_rep；PERM-6a：平台 role=trade → trade_rep
  // （不覆盖已有任何绑定；trade 不绑销售岗位）
  const autoBindProfileIds: Record<string, string | undefined> = {
    sales: profileIdByKey.get("sales_rep"),
    trade: profileIdByKey.get("trade_rep"),
  };
  if (autoBindProfileIds.sales || autoBindProfileIds.trade) {
    const members = await db.organizationMember.findMany({
      where: { orgId, status: "active", role: "org_member" },
      select: { userId: true, user: { select: { role: true } } },
    });
    for (const m of members) {
      const autoProfileId = autoBindProfileIds[m.user.role];
      if (!autoProfileId) continue;
      const hasAny = await db.principalRoleBinding.findFirst({
        where: {
          orgId,
          principalType: "HUMAN",
          principalId: m.userId,
          status: "active",
        },
        select: { id: true },
      });
      if (!hasAny) {
        await ensurePrincipalBinding(orgId, m.userId, autoProfileId);
      }
    }
  }

  return { profiles, bindings, positions, ownerAssigned };
}

async function ensurePrincipalBinding(
  orgId: string,
  principalId: string,
  roleProfileId: string,
): Promise<void> {
  const existing = await db.principalRoleBinding.findFirst({
    where: {
      orgId,
      principalType: "HUMAN",
      principalId,
      roleProfileId,
      status: "active",
    },
  });
  if (!existing) {
    await db.principalRoleBinding.create({
      data: {
        orgId,
        principalType: "HUMAN",
        principalId,
        roleProfileId,
        status: "active",
      },
    });
  }
}

export async function seedAllOrgAuthorizationProfiles(): Promise<number> {
  const orgs = await db.organization.findMany({
    where: { status: { not: "archived" } },
    select: { id: true },
  });
  for (const o of orgs) {
    await seedOrgAuthorizationProfiles(o.id);
  }
  return orgs.length;
}
