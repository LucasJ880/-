/**
 * Phase 5B：调查 20260416120000_baseline_before_launch 重复登记（只读）
 */
import { PrismaClient } from "@prisma/client";

async function inspect(label: string, url: string) {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = (await db.$queryRawUnsafe(`
      SELECT id, migration_name, checksum, started_at, finished_at,
             rolled_back_at, applied_steps_count,
             CASE WHEN logs IS NULL THEN NULL ELSE left(logs::text, 200) END AS logs_preview
      FROM _prisma_migrations
      WHERE migration_name = '20260416120000_baseline_before_launch'
      ORDER BY started_at, id
    `)) as Array<Record<string, unknown>>;

    const statusHint = (await db.$queryRawUnsafe(`
      SELECT count(*)::int AS total_rows,
             count(DISTINCT migration_name)::int AS unique_names
      FROM _prisma_migrations
    `)) as Array<{ total_rows: number; unique_names: number }>;

    console.log(
      JSON.stringify(
        {
          label,
          host: (() => {
            try {
              return new URL(url.replace(/^postgresql:/i, "http:")).hostname;
            } catch {
              return "(unparseable)";
            }
          })(),
          duplicateRows: rows,
          counts: statusHint[0],
        },
        null,
        2,
      ),
    );
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const shared = process.env.DATABASE_URL;
  if (!shared) throw new Error("缺少 DATABASE_URL");
  await inspect("shared-env", shared);

  const prod = process.env.PHASE5B_PROD_URL;
  const branch = process.env.PHASE5B_ISOLATION_URL;
  if (prod) await inspect("production", prod);
  if (branch) await inspect("isolation-branch", branch);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
