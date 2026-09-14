/**
 * 性能计时 / Server-Timing / 探针 / TTFT / 基准策略
 * 运行：npx tsx src/lib/performance/__tests__/timing.test.ts
 */

import { createRequestTimer, isAllowedTimingMetric } from "../timing";
import { formatServerTiming } from "../server-timing";
import {
  shouldEmitPerfLog,
} from "../request-timer";
import {
  classifyHostCategory,
  extractNeonAwsRegionFromHost,
  isPooledNeonHost,
  probeRuntimeTopology,
} from "../runtime-probe";
import { createTtftTracker, observeStreamTtft } from "../ttft";
import {
  assertPerfTargetAllowed,
  classifyPerfHostname,
} from "../benchmark-policy";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.error(`✗ ${name}`);
  }
}

{
  let t = 1000;
  const timer = createRequestTimer(() => t);
  t = 1031;
  timer.mark("auth");
  t = 1115;
  timer.mark("db");
  t = 3495;
  timer.mark("openai");
  t = 3510;
  const snap = timer.finish();
  ok(snap.auth_ms === 31, "auth_ms");
  ok(snap.db_ms === 84, "db_ms");
  ok(snap.llm_ms === 2380, "llm_ms from openai");
  ok(snap.external_api_ms === 2380, "external_api_ms");
  ok(snap.total_ms === 2510, "total_ms");
  const header = formatServerTiming(snap);
  ok(header.includes("auth;dur=31"), "Server-Timing auth");
  ok(header.includes("db;dur=84"), "Server-Timing db");
  ok(header.includes("openai;dur=2380"), "Server-Timing openai");
  ok(header.includes("total;dur=2510"), "Server-Timing total");
  ok(!header.toLowerCase().includes("select"), "no SQL in timing");
  ok(!header.includes("sk-"), "no token in timing");
}

{
  const timer = createRequestTimer();
  timer.mark("SELECT * FROM users");
  timer.mark("prompt");
  const snap = timer.finish();
  ok(snap.marks.every((m) => isAllowedTimingMetric(m.name)), "illegal marks dropped");
  ok(snap.auth_ms == null && snap.db_ms == null, "unknown marks ignored");
}

{
  ok(shouldEmitPerfLog({ QYANE_PERF_TELEMETRY: "1" }) === true, "flag on");
  ok(shouldEmitPerfLog({ QYANE_PERF_TELEMETRY: "0", VERCEL_ENV: "preview" }) === false, "flag off wins");
  ok(shouldEmitPerfLog({ VERCEL_ENV: "preview" }) === true, "preview default on");
  ok(shouldEmitPerfLog({ VERCEL_ENV: "production" }) === false, "production default off");
}

{
  ok(
    extractNeonAwsRegionFromHost(
      "ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech",
    ) === "aws-us-east-1",
    "neon pooled region",
  );
  ok(
    extractNeonAwsRegionFromHost(
      "ep-floral-sea-au07ycff.c-10.us-east-1.aws.neon.tech",
    ) === "aws-us-east-1",
    "neon direct region",
  );
  ok(extractNeonAwsRegionFromHost("localhost") === null, "local host no region");
  ok(isPooledNeonHost("ep-x-pooler.c-6.us-east-1.aws.neon.tech") === true, "pooled");
  ok(isPooledNeonHost("ep-x.c-6.us-east-1.aws.neon.tech") === false, "direct");
  ok(classifyHostCategory("ep-x.c-6.us-east-1.aws.neon.tech") === "neon", "neon category");
  ok(classifyHostCategory("localhost") === "local", "local category");
}

{
  const probe = probeRuntimeTopology(
    "ep-x-pooler.c-6.us-east-1.aws.neon.tech",
    { VERCEL_REGION: "iad1", VERCEL_ENV: "production" },
  );
  ok(probe.vercelRegion === "iad1", "vercel region");
  ok(probe.dbRegion === "aws-us-east-1", "db region");
  ok(probe.dbPooled === true, "pooled flag");
  const json = JSON.stringify(probe);
  ok(!json.includes("ep-x"), "probe json has no endpoint id");
  ok(!json.includes("postgresql"), "probe json has no protocol");
}

{
  let now = 0;
  const tracker = createTtftTracker(() => now);
  now = 1800;
  tracker.noteVisibleToken();
  now = 5000;
  ok(tracker.ttftMs() === 1800, "ttft");
  ok(tracker.totalMs() === 5000, "total after first token");
}

async function runAsync() {
  async function* chunks() {
    yield { choices: [{ delta: { role: "assistant" } }] };
    yield { choices: [{ delta: { content: "你" } }] };
    yield { choices: [{ delta: { content: "好" } }] };
  }
  let ttft: number | null = null;
  let t = 0;
  const observed = observeStreamTtft(chunks(), {
    now: () => t,
    onFirstToken(ms) {
      ttft = ms;
    },
  });
  const acc: unknown[] = [];
  const it = observed[Symbol.asyncIterator]();
  t = 10;
  acc.push((await it.next()).value);
  t = 40;
  acc.push((await it.next()).value);
  t = 80;
  acc.push((await it.next()).value);
  ok(ttft === 40, `ttft skips role-only chunk (${ttft})`);
  ok(acc.length === 3, "stream still yields all chunks");

  ok(classifyPerfHostname("localhost") === "local", "local host");
  ok(classifyPerfHostname("git-abc.vercel.app") === "preview", "preview");
  ok(classifyPerfHostname("qingyan.ca") === "production", "prod ca");
  ok(classifyPerfHostname("qingyan.ai") === "production", "prod ai");
  ok(
    assertPerfTargetAllowed({ hostname: "qingyan.ca", allowProduction: false }).ok === false,
    "prod blocked without flag",
  );
  ok(
    assertPerfTargetAllowed({ hostname: "qingyan.ca", allowProduction: true }).ok === true,
    "prod allowed with flag",
  );
  ok(
    assertPerfTargetAllowed({ hostname: "evil.example.com", allowProduction: true }).ok === false,
    "unknown host blocked even with prod flag",
  );

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

runAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
