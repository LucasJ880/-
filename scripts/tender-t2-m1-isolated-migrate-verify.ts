/**
 * Tender T2-M1：隔离库 migration 后四表约束验证（不打印连接串）。
 *
 * 覆盖任务书 §26 A–L：
 *   A 四表创建  B 既有表完好  C/D ProjectEvent 双唯一  E Actor 唯一
 *   F Actor→Event Restrict  G/H Archive 双唯一  I 同 hash 异 captureKey 多行
 *   J Decimal 精度  K orgId NOT NULL  L 无 Project FK 依赖
 * 另验证：四表对外零 FK（唯一 FK = ProjectEventActor→ProjectEvent, RESTRICT）。
 *
 * 用法（临时隔离 Neon 分支）：
 *   DATABASE_URL=$CS DIRECT_URL=$CS DATABASE_ENVIRONMENT=isolated \
 *     npx tsx scripts/tender-t2-m1-isolated-migrate-verify.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const P = "qy_t2m1_test_";
const PROJECT_ID = `${P}project_nonexistent`;
const ORG_ID = `${P}org`;

function isUnique(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
function isFkRestrict(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
}

let pass = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (!cond) throw new Error(`[t2m1-verify] FAIL ${label}${detail ? " — " + detail : ""}`);
  pass += 1;
  console.log(`[t2m1-verify] PASS ${label}`);
}

async function cleanup() {
  await db.projectEventActor.deleteMany({ where: { orgId: ORG_ID } });
  await db.projectEvent.deleteMany({ where: { orgId: ORG_ID } });
  await db.projectCost.deleteMany({ where: { orgId: ORG_ID } });
  await db.tenderArchiveItem.deleteMany({ where: { orgId: ORG_ID } });
}

async function main() {
  const env = (process.env.DATABASE_ENVIRONMENT || "").toLowerCase();
  if (env !== "isolated") {
    throw new Error("DATABASE_ENVIRONMENT must be isolated");
  }

  // A. 四表存在
  const rows = (await db.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`,
  )) as Array<{ tablename: string }>;
  const names = new Set(rows.map((r) => r.tablename));
  for (const t of ["ProjectEvent", "ProjectEventActor", "ProjectCost", "TenderArchiveItem"]) {
    ok(`A.${t} created`, names.has(t));
  }

  // B. 既有关键表完好
  for (const t of [
    "Project",
    "AuditLog",
    "ProjectDocument",
    "TenderAnalysisRun",
    "AgentRun",
    "AgentRunEvent",
    "AiUsageLedger",
    "ProjectMessage",
  ]) {
    ok(`B.existing ${t} intact`, names.has(t));
  }

  // 对外零 FK（唯一 FK = ProjectEventActor→ProjectEvent RESTRICT）
  const fks = (await db.$queryRawUnsafe(`
    SELECT tc.table_name, tc.constraint_name, rc.delete_rule,
           ccu.table_name AS referenced_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY'
      AND tc.table_name IN ('ProjectEvent','ProjectEventActor','ProjectCost','TenderArchiveItem')
  `)) as Array<{ table_name: string; constraint_name: string; delete_rule: string; referenced_table: string }>;
  ok(
    "FK.only ProjectEventActor→ProjectEvent",
    fks.length === 1 &&
      fks[0].table_name === "ProjectEventActor" &&
      fks[0].referenced_table === "ProjectEvent",
    JSON.stringify(fks),
  );
  ok("FK.delete_rule RESTRICT", fks[0]?.delete_rule === "RESTRICT", fks[0]?.delete_rule);

  await cleanup();

  // 基础行
  const ev1 = await db.projectEvent.create({
    data: {
      id: `${P}ev1`,
      orgId: ORG_ID,
      projectId: PROJECT_ID, // L: 不存在的 Project id —— schema 不要求 Project 行
      seq: 1,
      eventKey: `${P}stage:interpretation`,
      occurredAt: new Date("2026-08-10T12:00:00Z"),
      actorType: "user",
      actorId: `${P}user1`,
      eventType: "tender.stage_advanced",
      title: "测试事件",
    },
  });
  ok("L.ProjectEvent insert without Project row", ev1.id === `${P}ev1`);

  // C. (projectId, seq) duplicate rejected
  let dupSeq = false;
  try {
    await db.projectEvent.create({
      data: {
        id: `${P}ev_dup_seq`,
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        seq: 1,
        eventKey: `${P}other-key`,
        occurredAt: new Date(),
        actorType: "user",
        eventType: "tender.stage_advanced",
        title: "dup seq",
      },
    });
  } catch (e) {
    dupSeq = isUnique(e);
  }
  ok("C.(projectId,seq) duplicate rejected", dupSeq);

  // D. (projectId, eventKey) duplicate rejected
  let dupKey = false;
  try {
    await db.projectEvent.create({
      data: {
        id: `${P}ev_dup_key`,
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        seq: 2,
        eventKey: `${P}stage:interpretation`,
        occurredAt: new Date(),
        actorType: "user",
        eventType: "tender.stage_advanced",
        title: "dup key",
      },
    });
  } catch (e) {
    dupKey = isUnique(e);
  }
  ok("D.(projectId,eventKey) duplicate rejected", dupKey);

  // E. Actor (eventId, actorKey) duplicate rejected
  await db.projectEventActor.create({
    data: {
      id: `${P}actor1`,
      orgId: ORG_ID,
      eventId: ev1.id,
      actorKey: `${P}user:tony`,
      userId: `${P}tony`,
      role: "performer",
    },
  });
  let dupActor = false;
  try {
    await db.projectEventActor.create({
      data: {
        id: `${P}actor_dup`,
        orgId: ORG_ID,
        eventId: ev1.id,
        actorKey: `${P}user:tony`,
      },
    });
  } catch (e) {
    dupActor = isUnique(e);
  }
  ok("E.(eventId,actorKey) duplicate rejected", dupActor);

  // F. 被 Actor 引用的 Event 不可删（RESTRICT）
  let restricted = false;
  try {
    await db.projectEvent.delete({ where: { id: ev1.id } });
  } catch (e) {
    restricted = isFkRestrict(e);
  }
  ok("F.Event delete restricted while Actor exists", restricted);

  // G/H/I. TenderArchiveItem 双唯一 + 同 hash 异 captureKey
  const HASH = `${P}hash_aaaa`;
  const KEY1 = `${P}ckey_1`;
  await db.tenderArchiveItem.create({
    data: {
      id: `${P}arc1`,
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      kind: "tender_document",
      captureKey: KEY1,
      capturedAt: new Date("2026-08-10T13:00:00Z"),
      captureMethod: "upload",
      mimeType: "application/pdf",
      fileSize: 1234,
      contentHash: HASH,
      storageKey: `archive/${ORG_ID}/aa/${HASH}`,
      snapshotVersion: 1,
    },
  });
  let dupObservation = false;
  try {
    await db.tenderArchiveItem.create({
      data: {
        id: `${P}arc_dup_obs`,
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        kind: "tender_document",
        captureKey: KEY1,
        capturedAt: new Date(),
        captureMethod: "upload",
        mimeType: "application/pdf",
        fileSize: 1234,
        contentHash: HASH,
        storageKey: `archive/${ORG_ID}/aa/${HASH}`,
        snapshotVersion: 2,
      },
    });
  } catch (e) {
    dupObservation = isUnique(e);
  }
  ok("G.(captureKey,contentHash) duplicate rejected", dupObservation);

  let dupVersion = false;
  try {
    await db.tenderArchiveItem.create({
      data: {
        id: `${P}arc_dup_ver`,
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        kind: "tender_document",
        captureKey: KEY1,
        capturedAt: new Date(),
        captureMethod: "upload",
        mimeType: "application/pdf",
        fileSize: 5678,
        contentHash: `${P}hash_bbbb`,
        storageKey: `archive/${ORG_ID}/bb/${P}hash_bbbb`,
        snapshotVersion: 1,
      },
    });
  } catch (e) {
    dupVersion = isUnique(e);
  }
  ok("H.(captureKey,snapshotVersion) duplicate rejected", dupVersion);

  const arc2 = await db.tenderArchiveItem.create({
    data: {
      id: `${P}arc2`,
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      kind: "tender_document",
      captureKey: `${P}ckey_2`,
      capturedAt: new Date("2026-08-10T14:00:00Z"),
      captureMethod: "url_capture",
      mimeType: "application/pdf",
      fileSize: 1234,
      contentHash: HASH,
      storageKey: `archive/${ORG_ID}/aa/${HASH}`,
      snapshotVersion: 1,
    },
  });
  ok("I.same contentHash different captureKey allowed", arc2.contentHash === HASH);

  // J. ProjectCost Decimal 精度
  const cost = await db.projectCost.create({
    data: {
      id: `${P}cost1`,
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      costStatus: "PLANNED",
      category: "MILEAGE",
      quantity: new Prisma.Decimal("120.505"),
      unit: "km",
      unitRate: new Prisma.Decimal("0.6825"),
      amountPlanned: new Prisma.Decimal("12345678901234.56"),
      currency: "CAD",
      incurredAt: new Date("2026-08-10T15:00:00Z"),
      createdById: `${P}user1`,
    },
  });
  ok("J.quantity Decimal(12,3) exact", cost.quantity?.toString() === "120.505");
  ok("J.unitRate Decimal(18,4) exact", cost.unitRate?.toString() === "0.6825");
  ok(
    "J.amountPlanned Decimal(18,2) exact",
    cost.amountPlanned?.toString() === "12345678901234.56",
  );

  // K. orgId NOT NULL（raw SQL 绕过 client 类型层）
  for (const [label, sql] of [
    [
      "ProjectEvent",
      `INSERT INTO "ProjectEvent" ("id","orgId","projectId","seq","eventKey","occurredAt","actorType","eventType","title")
       VALUES ('${P}null_ev', NULL, '${PROJECT_ID}', 999, '${P}nullkey', now(), 'user', 't', 't')`,
    ],
    [
      "ProjectEventActor",
      `INSERT INTO "ProjectEventActor" ("id","orgId","eventId","actorKey")
       VALUES ('${P}null_actor', NULL, '${P}ev1', '${P}nullactor')`,
    ],
    [
      "ProjectCost",
      `INSERT INTO "ProjectCost" ("id","orgId","projectId","costStatus","category","currency","incurredAt","createdById","updatedAt")
       VALUES ('${P}null_cost', NULL, '${PROJECT_ID}', 'PLANNED', 'OTHER', 'CAD', now(), 'u', now())`,
    ],
    [
      "TenderArchiveItem",
      `INSERT INTO "TenderArchiveItem" ("id","orgId","projectId","kind","captureKey","capturedAt","captureMethod","mimeType","fileSize","contentHash","storageKey")
       VALUES ('${P}null_arc', NULL, '${PROJECT_ID}', 'other', '${P}nullck', now(), 'upload', 'x', 1, 'h', 's')`,
    ],
  ] as const) {
    let notNull = false;
    try {
      await db.$executeRawUnsafe(sql);
    } catch (e) {
      notNull = String(e).includes("23502") || /null value in column/i.test(String(e));
    }
    ok(`K.${label} orgId NOT NULL enforced`, notNull);
  }

  await cleanup();
  console.log(`[t2m1-verify] ALL PASS (${pass} checks)`);
}

main()
  .catch((e) => {
    console.error("[t2m1-verify] FAIL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
