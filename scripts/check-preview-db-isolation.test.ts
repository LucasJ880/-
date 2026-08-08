/**
 * npx tsx scripts/check-preview-db-isolation.test.ts
 */

import {
  checkPreviewDbIsolation,
  PRODUCTION_NEON_HOST_PREFIX,
} from "./check-preview-db-isolation";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const youngDb =
  "postgresql://u:p@ep-young-credit-awvyi6l6-pooler.c-12.us-east-1.aws.neon.tech/neondb";
const youngDirect =
  "postgresql://u:p@ep-young-credit-awvyi6l6.c-12.us-east-1.aws.neon.tech/neondb";
const prodDb = `postgresql://u:p@${PRODUCTION_NEON_HOST_PREFIX}-pooler.example/neondb`;
const prodDirect = `postgresql://u:p@${PRODUCTION_NEON_HOST_PREFIX}.example/neondb`;

console.log("check-preview-db-isolation");

// 1–2: production / local skip
ok(
  checkPreviewDbIsolation({ vercelEnv: undefined }).skipped === true,
  "local 无 VERCEL_ENV 跳过",
);
ok(
  checkPreviewDbIsolation({ vercelEnv: "production" }).skipped === true,
  "production 跳过（不要求 PREVIEW_DATABASE_MODE）",
);

// 3: preview + none + DB missing → pass/skip
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "none",
  });
  ok(
    r.ok && r.skipped === true && /PREVIEW_DATABASE_MODE=none/.test(r.reason),
    "preview + mode=none + DB missing → explicit skip",
  );
}

// 4: preview + none + production DB → fail
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "none",
    databaseUrl: prodDb,
    directUrl: youngDirect,
  });
  ok(
    !r.ok && r.code === "BLOCKED_BY_PREVIEW_DATABASE_IDENTITY",
    "preview + mode=none + production DATABASE_URL → fail",
  );
}

// 5: preview + isolated + young-credit → pass
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "isolated",
    databaseUrl: youngDb,
    directUrl: youngDirect,
  });
  ok(r.ok && !r.skipped, "preview + isolated + young-credit → pass");
}

// 6: preview + isolated + production DATABASE_URL → fail
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "isolated",
    databaseUrl: prodDb,
    directUrl: youngDirect,
  });
  ok(!r.ok, "preview + isolated + production DATABASE_URL → fail");
}

// 7: preview + isolated + production DIRECT_URL → fail
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "isolated",
    databaseUrl: youngDb,
    directUrl: prodDirect,
  });
  ok(!r.ok, "preview + isolated + production DIRECT_URL → fail");
}

// 8–9: missing URLs in isolated
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "isolated",
    databaseUrl: "",
    directUrl: youngDirect,
  });
  ok(
    !r.ok && r.matched.includes("DATABASE_URL:missing"),
    "preview + isolated + DATABASE_URL missing → fail",
  );
}
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "isolated",
    databaseUrl: youngDb,
    directUrl: "",
  });
  ok(
    !r.ok && r.matched.includes("DIRECT_URL:missing"),
    "preview + isolated + DIRECT_URL missing → fail",
  );
}

// 10–11: malformed
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "isolated",
    databaseUrl: "not-a-url",
    directUrl: youngDirect,
  });
  ok(
    !r.ok && r.matched.includes("DATABASE_URL:malformed"),
    "preview + isolated + malformed DATABASE_URL → fail",
  );
}
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "isolated",
    databaseUrl: youngDb,
    directUrl: "also-bad",
  });
  ok(
    !r.ok && r.matched.includes("DIRECT_URL:malformed"),
    "preview + isolated + malformed DIRECT_URL → fail",
  );
}

// 12: mode missing
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    databaseUrl: youngDb,
    directUrl: youngDirect,
  });
  ok(
    !r.ok &&
      r.code === "BLOCKED_BY_PREVIEW_DATABASE_MODE" &&
      r.matched.includes("PREVIEW_DATABASE_MODE:missing"),
    "preview + PREVIEW_DATABASE_MODE missing → fail",
  );
}

// 13: invalid mode
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "maybe",
    databaseUrl: youngDb,
    directUrl: youngDirect,
  });
  ok(
    !r.ok && r.code === "BLOCKED_BY_PREVIEW_DATABASE_MODE",
    "preview + invalid mode → fail",
  );
}

// 14: mode=none + malformed present → fail
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "none",
    databaseUrl: "not-a-url",
    directUrl: "",
  });
  ok(
    !r.ok && r.matched.includes("DATABASE_URL:malformed"),
    "mode=none + malformed DATABASE_URL → fail",
  );
}

// legacy error code still used for identity blocks
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    previewDatabaseMode: "isolated",
    databaseUrl: prodDb,
    directUrl: prodDirect,
  });
  ok(
    !r.ok && r.code === "BLOCKED_BY_PREVIEW_DATABASE_IDENTITY",
    "错误码 BLOCKED_BY_PREVIEW_DATABASE_IDENTITY",
  );
}

// forceCheck still requires mode + enforces identity
{
  const r = checkPreviewDbIsolation({
    vercelEnv: "development",
    forceCheck: true,
    previewDatabaseMode: "isolated",
    databaseUrl: prodDb,
    directUrl: youngDirect,
  });
  ok(!r.ok, "forceCheck + isolated 仍可拦截 production host");
}

console.log(`\ncheck-preview-db-isolation: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
