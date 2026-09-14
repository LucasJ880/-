/**
 * 只读 DB 往返基准：仅 SELECT 1。
 *
 *   npx tsx scripts/performance/benchmark-db.ts
 *   npx tsx scripts/performance/benchmark-db.ts --allow-production
 *
 * 默认拒绝 production Neon。不创建/删除业务数据，不跑 migrate。
 */
import { parseArgs } from "node:util";
import { inspectDatabaseTarget } from "@/lib/db-safety/target";
import {
  QYANE_PERFORMANCE_BUDGET,
  extractNeonAwsRegionFromHost,
} from "@/lib/performance";

async function main() {
  const { values } = parseArgs({
    options: {
      "allow-production": { type: "boolean", default: false },
      samples: { type: "string" },
    },
    strict: true,
  });

  const identity = inspectDatabaseTarget(process.env.DATABASE_URL);
  if (!identity) {
    console.error("DATABASE_URL missing or unparseable — skip (no connection attempted)");
    process.exit(0);
    return;
  }

  if (identity.isProduction && !values["allow-production"]) {
    console.error(
      "refused: production database (pass --allow-production to override). No query executed.",
    );
    process.exit(2);
    return;
  }

  if (identity.environment === "unknown") {
    console.error("refused: unknown database target (fail-closed). No query executed.");
    process.exit(2);
    return;
  }

  const samples = Math.max(1, Math.min(20, Number(values.samples || 5) || 5));
  const region = extractNeonAwsRegionFromHost(identity.host);
  console.log(
    `perf:db env=${identity.environment} pooled=${identity.pooled} region=${region ?? "UNKNOWN"} samples=${samples}`,
  );
  console.log(`budget db-only <${QYANE_PERFORMANCE_BUDGET.dbOnlyTargetMs}ms`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const times: number[] = [];
  try {
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      times.push(Date.now() - t0);
    }
  } finally {
    await prisma.$disconnect();
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor((times.length - 1) * 0.5)]!;
  const p95 = times[Math.floor((times.length - 1) * 0.95)]!;
  console.log(`SELECT 1                       p50=${p50}  p95=${p95}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
