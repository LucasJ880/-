/**
 * Preview DB isolation fail-closed guard.
 *
 * When VERCEL_ENV=preview (or CHECK_PREVIEW_DB_ISOLATION=1),
 * DATABASE_URL / DIRECT_URL must NOT point at the known production Neon host.
 *
 * Does not print connection strings. Host prefixes are not secrets.
 *
 * Usage:
 *   npx tsx scripts/check-preview-db-isolation.ts
 *   CHECK_PREVIEW_DB_ISOLATION=1 DATABASE_URL=... npx tsx scripts/check-preview-db-isolation.ts
 */

import { parse as parsePgUrl } from "node:url";

/** Known production Neon endpoint fingerprint (public host id, not a secret). */
export const PRODUCTION_NEON_HOST_PREFIX = "ep-super-field-antfibsl";

export type IsolationCheckInput = {
  vercelEnv: string | undefined;
  forceCheck?: boolean;
  databaseUrl?: string;
  directUrl?: string;
  /** Optional override; defaults to PRODUCTION_NEON_HOST_PREFIX */
  productionHostPrefix?: string;
};

export type IsolationCheckResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; databaseHost: string | null; directHost: string | null }
  | {
      ok: false;
      skipped: false;
      code: "BLOCKED_BY_PREVIEW_DATABASE_IDENTITY";
      databaseHost: string | null;
      directHost: string | null;
      matched: string[];
    };

function hostOf(url: string | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  try {
    // postgres:// URLs work with WHATWG URL in Node
    const u = new URL(raw);
    return u.hostname || null;
  } catch {
    try {
      const u = parsePgUrl(raw);
      return u.hostname || null;
    } catch {
      return null;
    }
  }
}

export function checkPreviewDbIsolation(
  input: IsolationCheckInput,
): IsolationCheckResult {
  const env = (input.vercelEnv ?? "").trim().toLowerCase();
  const shouldCheck = env === "preview" || input.forceCheck === true;
  if (!shouldCheck) {
    return {
      ok: true,
      skipped: true,
      reason: env ? `VERCEL_ENV=${env}` : "VERCEL_ENV unset",
    };
  }

  const prefix = (
    input.productionHostPrefix ?? PRODUCTION_NEON_HOST_PREFIX
  ).trim();
  const databaseHost = hostOf(input.databaseUrl);
  const directHost = hostOf(input.directUrl);
  const matched: string[] = [];
  if (!databaseHost) {
    matched.push("DATABASE_URL:missing");
  } else if (databaseHost.includes(prefix)) {
    matched.push(`DATABASE_URL:${databaseHost}`);
  }
  if (!directHost) {
    matched.push("DIRECT_URL:missing");
  } else if (directHost.includes(prefix)) {
    matched.push(`DIRECT_URL:${directHost}`);
  }

  if (matched.length > 0) {
    return {
      ok: false,
      skipped: false,
      code: "BLOCKED_BY_PREVIEW_DATABASE_IDENTITY",
      databaseHost,
      directHost,
      matched,
    };
  }

  return {
    ok: true,
    skipped: false,
    databaseHost,
    directHost,
  };
}

function main() {
  const result = checkPreviewDbIsolation({
    vercelEnv: process.env.VERCEL_ENV,
    forceCheck: process.env.CHECK_PREVIEW_DB_ISOLATION === "1",
    databaseUrl: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
    productionHostPrefix: process.env.PRODUCTION_DB_HOST_PREFIX,
  });

  if (result.skipped) {
    console.log(`[preview-db-isolation] skip (${result.reason})`);
    process.exit(0);
  }
  if (!result.ok) {
    console.error(
      `[preview-db-isolation] FAIL ${result.code}: Preview DB host matches production fingerprint`,
    );
    for (const m of result.matched) {
      console.error(`  - ${m}`);
    }
    process.exit(1);
  }
  console.log(
    `[preview-db-isolation] ok databaseHost=${result.databaseHost ?? "missing"} directHost=${result.directHost ?? "missing"}`,
  );
  process.exit(0);
}

const isMain =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("check-preview-db-isolation.ts") ||
    process.argv[1].endsWith("check-preview-db-isolation.js"));

if (isMain) {
  main();
}
