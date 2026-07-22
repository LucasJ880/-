/**
 * Phase 3A-5：estimated → actual 结算（DB）
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a5-settle-db.test.ts
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { settleAiUsageReservation } from "@/lib/capabilities/governance";

const db = new PrismaClient();

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

async function main() {
  console.log("phase3a5 settle db");

  const sunny = await db.organization.findUnique({
    where: { code: "sunny-home-deco" },
    select: { id: true },
  });
  const member = sunny
    ? await db.organizationMember.findFirst({
        where: { orgId: sunny.id, status: "active", role: "org_admin" },
        select: { userId: true },
      })
    : null;

  if (!sunny || !member) {
    console.log("  ⚠ 跳过：缺少 Sunny / org_admin 种子数据");
    await db.$disconnect();
    return;
  }

  const stamp = Date.now();

  // 直接写入 RESERVED，绕过环境可能已触达的 hard limit=0 策略
  const row = await db.capabilityQuotaReservation.create({
    data: {
      orgId: sunny.id,
      metric: "MONTHLY_AI_COST",
      amount: new Prisma.Decimal(0.05),
      idempotencyKey: `test-settle-res-${stamp}`,
      status: "RESERVED",
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });

  const settled = await settleAiUsageReservation({
    reservationId: row.id,
    orgId: sunny.id,
    userId: member.userId,
    idempotencyKey: `test-settle-${stamp}`,
    actualCost: 0.01,
    model: "gpt-4o-mini",
    inputTokens: 100,
    outputTokens: 50,
    success: true,
    hadBillableUsage: true,
  });
  ok(settled.status === "SETTLED", "estimated>actual → SETTLED");
  ok(settled.actualCost === 0.01, "实际费用入账");
  ok(settled.releasedDelta > 0, "释放差额");
  ok(Boolean(settled.ledgerId), "写入 ledger");

  const again = await settleAiUsageReservation({
    reservationId: row.id,
    orgId: sunny.id,
    userId: member.userId,
    idempotencyKey: `test-settle-${stamp}`,
    actualCost: 0.01,
    success: true,
    hadBillableUsage: true,
  });
  ok(again.duplicate && again.status === "ALREADY_SETTLED", "重复结算幂等");

  const row2 = await db.capabilityQuotaReservation.create({
    data: {
      orgId: sunny.id,
      metric: "MONTHLY_AI_COST",
      amount: new Prisma.Decimal(0.05),
      idempotencyKey: `test-settle-res-fail-${stamp}`,
      status: "RESERVED",
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  const released = await settleAiUsageReservation({
    reservationId: row2.id,
    orgId: sunny.id,
    userId: member.userId,
    idempotencyKey: `test-settle-fail-${stamp}`,
    actualCost: 0,
    success: false,
    hadBillableUsage: false,
    errorCode: "model_error",
  });
  ok(released.status === "RELEASED", "失败无费用 → RELEASED");

  // estimated < actual
  const row3 = await db.capabilityQuotaReservation.create({
    data: {
      orgId: sunny.id,
      metric: "MONTHLY_AI_COST",
      amount: new Prisma.Decimal(0.01),
      idempotencyKey: `test-settle-res-over-${stamp}`,
      status: "RESERVED",
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  const over = await settleAiUsageReservation({
    reservationId: row3.id,
    orgId: sunny.id,
    userId: member.userId,
    idempotencyKey: `test-settle-over-${stamp}`,
    actualCost: 0.08,
    model: "gpt-4o",
    inputTokens: 2000,
    outputTokens: 1000,
    success: true,
    hadBillableUsage: true,
  });
  ok(over.status === "SETTLED" && over.actualCost === 0.08, "actual>estimated 记录真实费用");
  ok(over.releasedDelta === 0, "超额时无释放差额");

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
