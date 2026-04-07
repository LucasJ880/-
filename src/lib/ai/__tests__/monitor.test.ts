/**
 * AI 调用监控 — 纯逻辑测试
 *
 * 运行方式: npx tsx src/lib/ai/__tests__/monitor.test.ts
 */

import { recordAiCall, getAiStats } from "../monitor";

const passed: string[] = [];
const failed: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) {
    passed.push(name);
  } else {
    failed.push(name);
    console.error(`  ❌ FAIL: ${name}`);
  }
}

// ── 1. 空状态 ──

const emptyStats = getAiStats(1);
assert(emptyStats.totalCalls === 0, "空状态: totalCalls === 0");
assert(emptyStats.successRate === 1, "空状态: successRate === 1（无调用视为 100%）");
assert(emptyStats.recentErrors.length === 0, "空状态: 无错误");

// ── 2. 记录成功调用 ──

recordAiCall({ model: "gpt-4o-mini", success: true, elapsedMs: 500 });
recordAiCall({ model: "gpt-4o-mini", success: true, elapsedMs: 800 });
recordAiCall({ model: "gpt-4o", success: true, elapsedMs: 1200 });

const stats1 = getAiStats(60);
assert(stats1.totalCalls === 3, `记录3次调用: totalCalls === ${stats1.totalCalls}`);
assert(stats1.successCount === 3, "全部成功");
assert(stats1.failureCount === 0, "无失败");
assert(stats1.successRate === 1, "成功率 100%");
assert(stats1.avgLatencyMs > 0, `平均延迟 > 0: ${stats1.avgLatencyMs}ms`);

// ── 3. 记录失败调用 ──

recordAiCall({ model: "gpt-4o", success: false, elapsedMs: 200, error: "Rate limit exceeded" });

const stats2 = getAiStats(60);
assert(stats2.totalCalls === 4, `记录4次调用: totalCalls === ${stats2.totalCalls}`);
assert(stats2.failureCount === 1, "1 次失败");
assert(stats2.successRate === 0.75, `成功率 75%: ${stats2.successRate}`);
assert(stats2.recentErrors.length === 1, "最近错误 1 条");
assert(stats2.recentErrors[0].error === "Rate limit exceeded", "错误信息正确");

// ── 4. 按模型统计 ──

assert("gpt-4o-mini" in stats2.byModel, "byModel 包含 gpt-4o-mini");
assert("gpt-4o" in stats2.byModel, "byModel 包含 gpt-4o");
assert(stats2.byModel["gpt-4o-mini"].calls === 2, "gpt-4o-mini 调用 2 次");
assert(stats2.byModel["gpt-4o"].calls === 2, "gpt-4o 调用 2 次");
assert(stats2.byModel["gpt-4o"].failures === 1, "gpt-4o 失败 1 次");

// ── 5. P95 延迟合理性 ──

assert(stats2.p95LatencyMs > 0, `P95 延迟 > 0: ${stats2.p95LatencyMs}ms`);
assert(stats2.p95LatencyMs <= 1200, `P95 延迟 <= 1200ms: ${stats2.p95LatencyMs}ms`);

// ── 结果汇总 ──

console.log(`\n${"═".repeat(50)}`);
console.log(`AI 监控 测试结果: ${passed.length} 通过, ${failed.length} 失败`);
console.log(`${"═".repeat(50)}\n`);

if (failed.length > 0) {
  console.error("失败项:");
  failed.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log("✅ 全部通过");
}
