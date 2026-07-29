import { PrismaClient } from "@prisma/client";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

async function main() {
  const db = new PrismaClient();
  const rows = (await db.$queryRawUnsafe(`
    SELECT migration_name, checksum, started_at, finished_at, rolled_back_at,
           applied_steps_count,
           CASE WHEN logs IS NULL THEN NULL ELSE left(logs::text, 120) END AS logs_preview
    FROM _prisma_migrations
    ORDER BY started_at
  `)) as Array<{
    migration_name: string;
    checksum: string;
    started_at: Date;
    finished_at: Date | null;
    rolled_back_at: Date | null;
    applied_steps_count: number;
    logs_preview: string | null;
  }>;

  const localDir = join(process.cwd(), "prisma/migrations");
  const local = readdirSync(localDir).filter((n) =>
    existsSync(join(localDir, n, "migration.sql")),
  );

  const dbMap = new Map(rows.map((r) => [r.migration_name, r]));
  const all = new Set([...local, ...rows.map((r) => r.migration_name)]);

  const report: Array<Record<string, string>> = [];
  for (const name of [...all].sort()) {
    const file = join(localDir, name, "migration.sql");
    const hasLocal = existsSync(file);
    const rec = dbMap.get(name);
    let localChecksum = "";
    if (hasLocal) {
      const sql = readFileSync(file);
      localChecksum = createHash("sha256").update(sql).digest("hex");
    }
    let classification = "";
    let action = "";
    if (hasLocal && rec) {
      if (rec.rolled_back_at) {
        classification = "已标记 rolled back";
        action = "调查回滚原因";
      } else if (!rec.finished_at) {
        classification = "migration 失败或未完成";
        action = "暂停；修复后重试";
      } else if (localChecksum && localChecksum !== rec.checksum) {
        classification = "Checksum 不一致";
        action = "发布阻塞；禁止 resolve";
      } else {
        classification = "本地和数据库均存在且一致";
        action = "保持";
      }
    } else if (!hasLocal && rec) {
      classification = "数据库存在，本地缺失";
      action = "从真实历史恢复";
    } else if (hasLocal && !rec) {
      classification = "本地存在，数据库未登记";
      action = "隔离分支 migrate deploy 或核验后 resolve";
    }
    report.push({
      migration: name,
      localFile: hasLocal ? "yes" : "no",
      dbRecord: rec ? "yes" : "no",
      checksumMatch:
        hasLocal && rec
          ? localChecksum === rec.checksum
            ? "yes"
            : "NO"
          : "n/a",
      finished: rec?.finished_at ? "yes" : rec ? "no" : "n/a",
      rolledBack: rec?.rolled_back_at ? "yes" : "no",
      classification,
      action,
      dbChecksum: rec?.checksum || "",
      localChecksum,
    });
  }

  const nameCounts = new Map<string, number>();
  for (const r of rows) {
    nameCounts.set(r.migration_name, (nameCounts.get(r.migration_name) || 0) + 1);
  }
  const duplicates = [...nameCounts.entries()].filter(([, n]) => n > 1);

  console.log(
    JSON.stringify(
      {
        countDbRows: rows.length,
        countDbUnique: nameCounts.size,
        countLocal: local.length,
        duplicates: duplicates.map(([name, n]) => ({ name, n })),
        report,
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
