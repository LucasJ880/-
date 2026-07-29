/**
 * Phase C：仅在隔离/Staging 数据库执行 migration（禁止生产）
 *
 * 用法（连接串勿写入 shell 历史；用 read -s 或未提交 secret 文件）：
 *
 *   DATABASE_ENVIRONMENT=isolated \
 *   ALLOW_DATABASE_MIGRATION=true \
 *   ISOLATED_DATABASE_URL=... \
 *   ISOLATED_DIRECT_URL=... \
 *   npx tsx scripts/phase-c-isolated-migrate.ts
 *
 * 硬性规则：
 * - 不 fallback 到 DATABASE_URL / DIRECT_URL
 * - 不自动设置 ALLOW_DATABASE_MIGRATION
 * - 不打印完整 URL / 用户名 / 密码
 * - 拒绝生产 host / 与生产 URL 相同的目标
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PRODUCTION_HOST_MARKERS = [
  "ep-super-field",
  "ep-raspy-credit", // 历史事故共享库，禁止当隔离验证目标
];

const ALLOWED_ENV = new Set(["isolated", "staging"]);

type UrlInfo = {
  host: string;
  database: string;
  userPresent: boolean;
  passwordPresent: boolean;
  neonEndpointHint: string | null;
  fingerprint: string;
};

function cleanUrl(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, "");
}

function parseDbUrl(raw: string): UrlInfo {
  const cleaned = cleanUrl(raw);
  const u = new URL(cleaned.replace(/^postgresql:/i, "http:"));
  const host = u.hostname.toLowerCase();
  const database = (u.pathname.replace(/^\//, "") || "").split("?")[0] || "(unknown)";
  const neonEndpointHint = host.includes("neon.tech")
    ? host.split(".")[0] || host
    : null;
  const fingerprint = createHash("sha256")
    .update(cleaned)
    .digest("hex")
    .slice(0, 12);
  return {
    host,
    database,
    userPresent: Boolean(u.username),
    passwordPresent: Boolean(u.password),
    neonEndpointHint,
    fingerprint,
  };
}

function maskHost(host: string): string {
  if (host.length <= 18) return `${host.slice(0, 8)}…`;
  return `${host.slice(0, 14)}…${host.slice(-10)}`;
}

function classifyTarget(info: UrlInfo): "production" | "isolated_candidate" | "unknown" {
  const host = info.host;
  const hint = (info.neonEndpointHint || "").toLowerCase();
  if (PRODUCTION_HOST_MARKERS.some((m) => host.includes(m))) return "production";
  if (host.includes("prod") || host.includes("production")) return "production";
  if (hint.includes("prod") || hint.includes("main") || hint.includes("primary")) {
    return "production";
  }
  return "isolated_candidate";
}

function listPendingMigrations(): string[] {
  const dir = join(process.cwd(), "prisma/migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory() && /^\d+_/.test(n))
    .sort();
}

function fail(msg: string): never {
  console.error(`[phase-c-isolated-migrate] 拒绝：${msg}`);
  process.exit(1);
}

function main() {
  const envTag = (process.env.DATABASE_ENVIRONMENT || "").trim().toLowerCase();
  if (!ALLOWED_ENV.has(envTag)) {
    fail("DATABASE_ENVIRONMENT 必须为 isolated 或 staging");
  }
  if (process.env.ALLOW_DATABASE_MIGRATION !== "true") {
    fail("需要显式 ALLOW_DATABASE_MIGRATION=true");
  }

  const isolatedUrl = process.env.ISOLATED_DATABASE_URL;
  const isolatedDirect = process.env.ISOLATED_DIRECT_URL;
  if (!isolatedUrl?.trim()) fail("必须提供 ISOLATED_DATABASE_URL（禁止 fallback）");
  if (!isolatedDirect?.trim()) fail("必须提供 ISOLATED_DIRECT_URL（禁止 fallback）");

  // 禁止脚本读到生产 env 后误用：若生产 URL 与隔离 URL 指纹相同则拒绝
  const prodUrl = process.env.DATABASE_URL || process.env.DIRECT_URL || "";
  let isolatedInfo: UrlInfo;
  let directInfo: UrlInfo;
  try {
    isolatedInfo = parseDbUrl(isolatedUrl);
    directInfo = parseDbUrl(isolatedDirect);
  } catch {
    fail("ISOLATED_* URL 无法解析");
  }

  if (prodUrl.trim()) {
    try {
      const prodInfo = parseDbUrl(prodUrl);
      if (
        prodInfo.fingerprint === isolatedInfo.fingerprint ||
        prodInfo.fingerprint === directInfo.fingerprint
      ) {
        fail("隔离 URL 与当前生产 DATABASE_URL/DIRECT_URL 相同");
      }
      if (
        classifyTarget(prodInfo) === "production" &&
        isolatedInfo.host === prodInfo.host
      ) {
        fail("隔离 URL host 与生产 DATABASE_URL host 相同");
      }
    } catch {
      // 生产 URL 解析失败不阻断，但仍检查隔离目标自身
    }
  }

  if (classifyTarget(isolatedInfo) === "production") {
    fail(`目标被识别为 production（host=${maskHost(isolatedInfo.host)}）`);
  }
  if (classifyTarget(directInfo) === "production") {
    fail(`DIRECT 目标被识别为 production（host=${maskHost(directInfo.host)}）`);
  }

  const migrations = listPendingMigrations();
  console.log("[phase-c-isolated-migrate] 目标确认（已脱敏）");
  console.log(`  environment=${envTag}`);
  console.log(`  targetClass=isolated_candidate`);
  console.log(`  pooledHost=${maskHost(isolatedInfo.host)}`);
  console.log(`  directHost=${maskHost(directInfo.host)}`);
  console.log(`  database=${isolatedInfo.database}`);
  console.log(`  userPresent=${isolatedInfo.userPresent}`);
  console.log(`  passwordPresent=${isolatedInfo.passwordPresent}`);
  console.log(`  urlFingerprint=${isolatedInfo.fingerprint}`);
  console.log(`  activeMigrationFiles=${migrations.length}`);
  console.log(`  migrations=${migrations.join(", ")}`);
  console.log("[phase-c-isolated-migrate] 运行 prisma migrate deploy（不使用 db push）…");

  // 保留原始生产 URL 供 postcheck 对照（勿把覆盖后的 DATABASE_URL 当成生产）
  const productionRef =
    process.env.PRODUCTION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.DIRECT_URL ||
    "";

  const env = {
    ...process.env,
    DATABASE_URL: cleanUrl(isolatedUrl),
    DIRECT_URL: cleanUrl(isolatedDirect),
    ISOLATED_DATABASE_URL: cleanUrl(isolatedUrl),
    ISOLATED_DIRECT_URL: cleanUrl(isolatedDirect),
    DATABASE_ENVIRONMENT: envTag,
    ...(productionRef.trim()
      ? { PRODUCTION_DATABASE_URL: cleanUrl(productionRef) }
      : {}),
  };
  // 防止子进程日志意外带出：不向 console 回显 env 值
  const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env,
  });
  if ((r.status ?? 1) !== 0) {
    console.error("[phase-c-isolated-migrate] migrate deploy 失败；未切换其他数据库");
    process.exit(r.status ?? 1);
  }

  console.log("[phase-c-isolated-migrate] 跑隔离后校验脚本…");
  const check = spawnSync(
    "npx",
    ["tsx", "scripts/phase-c-isolated-postcheck.ts"],
    { stdio: "inherit", env },
  );
  process.exit(check.status ?? 1);
}

main();
