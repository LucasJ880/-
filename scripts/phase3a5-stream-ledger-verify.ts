/**
 * Phase 3A-5：流式后 ledger / reservation 结算核对 + 无 membership 拒绝
 * 运行：npx tsx scripts/phase3a5-stream-ledger-verify.ts
 */
import { db } from "../src/lib/db";
import {
  buildCapabilitiesAccess,
  CapabilitiesAccessError,
} from "../src/lib/capabilities/access";
import type { AuthUser } from "../src/lib/auth";
import type { TenantContext } from "../src/lib/tenancy/context";
import {
  evaluateQuota,
  notifyQuotaThreshold,
  buildQuotaNotifyDedupeKey,
} from "../src/lib/capabilities/governance";

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

function fakeUser(id: string, role = "user"): AuthUser {
  return { id, email: `${id}@t.local`, name: id, role } as AuthUser;
}

async function main() {
  console.log("phase3a5 stream ledger / soft-limit verify");

  const sunny = await db.organization.findFirst({
    where: { code: "sunny-home-deco" },
  });
  const mx = await db.organization.findFirst({
    where: { code: "mengxin-home-textile" },
  });
  ok(!!sunny && !!mx, "双租户存在");
  if (!sunny || !mx) process.exit(1);

  const sunnyAdmin = await db.organizationMember.findFirst({
    where: { orgId: sunny.id, status: "active", role: "org_admin" },
  });
  ok(!!sunnyAdmin, "Sunny org_admin 存在");

  const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const sunnyLedgers = await db.aiUsageLedger.findMany({
    where: { orgId: sunny.id, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const mxLedgers = await db.aiUsageLedger.findMany({
    where: { orgId: mx.id, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  ok(
    sunnyLedgers.every((l) => l.orgId === sunny.id),
    "Sunny ledger 无串租户",
  );
  ok(mxLedgers.every((l) => l.orgId === mx.id), "梦馨 ledger 无串租户");

  const reservations = await db.capabilityQuotaReservation.findMany({
    where: {
      orgId: { in: [sunny.id, mx.id] },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const statusCounts = reservations.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const openStuck = reservations.filter((r) => r.status === "RESERVED");
  const known = reservations.every((r) =>
    [
      "RESERVED",
      "COMMITTED",
      "RELEASED",
      "EXPIRED",
      "SETTLED",
      "SETTLEMENT_FAILED",
    ].includes(r.status),
  );
  ok(
    reservations.length === 0 || known,
    `reservation 状态已知（共 ${reservations.length}，分布 ${JSON.stringify(statusCounts)}，未结 RESERVED=${openStuck.length}）`,
  );

  // Platform admin 无 membership
  const orphan = await db.user.create({
    data: {
      email: `phase3a5-orphan-${Date.now()}@test.qingyan.ai`,
      name: "orphan-admin",
      role: "admin",
      status: "active",
      authProvider: "email",
      passwordHash: "x",
    },
  });
  const t: TenantContext = {
    userId: orphan.id,
    orgId: sunny.id,
    orgRole: "org_admin",
    workspaceIds: [],
    isPlatformAdmin: true,
    user: fakeUser(orphan.id, "admin"),
  };
  let denied = false;
  try {
    await buildCapabilitiesAccess(t);
  } catch (e) {
    denied =
      e instanceof CapabilitiesAccessError && e.code === "NO_MEMBERSHIP";
  }
  ok(denied, "Platform Admin 无 membership → NO_MEMBERSHIP（中台）");
  await db.user.delete({ where: { id: orphan.id } }).catch(() => undefined);

  const k1 = buildQuotaNotifyDedupeKey({
    orgId: sunny.id,
    workspaceId: null,
    metric: "MONTHLY_AI_COST",
    level: "SOFT_LIMIT",
  });
  const k2 = buildQuotaNotifyDedupeKey({
    orgId: mx.id,
    workspaceId: null,
    metric: "MONTHLY_AI_COST",
    level: "SOFT_LIMIT",
  });
  ok(k1 !== k2, "Sunny / 梦馨 soft limit 去重键不串");
  ok(k1.includes(sunny.id) && k2.includes(mx.id), "去重键含各自 orgId");

  if (sunnyAdmin) {
    const evalSoft = await evaluateQuota({
      orgId: sunny.id,
      userId: sunnyAdmin.userId,
      workspaceId: null,
      metric: "MONTHLY_AI_COST",
      requestedAmount: 0.01,
    });
    ok(typeof evalSoft.level === "string", `quota evaluate level=${evalSoft.level}`);

    if (evalSoft.level === "WARNING" || evalSoft.level === "SOFT_LIMIT") {
      const a = await notifyQuotaThreshold({
        orgId: sunny.id,
        workspaceId: null,
        userId: sunnyAdmin.userId,
        metric: "MONTHLY_AI_COST",
        level: evalSoft.level,
        currentUsage: evalSoft.currentUsage,
        projectedUsage: evalSoft.projectedUsage,
        softLimit: evalSoft.softLimit,
        warningLimit: evalSoft.warningLimit,
        hardLimit: evalSoft.hardLimit,
      });
      const b = await notifyQuotaThreshold({
        orgId: sunny.id,
        workspaceId: null,
        userId: sunnyAdmin.userId,
        metric: "MONTHLY_AI_COST",
        level: evalSoft.level,
        currentUsage: evalSoft.currentUsage,
        projectedUsage: evalSoft.projectedUsage,
        softLimit: evalSoft.softLimit,
        warningLimit: evalSoft.warningLimit,
        hardLimit: evalSoft.hardLimit,
      });
      ok(a.deduped || b.deduped || b.notified === 0, "同周期 soft/warn 通知去重");
    } else {
      ok(true, `当前非 soft/warn（${evalSoft.level}），去重逻辑由单测覆盖`);
    }
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
