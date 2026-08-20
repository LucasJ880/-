/**
 * 观察期包1 — 延迟压缩：让出链式自触发（纯平面，零 DB / 零真实模型）
 *
 * OBS-P1-PRED-01..07   shouldFire 判定矩阵（防风暴门）
 * OBS-P1-FIRE-01..05   fire-and-forget 机制（URL/鉴权/超时放弃/不抛出/零泄密）
 * OBS-P1-LAYER-01      层次纪律：processor 层绝不自触发（harness 安全）
 * OBS-P1-ROUTE-01..04  route 接线（continuation 跳过 legacy / after / clamp）
 * OBS-P1-PROC-01..02   processor yielded 观测 + continuation 契约不变
 *
 * 反例守卫（P11-CONT-07 教训：不许把 bug 断言成现状）：
 * ROUTE-02b 断言无条件消费 legacy 的旧写法**不**出现；
 * ROUTE-03b 断言处理路径上**不**出现 await fireContinuationTrigger。
 *
 * 运行：npx tsx src/lib/workforce-runtime/__tests__/obs-p1-latency-self-trigger.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveSelfTriggerBaseUrl,
  shouldFireContinuationTrigger,
  fireContinuationTrigger,
} from "../self-trigger";
import { WORKFORCE_CONTINUATION_MAX_DEPTH } from "../constants";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
/** 只看代码（源码级断言不把设计说明当证据） */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
/** 去空白归一化（免疫格式化差异的结构断言） */
const flat = (s: string) => s.replace(/\s+/g, "");

const processorCode = code("src/lib/workforce-runtime/processor.ts");
const routeCode = code("src/app/api/cron/agent-runs/route.ts");
const processorFlat = flat(processorCode);
const routeFlat = flat(routeCode);

console.log("观察期包1 — 延迟压缩：让出链式自触发");

// ── 判定矩阵 ──────────────────────────────────────────────
const ENV_OK = {
  WORKFORCE_CONTINUATION_SELF_TRIGGER_URL: "https://qingyan.ca",
  CRON_SECRET: "test-secret",
};

ok(
  shouldFireContinuationTrigger({ yieldedContinuations: 1, depth: 0, env: ENV_OK }),
  "OBS-P1-PRED-01: 有让出 + env 齐备 + depth=0 → 触发",
);
ok(
  !shouldFireContinuationTrigger({ yieldedContinuations: 0, depth: 0, env: ENV_OK }),
  "OBS-P1-PRED-02: 零让出 → 不触发（防风暴第 1 层）",
);
ok(
  !shouldFireContinuationTrigger({ yieldedContinuations: 1, depth: 0, env: { CRON_SECRET: "x" } }),
  "OBS-P1-PRED-03: env 未配置 URL → 不触发（默认 OFF）",
);
ok(
  !shouldFireContinuationTrigger({
    yieldedContinuations: 1,
    depth: 0,
    env: { WORKFORCE_CONTINUATION_SELF_TRIGGER_URL: "https://qingyan.ca" },
  }),
  "OBS-P1-PRED-04: 缺 CRON_SECRET → 不触发（child 必过鉴权，父侧先验）",
);
ok(
  shouldFireContinuationTrigger({
    yieldedContinuations: 1,
    depth: WORKFORCE_CONTINUATION_MAX_DEPTH - 1,
    env: ENV_OK,
  }) &&
    !shouldFireContinuationTrigger({
      yieldedContinuations: 1,
      depth: WORKFORCE_CONTINUATION_MAX_DEPTH,
      env: ENV_OK,
    }),
  "OBS-P1-PRED-05: depth 上限边界（MAX-1 触发 / MAX 停止，链恰在上限收敛）",
);
ok(
  !shouldFireContinuationTrigger({
    yieldedContinuations: 1,
    depth: 0,
    env: { WORKFORCE_CONTINUATION_SELF_TRIGGER_URL: "qingyan.ca", CRON_SECRET: "x" },
  }) && resolveSelfTriggerBaseUrl({ WORKFORCE_CONTINUATION_SELF_TRIGGER_URL: "ftp://x" }) === null,
  "OBS-P1-PRED-06: 非 http(s) 基址 → 视为未配置（fail-closed）",
);
ok(
  !shouldFireContinuationTrigger({ yieldedContinuations: 1, depth: -1, env: ENV_OK }) &&
    !shouldFireContinuationTrigger({ yieldedContinuations: 1, depth: 1.5, env: ENV_OK }) &&
    !shouldFireContinuationTrigger({ yieldedContinuations: Number.NaN, depth: 0, env: ENV_OK }),
  "OBS-P1-PRED-07: 非法 depth / 非整数计数 → 不触发",
);

// ── fire-and-forget 机制 ─────────────────────────────────
async function main() {
  {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), auth: headers.authorization });
      return new Response("ok");
    }) as typeof fetch;
    const r = await fireContinuationTrigger({
      depth: 3,
      env: { ...ENV_OK, WORKFORCE_CONTINUATION_SELF_TRIGGER_URL: "https://qingyan.ca/" },
      fetchImpl,
    });
    ok(
      r.fired === true &&
        calls.length === 1 &&
        calls[0].url === "https://qingyan.ca/api/cron/agent-runs?trigger=continuation&depth=4",
      "OBS-P1-FIRE-01: 恰一次请求，URL 正确（尾斜杠归一化，child depth = 父 + 1）",
      calls,
    );
    ok(
      calls[0].auth === "Bearer test-secret",
      "OBS-P1-FIRE-02: Authorization 与 requireCronSecret 期望的 Bearer 格式一致",
    );
  }

  {
    // 挂起但尊重 abort 的 fetch：验证「只等发出、超时放弃」不悬挂父 invocation
    const startedAt = Date.now();
    const fetchImpl = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      })) as unknown as typeof fetch;
    const r = await fireContinuationTrigger({
      depth: 0,
      env: ENV_OK,
      fetchImpl,
      sendTimeoutMs: 30,
    });
    ok(
      r.fired === true && r.reason === "send_timeout_abort" && Date.now() - startedAt < 2_000,
      "OBS-P1-FIRE-03: child 不速回（预期常态）→ 超时 abort 放弃等待，不悬挂",
      r,
    );
  }

  {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await fireContinuationTrigger({ depth: 0, env: ENV_OK, fetchImpl });
    ok(
      r.fired === false && r.reason === "fetch_failed",
      "OBS-P1-FIRE-04: 网络失败不抛出（自触发只是加速器，cron 节拍兜底）",
    );
  }

  {
    const r = await fireContinuationTrigger({ depth: 0, env: {} });
    ok(
      r.fired === false &&
        r.reason === "not_configured" &&
        !JSON.stringify(r).includes("test-secret"),
      "OBS-P1-FIRE-05: 未配置 → 不发请求；返回值不含 secret",
    );
  }

  // ── 层次纪律（load-bearing：harness 直调 processor 绝不发 HTTP） ──
  ok(
    !processorFlat.includes("self-trigger") &&
      !processorFlat.includes("fireContinuationTrigger"),
    "OBS-P1-LAYER-01: processor 层零自触发引用（§38/§39 harness 同库并发安全）",
  );

  // ── route 接线 ──────────────────────────────────────────
  ok(
    routeFlat.includes("shouldFireContinuationTrigger") &&
      routeFlat.includes("after(()=>fireContinuationTrigger({depth}))"),
    "OBS-P1-ROUTE-01: 让出后经 after() fire-and-forget（响应后才发）",
  );
  ok(
    routeFlat.includes(
      "isContinuation?{processed:0,runIds:[]asstring[]}:awaitprocessQueuedAgentRuns(2)",
    ),
    "OBS-P1-ROUTE-02: continuation 模式跳过 legacy 队列（消除前置偏移）",
  );
  ok(
    !routeFlat.includes("constresult=awaitprocessQueuedAgentRuns(2)"),
    "OBS-P1-ROUTE-02b（反例守卫）: 无条件消费 legacy 的旧写法不再存在",
  );
  ok(
    !routeFlat.includes("awaitfireContinuationTrigger"),
    "OBS-P1-ROUTE-03b（反例守卫）: 处理路径上绝不 await 自触发（不占处理预算）",
  );
  ok(
    routeFlat.includes("Math.min(depthRaw,WORKFORCE_CONTINUATION_MAX_DEPTH)"),
    "OBS-P1-ROUTE-04: depth 防御性 clamp 到硬上限",
  );

  // ── processor yielded 观测 + continuation 契约不变 ───────
  ok(
    processorFlat.includes('if(result.status==="yielded"){sawYield=true;break;}') &&
      processorFlat.includes("yielded:sawYield"),
    "OBS-P1-PROC-01: 让出被记录并随 slice 结果 / job.queued payload 上抛",
  );
  ok(
    processorFlat.includes(
      'status:"queued",leaseExpiresAt:null,nextAttemptAt:newDate(Date.now()+CONTINUATION_DELAY_MS),attempts:0',
    ),
    "OBS-P1-PROC-02: normal continuation 契约原样（queued / +2s / attempts=0，让出零烧）",
  );
  ok(
    Number.isInteger(WORKFORCE_CONTINUATION_MAX_DEPTH) &&
      WORKFORCE_CONTINUATION_MAX_DEPTH >= 10,
    "OBS-P1-CONST-01: depth 上限为 ≥10 的整数（163 页首单 8 invocation 的数倍余量）",
  );

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

void main();
