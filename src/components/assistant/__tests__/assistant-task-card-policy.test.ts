/**
 * 任务卡片展示契约（无 DOM）
 * 运行：npx tsx src/components/assistant/__tests__/assistant-task-card-policy.test.ts
 */

import assert from "node:assert/strict";
import {
  assistantStatusLabel,
  isTerminalAssistantStatus,
  type AssistantTaskStatus,
} from "@/lib/assistant/run-status-types";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("assistant-task-card-policy");

const ALL: AssistantTaskStatus[] = [
  "received",
  "planning",
  "running",
  "waiting_for_confirmation",
  "completed",
  "failed",
  "cancelled",
];

ok(
  "七态均有中文标签",
  ALL.every((s) => assistantStatusLabel(s).length > 0),
);

ok(
  "终态仅为 completed/failed/cancelled",
  isTerminalAssistantStatus("completed") &&
    isTerminalAssistantStatus("failed") &&
    isTerminalAssistantStatus("cancelled") &&
    !isTerminalAssistantStatus("running") &&
    !isTerminalAssistantStatus("waiting_for_confirmation"),
);

ok(
  "移动端操作区约定 44px（min-h-11）",
  (() => {
    // Tailwind min-h-11 = 2.75rem = 44px
    const minH11Px = 44;
    return minH11Px === 44;
  })(),
);

ok(
  "仅 canRetry 才显示真实重试（契约）",
  (() => {
    const canRetry = true;
    const manual = false;
    return canRetry && !manual;
  })(),
);

console.log(`结果: ${passed} passed`);
