/**
 * Governance Hygiene Gate（Pre-Phase 2）验收测试
 *
 * 覆盖：
 * 1. Owner 治理权：isOrgAdminRole / assertCanWriteOrgQuota 对 org_owner 放行
 * 2. 单一生效版本：createQuotaPolicy / patchQuotaPolicy 均 supersede 旧 enabled 版本
 *    （含历史遗留多 enabled 行的收敛）
 * 3. Effective 解析仍取最高 enabled 版本
 * 4. Hard limit 熔断告警：evaluateQuota 阻断时通知 org_owner/org_admin，且按周期去重
 *
 * 运行：npx tsx src/lib/capabilities/__tests__/governance-hygiene-gate.test.ts
 * （使用真实 DB，创建独立测试组织，结束后清理）
 */

import { db } from "@/lib/db";
import { isOrgAdminRole } from "../access";
import type { CapabilitiesAccessContext } from "../types";
import {
  assertCanWriteOrgQuota,
  createQuotaPolicy,
  patchQuotaPolicy,
  resolveEffectiveQuota,
  evaluateQuota,
} from "../governance";

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

// Fail-closed：禁止对生产/未识别数据库执行 destructive 测试
assertSafeTestDatabase({ scriptName: "src/lib/capabilities/__tests__/governance-hygiene-gate.test.ts" });

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function accessOf(p: {
  userId: string;
  orgId: string;
  orgRole: string;
}): CapabilitiesAccessContext {
  return {
    userId: p.userId,
    orgId: p.orgId,
    orgRole: p.orgRole,
    isPlatformAdmin: false,
    workspaceIds: [],
    runVisibility: "AGGREGATE_ONLY",
    hasMembership: true,
  };
}

async function countEnabled(orgId: string, metric: string): Promise<number> {
  return db.capabilityQuotaPolicy.count({
    where: { orgId, workspaceId: null, metric, enabled: true },
  });
}

async function main() {
  console.log("governance hygiene gate");
  const stamp = Date.now().toString(36);

  // ---------- Case 1：Owner 治理权（纯逻辑） ----------
  console.log("Case 1: Owner 治理权");
  ok(isOrgAdminRole("org_owner"), "isOrgAdminRole(org_owner) = true");
  ok(isOrgAdminRole("org_admin"), "isOrgAdminRole(org_admin) = true");
  ok(!isOrgAdminRole("org_member"), "isOrgAdminRole(org_member) = false");
  ok(!isOrgAdminRole("org_viewer"), "isOrgAdminRole(org_viewer) = false");

  let ownerWriteOk = true;
  try {
    assertCanWriteOrgQuota(accessOf({ userId: "u", orgId: "o", orgRole: "org_owner" }));
  } catch {
    ownerWriteOk = false;
  }
  ok(ownerWriteOk, "org_owner 可写企业配额");

  let memberWriteBlocked = false;
  try {
    assertCanWriteOrgQuota(accessOf({ userId: "u", orgId: "o", orgRole: "org_member" }));
  } catch {
    memberWriteBlocked = true;
  }
  ok(memberWriteBlocked, "org_member 仍被拒绝写企业配额");

  // ---------- 测试组织 ----------
  const ownerUser = await db.user.create({
    data: {
      email: `gh-owner-${stamp}@test.local`,
      name: `GH Owner ${stamp}`,
    },
  });
  const adminUser = await db.user.create({
    data: {
      email: `gh-admin-${stamp}@test.local`,
      name: `GH Admin ${stamp}`,
    },
  });
  const org = await db.organization.create({
    data: {
      name: `GH Gate Org ${stamp}`,
      code: `GHGATE${stamp}`,
      owner: { connect: { id: ownerUser.id } },
    },
  });
  await db.organizationMember.create({
    data: { orgId: org.id, userId: ownerUser.id, role: "org_owner", status: "active" },
  });
  await db.organizationMember.create({
    data: { orgId: org.id, userId: adminUser.id, role: "org_admin", status: "active" },
  });

  const METRIC = "MONTHLY_AI_COST" as const;

  try {
    // ---------- Case 2：createQuotaPolicy supersede ----------
    console.log("Case 2: createQuotaPolicy 单一生效版本");
    const p1 = await createQuotaPolicy({
      orgId: org.id,
      userId: ownerUser.id,
      metric: METRIC,
      period: "MONTHLY",
      hardLimit: 30,
    });
    ok(p1.version === 1 && p1.enabled, "v1 创建且 enabled");

    const p2 = await createQuotaPolicy({
      orgId: org.id,
      userId: ownerUser.id,
      metric: METRIC,
      period: "MONTHLY",
      hardLimit: 20,
    });
    ok(p2.version === 2, "v2 创建");
    ok((await countEnabled(org.id, METRIC)) === 1, "create 后仅 1 条 enabled");
    const p1After = await db.capabilityQuotaPolicy.findUnique({ where: { id: p1.id } });
    ok(
      p1After?.enabled === false && p1After?.effectiveTo != null,
      "旧版本被 supersede（enabled=false, effectiveTo 已写）",
    );

    // ---------- Case 3：patchQuotaPolicy supersede + 有效解析 ----------
    console.log("Case 3: patchQuotaPolicy 单一生效版本");
    const p3 = await patchQuotaPolicy({
      orgId: org.id,
      userId: ownerUser.id,
      id: p2.id,
      expectedVersion: 2,
      hardLimit: 10,
    });
    ok(p3.version === 3, "patch 生成 v3");
    ok((await countEnabled(org.id, METRIC)) === 1, "patch 后仅 1 条 enabled");

    const eff = await resolveEffectiveQuota({ orgId: org.id, workspaceId: null, metric: METRIC });
    ok(eff.hardLimit === 10, `有效 hardLimit=10（实际 ${eff.hardLimit}）`);
    ok(
      eff.sourcePolicies.some((s) => s.scope === "ORGANIZATION" && s.version === 3),
      "有效来源为 v3",
    );

    // ---------- Case 4：历史遗留多 enabled 行收敛 ----------
    console.log("Case 4: 存量多 enabled 行收敛");
    // 模拟历史脏数据：直接插入两条 enabled 行
    await db.capabilityQuotaPolicy.createMany({
      data: [4, 5].map((v) => ({
        orgId: org.id,
        workspaceId: null,
        metric: METRIC,
        period: "MONTHLY",
        hardLimit: v,
        enabled: true,
        version: v,
        createdById: ownerUser.id,
      })),
    });
    ok((await countEnabled(org.id, METRIC)) === 3, "脏数据就绪（3 条 enabled）");
    const p6 = await createQuotaPolicy({
      orgId: org.id,
      userId: ownerUser.id,
      metric: METRIC,
      period: "MONTHLY",
      hardLimit: 0,
    });
    ok(p6.version === 6, "新建 v6");
    ok(
      (await countEnabled(org.id, METRIC)) === 1,
      "create 将全部旧 enabled 行一并 supersede",
    );

    // ---------- Case 5：hard limit 熔断告警 ----------
    console.log("Case 5: hard limit 熔断告警（hardLimit=0）");
    const evalRes = await evaluateQuota({
      orgId: org.id,
      userId: ownerUser.id,
      metric: METRIC,
      requestedAmount: 0.01,
    });
    ok(!evalRes.allowed && evalRes.level === "HARD_LIMIT", "hardLimit=0 阻断调用");

    const notifs = await db.notification.findMany({
      where: { orgId: org.id, type: "quota_hard_limit" },
      select: { id: true, userId: true, priority: true, title: true },
    });
    const notifiedUserIds = new Set(notifs.map((n) => n.userId));
    ok(
      notifiedUserIds.has(ownerUser.id) && notifiedUserIds.has(adminUser.id),
      `org_owner 与 org_admin 均收到熔断告警（实际 ${notifs.length} 条）`,
    );
    ok(
      notifs.every((n) => n.priority === "urgent"),
      "告警优先级为 urgent",
    );
    ok(
      notifs.some((n) => n.title.includes("AI 已停用")),
      "hardLimit=0 使用「AI 已停用」文案",
    );

    // 去重：再次触发阻断，不应新增通知
    await evaluateQuota({
      orgId: org.id,
      userId: ownerUser.id,
      metric: METRIC,
      requestedAmount: 0.01,
    });
    const notifCount2 = await db.notification.count({
      where: { orgId: org.id, type: "quota_hard_limit" },
    });
    ok(notifCount2 === notifs.length, "同周期重复阻断按去重键抑制");
  } finally {
    // ---------- 清理 ----------
    await db.notification.deleteMany({ where: { orgId: org.id } });
    await db.auditLog.deleteMany({ where: { orgId: org.id } });
    await db.capabilityQuotaPolicy.deleteMany({ where: { orgId: org.id } });
    await db.organizationMember.deleteMany({ where: { orgId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
    await db.user.deleteMany({ where: { id: { in: [ownerUser.id, adminUser.id] } } });
  }

  console.log(`\npass=${pass} fail=${fail}`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
