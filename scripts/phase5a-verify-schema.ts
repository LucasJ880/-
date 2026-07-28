/**
 * Phase 5A：核验 Phase 3/4/5 关键结构与数据（对当前 DATABASE_URL）
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const db = new PrismaClient();
  const cols = (await db.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public'
      AND (
        (table_name='Task' AND column_name IN ('blockedReason','waitingOn','waitingUntil','sourceType','sourceId','sourceBatchKey','sourceTemplateKey'))
        OR (table_name='Project' AND column_name IN ('workDomain','deliveryStage','plannedCompletionDate','actualCompletionDate','sourceTenderProjectId'))
        OR (table_name='ProjectHandoff')
      )
    ORDER BY table_name, column_name
  `)) as unknown[];

  const indexes = (await db.$queryRawUnsafe(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public'
      AND (
        indexname ILIKE '%waiting%'
        OR indexname ILIKE '%workDomain%'
        OR indexname ILIKE '%Handoff%'
        OR indexname ILIKE '%sourceTender%'
        OR indexname ILIKE '%sourceTemplate%'
        OR indexname ILIKE '%idempotency%'
      )
    ORDER BY tablename, indexname
  `)) as unknown[];

  const taskStats = (await db.$queryRawUnsafe(`
    SELECT status, count(*)::int AS n FROM "Task" GROUP BY status ORDER BY n DESC
  `)) as unknown[];
  const taskTotal = (await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "Task"`)) as Array<{ n: number }>;
  const workDomain = (await db.$queryRawUnsafe(`
    SELECT "workDomain", count(*)::int AS n FROM "Project" GROUP BY "workDomain" ORDER BY n DESC
  `)) as unknown[];
  const handoffCount = (await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "ProjectHandoff"`)) as Array<{ n: number }>;
  const bidTables = (await db.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name ILIKE 'BidData%'
    ORDER BY table_name
  `)) as unknown[];

  console.log(
    JSON.stringify(
      {
        cols,
        indexes,
        taskTotal: taskTotal[0]?.n,
        taskStats,
        workDomain,
        handoffCount: handoffCount[0]?.n,
        bidTables,
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
