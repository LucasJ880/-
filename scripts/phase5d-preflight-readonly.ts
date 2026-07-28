/**
 * Phase 5D Step A — read-only production preflight probes.
 * Never writes migrations. Safe to run against production or backup.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/phase5d-preflight-readonly.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function maskHost(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(
      /ep-([a-z]+)-([a-z]+)-([a-z0-9]+)/i,
      (_m, a, b, c) => `ep-${a}-${b}-${String(c).slice(0, 4)}…`
    );
    return `${u.protocol}//${u.username}@${host}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(unparseable)";
  }
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    name
  );
  return Boolean(rows[0]?.exists);
}

async function countOrNull(sql: string): Promise<number | "NOT_PRESENT"> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(sql);
    return Number(rows[0]?.c ?? 0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist|relation .* does not exist/i.test(msg)) return "NOT_PRESENT";
    throw e;
  }
}

async function main() {
  console.log("=== Phase 5D Step A read-only preflight ===");
  console.log("target:", maskHost(process.env.DATABASE_URL || ""));

  const identity = await prisma.$queryRawUnsafe<
    Array<{ db: string; usr: string; schema: string }>
  >(`SELECT current_database() AS db, current_user AS usr, current_schema() AS schema`);
  console.log("identity:", identity[0]);

  const counts: Record<string, number | "NOT_PRESENT"> = {};
  counts.Organization = await countOrNull(`SELECT COUNT(*)::bigint AS c FROM "Organization"`);
  counts.User = await countOrNull(`SELECT COUNT(*)::bigint AS c FROM "User"`);
  // Schema uses OrganizationMember (not OrganizationMembership)
  counts.OrganizationMember = await countOrNull(
    `SELECT COUNT(*)::bigint AS c FROM "OrganizationMember"`
  );
  counts.Project = await countOrNull(`SELECT COUNT(*)::bigint AS c FROM "Project"`);
  counts.Task = await countOrNull(`SELECT COUNT(*)::bigint AS c FROM "Task"`);
  counts.TaskActivity = await countOrNull(`SELECT COUNT(*)::bigint AS c FROM "TaskActivity"`);
  counts.AuditLog = await countOrNull(`SELECT COUNT(*)::bigint AS c FROM "AuditLog"`);
  counts.ProjectHandoff = (await tableExists("ProjectHandoff"))
    ? await countOrNull(`SELECT COUNT(*)::bigint AS c FROM "ProjectHandoff"`)
    : "NOT_PRESENT";

  // Bid Data layer (actual table names from baseline introspection)
  const bidTables = [
    "BidDataRevision",
    "TenderRequirement",
    "ProductEvidence",
    "PricingLine",
    "SolicitationNumberAlias",
  ];
  for (const t of bidTables) {
    counts[t] = (await tableExists(t))
      ? await countOrNull(`SELECT COUNT(*)::bigint AS c FROM "${t}"`)
      : "NOT_PRESENT";
  }

  console.log("\n=== counts ===");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`${k}: ${v}`);
  }

  console.log("\n=== Task status distribution ===");
  try {
    const statuses = await prisma.$queryRawUnsafe<Array<{ status: string; c: bigint }>>(
      `SELECT status::text AS status, COUNT(*)::bigint AS c FROM "Task" GROUP BY status ORDER BY status`
    );
    for (const r of statuses) console.log(`  ${r.status}: ${Number(r.c)}`);
  } catch (e) {
    console.log("  ERROR:", e instanceof Error ? e.message : e);
  }

  console.log("\n=== Project tender / Bid Data probes ===");
  try {
    const hasBid = await tableExists("BidDataRevision");
    const tender = await prisma.$queryRawUnsafe<
      Array<{
        tender_nonnull: bigint;
        solicitation_nonnull: bigint;
        with_bid_rel: bigint;
      }>
    >(
      hasBid
        ? `
      SELECT
        COUNT(*) FILTER (WHERE "tenderStatus" IS NOT NULL)::bigint AS tender_nonnull,
        COUNT(*) FILTER (WHERE "solicitationNumber" IS NOT NULL AND TRIM("solicitationNumber") <> '')::bigint AS solicitation_nonnull,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM "BidDataRevision" b WHERE b."projectId" = p.id
          )
        )::bigint AS with_bid_rel
      FROM "Project" p
    `
        : `
      SELECT
        COUNT(*) FILTER (WHERE "tenderStatus" IS NOT NULL)::bigint AS tender_nonnull,
        COUNT(*) FILTER (WHERE "solicitationNumber" IS NOT NULL AND TRIM("solicitationNumber") <> '')::bigint AS solicitation_nonnull,
        0::bigint AS with_bid_rel
      FROM "Project" p
    `
    );
    console.log({
      tenderStatus_nonnull: Number(tender[0]?.tender_nonnull ?? 0),
      solicitationNumber_nonnull: Number(tender[0]?.solicitation_nonnull ?? 0),
      projects_with_BidDataRevision: Number(tender[0]?.with_bid_rel ?? 0),
    });
  } catch (e) {
    console.log("  tender/bid probe ERROR:", e instanceof Error ? e.message : e);
  }

  console.log("\n=== Phase 4/5 column presence (expect false on prod pre-migrate) ===");
  const colChecks = [
    ["Project", "workDomain"],
    ["Task", "sourceType"],
    ["Task", "sourceId"],
    ["Task", "sourceTemplateKey"],
  ];
  for (const [table, col] of colChecks) {
    const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 AND column_name=$2
       ) AS exists`,
      table,
      col
    );
    console.log(`  ${table}.${col}: ${rows[0]?.exists ? "PRESENT" : "ABSENT"}`);
  }
  console.log(`  ProjectHandoff table: ${(await tableExists("ProjectHandoff")) ? "PRESENT" : "ABSENT"}`);

  console.log("\n=== _prisma_migrations (read-only) ===");
  const migrations = await prisma.$queryRawUnsafe<
    Array<{
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
      applied_steps_count: number;
      checksum: string;
    }>
  >(`
    SELECT migration_name, finished_at, rolled_back_at, applied_steps_count, checksum
    FROM "_prisma_migrations"
    ORDER BY started_at ASC NULLS LAST, migration_name ASC
  `);

  const names = migrations.map((m) => m.migration_name);
  const hasGreenfield = names.includes("00000000000000_greenfield_baseline_pre_phase4");
  const hasP4 = names.includes("20260728120000_project_work_domain");
  const hasP5 = names.includes("20260728180000_project_handoff");
  const failed = migrations.filter((m) => m.finished_at == null && m.rolled_back_at == null);
  const rolledUnresolved = migrations.filter(
    (m) => m.rolled_back_at != null && m.finished_at == null
  );
  const baselineDup = migrations.filter((m) =>
    m.migration_name.includes("baseline_before_launch")
  );

  console.log(`total_rows: ${migrations.length}`);
  console.log(`greenfield_baseline_registered: ${hasGreenfield}`);
  console.log(`phase4_registered: ${hasP4}`);
  console.log(`phase5_registered: ${hasP5}`);
  console.log(`failed_unfinished: ${failed.length}`);
  console.log(`rolled_back_unresolved_count: ${rolledUnresolved.length}`);
  console.log(`baseline_before_launch_rows: ${baselineDup.length}`);
  for (const m of baselineDup) {
    console.log(
      `  baseline_dup: finished=${m.finished_at != null} rolled_back=${m.rolled_back_at != null} steps=${m.applied_steps_count}`
    );
  }
  if (failed.length) {
    console.log("FAILED:");
    for (const m of failed) console.log(`  - ${m.migration_name}`);
  }

  // List last 15 for sanity
  console.log("\nlast_15_migrations:");
  for (const m of migrations.slice(-15)) {
    const state =
      m.rolled_back_at != null ? "rolled_back" : m.finished_at != null ? "applied" : "pending/failed";
    console.log(`  ${m.migration_name} [${state}]`);
  }

  // Extensions / views / triggers / functions summary (counts only)
  console.log("\n=== custom SQL object counts ===");
  const ext = await prisma.$queryRawUnsafe<Array<{ extname: string }>>(
    `SELECT extname FROM pg_extension ORDER BY extname`
  );
  console.log("extensions:", ext.map((e) => e.extname).join(", "));

  const views = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*)::bigint AS c FROM information_schema.views WHERE table_schema='public'`
  );
  const triggers = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*)::bigint AS c FROM information_schema.triggers WHERE trigger_schema='public'`
  );
  const funcs = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*)::bigint AS c FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`
  );
  const policies = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*)::bigint AS c FROM pg_policies WHERE schemaname='public'`
  );
  console.log({
    views: Number(views[0]?.c ?? 0),
    triggers: Number(triggers[0]?.c ?? 0),
    public_functions: Number(funcs[0]?.c ?? 0),
    policies: Number(policies[0]?.c ?? 0),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
