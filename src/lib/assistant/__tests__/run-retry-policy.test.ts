/**
 * 安全重试策略 + 原子占位（含可验证并发边界）
 * 运行：npx tsx src/lib/assistant/__tests__/run-retry-policy.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ASSISTANT_DIR = resolve(process.cwd(), "src/lib/assistant");
import { deriveRetryFlags } from "@/lib/assistant/reconcile-decision";
import {
  buildRetryIdempotencyKey,
  createMemoryRetrySlotStore,
  markRetrySlotCompleted,
  markRetrySlotFailed,
  markRetrySlotStarted,
  reserveRetrySlot,
} from "@/lib/assistant/retry-idempotency";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const future = new Date(Date.now() + 86_400_000);

console.log("run-retry-policy");

ok(
  "Prepare 失败、无 PA → canRetry",
  deriveRetryFlags({
    runStatus: "failed",
    metadata: { safeToRetry: true },
    actions: [],
  }).canRetry === true,
);

ok(
  "非 failed Run → 不可重试",
  deriveRetryFlags({
    runStatus: "completed",
    metadata: { safeToRetry: true },
    actions: [],
  }).canRetry === false,
);

ok(
  "有 executed → MANUAL 语义",
  deriveRetryFlags({
    runStatus: "failed",
    metadata: {},
    actions: [{ status: "executed", expiresAt: future }],
  }).retryKind === "manual_review",
);

ok(
  "有 failed PA（可能外部已成功）→ manual_review",
  deriveRetryFlags({
    runStatus: "failed",
    metadata: { safeToRetry: false },
    actions: [{ status: "failed", expiresAt: future }],
  }).retryKind === "manual_review",
);

ok(
  "超过两次 → RETRY_LIMIT 侧不可 canRetry",
  deriveRetryFlags({
    runStatus: "failed",
    metadata: { safeToRetry: true, retryAttempt: 2 },
    actions: [],
  }).canRetry === false,
);

ok(
  "幂等键格式约定",
  buildRetryIdempotencyKey("run-abc", 1) === "assistant-run-retry:run-abc:1",
);

ok(
  "无 safeToRetry 标记 → 不可重试",
  deriveRetryFlags({
    runStatus: "failed",
    metadata: {},
    actions: [],
  }).canRetry === false,
);

// ── 并发占位（内存 store = 可验证事务边界）────────────────────────

async function okAsync(name: string, fn: () => Promise<boolean>) {
  const cond = await fn();
  ok(name, cond);
}

async function main() {
  await okAsync("两个并发 Retry → 只一个 acquired", async () => {
    const store = createMemoryRetrySlotStore();
    const key = buildRetryIdempotencyKey("run-c1", 1);
    const [a, b] = await Promise.all([
      reserveRetrySlot(store, {
        orgId: "org",
        userId: "u",
        oldRunId: "run-c1",
        retryAttempt: 1,
        idempotencyKey: key,
      }),
      reserveRetrySlot(store, {
        orgId: "org",
        userId: "u",
        oldRunId: "run-c1",
        retryAttempt: 1,
        idempotencyKey: key,
      }),
    ]);
    const acquired = [a, b].filter(
      (x) => x.kind === "acquired" || x.kind === "reclaimed",
    );
    const blocked = [a, b].filter((x) => x.kind === "in_progress");
    return acquired.length === 1 && blocked.length === 1 && store.rows.size === 1;
  });

  await okAsync("占位后失败 → FAILED 可回收同一 attempt", async () => {
    const store = createMemoryRetrySlotStore();
    const key = buildRetryIdempotencyKey("run-fail", 1);
    const first = await reserveRetrySlot(store, {
      orgId: "org",
      userId: "u",
      oldRunId: "run-fail",
      retryAttempt: 1,
      idempotencyKey: key,
    });
    assert.equal(first.kind, "acquired");
    await markRetrySlotStarted(store, {
      orgId: "org",
      idempotencyKey: key,
      fromStatus: "RESERVED",
      payload: { ...first.payload, status: "STARTED", newRunId: "new-1" },
    });
    await markRetrySlotFailed(store, {
      orgId: "org",
      idempotencyKey: key,
      payload: { ...first.payload, newRunId: "new-1" },
      errorCode: "RUN_CREATE_FAILED",
    });
    const again = await reserveRetrySlot(store, {
      orgId: "org",
      userId: "u",
      oldRunId: "run-fail",
      retryAttempt: 1,
      idempotencyKey: key,
    });
    return again.kind === "reclaimed" && again.payload.status === "RESERVED";
  });

  await okAsync("COMPLETED 后并发返回 completed 不二次执行", async () => {
    const store = createMemoryRetrySlotStore();
    const key = buildRetryIdempotencyKey("run-done", 1);
    const first = await reserveRetrySlot(store, {
      orgId: "org",
      userId: "u",
      oldRunId: "run-done",
      retryAttempt: 1,
      idempotencyKey: key,
    });
    assert.equal(first.kind, "acquired");
    await markRetrySlotStarted(store, {
      orgId: "org",
      idempotencyKey: key,
      fromStatus: "RESERVED",
      payload: {
        ...first.payload,
        status: "STARTED",
        newRunId: "new-done",
        userMessageId: "um",
        assistantMessageId: "am",
      },
    });
    await markRetrySlotCompleted(store, {
      orgId: "org",
      idempotencyKey: key,
      payload: {
        ...first.payload,
        status: "COMPLETED",
        newRunId: "new-done",
        userMessageId: "um",
        assistantMessageId: "am",
      },
    });
    const [x, y] = await Promise.all([
      reserveRetrySlot(store, {
        orgId: "org",
        userId: "u",
        oldRunId: "run-done",
        retryAttempt: 1,
        idempotencyKey: key,
      }),
      reserveRetrySlot(store, {
        orgId: "org",
        userId: "u",
        oldRunId: "run-done",
        retryAttempt: 1,
        idempotencyKey: key,
      }),
    ]);
    return (
      x.kind === "completed" &&
      y.kind === "completed" &&
      x.payload.newRunId === "new-done" &&
      y.payload.newRunId === "new-done"
    );
  });

  // 源码契约：禁止 runs[0] 猜测；必须先占位再 createAssistantScenarioBinding
  ok(
    "Retry 不依赖 runs[0]（源码契约）",
    (() => {
      const src = readFileSync(resolve(ASSISTANT_DIR, "retry-run.ts"), "utf8");
      // 去掉注释后再检查，避免文档说明误伤
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const hasListGuess = code.includes("listAssistantRunsForThread");
      const hasRuns0 = /runs\s*\[\s*0\s*\]/.test(code);
      const callReserve = src.indexOf("await reserveRetrySlot");
      const callBinding = src.indexOf("await createAssistantScenarioBinding");
      return (
        !hasListGuess &&
        !hasRuns0 &&
        callReserve >= 0 &&
        callBinding >= 0 &&
        callReserve < callBinding
      );
    })(),
  );

  ok(
    "Dispatch 导出 startAssistantScenario / createAssistantScenarioBinding",
    (() => {
      const src = readFileSync(resolve(ASSISTANT_DIR, "dispatch.ts"), "utf8");
      return (
        src.includes("export async function startAssistantScenario") &&
        src.includes("export async function createAssistantScenarioBinding") &&
        src.includes("bound?: AssistantScenarioBinding")
      );
    })(),
  );

  console.log(`结果: ${passed} passed`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
