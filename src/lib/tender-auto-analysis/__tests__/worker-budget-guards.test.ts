/**
 * Worker 时间预算与陈旧判定不变量（P0）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/worker-budget-guards.test.ts
 *
 * 这些断言把 2026-08-15 生产事故的两个放大器钉死：
 *   BUDGET-* ：cron 函数 maxDuration 与 worker 预算/租约/阶段门槛必须自洽，
 *              否则长阶段永远跑不完（被硬杀 → 从零重来 → 重试耗尽）。
 *   STALE-*  ：陈旧判定必须看**检查点进展**，而不是永不重置的 run.startedAt。
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  INVOCATION_BUDGET_MS,
  LEASE_MS,
  MIN_RUN_SLICE_MS,
  STALE_RUN_MS,
  isRunStale,
} from "../worker";
import {
  PHASE_SAFETY_MS,
  V2_CURSOR_KIND,
  V2_PHASE_MIN_MS,
} from "../v2-cursor";

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

function cronMaxDurationMs(): number {
  const file = path.join(
    process.cwd(),
    "src/app/api/cron/tender-auto-analysis/route.ts",
  );
  const src = readFileSync(file, "utf-8");
  const m = src.match(/export const maxDuration\s*=\s*(\d+)/);
  if (!m) throw new Error("cron route 缺少 maxDuration 声明");
  return Number(m[1]) * 1000;
}

const now = new Date("2026-08-16T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

function cursorWithProgress(iso: string): unknown {
  return { kind: V2_CURSOR_KIND, startedAt: iso, progressAt: iso };
}

function main(): void {
  /* ------------------------------ 预算自洽 ------------------------------ */
  const maxDuration = cronMaxDurationMs();
  ok(
    INVOCATION_BUDGET_MS <= maxDuration - 45_000,
    `BUDGET-01 工作预算(${INVOCATION_BUDGET_MS}ms) ≤ maxDuration(${maxDuration}ms) − 45s 余量`,
  );
  ok(
    LEASE_MS >= INVOCATION_BUDGET_MS,
    "BUDGET-02 租约 ≥ 单次调用预算（长阶段跑到一半租约不得过期，否则会被并发重复认领）",
  );
  ok(
    V2_PHASE_MIN_MS.ANALYST_A + PHASE_SAFETY_MS <= INVOCATION_BUDGET_MS,
    "BUDGET-03 最长阶段（Analyst PASS A）在一个满预算 tick 内必须能开工，否则永远推进不了",
  );
  ok(
    MIN_RUN_SLICE_MS < INVOCATION_BUDGET_MS,
    "BUDGET-04 单 run 起步门槛小于总预算（同批第二个 run 仍有机会）",
  );
  ok(
    Object.values(V2_PHASE_MIN_MS).every((v) => v > 0 && v <= INVOCATION_BUDGET_MS),
    "BUDGET-05 所有阶段门槛都落在单 tick 预算内",
  );

  /* ------------------------------ 陈旧判定 ------------------------------ */
  ok(
    isRunStale(
      {
        startedAt: minutesAgo(90),
        createdAt: minutesAgo(95),
        workerCursor: cursorWithProgress(minutesAgo(2).toISOString()),
      },
      now,
    ) === false,
    "STALE-01 startedAt 很旧但检查点在推进 → 不算陈旧（重试额度不被误烧）",
  );
  ok(
    isRunStale(
      {
        startedAt: minutesAgo(90),
        createdAt: minutesAgo(95),
        workerCursor: cursorWithProgress(minutesAgo(45).toISOString()),
      },
      now,
    ) === true,
    "STALE-02 检查点 45 分钟无推进 → 陈旧",
  );
  ok(
    isRunStale(
      { startedAt: minutesAgo(45), createdAt: minutesAgo(50), workerCursor: null },
      now,
    ) === true,
    "STALE-03 无检查点（legacy/V1 路径）→ 回落 startedAt 判定",
  );
  ok(
    isRunStale(
      { startedAt: minutesAgo(5), createdAt: minutesAgo(6), workerCursor: null },
      now,
    ) === false,
    "STALE-04 无检查点且刚开始 → 不陈旧",
  );
  ok(
    isRunStale(
      { startedAt: null, createdAt: minutesAgo(90), workerCursor: null },
      now,
    ) === true,
    "STALE-05 从未开跑且创建很久 → 陈旧",
  );
  ok(
    isRunStale(
      {
        startedAt: minutesAgo(90),
        createdAt: minutesAgo(95),
        workerCursor: { kind: "someone-elses-cursor", progressAt: "x" },
      },
      now,
    ) === true,
    "STALE-06 非本模块游标不被误信 → 回落 startedAt",
  );
  ok(STALE_RUN_MS >= 30 * 60_000, "STALE-07 陈旧阈值 ≥ 30 分钟");

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

main();
