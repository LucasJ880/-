import { PrismaClient } from "@prisma/client";

async function main() {
  const label = process.argv[2] || "track";
  const db = new PrismaClient();
  const tasks = await db.task.count();
  const projects = await db.project.count();
  const users = await db.user.count();
  const orgs = await db.organization.count();
  const handoffs = await db.projectHandoff.count().catch(() => -1);
  const workDomain = await db.$queryRawUnsafe(
    `SELECT "workDomain", count(*)::int AS n FROM "Project" GROUP BY 1 ORDER BY 2 DESC`,
  );
  const bid = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "BidDataRevision"`,
  );
  const mig = await db.$queryRawUnsafe(
    `SELECT migration_name, finished_at IS NOT NULL AS done
     FROM _prisma_migrations
     WHERE migration_name IN (
       '00000000000000_greenfield_baseline_pre_phase4',
       '20260728120000_project_work_domain',
       '20260728180000_project_handoff'
     )
     ORDER BY migration_name`,
  );
  console.log(
    JSON.stringify(
      { label, tasks, projects, users, orgs, handoffs, workDomain, bid, mig },
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
