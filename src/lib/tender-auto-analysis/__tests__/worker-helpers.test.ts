/**
 * worker 纯函数（sanitize / step 顺序）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/worker-helpers.test.ts
 */

import { WORKER_STEPS } from "../constants";
import { sanitizeWorkerError } from "../worker";

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

console.log("tender-auto-analysis worker-helpers");

{
  const s = sanitizeWorkerError(new Error("Bearer sk-secret-123 failed"));
  ok(!s.includes("sk-secret"), "sanitize 去掉 Bearer token");
  ok(s.includes("[redacted]"), "sanitize 标记 redacted");
}

{
  const long = "x".repeat(2000);
  ok(sanitizeWorkerError(long).length <= 800, "sanitize 截断长度");
}

{
  ok(WORKER_STEPS[0] === "CLAIMED", "步骤从 CLAIMED 开始");
  ok(WORKER_STEPS.includes("ENSURE_PAGES"), "含 ENSURE_PAGES（页解析）");
  ok(WORKER_STEPS.includes("EXTRACT_FACTS"), "含 EXTRACT_FACTS");
  ok(WORKER_STEPS.includes("GENERATE_SECTIONS"), "含 GENERATE_SECTIONS");
  ok(WORKER_STEPS.includes("PROJECT_ROOM"), "含 PROJECT_ROOM");
  ok(WORKER_STEPS.includes("CREATE_TASKS"), "含 CREATE_TASKS");
  ok(WORKER_STEPS[WORKER_STEPS.length - 1] === "FINALIZE", "以 FINALIZE 结束");

  const ensureIdx = WORKER_STEPS.indexOf("ENSURE_PAGES");
  const extractIdx = WORKER_STEPS.indexOf("EXTRACT_FACTS");
  const genIdx = WORKER_STEPS.indexOf("GENERATE_SECTIONS");
  const tasksIdx = WORKER_STEPS.indexOf("CREATE_TASKS");
  const roomIdx = WORKER_STEPS.indexOf("PROJECT_ROOM");
  ok(ensureIdx < extractIdx, "ENSURE_PAGES → EXTRACT_FACTS");
  ok(extractIdx < genIdx, "EXTRACT_FACTS → GENERATE_SECTIONS");
  ok(tasksIdx < roomIdx, "CREATE_TASKS → PROJECT_ROOM（Phase A 顺序）");
}

console.log(`\nworker-helpers: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
