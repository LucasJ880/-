/**
 * Bid Workflow Phase1：隔离库 migration 后抽查（不打印连接串）。
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const env = (process.env.DATABASE_ENVIRONMENT || "").toLowerCase();
  if (env !== "isolated") {
    throw new Error("DATABASE_ENVIRONMENT must be isolated");
  }

  const required = [
    "Project",
    "BidIntelligenceRoom",
    "BidIntelligenceModule",
    "BidIntelligenceFact",
    "ProjectSupplierLink",
    "ProjectJoinBrief",
    "ProjectGeneratedDocument",
    "User",
    "Organization",
    "AuditLog",
  ];
  const rows = (await db.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`,
  )) as Array<{ tablename: string }>;
  const names = new Set(rows.map((r) => r.tablename));
  const missing = required.filter((t) => !names.has(t));
  console.log("[bid-iso-verify] public_table_count=", names.size);
  console.log("[bid-iso-verify] required_missing=", missing);

  const idxs = (await db.$queryRawUnsafe(`
    SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND (indexname ILIKE '%BidIntelligence%' OR indexname ILIKE '%ProjectSupplierLink%'
      OR indexname ILIKE '%ProjectJoinBrief%' OR indexname ILIKE '%ProjectGeneratedDocument%')
    ORDER BY 1`)) as Array<{ indexname: string }>;
  console.log(
    "[bid-iso-verify] bid_indexes=",
    idxs.map((i) => i.indexname),
  );

  const mig = (await db.$queryRawUnsafe(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at`,
  )) as Array<{ migration_name: string }>;
  console.log(
    "[bid-iso-verify] applied=",
    mig.map((m) => m.migration_name),
  );

  if (missing.length) throw new Error("missing tables: " + missing.join(","));
  if (!idxs.some((i) => i.indexname.includes("BidIntelligenceRoom_projectId"))) {
    throw new Error("missing room project unique");
  }
  if (!idxs.some((i) => i.indexname.includes("moduleKey"))) {
    throw new Error("missing module unique");
  }
  if (!mig.some((m) => m.migration_name === "20260803200000_bid_workflow_phase1")) {
    throw new Error("bid_workflow_phase1 migration not applied");
  }
  console.log("[bid-iso-verify] PASS");
}

main()
  .catch((e) => {
    console.error("[bid-iso-verify] FAIL", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
