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
  isRealWechatSendAllowed,
  isWorkerExecutionAllowed,
  NON_PROD_SIDE_EFFECT_DISABLED,
  NonProdSideEffectDisabledError,
  resolveQingyanRuntimeEnv,
} from "../runtime-isolation";

const PROD_DB =
  "postgresql://u:p@ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech/neondb";
const STAGING_DB =
  "postgresql://u:p@ep-floral-sea-au07ycff.c-10.us-east-1.aws.neon.tech/neondb";

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
  // 1) Preview + Production DB → isolation fail（health 会 503）
  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "preview",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_DB,
    },
    () => {
      const a = assessRuntimeIsolation();
      assert.equal(a.ok, false);
      assert.ok(a.violations.includes("PROD_DB_ON_NON_PROD_RUNTIME"));
      assert.equal(a.dbPlane, "production");
      assert.equal(isCronExecutionAllowed(), false);
    },
  );

  // 2) Preview + Production DB → 写入口 503
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "preview",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_DB,
    },
    async () => {
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("write"),
        "PROD_DB_ON_NON_PROD_RUNTIME",
      );
    },
  );

  // 3) Preview + QINGYAN_RUNTIME_ENV=production → mismatch 503
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "production",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
    },
    async () => {
      const a = assessRuntimeIsolation();
      assert.equal(a.ok, false);
      assert.ok(a.violations.includes("RUNTIME_ENV_MISMATCH"));
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("write"),
        "RUNTIME_ENV_MISMATCH",
      );
    },
  );

  // 4) Staging + 无 DATABASE_URL → fail-closed
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: undefined,
      DIRECT_URL: undefined,
    },
    async () => {
      const a = assessRuntimeIsolation();
      assert.equal(a.ok, false);
      assert.ok(a.violations.includes("DB_ENDPOINT_UNRESOLVED"));
      assert.equal(classifyDbPlane(null), "unresolved");
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("write"),
        "DB_ENDPOINT_UNRESOLVED",
      );
    },
  );

  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: "not-a-valid-url",
      DIRECT_URL: undefined,
    },
    () => {
      const a = assessRuntimeIsolation();
      assert.equal(a.ok, false);
      assert.ok(a.violations.includes("DB_ENDPOINT_UNRESOLVED"));
    },
  );

  // 5) Staging + 无 worker allow → worker 不执行
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
    },
  );

  // 6) Staging + 无 webhook allow → 不发外部请求
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
    },
    async () => {
      assert.equal(isExternalWebhookSideEffectAllowed(), false);
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("webhook"),
        "SIDE_EFFECT_DISABLED",
      );
      assert.throws(
        () => assertSideEffectOrThrow("webhook"),
        (e: unknown) =>
          e instanceof NonProdSideEffectDisabledError &&
          e.code === NON_PROD_SIDE_EFFECT_DISABLED,
      );
    },
  );

  // 7) Staging + 微信关闭 → 明确错误，非假成功
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
    },
    async () => {
      assert.equal(isRealWechatSendAllowed(), false);
      await assertResponseCode(
        assertNonProdSideEffectsAllowed("wechat"),
        "NON_PROD_SIDE_EFFECT_DISABLED",
      );
      assert.throws(
        () => assertSideEffectOrThrow("wechat"),
        (e: unknown) =>
          e instanceof NonProdSideEffectDisabledError &&
          e.code === NON_PROD_SIDE_EFFECT_DISABLED,
      );
    },
  );

  // 8) Staging + Gmail 关闭 → 不创建草稿
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

  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
      GMAIL_DRAFT_ENABLED: undefined,
    },
    () => {
      assert.equal(isGmailDraftAllowed(), false);
    },
  );

  // 9) Production 正常行为不回归
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
      assert.equal(assertNonProdSideEffectsAllowed("webhook"), null);
      assert.equal(assertNonProdSideEffectsAllowed("wechat"), null);
      assert.equal(isGmailDraftAllowed(), true);
      assert.equal(isCronExecutionAllowed(), true);
      assert.equal(isWorkerExecutionAllowed(), true);
      const snap = healthIsolationSnapshot();
      assert.equal(snap.isolationOk, true);
      assert.equal(snap.runtimeEnv, "production");
      assert.equal(snap.dbPlane, "production");
      assert.equal(snap.dbFingerprint, null);
    },
  );

  // 10) Staging 独立 DB + 显式安全 allow → 受控路径可执行
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
      const a = assessRuntimeIsolation();
      assert.equal(a.ok, true);
      assert.equal(a.dbPlane, "staging");
      assert.equal(assertNonProdSideEffectsAllowed("write"), null);
      assert.equal(assertNonProdSideEffectsAllowed("worker"), null);
      assert.equal(assertNonProdSideEffectsAllowed("webhook"), null);
      assert.equal(assertNonProdSideEffectsAllowed("wechat"), null);
      assert.equal(isGmailDraftAllowed(), true);
      assert.equal(isCronExecutionAllowed(), true);
      assert.equal(isWorkerExecutionAllowed(), true);
      const snap = healthIsolationSnapshot();
      assert.equal(snap.isolationOk, true);
      assert.equal(snap.runtimeEnv, "staging");
      assert.equal(snap.dbPlane, "staging");
      assert.ok(snap.dbFingerprint);
      assert.notEqual(snap.dbFingerprint, "ep-floral-sea-au07ycff");
    },
  );

  withEnv(
    {
      QINGYAN_RUNTIME_ENV: "production",
      VERCEL_ENV: "development",
      DATABASE_URL: PROD_DB,
    },
    () => {
      assert.ok(
        assessRuntimeIsolation().violations.includes("RUNTIME_ENV_MISMATCH"),
      );
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
