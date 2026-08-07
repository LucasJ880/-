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

console.log("check-preview-db-isolation");

ok(
  checkPreviewDbIsolation({ vercelEnv: undefined }).skipped === true,
  "本地无 VERCEL_ENV 跳过",
);
ok(
  checkPreviewDbIsolation({ vercelEnv: "production" }).skipped === true,
  "production 跳过",
);

{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    databaseUrl: `postgresql://u:p@${PRODUCTION_NEON_HOST_PREFIX}-pooler.example/neondb`,
    directUrl: `postgresql://u:p@${PRODUCTION_NEON_HOST_PREFIX}.example/neondb`,
  });
  ok(!r.ok && !r.skipped, "preview+生产 host → fail closed");
  ok(
    !r.ok && r.code === "BLOCKED_BY_PREVIEW_DATABASE_IDENTITY",
    "错误码 BLOCKED_BY_PREVIEW_DATABASE_IDENTITY",
  );
}

{
  const r = checkPreviewDbIsolation({
    vercelEnv: "preview",
    databaseUrl:
      "postgresql://u:p@ep-young-credit-awvyi6l6-pooler.c-12.us-east-1.aws.neon.tech/neondb",
    directUrl:
      "postgresql://u:p@ep-young-credit-awvyi6l6.c-12.us-east-1.aws.neon.tech/neondb",
  });
  ok(r.ok && !r.skipped, "preview+隔离 host → pass");
}

{
  const r = checkPreviewDbIsolation({
    vercelEnv: "development",
    forceCheck: true,
    databaseUrl: `postgresql://u:p@${PRODUCTION_NEON_HOST_PREFIX}.example/neondb`,
  });
  ok(!r.ok, "forceCheck 仍可拦截");
}

console.log(`\ncheck-preview-db-isolation: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
