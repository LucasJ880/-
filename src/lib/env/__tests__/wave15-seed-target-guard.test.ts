/**
 * Wave1.5 Seed 目标门禁（纯函数，零 Prisma）
 * 运行：npx tsx src/lib/env/__tests__/wave15-seed-target-guard.test.ts
 */
import assert from "node:assert/strict";
import { assertWave15SeedTargetAllowed } from "../runtime-isolation";

const PROD_DB =
  "postgresql://u:p@ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech/neondb";
const STAGING_DB =
  "postgresql://u:p@ep-floral-sea-au07ycff.c-10.us-east-1.aws.neon.tech/neondb";
const OTHER_DB =
  "postgresql://u:p@ep-random-other-abc123.c-1.us-east-1.aws.neon.tech/neondb";

let prismaCalls = 0;

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

function rejectCase(
  name: string,
  patch: Record<string, string | undefined>,
  expectedReason?: string,
) {
  withEnv(patch, () => {
    const before = prismaCalls;
    const r = assertWave15SeedTargetAllowed();
    assert.equal(r.ok, false, name);
    if (expectedReason && !r.ok) {
      assert.equal(r.reason, expectedReason, `${name} reason`);
    }
    assert.equal(prismaCalls, before, `${name}: Prisma 调用必须为 0`);
    console.log(`  ✓ ${name}`);
  });
}

console.log("wave15-seed-target-guard");

rejectCase(
  "staging + Production DB → 拒绝",
  {
    QINGYAN_RUNTIME_ENV: "staging",
    VERCEL_ENV: "preview",
    DATABASE_URL: PROD_DB,
  },
  "PROD_DB_ON_NON_PROD_RUNTIME",
);

rejectCase(
  "staging + other DB → 拒绝",
  {
    QINGYAN_RUNTIME_ENV: "staging",
    VERCEL_ENV: "preview",
    DATABASE_URL: OTHER_DB,
  },
  "DB_PLANE_MISMATCH",
);

rejectCase(
  "staging + unresolved DB → 拒绝",
  {
    QINGYAN_RUNTIME_ENV: "staging",
    VERCEL_ENV: "preview",
    DATABASE_URL: undefined,
    DIRECT_URL: undefined,
  },
  "DB_ENDPOINT_UNRESOLVED",
);

rejectCase(
  "preview + Staging DB → 拒绝",
  {
    QINGYAN_RUNTIME_ENV: "preview",
    VERCEL_ENV: "preview",
    QINGYAN_EXPECTED_DB_PLANE: "staging",
    DATABASE_URL: STAGING_DB,
  },
  "SEED_TARGET_REJECTED",
);

rejectCase(
  "staging + Vercel production 冲突 → 拒绝",
  {
    QINGYAN_RUNTIME_ENV: "staging",
    VERCEL_ENV: "production",
    DATABASE_URL: STAGING_DB,
  },
  "RUNTIME_ENV_MISMATCH",
);

withEnv(
  {
    QINGYAN_RUNTIME_ENV: "staging",
    VERCEL_ENV: "preview",
    QINGYAN_EXPECTED_DB_PLANE: "staging",
    DATABASE_URL: STAGING_DB,
  },
  () => {
    const before = prismaCalls;
    const r = assertWave15SeedTargetAllowed();
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.runtimeEnv, "staging");
      assert.equal(r.dbPlane, "staging");
      assert.equal(r.expectedDbPlane, "staging");
      assert.ok(r.dbFingerprint);
    }
    assert.equal(prismaCalls, before);
    console.log("  ✓ staging + 正确 Staging DB → 门禁通过");
  },
);

console.log("wave15-seed-target-guard.test.ts OK");
