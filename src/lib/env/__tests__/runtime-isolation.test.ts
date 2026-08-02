import assert from "node:assert/strict";
import {
  assessRuntimeIsolation,
  extractDbEndpointPrefix,
  isCronExecutionAllowed,
  isGmailDraftAllowed,
  isProductionDatabaseUrl,
  resolveQingyanRuntimeEnv,
} from "../runtime-isolation";

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

withEnv(
  {
    QINGYAN_RUNTIME_ENV: "preview",
    VERCEL_ENV: "preview",
    DATABASE_URL:
      "postgresql://u:p@ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech/neondb",
  },
  () => {
    const a = assessRuntimeIsolation();
    assert.equal(a.ok, false);
    assert.ok(a.violations.includes("PROD_DB_ON_NON_PROD_RUNTIME"));
    assert.equal(isCronExecutionAllowed(), false);
  },
);

withEnv(
  {
    QINGYAN_RUNTIME_ENV: "staging",
    DATABASE_URL:
      "postgresql://u:p@ep-floral-sea-au07ycff.c-10.us-east-1.aws.neon.tech/neondb",
    GMAIL_DRAFT_ENABLED: "true",
  },
  () => {
    const a = assessRuntimeIsolation();
    assert.equal(a.ok, true);
    assert.equal(isGmailDraftAllowed(), false);
    assert.equal(isCronExecutionAllowed(), false);
  },
);

withEnv(
  {
    QINGYAN_RUNTIME_ENV: "staging",
    DATABASE_URL:
      "postgresql://u:p@ep-floral-sea-au07ycff.c-10.us-east-1.aws.neon.tech/neondb",
    GMAIL_DRAFT_ENABLED: "true",
    QINGYAN_ALLOW_GMAIL_DRAFT_NON_PROD: "true",
    QINGYAN_ALLOW_CRON_NON_PROD: "true",
  },
  () => {
    assert.equal(isGmailDraftAllowed(), true);
    assert.equal(isCronExecutionAllowed(), true);
  },
);

assert.equal(
  extractDbEndpointPrefix(
    "postgresql://u:p@ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech/neondb",
  ),
  "ep-super-field-antfibsl",
);
assert.equal(
  isProductionDatabaseUrl(
    "postgresql://u:p@ep-floral-sea-au07ycff.c-10.us-east-1.aws.neon.tech/neondb",
  ),
  false,
);

withEnv({ QINGYAN_RUNTIME_ENV: "staging", VERCEL_ENV: undefined }, () => {
  assert.equal(resolveQingyanRuntimeEnv(), "staging");
});

console.log("runtime-isolation.test.ts OK");
