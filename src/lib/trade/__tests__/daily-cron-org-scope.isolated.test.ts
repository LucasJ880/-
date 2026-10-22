/**
 * 外贸每日检查按组织范围执行（隔离库集成测试）。
 * 运行（隔离库）：DATABASE_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx <本文件>
 * 无隔离库自动跳过。
 *
 * /api/trade/cron 按各组织当地 08:00 传入 orgIds；未轮到的组织的线索、报价不得被改动。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过外贸每日检查组织范围测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "trade daily cron org scope" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { runDailyCron } = await import("../cron-jobs");

  const stamp = "dc" + Date.now().toString(36);
  const ORG_A = `orgA_${stamp}`, ORG_B = `orgB_${stamp}`;
  const U = `u_${stamp}`;
  const now = Date.now();
  const past = new Date(now - 24 * 3600_000);
  const eightDaysAgo = new Date(now - 8 * 24 * 3600_000);

  await db.user.create({ data: { id: U, email: `${U}@f.test`, name: U, role: "user" } });
  await db.organization.create({ data: { id: ORG_A, name: "DC Org A", code: `dca-${stamp}`, ownerId: U, settingsJson: { timezone: "Asia/Shanghai" } } });
  await db.organization.create({ data: { id: ORG_B, name: "DC Org B", code: `dcb-${stamp}`, ownerId: U } });

  const seed = async (orgId: string, tag: string) => {
    const campaign = await db.tradeCampaign.create({
      data: { orgId, name: `c-${tag}`, productDesc: "towels", targetMarket: "CA", createdById: U },
      select: { id: true },
    });
    const overdue = await db.tradeProspect.create({
      data: { orgId, campaignId: campaign.id, companyName: `overdue-${tag}`, stage: "follow_up", nextFollowUpAt: past },
      select: { id: true },
    });
    const silent = await db.tradeProspect.create({
      data: { orgId, campaignId: campaign.id, companyName: `silent-${tag}`, stage: "contacted", outreachSentAt: eightDaysAgo },
      select: { id: true },
    });
    const quote = await db.tradeQuote.create({
      data: { orgId, quoteNumber: `Q-${stamp}-${tag}`, companyName: `buyer-${tag}`, createdById: U, status: "sent", expiresAt: past },
      select: { id: true },
    });
    return { overdue, silent, quote };
  };
  const a = await seed(ORG_A, "a");
  const b = await seed(ORG_B, "b");
  const stageOf = async (id: string) => (await db.tradeProspect.findUniqueOrThrow({ where: { id }, select: { stage: true } })).stage;
  const quoteStatusOf = async (id: string) => (await db.tradeQuote.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  try {
    const r = await runDailyCron({ orgIds: [ORG_A] });
    ok(r.overdueFollowUps === 1 && r.expiredQuotes === 1 && r.noResponseProspects === 1,
      "只统计本次传入的组织（A）", r);
    ok((await quoteStatusOf(a.quote.id)) === "expired", "A 的过期报价被标记 expired");
    ok((await stageOf(a.silent.id)) === "follow_up", "A 的 7 天无回复线索转 follow_up");
    ok((await quoteStatusOf(b.quote.id)) === "sent", "B 未轮到：报价保持 sent");
    ok((await stageOf(b.silent.id)) === "contacted", "B 未轮到：线索保持 contacted");
    const bLogs = await db.tradeActivityLog.count({ where: { orgId: ORG_B } });
    ok(bLogs === 0, "B 未轮到：不写活动日志", { bLogs });

    const r2 = await runDailyCron({ orgIds: [ORG_B] });
    ok(r2.expiredQuotes === 1 && r2.noResponseProspects === 1, "轮到 B 时只处理 B", r2);
    ok((await quoteStatusOf(b.quote.id)) === "expired" && (await stageOf(b.silent.id)) === "follow_up", "B 的报价与线索在自己的轮次更新");
  } finally {
    await db.tradeActivityLog.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.tradeQuote.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.tradeProspect.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.tradeCampaign.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await db.user.deleteMany({ where: { id: U } });
    await db.$disconnect();
  }

  console.log(`\n外贸每日检查组织范围：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
