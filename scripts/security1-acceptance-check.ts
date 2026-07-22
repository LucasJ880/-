/**
 * Security-1：基于真实 DB 的验收探针（非 UI，但用真实账号数据）
 * 用法：npx tsx scripts/security1-acceptance-check.ts
 */

import { authorize } from "../src/lib/authorization";
import type { PrincipalRef } from "../src/lib/authorization";
import { canSelfSwitchOrganizations } from "../src/lib/organizations/org-access";
import { db } from "../src/lib/db";

function principal(userId: string, orgId: string): PrincipalRef {
  return { type: "HUMAN", id: userId, orgId };
}

type Check = { name: string; ok: boolean; detail?: string };

async function main() {
  const checks: Check[] = [];

  // 全局：无人应误开 canSelfSwitchOrg（除非人工）
  const switchers = await db.user.count({ where: { canSelfSwitchOrg: true } });
  checks.push({
    name: "无自动 canSelfSwitchOrg（当前库）",
    ok: switchers === 0,
    detail: `count=${switchers}`,
  });

  const platformWrong = await db.user.count({
    where: {
      role: { in: ["admin", "super_admin"] },
      orgAccessMode: { not: "PLATFORM_SUPPORT" },
    },
  });
  checks.push({
    name: "平台 admin → PLATFORM_SUPPORT",
    ok: platformWrong === 0,
    detail: `mismatch=${platformWrong}`,
  });

  // 找 active Sunny / 梦馨（优先 Home & Deco，排除 archived Bid Lead）
  const sunny = await db.organization.findFirst({
    where: {
      status: "active",
      OR: [
        { code: "sunny-home-deco" },
        { name: { contains: "Sunny Home", mode: "insensitive" } },
        { name: { contains: "Sunny", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, status: true, code: true },
    orderBy: { createdAt: "asc" },
  });
  const mengxin = await db.organization.findFirst({
    where: {
      status: "active",
      OR: [
        { name: { contains: "梦馨" } },
        { code: { contains: "mengxin", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, status: true },
  });

  checks.push({
    name: "找到 active Sunny 组织",
    ok: !!sunny && sunny.status === "active",
    detail: sunny ? `${sunny.name} (${sunny.code ?? sunny.id})` : "missing",
  });
  checks.push({
    name: "找到 active 梦馨组织",
    ok: !!mengxin && mengxin.status === "active",
    detail: mengxin ? `${mengxin.name} (${mengxin.id})` : "missing",
  });

  // 销售账号可能仍挂在历史 archived Sunny Bid Lead；权限兼容按 membership org 测
  const salesMember = await db.organizationMember.findFirst({
    where: {
      status: "active",
      role: "org_member",
      user: { role: "sales" },
      org: {
        OR: [
          { code: { contains: "sunny", mode: "insensitive" } },
          { name: { contains: "Sunny", mode: "insensitive" } },
        ],
      },
    },
    select: {
      userId: true,
      orgId: true,
      role: true,
      org: { select: { name: true, status: true } },
      user: {
        select: {
          email: true,
          role: true,
          orgAccessMode: true,
          canSelfSwitchOrg: true,
          activeOrgId: true,
        },
      },
    },
  });

  if (salesMember) {
    const u = salesMember.user;
    const salesOrgId = salesMember.orgId;
    checks.push({
      name: "Sunny 销售 FIXED 且不可自助切换",
      ok:
        u.orgAccessMode === "FIXED" &&
        u.canSelfSwitchOrg === false &&
        !canSelfSwitchOrganizations({
          orgAccessMode: u.orgAccessMode,
          canSelfSwitchOrg: u.canSelfSwitchOrg,
          activeOrgId: u.activeOrgId,
        }),
      detail: `${u.email} @ ${salesMember.org.name} (${salesMember.org.status})`,
    });

    const decision = await authorize({
      principal: principal(salesMember.userId, salesOrgId),
      orgId: salesOrgId,
      permission: "sales.customer.read",
    });
    checks.push({
      name: "Sunny 销售有 customer.read PRINCIPAL",
      ok: decision.allowed && decision.scopes.includes("PRINCIPAL"),
      detail: `${decision.reasonCode} scopes=${decision.scopes.join(",")}`,
    });
    checks.push({
      name: "Sunny 销售非默认 ORG 全量",
      ok: decision.allowed && !decision.scopes.includes("ORG"),
      detail: `scopes=${decision.scopes.join(",")}`,
    });
  } else {
    checks.push({
      name: "Sunny 销售账号存在",
      ok: false,
      detail: "未找到 role=sales 的 org_member",
    });
  }

  if (sunny) {
    const orgAdmin = await db.organizationMember.findFirst({
      where: { orgId: sunny.id, status: "active", role: "org_admin" },
      select: {
        userId: true,
        user: { select: { email: true, role: true } },
      },
    });
    if (orgAdmin) {
      const d = await authorize({
        principal: principal(orgAdmin.userId, sunny.id),
        orgId: sunny.id,
        permission: "sales.customer.read",
      });
      checks.push({
        name: "Sunny org_admin 经 authorize 无销售读（非角色绕过）",
        ok: !d.allowed,
        detail: `${orgAdmin.user.email} platform=${orgAdmin.user.role} ${d.reasonCode}`,
      });
    } else {
      checks.push({
        name: "Sunny org_admin 账号存在",
        ok: false,
        detail: "未找到",
      });
    }

    const owner = await db.organizationMember.findFirst({
      where: { orgId: sunny.id, status: "active", role: "org_owner" },
      select: {
        userId: true,
        user: { select: { email: true, role: true } },
      },
    });
    if (owner) {
      const d = await authorize({
        principal: principal(owner.userId, sunny.id),
        orgId: sunny.id,
        permission: "sales.customer.read",
      });
      checks.push({
        name: "Sunny org_owner 有销售 ORG read",
        ok: d.allowed && d.scopes.includes("ORG"),
        detail: `${owner.user.email} ${d.reasonCode} ${d.scopes.join(",")}`,
      });

      if (mengxin) {
        const cross = await authorize({
          principal: principal(owner.userId, sunny.id),
          orgId: sunny.id,
          permission: "sales.customer.read",
          resource: {
            type: "sales_customer",
            orgId: mengxin.id,
            ownerId: "x",
          },
        });
        checks.push({
          name: "Sunny owner 不能用 Sunny principal 读梦馨资源",
          ok: !cross.allowed,
          detail: cross.reasonCode,
        });
      }
    }
  }

  // trade 账号：当前库可能不在梦馨；验证任意 trade 用户无 sales_rep 绑定，且对梦馨无销售读
  const tradeUser = await db.user.findFirst({
    where: { role: "trade" },
    select: { id: true, email: true },
  });
  if (tradeUser && mengxin) {
    const d = await authorize({
      principal: principal(tradeUser.id, mengxin.id),
      orgId: mengxin.id,
      permission: "sales.customer.read",
    });
    checks.push({
      name: "trade 用户对梦馨无 sales.customer.read",
      ok: !d.allowed,
      detail: `${tradeUser.email} ${d.reasonCode}`,
    });
    const binding = await db.principalRoleBinding.findFirst({
      where: {
        principalId: tradeUser.id,
        status: "active",
        roleProfile: { key: "sales_rep" },
      },
    });
    checks.push({
      name: "trade 用户全局无 sales_rep 绑定",
      ok: !binding,
      detail: binding?.id ?? "none",
    });
  } else {
    checks.push({
      name: "存在 trade 测试账号供验收",
      ok: !!tradeUser,
      detail: tradeUser?.email ?? "未找到 trade 用户",
    });
  }

  // 归档企业不可作为切换目标（状态门禁）
  const archived = await db.organization.findFirst({
    where: { status: "archived" },
    select: { id: true, name: true, status: true },
  });
  if (archived) {
    const { isOrgStatusActive } = await import(
      "../src/lib/organizations/org-access"
    );
    checks.push({
      name: "archived 组织 status 门禁拒绝",
      ok: !isOrgStatusActive(archived.status),
      detail: archived.name,
    });
  }

  console.log("=== Security-1 acceptance (DB probe) ===");
  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    if (!c.ok) failed += 1;
    console.log(`  ${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
