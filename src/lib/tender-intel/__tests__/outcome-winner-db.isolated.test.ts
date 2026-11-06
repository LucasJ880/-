/**
 * P2-0 结果表单「中标方（选填）」+ 竞争对手域排除我方 — 真实 DB 端到端（隔离库，虚构企业）
 *
 *   未中标 + 中标方 → HUMAN_CONFIRMED AwardRecord（sourceKey=tender-result-winner:{projectId}）+ 结果备注
 *   → 同名再标记幂等 → 换名不覆盖（winner_already_recorded）→ 填我方被拒 → 不填不写对手事实
 *   → 授标情报关闭只写备注 → 我方中标回灌后，投影把我方排除出竞争对手域
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-intel/__tests__/outcome-winner-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构企业名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 P2-0 中标方 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "P2-0 outcome winner DB e2e" });
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
const ORG = `fx_p20_org_${stamp}`;
const USER = `fx_p20_user_${stamp}`;
const P_LOST = `fx_p20_lost_${stamp}`;
const P_PLAIN = `fx_p20_plain_${stamp}`;
const P_OFF = `fx_p20_off_${stamp}`;
const P_WON = `fx_p20_won_${stamp}`;
const ORG_NAME = `Fixture Shutters ${stamp} Inc.`;

async function main() {
  const { db } = await import("@/lib/db");
  const { markProjectTenderResult } = await import("@/lib/projects/tender-result");
  const { listAwardsForOrg } = await import("@/lib/tender-intel/awards");
  const { deriveAwardIntelligence } = await import("@/lib/tender-intel/award-intelligence");

  await db.user.create({ data: { id: USER, email: `${USER}@fixture.test`, name: "虚构投标员", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: ORG_NAME, code: `p20-${stamp}`, ownerId: USER } });
  for (const id of [P_LOST, P_PLAIN, P_OFF, P_WON]) {
    await db.project.create({
      data: { id, name: `Fixture Window Coverings ${id.slice(-6)}`, orgId: ORG, ownerId: USER, workDomain: "tender", intakeStatus: "dispatched", clientOrganization: "Fixture Buyer Agency", solicitationNumber: `FX-${id.slice(-6)}`, currency: "CAD" },
    });
  }

  try {
    console.log("\n[1] 未中标 + 中标方 → 授标事实 + 结果备注");
    const r1 = await markProjectTenderResult({ projectId: P_LOST, result: "lost", winningBidPrice: 118000, winnerName: "ABC Blinds Ltd", actorUserId: USER });
    ok(r1.canonicalBackfill?.award === "written" && !!r1.canonicalBackfill.awardRecordId, "写入 AwardRecord", r1.canonicalBackfill);
    const rec = await db.awardRecord.findFirst({ where: { orgId: ORG, projectId: P_LOST } });
    const src = await db.awardRecordSource.findMany({ where: { orgId: ORG, sourceKey: `tender-result-winner:${P_LOST}` } });
    ok(rec?.winnerName === "ABC Blinds Ltd" && rec.verificationStatus === "HUMAN_CONFIRMED" && rec.status === "ACTIVE", "中标方 / 人工确认 / ACTIVE", rec);
    ok(Number(rec?.contractAmount) === 118000 && rec?.currency === "CAD" && rec?.buyerNameRaw === "Fixture Buyer Agency", "带上中标价、币种与买家", rec);
    ok(src.length === 1 && src[0].sourceType === "USER_ENTRY", "来源 USER_ENTRY，幂等键 tender-result-winner:{projectId}", src);
    const p1 = await db.project.findUnique({ where: { id: P_LOST }, select: { description: true, tenderStatus: true } });
    ok(p1?.tenderStatus === "lost" && (p1.description ?? "").includes("] ABC Blinds Ltd") && (p1.description ?? "").includes("[中标方"), "结果备注里有中标方", p1);

    console.log("\n[2] 再次标记：同名幂等、换名不覆盖");
    const r2 = await markProjectTenderResult({ projectId: P_LOST, result: "lost", winnerName: "abc blinds ltd", actorUserId: USER });
    ok(r2.canonicalBackfill?.award === "written" && r2.canonicalBackfill.awardRecordId === rec?.id, "同名（大小写不同）→ 同一条记录", r2.canonicalBackfill);
    const r3 = await markProjectTenderResult({ projectId: P_LOST, result: "lost", winnerName: "XYZ Coverings Corp", actorUserId: USER });
    ok(r3.canonicalBackfill?.award === "skipped" && r3.canonicalBackfill.awardReason === "winner_already_recorded", "换名 → 不覆盖，原因 winner_already_recorded", r3.canonicalBackfill);
    ok((await db.awardRecord.count({ where: { orgId: ORG, projectId: P_LOST } })) === 1 && (await db.awardRecord.findFirst({ where: { orgId: ORG, projectId: P_LOST } }))?.winnerName === "ABC Blinds Ltd", "仍只有一条，中标方未被改写");

    console.log("\n[3] 填我方被拒；不填不写对手事实");
    let threw = "";
    try {
      await markProjectTenderResult({ projectId: P_PLAIN, result: "lost", winnerName: ORG_NAME.toUpperCase().replace(".", ""), actorUserId: USER });
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    ok(threw.includes("不能填我方"), "中标方 = 我方 → 拒绝", threw);
    ok((await db.project.findUnique({ where: { id: P_PLAIN }, select: { tenderStatus: true } }))?.tenderStatus !== "lost", "被拒时不改项目状态");
    const r4 = await markProjectTenderResult({ projectId: P_PLAIN, result: "lost", actorUserId: USER });
    ok(r4.canonicalBackfill?.award === "skipped" && r4.canonicalBackfill.awardReason === "lost_without_winner", "未填中标方 → 不写对手事实", r4.canonicalBackfill);
    ok((await db.awardRecord.count({ where: { orgId: ORG, projectId: P_PLAIN } })) === 0, "没有新记录");

    console.log("\n[4] 授标情报关闭：只写备注");
    process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "0";
    const r5 = await markProjectTenderResult({ projectId: P_OFF, result: "lost", winnerName: "Off Switch Blinds Inc.", actorUserId: USER });
    process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";
    ok(r5.canonicalBackfill?.award === "skipped" && r5.canonicalBackfill.awardReason === "t4_schema_not_ready", "开关关 → t4_schema_not_ready", r5.canonicalBackfill);
    ok((await db.awardRecord.count({ where: { orgId: ORG, projectId: P_OFF } })) === 0, "不写 AwardRecord");
    ok(((await db.project.findUnique({ where: { id: P_OFF }, select: { description: true } }))?.description ?? "").includes("Off Switch Blinds Inc."), "备注里保留中标方");

    console.log("\n[5] 我方中标回灌后，竞争对手域排除我方");
    const r6 = await markProjectTenderResult({ projectId: P_WON, result: "won", winningBidPrice: 95000, actorUserId: USER });
    ok(r6.canonicalBackfill?.award === "written", "我方中标写入（既有行为不变）", r6.canonicalBackfill);
    const rows = await listAwardsForOrg({ orgId: ORG });
    const withOwn = deriveAwardIntelligence(rows);
    const withoutOwn = deriveAwardIntelligence(rows, { ownWinnerNames: [ORG_NAME] });
    ok(withOwn.competitorSignals.confirmed.some((c) => c.name === ORG_NAME), "不传组织名：我方出现在竞争对手域（改动前的问题）", withOwn.competitorSignals);
    ok(
      withoutOwn.competitorSignals.confirmed.map((c) => c.name).join() === "ABC Blinds Ltd" && withoutOwn.competitorSignals.ownAwardCount === 1,
      "传组织名：只剩对手 ABC，排除我方 1 条",
      withoutOwn.competitorSignals,
    );
  } finally {
    await db.awardRecordSource.deleteMany({ where: { orgId: ORG } });
    await db.awardRecord.deleteMany({ where: { orgId: ORG } });
    await db.projectReview.deleteMany({ where: { projectId: { in: [P_LOST, P_PLAIN, P_OFF, P_WON] } } });
    await db.project.deleteMany({ where: { id: { in: [P_LOST, P_PLAIN, P_OFF, P_WON] } } });
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
