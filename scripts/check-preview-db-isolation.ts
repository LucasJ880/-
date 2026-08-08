/**
 * Preview DB isolation fail-closed guard.
 *
 * When VERCEL_ENV=preview (or CHECK_PREVIEW_DB_ISOLATION=1), requires an
 * explicit PREVIEW_DATABASE_MODE:
 *
 * - isolated: DATABASE_URL + DIRECT_URL must exist, parse, and NOT point at
 *   the known production Neon host.
 * - none: Preview declares no DB use; missing DB env is allowed, but any
 *   production / malformed DB URL still fails closed.
 *
 * Production / local (VERCEL_ENV unset) skip. Does not print connection strings.
 *
 * Usage:
 *   npx tsx scripts/check-preview-db-isolation.ts
 *   VERCEL_ENV=preview PREVIEW_DATABASE_MODE=isolated DATABASE_URL=... DIRECT_URL=... \
 *     npx tsx scripts/check-preview-db-isolation.ts
 */

import { parse as parsePgUrl } from "node:url";

/** Known production Neon endpoint fingerprint (public host id, not a secret). */
export const PRODUCTION_NEON_HOST_PREFIX = "ep-super-field-antfibsl";

export type PreviewDatabaseMode = "isolated" | "none";

export type IsolationCheckInput = {
  vercelEnv: string | undefined;
  forceCheck?: boolean;
  /** Explicit Preview DB safety mode (required when preview/forceCheck). */
  previewDatabaseMode?: string;
  databaseUrl?: string;
  directUrl?: string;
  /** Optional override; defaults to PRODUCTION_NEON_HOST_PREFIX */
  productionHostPrefix?: string;
};

export type IsolationCheckResult =
  | { ok: true; skipped: true; reason: string }
  | {
      ok: true;
      skipped: false;
      mode: PreviewDatabaseMode;
      databaseHost: string | null;
      directHost: string | null;
    }
  | {
      ok: false;
      skipped: false;
      code:
        | "BLOCKED_BY_PREVIEW_DATABASE_IDENTITY"
        | "BLOCKED_BY_PREVIEW_DATABASE_MODE";
      databaseHost: string | null;
      directHost: string | null;
      matched: string[];
    };

type UrlInspect =
  | { kind: "missing"; host: null }
  | { kind: "malformed"; host: null }
  | { kind: "ok"; host: string };

function inspectDbUrl(url: string | undefined): UrlInspect {
  const raw = (url ?? "").trim();
  if (!raw) return { kind: "missing", host: null };
  try {
    const u = new URL(raw);
    if (!u.hostname) return { kind: "malformed", host: null };
    return { kind: "ok", host: u.hostname };
  } catch {
    try {
      const u = parsePgUrl(raw);
      if (!u.hostname) return { kind: "malformed", host: null };
      return { kind: "ok", host: u.hostname };
    } catch {
      return { kind: "malformed", host: null };
    }
  }
}

function fail(
  code: "BLOCKED_BY_PREVIEW_DATABASE_IDENTITY" | "BLOCKED_BY_PREVIEW_DATABASE_MODE",
  matched: string[],
  databaseHost: string | null,
  directHost: string | null,
): IsolationCheckResult {
  return {
    ok: false,
    skipped: false,
    code,
    databaseHost,
    directHost,
    matched,
  };
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

  const modeRaw = (input.previewDatabaseMode ?? "").trim().toLowerCase();
  if (!modeRaw) {
    return fail(
      "BLOCKED_BY_PREVIEW_DATABASE_MODE",
      ["PREVIEW_DATABASE_MODE:missing"],
      null,
      null,
    );
  }
  if (modeRaw !== "isolated" && modeRaw !== "none") {
    return fail(
      "BLOCKED_BY_PREVIEW_DATABASE_MODE",
      [`PREVIEW_DATABASE_MODE:invalid:${modeRaw}`],
      null,
      null,
    );
  }
  const mode = modeRaw as PreviewDatabaseMode;

  const prefix = (
    input.productionHostPrefix ?? PRODUCTION_NEON_HOST_PREFIX
  ).trim();
  const database = inspectDbUrl(input.databaseUrl);
  const direct = inspectDbUrl(input.directUrl);
  const databaseHost = database.host;
  const directHost = direct.host;
  const matched: string[] = [];

  const markProdOrBad = (label: string, inspected: UrlInspect) => {
    if (inspected.kind === "missing") {
      matched.push(`${label}:missing`);
      return;
    }
    if (inspected.kind === "malformed") {
      matched.push(`${label}:malformed`);
      return;
    }
    if (inspected.host.includes(prefix)) {
      matched.push(`${label}:${inspected.host}`);
    }
  };

  if (mode === "none") {
    // Explicit no-db Preview: allow missing URLs, but never tolerate
    // production host or malformed values if a URL is present.
    if (database.kind === "malformed") matched.push("DATABASE_URL:malformed");
    else if (database.kind === "ok" && database.host.includes(prefix)) {
      matched.push(`DATABASE_URL:${database.host}`);
    }
    if (direct.kind === "malformed") matched.push("DIRECT_URL:malformed");
    else if (direct.kind === "ok" && direct.host.includes(prefix)) {
      matched.push(`DIRECT_URL:${direct.host}`);
    }

    if (matched.length > 0) {
      return fail(
        "BLOCKED_BY_PREVIEW_DATABASE_IDENTITY",
        matched,
        databaseHost,
        directHost,
      );
    }

    return {
      ok: true,
      skipped: true,
      reason:
        "PREVIEW_DATABASE_MODE=none — database isolation check skipped by explicit no-db mode",
    };
  }

  // mode === isolated
  markProdOrBad("DATABASE_URL", database);
  markProdOrBad("DIRECT_URL", direct);

  if (matched.length > 0) {
    return fail(
      "BLOCKED_BY_PREVIEW_DATABASE_IDENTITY",
      matched,
      databaseHost,
      directHost,
    );
  }

  return {
    ok: true,
    skipped: false,
    mode,
    databaseHost,
    directHost,
  };
}

function main() {
  const result = checkPreviewDbIsolation({
    vercelEnv: process.env.VERCEL_ENV,
    forceCheck: process.env.CHECK_PREVIEW_DB_ISOLATION === "1",
    previewDatabaseMode: process.env.PREVIEW_DATABASE_MODE,
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
      `[preview-db-isolation] FAIL ${result.code}: Preview DB isolation check failed`,
    );
    for (const m of result.matched) {
      console.error(`  - ${m}`);
    }
    process.exit(1);
  }
  console.log(
    `[preview-db-isolation] ok mode=${result.mode} databaseHost=${result.databaseHost ?? "missing"} directHost=${result.directHost ?? "missing"}`,
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
