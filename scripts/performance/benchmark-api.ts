/**
 * 只读 API 延迟基准。
 *
 *   npx tsx scripts/performance/benchmark-api.ts
 *   npx tsx scripts/performance/benchmark-api.ts --base-url http://127.0.0.1:3000
 *   npx tsx scripts/performance/benchmark-api.ts --allow-production --base-url https://qingyan.ca
 *
 * 默认只打 GET /api/health。加 --with-auth 且提供 COOKIE 才探测只读登录接口。
 * 不 POST、不写业务、不跑 LLM。
 */
import { parseArgs } from "node:util";
import {
  PERF_AUTH_GET_PATHS,
  PERF_SAFE_GET_PATHS,
  QYANE_PERFORMANCE_BUDGET,
  assertPerfTargetAllowed,
} from "@/lib/performance";

const DEFAULT_BASE = "http://127.0.0.1:3000";
const SAMPLES = 5;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function measureGet(
  base: URL,
  path: string,
  cookie?: string,
): Promise<{ status: number; ms: number; serverTiming: string | null; requestId: string | null }> {
  const t0 = Date.now();
  const res = await fetch(new URL(path, base), {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: cookie ? { cookie } : undefined,
  });
  const ms = Date.now() - t0;
  await res.arrayBuffer();
  return {
    status: res.status,
    ms,
    serverTiming: res.headers.get("server-timing"),
    requestId: res.headers.get("x-request-id"),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "base-url": { type: "string" },
      "allow-production": { type: "boolean", default: false },
      "with-auth": { type: "boolean", default: false },
      samples: { type: "string" },
    },
    strict: true,
  });

  const baseUrl = values["base-url"] || process.env.PERF_BASE_URL || DEFAULT_BASE;
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    console.error("invalid --base-url");
    process.exit(1);
    return;
  }

  const gate = assertPerfTargetAllowed({
    hostname: base.hostname,
    allowProduction: Boolean(values["allow-production"]),
  });
  if (!gate.ok) {
    console.error(`refused: ${gate.reason}`);
    process.exit(2);
    return;
  }

  const samples = Math.max(1, Math.min(30, Number(values.samples || SAMPLES) || SAMPLES));
  const cookie = values["with-auth"] ? process.env.COOKIE || process.env.PERF_COOKIE : undefined;
  const paths = [
    ...PERF_SAFE_GET_PATHS,
    ...(values["with-auth"] && cookie ? PERF_AUTH_GET_PATHS : []),
  ];

  console.log(`perf:api target=${base.origin} kind=${gate.kind} samples=${samples}`);
  console.log(
    `budget api p50<${QYANE_PERFORMANCE_BUDGET.apiP50Ms}ms p95<${QYANE_PERFORMANCE_BUDGET.apiP95Ms}ms`,
  );
  console.log("");
  console.log(`${pad("Route", 28)}${pad("p50", 8)}${pad("p95", 8)}status`);

  for (const path of paths) {
    const times: number[] = [];
    let lastStatus = 0;
    for (let i = 0; i < samples; i++) {
      const row = await measureGet(base, path, cookie);
      times.push(row.ms);
      lastStatus = row.status;
    }
    times.sort((a, b) => a - b);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    console.log(
      `${pad(path, 28)}${pad(String(p50), 8)}${pad(String(p95), 8)}${lastStatus}`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
