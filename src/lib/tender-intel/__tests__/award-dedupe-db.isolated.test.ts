/**
 * P2-0c 授标去重：不同招标编号不判疑似重复 — 真实 DB（隔离库，虚构企业）
 *
 *   我方在同一机构两次中标（不同招标编号）→ 两条都是 ACTIVE（改前第二条落 NEEDS_REVIEW）
 *   → 同一对手在同一机构再次中标（不同编号）→ ACTIVE
 *   → 编号只差大小写 / 标点 → 仍 NEEDS_REVIEW；一方没编号 → 仍 NEEDS_REVIEW
 *   → 同机构同范围 5 次真实中标全部进入买家周期（改前只有 3 次）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-intel/__tests__/award-dedupe-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构企业名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 P2-0c 授标去重 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "P2-0c award dedupe DB test" });
process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : "");
  }
}

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ORG = `fx_p20c_org_${stamp}`;
const USER = `fx_p20c_user_${stamp}`;
const ORG_NAME = `Fixture Shutters ${stamp} Inc.`;
const BUYER = "Fixture Housing Agency";
const P1 = `fx_p20c_w1_${stamp}`;
const P2 = `fx_p20c_w2_${stamp}`;

async function main() {
  const { db } = await import("@/lib/db");
  const { markProjectTenderResult } = await import("@/lib/projects/tender-result");
  const { createOrObserveAwardRecord, listAwardsForOrg } = await import("@/lib/tender-intel/awards");
  const { deriveAwardIntelligence } = await import("@/lib/tender-intel/award-intelligence");

  await db.user.create({ data: { id: USER, email: `${USER}@fixture.test`, name: "虚构投标员", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: ORG_NAME, code: `p20c-${stamp}`, ownerId: USER } });
  const scope = "Supply and install roller blinds";
  for (const [id, sol, date] of [
    [P1, `FX-2024-${stamp}`, "2024-04-02"],
    [P2, `FX-2025-${stamp}`, "2025-04-07"],
  ] as const) {
    await db.project.create({
      data: { id, name: scope, orgId: ORG, ownerId: USER, workDomain: "tender", intakeStatus: "dispatched", clientOrganization: BUYER, solicitationNumber: sol, awardDate: new Date(date), currency: "CAD" },
    });
  }
  const actor = { actorType: "user" as const, userId: USER };
  const observe = (winnerName: string, solicitationNumber: string | null, awardDate: string, sourceKey: string) =>
    createOrObserveAwardRecord({
      orgId: ORG,
      actor,
      award: { winnerName, buyerNameRaw: BUYER, solicitationNumber, awardDate: new Date(awardDate), contractAmount: 50000, currency: "CAD", scopeSummary: scope },
      source: { sourceType: "USER_ENTRY", sourceKey, capturedAt: new Date() },
      confidence: "MEDIUM",
      verificationStatus: "HUMAN_CONFIRMED",
    });

  try {
    console.log("\n[1] 我方在同一机构两次中标（不同招标编号）");
    const w1 = await markProjectTenderResult({ projectId: P1, result: "won", winningBidPrice: 61000, actorUserId: USER });
    const w2 = await markProjectTenderResult({ projectId: P2, result: "won", winningBidPrice: 64000, actorUserId: USER });
    ok(w1.canonicalBackfill?.award === "written" && w2.canonicalBackfill?.award === "written", "两次结果标记都回灌", { w1: w1.canonicalBackfill, w2: w2.canonicalBackfill });
    const own = await db.awardRecord.findMany({ where: { orgId: ORG, projectId: { in: [P1, P2] } }, orderBy: { createdAt: "asc" } });
    ok(own.length === 2 && own.every((r) => r.status === "ACTIVE" && r.possibleDuplicateOfId === null), "两条都 ACTIVE，没有疑似重复", own.map((r) => ({ s: r.status, d: r.possibleDuplicateOfId })));

    console.log("\n[2] 同一对手在同一机构再次中标");
    const a = await observe("ABC Blinds Ltd", `FX-2023-${stamp}`, "2023-04-03", `p20c:a:${stamp}`);
    const b = await observe("ABC Blinds Ltd", `FX-2026-${stamp}`, "2026-04-06", `p20c:b:${stamp}`);
    ok(a.outcome === "CREATED" && b.outcome === "CREATED" && b.record.status === "ACTIVE", "不同编号 → 第二条 ACTIVE", { a: a.outcome, b: b.outcome, s: b.record.status });

    console.log("\n[3] 仍判疑似重复的情况");
    const c = await observe("ABC Blinds Ltd", `fx 2023 ${stamp}`.toLowerCase(), "2023-05-01", `p20c:c:${stamp}`);
    ok(c.outcome === "NEEDS_REVIEW" && c.record.possibleDuplicateOfId === a.record.id, "编号只差大小写 / 标点 → NEEDS_REVIEW，指向原记录", { o: c.outcome, d: c.record.possibleDuplicateOfId });
    const d = await observe("ABC Blinds Ltd", null, "2022-01-01", `p20c:d:${stamp}`);
    ok(d.outcome === "NEEDS_REVIEW", "新记录没编号 → NEEDS_REVIEW", d.outcome);

    console.log("\n[4] 周期：同机构同范围的真实中标全部计入");
    await observe("XYZ Coverings", `FX-2022-${stamp}`, "2022-04-05", `p20c:x:${stamp}`);
    const rows = await listAwardsForOrg({ orgId: ORG });
    const buyer = deriveAwardIntelligence(rows).buyerPattern.buyers.find((x) => x.buyerName === BUYER);
    ok(
      buyer?.cycle.status === "SUPPORTED" && buyer.cycle.sampleSize === 5 && buyer.cycle.medianIntervalDays != null,
      "买家周期用上全部 5 次真实中标（改前只有 3 次，第二次中标被当疑似重复排除）",
      buyer?.cycle,
    );
  } finally {
    await db.awardRecordSource.deleteMany({ where: { orgId: ORG } });
    await db.awardRecord.deleteMany({ where: { orgId: ORG } });
    await db.projectReview.deleteMany({ where: { projectId: { in: [P1, P2] } } });
    await db.project.deleteMany({ where: { id: { in: [P1, P2] } } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: USER } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
