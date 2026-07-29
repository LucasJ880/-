/**
 * Phase C：空库完整重放 active migrations（不碰生产）
 *
 *   DATABASE_ENVIRONMENT=isolated|staging \
 *   GREENFIELD_DATABASE_URL=... \
 *   GREENFIELD_DIRECT_URL=... \
 *   ALLOW_DATABASE_MIGRATION=true \
 *   npx tsx scripts/phase-c-greenfield-replay.ts
 *
 * GREENFIELD_* 必须是可丢弃的空库/新 Branch；禁止生产 host。
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PRODUCTION_HOST_MARKERS = ["ep-super-field", "ep-raspy-credit"];
const ALLOWED_ENV = new Set(["isolated", "staging"]);

function cleanUrl(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, "");
}

function maskHost(host: string): string {
  if (host.length <= 18) return `${host.slice(0, 8)}…`;
  return `${host.slice(0, 14)}…${host.slice(-10)}`;
}

function parseHost(raw: string): { host: string; fingerprint: string } {
  const cleaned = cleanUrl(raw);
  const u = new URL(cleaned.replace(/^postgresql:/i, "http:"));
  return {
    host: u.hostname.toLowerCase(),
    fingerprint: createHash("sha256").update(cleaned).digest("hex").slice(0, 12),
  };
}

function isProdHost(host: string): boolean {
  if (PRODUCTION_HOST_MARKERS.some((m) => host.includes(m))) return true;
  if (host.includes("prod") || host.includes("production")) return true;
  return false;
}

function fail(msg: string): never {
  console.error(`[greenfield-replay] FAIL: ${msg}`);
  console.log("GREENFIELD_REPLAY = FAIL");
  process.exit(1);
}

function main() {
  const envTag = (process.env.DATABASE_ENVIRONMENT || "").trim().toLowerCase();
  if (!ALLOWED_ENV.has(envTag)) fail("DATABASE_ENVIRONMENT 必须为 isolated 或 staging");
  if (process.env.ALLOW_DATABASE_MIGRATION !== "true") {
    fail("需要 ALLOW_DATABASE_MIGRATION=true");
  }

  const url = process.env.GREENFIELD_DATABASE_URL;
  const direct = process.env.GREENFIELD_DIRECT_URL || url;
  if (!url?.trim()) fail("必须提供 GREENFIELD_DATABASE_URL");
  if (!direct?.trim()) fail("必须提供 GREENFIELD_DIRECT_URL（或与 DATABASE 相同）");

  const info = parseHost(url!);
  const directInfo = parseHost(direct!);
  if (isProdHost(info.host) || isProdHost(directInfo.host)) {
    fail(`拒绝生产 host（${maskHost(info.host)}）`);
  }

  const prod = process.env.DATABASE_URL || "";
  if (prod.trim()) {
    try {
      const p = parseHost(prod);
      if (p.fingerprint === info.fingerprint) fail("GREENFIELD URL 与生产 URL 指纹相同");
    } catch {
      /* ignore */
    }
  }

  const migDir = join(process.cwd(), "prisma/migrations");
  const migrations = existsSync(migDir)
    ? readdirSync(migDir)
        .filter((n) => statSync(join(migDir, n)).isDirectory() && /^\d+_/.test(n))
        .sort()
    : [];

  console.log("[greenfield-replay] 目标（脱敏）");
  console.log(`  environment=${envTag}`);
  console.log(`  host=${maskHost(info.host)}`);
  console.log(`  urlFingerprint=${info.fingerprint}`);
  console.log(`  migrations=${migrations.length}: ${migrations.join(", ")}`);

  const env = {
    ...process.env,
    DATABASE_URL: cleanUrl(url!),
    DIRECT_URL: cleanUrl(direct!),
  };

  console.log("[greenfield-replay] prisma migrate deploy …");
  const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env,
  });
  if ((r.status ?? 1) !== 0) fail("migrate deploy 失败");

  console.log("[greenfield-replay] prisma generate …");
  const g = spawnSync("npx", ["prisma", "generate"], { stdio: "inherit", env });
  if ((g.status ?? 1) !== 0) fail("prisma generate 失败");

  console.log("[greenfield-replay] postcheck …");
  const p = spawnSync("npx", ["tsx", "scripts/phase-c-isolated-postcheck.ts"], {
    stdio: "inherit",
    env: {
      ...env,
      ISOLATED_DATABASE_URL: cleanUrl(url!),
      ISOLATED_DIRECT_URL: cleanUrl(direct!),
      DATABASE_ENVIRONMENT: envTag,
    },
  });
  if ((p.status ?? 1) !== 0) fail("postcheck 失败");

  console.log("GREENFIELD_REPLAY = PASS");
}

main();
