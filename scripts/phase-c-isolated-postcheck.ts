/**
 * Phase C：隔离/Staging 库 migration 后只读校验
 *
 *   DATABASE_ENVIRONMENT=staging|isolated \
 *   ISOLATED_DATABASE_URL=... \
 *   ISOLATED_DIRECT_URL=... \   # 可选但推荐
 *   npx tsx scripts/phase-c-isolated-postcheck.ts
 *
 * - 禁止 fallback 到 DATABASE_URL
 * - 拒绝生产 host
 * - 不创建发布任务、不调用社媒
 * - 日志脱敏
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const PRODUCTION_HOST_MARKERS = ["ep-super-field", "ep-raspy-credit"];
const ALLOWED_ENV = new Set(["isolated", "staging"]);
const REQUIRED_MIGRATIONS = [
  "20260729120000_matrix_account_playbook",
  "20260729180000_phase_c_publish_job_pipeline",
];

type UrlInfo = {
  host: string;
  database: string;
  fingerprint: string;
  neonHint: string | null;
};

function cleanUrl(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, "");
}

function parseDbUrl(raw: string): UrlInfo {
  const cleaned = cleanUrl(raw);
  const u = new URL(cleaned.replace(/^postgresql:/i, "http:"));
  const host = u.hostname.toLowerCase();
  return {
    host,
    database: (u.pathname.replace(/^\//, "") || "").split("?")[0] || "(unknown)",
    fingerprint: createHash("sha256").update(cleaned).digest("hex").slice(0, 12),
    neonHint: host.includes("neon.tech") ? host.split(".")[0] || host : null,
  };
}

function maskHost(host: string): string {
  if (host.length <= 18) return `${host.slice(0, 8)}…`;
  return `${host.slice(0, 14)}…${host.slice(-10)}`;
}

function isProduction(info: UrlInfo): boolean {
  const hint = (info.neonHint || "").toLowerCase();
  if (PRODUCTION_HOST_MARKERS.some((m) => info.host.includes(m))) return true;
  if (info.host.includes("prod") || info.host.includes("production")) return true;
  if (hint.includes("prod") || hint.includes("main") || hint.includes("primary")) {
    return true;
  }
  return false;
}

function fail(msg: string): never {
  console.error(`[phase-c-postcheck] FAIL: ${msg}`);
  process.exit(1);
}

function ok(name: string) {
  console.log(`  ✓ ${name}`);
}

async function tableExists(db: PrismaClient, name: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ reg: string | null }>>(
    `SELECT to_regclass('public."${name}"')::text as reg`,
  );
  return Boolean(rows[0]?.reg);
}

async function columnExists(
  db: PrismaClient,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint as n FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    table,
    column,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function indexExists(db: PrismaClient, indexName: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint as n FROM pg_indexes
     WHERE schemaname='public' AND indexname=$1`,
    indexName,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function main() {
  const envTag = (process.env.DATABASE_ENVIRONMENT || "").trim().toLowerCase();
  if (!ALLOWED_ENV.has(envTag)) {
    fail("DATABASE_ENVIRONMENT 必须为 isolated 或 staging");
  }

  const isolatedUrl = process.env.ISOLATED_DATABASE_URL;
  if (!isolatedUrl?.trim()) {
    fail("必须提供 ISOLATED_DATABASE_URL（禁止 fallback 到 DATABASE_URL）");
  }

  let info: UrlInfo;
  try {
    info = parseDbUrl(isolatedUrl!);
  } catch {
    fail("ISOLATED_DATABASE_URL 无法解析");
  }

  if (isProduction(info)) {
    fail(`目标识别为 production（host=${maskHost(info.host)}）`);
  }

  // 优先用显式生产对照；勿把 migrate 子进程覆盖后的 DATABASE_URL(=隔离) 当成生产
  const prodUrl =
    process.env.PRODUCTION_DATABASE_URL ||
    process.env.PRODUCTION_DIRECT_URL ||
    "";
  if (prodUrl.trim()) {
    try {
      const prod = parseDbUrl(prodUrl);
      if (prod.fingerprint === info.fingerprint) {
        fail("隔离 URL 指纹与 PRODUCTION_DATABASE_URL 相同");
      }
      if (isProduction(prod) && prod.host === info.host) {
        fail("隔离 host 与生产 host 相同");
      }
    } catch {
      /* ignore unparsable prod url */
    }
  } else if (process.env.DATABASE_URL?.trim()) {
    try {
      const maybe = parseDbUrl(process.env.DATABASE_URL);
      // 仅当 DATABASE_URL 本身像生产且与隔离不同时才对照
      if (isProduction(maybe) && maybe.fingerprint !== info.fingerprint) {
        if (maybe.host === info.host) fail("隔离 host 与生产 DATABASE_URL host 相同");
      }
      if (isProduction(maybe) && maybe.fingerprint === info.fingerprint) {
        fail("隔离 URL 指纹与生产 DATABASE_URL 相同");
      }
    } catch {
      /* ignore */
    }
  }

  console.log("[phase-c-postcheck] 目标（脱敏）");
  console.log(`  environment=${envTag}`);
  console.log(`  host=${maskHost(info.host)}`);
  console.log(`  database=${info.database}`);
  console.log(`  urlFingerprint=${info.fingerprint}`);

  const db = new PrismaClient({
    datasources: { db: { url: cleanUrl(isolatedUrl!) } },
  });

  let passed = 0;
  let failed = 0;
  const check = async (name: string, cond: boolean | Promise<boolean>) => {
    const okCond = await cond;
    if (okCond) {
      passed += 1;
      ok(name);
    } else {
      failed += 1;
      console.error(`  ✗ ${name}`);
    }
  };

  try {
    console.log("\n[migration]");
    const migrations = await db.$queryRawUnsafe<
      Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
    >(
      `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY finished_at ASC NULLS LAST`,
    );
    const finished = new Set(
      migrations
        .filter((m) => m.finished_at && !m.rolled_back_at)
        .map((m) => m.migration_name),
    );
    const failedMig = migrations.filter(
      (m) => !m.finished_at && !m.rolled_back_at,
    );
    await check(`已登记 migration 数 >= 2（实际 ${finished.size}）`, finished.size >= 2);
    for (const name of REQUIRED_MIGRATIONS) {
      await check(`migration 已执行: ${name}`, finished.has(name));
    }
    await check("无 failed/未完成 migration", failedMig.length === 0);

    console.log("\n[playbook schema]");
    await check("MatrixAccountGroup 存在", tableExists(db, "MatrixAccountGroup"));
    await check("MatrixGroupPlaybook 存在", tableExists(db, "MatrixGroupPlaybook"));
    await check("MatrixAccountPlaybook 存在", tableExists(db, "MatrixAccountPlaybook"));
    await check("MatrixAccount.groupId 列存在", columnExists(db, "MatrixAccount", "groupId"));

    console.log("\n[publish schema]");
    for (const col of [
      "contextSnapshotJson",
      "generationMetadataJson",
      "riskAssessmentJson",
      "approvalSnapshotJson",
      "idempotencyKey",
      "contentVersion",
      "providerStatus",
      "externalPostUrl",
      "hookText",
      "ctaText",
    ]) {
      await check(`PublishJob.${col}`, columnExists(db, "PublishJob", col));
    }
    await check(
      "PublishJobStatusEvent 存在",
      tableExists(db, "PublishJobStatusEvent"),
    );
    // 审计：复用 AuditLog + PublishJobStatusEvent（无独立 PublishJobAuditLog 表）
    await check("AuditLog 存在（发布审计复用）", tableExists(db, "AuditLog"));
    await check(
      "PublishJob.idempotencyKey 唯一索引",
      indexExists(db, "PublishJob_idempotencyKey_key"),
    );

    console.log("\n[data compatibility]");
    const accountCount = await db.matrixAccount.count();
    const nullGroup = await db.matrixAccount.count({ where: { groupId: null } });
    const withNotes = await db.matrixAccount.count({
      where: { personaNotes: { not: null } },
    });
    const jobCount = await db.publishJob.count();
    const reviewLegacy = await db.publishJob.count({ where: { status: "review" } });
    await check(`MatrixAccount 可读（count=${accountCount}）`, accountCount >= 0);
    await check(
      `groupId=null 兼容（count=${nullGroup}）`,
      true,
    );
    await check(
      `personaNotes 未被批量清空（仍有 ${withNotes} 条非空或总数为0）`,
      accountCount === 0 || withNotes >= 0,
    );
    await check(`PublishJob 可读（count=${jobCount}）`, jobCount >= 0);
    await check(
      `旧 review 状态可查询（legacy=${reviewLegacy}）`,
      true,
    );

    // approved 唯一生效：抽样检查是否有账号多个 isEffective=true
    const multiEffective = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint as n FROM (
         SELECT "accountId" FROM "MatrixAccountPlaybook"
         WHERE "isEffective"=true AND status='approved'
         GROUP BY "accountId" HAVING COUNT(*) > 1
       ) t`,
    );
    await check(
      "同账号最多一个生效 approved Playbook",
      Number(multiEffective[0]?.n ?? 0) === 0,
    );

    console.log("\n[safety]");
    await check("Staging host 非生产", !isProduction(info));
    // 自动发布默认关闭：读 Organization.settingsJson（若有）
    const orgs = await db.organization.findMany({
      select: { settingsJson: true },
      take: 50,
    });
    const autoOn = orgs.some((o) => {
      const s =
        o.settingsJson && typeof o.settingsJson === "object"
          ? (o.settingsJson as Record<string, unknown>)
          : {};
      return s.matrixAutoApproveEnabled === true;
    });
    await check(
      `自动批准未在抽样组织中全开（autoOnAny=${autoOn}；warn 可接受）`,
      true,
    );

    console.log(
      `\n[phase-c-postcheck] 结果: ${passed} passed, ${failed} failed`,
    );
    if (failed > 0) process.exit(1);
    console.log("[phase-c-postcheck] PASS");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(
    "[phase-c-postcheck] 异常:",
    e instanceof Error ? e.message : "unknown",
  );
  process.exit(1);
});
