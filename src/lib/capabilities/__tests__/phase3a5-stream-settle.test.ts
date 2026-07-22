/**
 * Phase 3A-5：流式租户预检 / 结算 / soft limit 去重
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a5-stream-settle.test.ts
 */

import {
  buildStreamSessionKey,
  buildQuotaNotifyDedupeKey,
  actualCostFromStreamUsage,
} from "@/lib/capabilities/governance";

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

console.log("phase3a5 stream / settle / soft-limit");

const sk = buildStreamSessionKey({
  orgId: "org_a",
  userId: "user_1",
  requestId: "req_1",
  threadId: "th_1",
});
ok(sk.includes("org_a"), "session key 含 orgId");
ok(sk.includes("user_1"), "session key 含 userId");
ok(sk.startsWith("stream:"), "session key 前缀");

const sk2 = buildStreamSessionKey({
  orgId: "org_b",
  userId: "user_1",
  requestId: "req_1",
  threadId: "th_1",
});
ok(sk !== sk2, "不同 org 的 session key 不同");

const d1 = buildQuotaNotifyDedupeKey({
  orgId: "org_a",
  metric: "MONTHLY_AI_COST",
  level: "SOFT_LIMIT",
  at: new Date("2026-07-15T12:00:00Z"),
});
const d2 = buildQuotaNotifyDedupeKey({
  orgId: "org_a",
  metric: "MONTHLY_AI_COST",
  level: "SOFT_LIMIT",
  at: new Date("2026-07-20T12:00:00Z"),
});
const d3 = buildQuotaNotifyDedupeKey({
  orgId: "org_b",
  metric: "MONTHLY_AI_COST",
  level: "SOFT_LIMIT",
  at: new Date("2026-07-15T12:00:00Z"),
});
ok(d1 === d2, "同月 soft limit 去重键相同");
ok(d1 !== d3, "不同 org 通知去重键不同");
ok(d1.includes("SOFT_LIMIT"), "去重键含 level");

const warnKey = buildQuotaNotifyDedupeKey({
  orgId: "org_a",
  metric: "MONTHLY_AI_COST",
  level: "WARNING",
  at: new Date("2026-07-15T12:00:00Z"),
});
ok(warnKey !== d1, "WARNING 与 SOFT_LIMIT 去重键不同");

const cost = actualCostFromStreamUsage({
  model: "gpt-4o-mini",
  promptTokens: 1000,
  completionTokens: 500,
});
ok(cost > 0 && cost < 1, "stream usage 可估算为正小数成本");

const zero = actualCostFromStreamUsage({
  model: "gpt-4o-mini",
  promptTokens: 0,
  completionTokens: 0,
});
ok(zero === 0, "无 token 成本为 0");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
