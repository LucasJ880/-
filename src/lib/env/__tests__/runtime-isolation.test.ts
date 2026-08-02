import assert from "node:assert/strict";
import {
  assessRuntimeIsolation,
  assertNonProdSideEffectsAllowed,
  assertSideEffectOrThrow,
  classifyDbPlane,
  dbEndpointFingerprint,
  extractDbEndpointPrefix,
  healthIsolationSnapshot,
  isCronExecutionAllowed,
  isExternalWebhookSideEffectAllowed,
  isGmailDraftAllowed,
  isProductionDatabaseUrl,
  isRealEmailSendAllowed,
  isRealWechatSendAllowed,
  isExternalWebhookSideEffectAllowed,
  isWorkerExecutionAllowed,
  NON_PROD_SIDE_EFFECT_DISABLED,
  NonProdSideEffectDisabledError,
  resolveQingyanRuntimeEnv,
  RuntimeIsolationError,
} from "../runtime-isolation";

const PROD_DB =
  "postgresql://u:p@ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech/neondb";
const STAGING_DB =
  "postgresql://u:p@ep-floral-sea-au07ycff.c-10.us-east-1.aws.neon.tech/neondb";
const OTHER_DB =
  "postgresql://u:p@ep-random-other-abc123.c-1.us-east-1.aws.neon.tech/neondb";

function withEnv(patch: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) {
    prev[k] = process.env[k];
    const v = patch[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(patch)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

async function withEnvAsync(
  patch: Record<string, string | undefined>,
  fn: () => Promise<void>,
) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) {
    prev[k] = process.env[k];
    const v = patch[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(patch)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

async function assertResponseCode(
  res: Response | null,
  expected: string,
): Promise<void> {
  assert.ok(res, "expected NextResponse");
  assert.equal(res!.status, 503);
  const body = (await res!.json()) as { code?: string };
  assert.equal(body.code, expected);
}

async function main() {
  // Production 只允许 production plane
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "production",
      VERCEL_ENV: "production",
      DATABASE_URL: STAGING_DB,
    },
    () => {
      const a = assessRuntimeIsolation();
      assert.equal(a.ok, false);
      assert.ok(a.violations.includes("DB_PLANE_MISMATCH"));
    },
  );

  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "production",
      VERCEL_ENV: "production",
      DATABASE_URL: OTHER_DB,
    },
    () => {
      assert.ok(
        assessRuntimeIsolation().violations.includes("DB_PLANE_MISMATCH"),
      );
    },
  );

  // Staging 只允许 staging plane
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_DB,
    },
    () => {
      const a = assessRuntimeIsolation();
      assert.equal(a.ok, false);
      assert.ok(a.violations.includes("PROD_DB_ON_NON_PROD_RUNTIME"));
      assert.ok(a.violations.includes("DB_PLANE_MISMATCH"));
    },
  );

  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: OTHER_DB,
    },
    () => {
      assert.ok(
        assessRuntimeIsolation().violations.includes("DB_PLANE_MISMATCH"),
      );
    },
  );

  // Preview + other 默认不安全
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "preview",
      VERCEL_ENV: "preview",
      DATABASE_URL: OTHER_DB,
    },
    () => {
      const a = assessRuntimeIsolation();
      assert.equal(a.ok, false);
      assert.ok(a.violations.includes("DB_PLANE_MISMATCH"));
    },
  );

  // Preview + expected staging + staging DB → ok
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "preview",
      VERCEL_ENV: "preview",
      QINGYAN_EXPECTED_DB_PLANE: "staging",
      DATABASE_URL: STAGING_DB,
    },
    () => {
      assert.equal(assessRuntimeIsolation().ok, true);
    },
  );

  // Preview + allowlist fingerprint
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "preview",
      VERCEL_ENV: "preview",
      QINGYAN_EXPECTED_DB_PLANE: "staging",
      QINGYAN_ALLOWED_DB_ENDPOINT_FINGERPRINTS: dbEndpointFingerprint(OTHER_DB)!,
      DATABASE_URL: OTHER_DB,
    },
    () => {
      assert.equal(assessRuntimeIsolation().ok, true);
    },
  );

  // Development 远程写默认关
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "development",
      VERCEL_ENV: undefined,
      DATABASE_URL: OTHER_DB,
    },
    () => {
      assert.ok(
        assessRuntimeIsolation().violations.includes("DB_PLANE_MISMATCH"),
      );
    },
  );

  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "development",
      QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES: "ep-random-other-abc123",
      DATABASE_URL: OTHER_DB,
    },
    () => {
      assert.equal(assessRuntimeIsolation().ok, true);
    },
  );

  // Vercel 上声明 test → mismatch
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "test",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
    },
    async () => {
      assert.ok(
        assessRuntimeIsolation().violations.includes("RUNTIME_ENV_MISMATCH"),
      );
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("write"),
        "RUNTIME_ENV_MISMATCH",
      );
    },
  );

  // Preview + Production DB → write 503
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "preview",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_DB,
    },
    async () => {
      const a = assessRuntimeIsolation();
      assert.equal(a.ok, false);
      assert.ok(a.violations.includes("PROD_DB_ON_NON_PROD_RUNTIME"));
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("write"),
        "PROD_DB_ON_NON_PROD_RUNTIME",
      );
    },
  );

  // Preview + QINGYAN_RUNTIME_ENV=production → mismatch
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "production",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
    },
    async () => {
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("write"),
        "RUNTIME_ENV_MISMATCH",
      );
    },
  );

  // Staging 无 DATABASE_URL
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: undefined,
      DIRECT_URL: undefined,
    },
    async () => {
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("write"),
        "DB_ENDPOINT_UNRESOLVED",
      );
    },
  );

  // Staging worker / webhook / wechat / gmail 默认关
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
    },
    async () => {
      assert.equal(isWorkerExecutionAllowed(), false);
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("worker"),
        "WORKER_DISABLED_NON_PROD",
      );
      assert.equal(isExternalWebhookSideEffectAllowed(), false);
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("webhook"),
        "SIDE_EFFECT_DISABLED",
      );
      assert.equal(isRealWechatSendAllowed(), false);
      assert.throws(
        () => assertSideEffectOrThrow("wechat"),
        (e: unknown) =>
          e instanceof NonProdSideEffectDisabledError &&
          e.code === NON_PROD_SIDE_EFFECT_DISABLED,
      );
      assert.equal(isGmailDraftAllowed(), false);
    },
  );

  // 平面错误保留真实 code（非通用 NON_PROD_SIDE_EFFECT_DISABLED）
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: OTHER_DB,
    },
    () => {
      assert.throws(
        () => assertSideEffectOrThrow("write"),
        (e: unknown) =>
          e instanceof RuntimeIsolationError && e.code === "DB_PLANE_MISMATCH",
      );
    },
  );

  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
      GMAIL_DRAFT_ENABLED: "true",
    },
    () => {
      assert.equal(isGmailDraftAllowed(), false);
    },
  );

  // Vercel 上 test runtime：Gmail / email / wechat / webhook 一律 false
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "test",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
      GMAIL_DRAFT_ENABLED: "true",
      QINGYAN_ALLOW_GMAIL_DRAFT_NON_PROD: "true",
      QINGYAN_ALLOW_REAL_EMAIL_NON_PROD: "true",
      QINGYAN_ALLOW_REAL_WECHAT_NON_PROD: "true",
      QINGYAN_ALLOW_EXTERNAL_WEBHOOK_NON_PROD: "true",
    },
    () => {
      assert.ok(
        assessRuntimeIsolation().violations.includes("RUNTIME_ENV_MISMATCH"),
      );
      assert.equal(isGmailDraftAllowed(), false);
      assert.equal(isRealEmailSendAllowed(), false);
      assert.equal(isRealWechatSendAllowed(), false);
      assert.equal(isExternalWebhookSideEffectAllowed(), false);
    },
  );

  // 本地 CI test（无 VERCEL_ENV）+ GMAIL_DRAFT_ENABLED → Draft 允许
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "test",
      VERCEL_ENV: undefined,
      GMAIL_DRAFT_ENABLED: "true",
      DATABASE_URL: undefined,
      DIRECT_URL: undefined,
    },
    () => {
      assert.equal(assessRuntimeIsolation().ok, true);
      assert.equal(isGmailDraftAllowed(), true);
      assert.equal(isRealEmailSendAllowed(), false);
    },
  );

  // Production 正常
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "production",
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_DB,
      GMAIL_DRAFT_ENABLED: "true",
    },
    () => {
      const a = assessRuntimeIsolation();
      assert.equal(a.ok, true);
      assert.equal(a.dbPlane, "production");
      assert.equal(assertNonProdSideEffectsAllowed("write"), null);
      assert.equal(assertNonProdSideEffectsAllowed("worker"), null);
      assert.equal(isGmailDraftAllowed(), true);
      const snap = healthIsolationSnapshot();
      assert.equal(snap.dbFingerprint, null);
    },
  );

  // Staging 独立 DB + 显式 allow
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
      GMAIL_DRAFT_ENABLED: "true",
      QINGYAN_ALLOW_GMAIL_DRAFT_NON_PROD: "true",
      QINGYAN_ALLOW_CRON_NON_PROD: "true",
      QINGYAN_ALLOW_WORKER_NON_PROD: "true",
      QINGYAN_ALLOW_EXTERNAL_WEBHOOK_NON_PROD: "true",
      QINGYAN_ALLOW_REAL_WECHAT_NON_PROD: "true",
    },
    () => {
      assert.equal(assessRuntimeIsolation().ok, true);
      assert.equal(assertNonProdSideEffectsAllowed("write"), null);
      assert.equal(assertNonProdSideEffectsAllowed("worker"), null);
      assert.equal(isGmailDraftAllowed(), true);
      assert.equal(isCronExecutionAllowed(), true);
    },
  );

  assert.equal(extractDbEndpointPrefix(PROD_DB), "ep-super-field-antfibsl");
  assert.equal(isProductionDatabaseUrl(STAGING_DB), false);
  assert.equal(classifyDbPlane(STAGING_DB), "staging");
  assert.ok(dbEndpointFingerprint(STAGING_DB));

  withEnv({ QINGYAN_RUNTIME_ENV: "staging", VERCEL_ENV: undefined }, () => {
    assert.equal(resolveQingyanRuntimeEnv(), "staging");
  });

  console.log("runtime-isolation.test.ts OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
