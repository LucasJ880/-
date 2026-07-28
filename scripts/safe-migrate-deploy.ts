#!/usr/bin/env tsx
/**
 * 受控 prisma migrate deploy
 *
 * 要求：
 *   ALLOW_DATABASE_MIGRATION=true
 *   生产额外：CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION
 *
 * 不会打印完整 DATABASE_URL / 密码 / token。
 * 无法确认环境时拒绝执行。
 */

import { spawnSync } from "node:child_process";

function maskDbUrl(raw: string): {
  host: string;
  database: string;
  user: string;
  neonBranchHint: string | null;
} {
  try {
    const u = new URL(raw.replace(/^postgresql:/i, "http:"));
    const host = u.hostname;
    const database = u.pathname.replace(/^\//, "") || "(unknown)";
    const user = decodeURIComponent(u.username || "(unknown)");
    let neonBranchHint: string | null = null;
    // Neon host 形如 ep-xxx-pooler.region.aws.neon.tech
    if (host.includes("neon.tech")) {
      neonBranchHint = host.split(".")[0] || host;
    }
    return { host, database, user, neonBranchHint };
  } catch {
    throw new Error("DATABASE_URL 无法解析，拒绝执行 migration");
  }
}

function isLikelyProductionTarget(info: {
  host: string;
  neonBranchHint: string | null;
}): boolean {
  const host = info.host.toLowerCase();
  const hint = (info.neonBranchHint || "").toLowerCase();
  if (process.env.FORCE_TREAT_AS_PRODUCTION === "true") return true;
  // 明确的生产/主库命名信号（不依赖 NODE_ENV）
  if (host.includes("prod") || host.includes("production")) return true;
  if (hint.includes("prod") || hint.includes("main") || hint.includes("primary")) {
    return true;
  }
  // 当前共享 Neon 主机（事故库）视为受保护目标
  if (host.includes("ep-raspy-credit") || host.includes("ep-super-field")) {
    return true;
  }
  return false;
}

function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
  if (!databaseUrl) {
    console.error("[safe-migrate-deploy] 缺少 DATABASE_URL / DIRECT_URL");
    process.exit(1);
  }

  if (process.env.ALLOW_DATABASE_MIGRATION !== "true") {
    console.error(
      "[safe-migrate-deploy] 拒绝：需要显式 ALLOW_DATABASE_MIGRATION=true",
    );
    process.exit(1);
  }

  let info: ReturnType<typeof maskDbUrl>;
  try {
    info = maskDbUrl(databaseUrl);
  } catch (e) {
    console.error(
      "[safe-migrate-deploy]",
      e instanceof Error ? e.message : "DATABASE_URL 无效",
    );
    process.exit(1);
  }

  const nodeEnv = process.env.NODE_ENV || "(unset)";
  const productionLike = isLikelyProductionTarget(info);

  console.log("[safe-migrate-deploy] 目标摘要（已脱敏）:");
  console.log(`  host=${info.host}`);
  console.log(`  database=${info.database}`);
  console.log(`  user=${info.user}`);
  console.log(`  neonEndpoint=${info.neonBranchHint || "(n/a)"}`);
  console.log(`  NODE_ENV=${nodeEnv}`);
  console.log(`  protectedTarget=${productionLike}`);

  if (productionLike) {
    const confirm = process.env.CONFIRM_PRODUCTION_MIGRATION;
    if (confirm !== "I_UNDERSTAND_PRODUCTION_MIGRATION") {
      console.error(
        "[safe-migrate-deploy] 拒绝：受保护数据库需要 CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION",
      );
      process.exit(1);
    }
  }

  console.log("[safe-migrate-deploy] 运行 prisma migrate deploy …");
  const result = spawnSync(
    "npx",
    ["prisma", "migrate", "deploy"],
    { stdio: "inherit", env: process.env },
  );
  process.exit(result.status ?? 1);
}

main();
