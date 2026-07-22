/**
 * Security-1：输出组织访问模式纠正后的账号报告
 * 用法：npx tsx scripts/security1-report-org-access.ts
 */

import { db } from "../src/lib/db";

async function main() {
  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      orgAccessMode: true,
      canSelfSwitchOrg: true,
      activeOrgId: true,
      orgMemberships: {
        where: { status: "active" },
        select: { orgId: true, role: true, org: { select: { name: true, status: true } } },
      },
    },
    orderBy: { email: "asc" },
  });

  const multiMembership = users.filter((u) => u.orgMemberships.length > 1);
  const canSwitch = users.filter((u) => u.canSelfSwitchOrg);
  const multiOrgMode = users.filter((u) => u.orgAccessMode === "MULTI_ORG");
  const platformSupport = users.filter((u) => u.orgAccessMode === "PLATFORM_SUPPORT");
  const fixedMulti = multiMembership.filter((u) => u.orgAccessMode === "FIXED");
  const invalidActive = users.filter((u) => {
    if (!u.activeOrgId) return u.orgMemberships.length > 0;
    return !u.orgMemberships.some((m) => m.orgId === u.activeOrgId);
  });

  console.log("=== Security-1 org access report ===");
  console.log(`total users: ${users.length}`);
  console.log(`canSelfSwitchOrg=true: ${canSwitch.length} (期望 0，除非人工授权)`);
  console.log(`orgAccessMode=MULTI_ORG: ${multiOrgMode.length}`);
  console.log(`orgAccessMode=PLATFORM_SUPPORT: ${platformSupport.length}`);
  console.log(`multi membership + FIXED: ${fixedMulti.length}`);
  console.log(`activeOrgId 无效/缺失 warning: ${invalidActive.length}`);

  if (canSwitch.length > 0) {
    console.log("\n[WARN] 仍可自助切换：");
    for (const u of canSwitch) {
      console.log(`  ${u.email} mode=${u.orgAccessMode} role=${u.role}`);
    }
  }

  if (multiOrgMode.length > 0) {
    console.log("\nMULTI_ORG 账号（应 canSelfSwitchOrg=false）：");
    for (const u of multiOrgMode) {
      console.log(
        `  ${u.email} switch=${u.canSelfSwitchOrg} memberships=${u.orgMemberships.length}`,
      );
    }
  }

  if (invalidActive.length > 0) {
    console.log("\n[WARN] activeOrgId 需管理员设置：");
    for (const u of invalidActive.slice(0, 50)) {
      console.log(
        `  ${u.email} activeOrgId=${u.activeOrgId ?? "null"} memberships=${u.orgMemberships.length}`,
      );
    }
  }

  // trade 误绑 sales_rep
  const tradeSalesBindings = await db.principalRoleBinding.findMany({
    where: {
      status: "active",
      principalType: "HUMAN",
      roleProfile: { key: "sales_rep" },
    },
    select: {
      id: true,
      orgId: true,
      principalId: true,
      roleProfile: { select: { key: true } },
    },
  });
  const tradeUserIds = new Set(
    (
      await db.user.findMany({
        where: { role: "trade", id: { in: tradeSalesBindings.map((b) => b.principalId) } },
        select: { id: true, email: true },
      })
    ).map((u) => u.id),
  );
  const mistaken = tradeSalesBindings.filter((b) => tradeUserIds.has(b.principalId));
  console.log(`\ntrade 用户仍绑定 sales_rep: ${mistaken.length}`);
  for (const b of mistaken.slice(0, 30)) {
    console.log(`  binding=${b.id} principal=${b.principalId} org=${b.orgId}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
