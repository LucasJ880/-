/**
 * P2-1b：已按旧口径（当成 UTC）入库的 CanadaBuys 截标时间，下一次扫描到时按东部当地时间改正（隔离库）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/procurement-records/__tests__/closing-tz-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不发外部请求、不调模型。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 P2-1b 截标时区 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "P2-1b closing timezone DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { parseCanadaBuysNoticesCsv } = await import("../sources-pure");
  const { upsertInstrumentFromRecord } = await import("../instruments");

  console.log("P2-1b closing timezone — isolated DB");
  const stamp = Date.now().toString(36);
  const U = `ctzu_${stamp}`, ORG = `ctzorg_${stamp}`;
  const header = `"title-titre-eng","title-titre-fra","referenceNumber-numeroReference","amendmentNumber-numeroModification","solicitationNumber-numeroSollicitation","publicationDate-datePublication","tenderClosingDate-appelOffresDateCloture","tenderStatus-appelOffresStatut-eng","gsin-nibs","unspsc","unspscDescription-eng","regionsOfDelivery-regionsLivraison-eng","contractingEntityName-nomEntitContractante-eng","endUserEntitiesName-nomEntitesUtilisateurFinal-eng","noticeURL-URLavis-eng","tenderDescription-descriptionAppelOffres-eng"\r\n`;
  const ref = `cb-ctz-${stamp}`;
  const csv = header + `"Fixture towels","Serviettes",${ref},000,W-${ref},2026-11-05,2026-12-15T14:00:00,Open,N7210,52121700,Towels,Ontario,Public Services and Procurement Canada,National Defence,https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${ref},"desc"\r\n`;
  try {
    await db.user.create({ data: { id: U, email: `${U}@fixture.test`, name: "Fixture", role: "user" } });
    await db.organization.create({ data: { id: ORG, name: "Fixture Org", code: `ctz-${stamp}`, ownerId: U } });
    const parsed = parseCanadaBuysNoticesCsv(csv);
    if (!parsed.ok) throw new Error("parse failed");
    const fresh = parsed.records[0];
    ok(fresh.closingAt === "2026-12-15T19:00:00.000Z", "新口径：14:00 东部 → 19:00Z", fresh.closingAt);

    // 旧口径入库（当成 UTC）
    const legacy = { ...fresh, closingAt: "2026-12-15T14:00:00.000Z" };
    const t1 = new Date("2026-11-10T12:00:00Z");
    const o1 = await upsertInstrumentFromRecord({ orgId: ORG, record: legacy, match: undefined, runId: null, now: t1, allowCreate: true });
    const before = await db.procurementInstrument.findUnique({ where: { id: o1.instrumentId! }, select: { closingAt: true, lastChangedAt: true } });
    ok(o1.created && before?.closingAt?.toISOString() === "2026-12-15T14:00:00.000Z", "旧数据：存成 14:00Z（多伦多上午 9 点）", before);

    // 下一次扫描读到同一条公告（新口径）
    const t2 = new Date("2026-11-17T12:00:00Z");
    const o2 = await upsertInstrumentFromRecord({ orgId: ORG, record: fresh, match: undefined, runId: null, now: t2, allowCreate: true });
    const after = await db.procurementInstrument.findUnique({ where: { id: o1.instrumentId! }, select: { closingAt: true, lastChangedAt: true } });
    ok(!o2.created && o2.instrumentId === o1.instrumentId && after?.closingAt?.toISOString() === "2026-12-15T19:00:00.000Z", "下一次扫描：同一条公告，截标时间改为 19:00Z", after);
    ok(o2.evidenceChanged === true && after?.lastChangedAt?.getTime() === t2.getTime(), "记为一次证据变化（只此一次）", { changed: o2.evidenceChanged, lastChangedAt: after?.lastChangedAt });
    const evCount = await db.procurementSourceEvidence.count({ where: { orgId: ORG, instrumentId: o1.instrumentId! } });
    ok(evCount === 2, "证据两条：旧口径一条、新口径一条", evCount);

    // 再扫一次：没有变化
    const o3 = await upsertInstrumentFromRecord({ orgId: ORG, record: fresh, match: undefined, runId: null, now: new Date("2026-11-18T12:00:00Z"), allowCreate: true });
    ok(o3.evidenceChanged === false && (await db.procurementSourceEvidence.count({ where: { orgId: ORG, instrumentId: o1.instrumentId! } })) === 2, "再扫一次：不再算变化，不加证据");
  } finally {
    await db.procurementSourceEvidence.deleteMany({ where: { orgId: ORG } });
    await db.procurementInstrumentRelation.deleteMany({ where: { orgId: ORG } });
    await db.procurementInstrument.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: U } });
    await db.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
