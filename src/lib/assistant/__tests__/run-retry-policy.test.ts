/**
 * 安全重试策略契约（无 DB）
 * 运行：npx tsx src/lib/assistant/__tests__/run-retry-policy.test.ts
 */

import assert from "node:assert/strict";
import { deriveRetryFlags } from "@/lib/assistant/reconcile-decision";

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
  (() => {
    const oldRunId = "run-abc";
    const attempt = 1;
    const key = `assistant-run-retry:${oldRunId}:${attempt}`;
    return key === "assistant-run-retry:run-abc:1";
  })(),
);

ok(
  "无 safeToRetry 标记 → 不可重试",
  deriveRetryFlags({
    runStatus: "failed",
    metadata: {},
    actions: [],
  }).canRetry === false,
);

console.log(`结果: ${passed} passed`);
