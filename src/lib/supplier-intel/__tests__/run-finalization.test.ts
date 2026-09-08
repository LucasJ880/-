/**
 * BL-4B（S2 Final Remediation）：Run 收口决策（§44，沿用既有 S2 语义）——CI 可执行的行为/决策测试。
 *
 *   - 全部实际执行源 FAILED → FAILED；
 *   - DISABLED / PLANNED 不伪装成成功执行源（不计入已执行源；零已执行源不构成全失败）；
 *   - 至少一个 SUCCESS 其余 FAILED → COMPLETED，源级失败详情保留；
 *   - 至少一个 EMPTY 其余 FAILED → COMPLETED（EMPTY 是合法执行结果，不改判为错误）；
 *   - adapter 级：provider 混合 EMPTY + 失败 → 源 FAILED 且带首个失败原因（既有 §44 聚合语义）。
 * 终态并发（CANCELLED 不被收口覆盖、晚到结果丢弃）与「全源失败」的真实持久化在
 * supplier-intel-s2rem-db.isolated.test.ts / supplier-intel-s2-db.isolated.test.ts（隔离库）验证。
 *
 * 注意：只给 Prisma 一个永不连接的占位 URL，零数据库副作用。
 */
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://ci:ci@127.0.0.1:5432/ci?schema=public";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

async function main() {
  const { decideRunFinalization } = await import("../discovery-service");
  type Sources = Parameters<typeof decideRunFinalization>[0];

  console.log("B1：全部已执行源 FAILED → FAILED（DISABLED/PLANNED 旁观不改变结论）");
  const allFailed: Sources = {
    memory: { status: "FAILED", reason: "db timeout" },
    OPEN_WEB: { status: "FAILED", reason: "TIMEOUT" },
    DOUYIN: { status: "FAILED", reason: "RATE_LIMITED" },
    WECHAT_CHANNELS: { status: "DISABLED", reason: "USER_ASSISTED" },
    historical: { status: "PLANNED" },
  };
  const d1 = decideRunFinalization(allFailed);
  assert.equal(d1.outcome, "FAILED");
  assert.equal(d1.executed, 3, "DISABLED/PLANNED 不计入已执行源");
  assert.equal(d1.failed, 3);
  assert.equal(d1.succeeded, 0);

  console.log("B2：只有 DISABLED/PLANNED（零已执行源）→ 不构成「全失败」，也不计任何成功执行源");
  const noneExecuted: Sources = {
    OPEN_WEB: { status: "DISABLED", reason: "双门未开" },
    memory: { status: "PLANNED" },
  };
  const d2 = decideRunFinalization(noneExecuted);
  assert.equal(d2.executed, 0);
  assert.equal(d2.succeeded, 0);
  assert.equal(d2.failed, 0);
  assert.equal(d2.outcome, "COMPLETED", "既有 §44 语义：无已执行源时不判 FAILED（不重新设计状态机）");

  console.log("B3：至少一个 SUCCESS，其余 FAILED → COMPLETED，源级失败详情原样保留");
  const mixedSuccess: Sources = {
    memory: { status: "SUCCESS", count: 2 },
    OPEN_WEB: { status: "FAILED", reason: "AUTH_ERROR" },
    XIAOHONGSHU: { status: "FAILED", reason: "TIMEOUT" },
  };
  const d3 = decideRunFinalization(mixedSuccess);
  assert.equal(d3.outcome, "COMPLETED");
  assert.equal(d3.executed, 3);
  assert.equal(d3.failed, 2);
  assert.equal(mixedSuccess.OPEN_WEB.reason, "AUTH_ERROR", "决策函数不修改源级详情");
  assert.equal(mixedSuccess.XIAOHONGSHU.status, "FAILED");

  console.log("B4：至少一个 EMPTY，其余 FAILED → COMPLETED（EMPTY 不被改判为错误）");
  const mixedEmpty: Sources = {
    saved: { status: "EMPTY", count: 0 },
    OPEN_WEB: { status: "FAILED", reason: "PROVIDER_ERROR" },
  };
  const d4 = decideRunFinalization(mixedEmpty);
  assert.equal(d4.outcome, "COMPLETED");
  assert.equal(d4.empty, 1);
  assert.equal(d4.failed, 1);
  assert.equal(mixedEmpty.saved.status, "EMPTY");

  console.log("B5：纯函数确定性——同输入同输出，不依赖键序");
  const a = decideRunFinalization({ x: { status: "FAILED" }, y: { status: "FAILED" } });
  const b = decideRunFinalization({ y: { status: "FAILED" }, x: { status: "FAILED" } });
  assert.deepEqual(a, b);
  assert.equal(a.outcome, "FAILED");

  console.log("B6：adapter 级聚合——provider 混合 EMPTY + 失败 → 源 FAILED 且带首个失败原因；全 EMPTY → EMPTY");
  const { douyinSupplierDiscoveryAdapter } = await import("../adapters");
  const { buildDeterministicBrief } = await import("../search-brief");
  type Provider = import("../providers").DiscoveryProvider;
  const brief = buildDeterministicBrief(
    { requirements: [], productKeywordsZh: ["铝合金外壳"], capabilityHintsZh: ["CNC 加工"] },
    { now: new Date("2026-09-08T00:00:00Z") },
  );
  const seq: Array<"EMPTY" | "PROVIDER_ERROR"> = ["EMPTY", "PROVIDER_ERROR"];
  let i = 0;
  const flaky: Provider = {
    providerId: "fake-flaky",
    policy: { respectsRobots: true, requiresPlatformLogin: false, dataLicense: "test" },
    isAvailable: () => true,
    search: async () => ({ status: seq[i++ % seq.length], results: [] }),
  };
  const plan = douyinSupplierDiscoveryAdapter.buildQueryPlan(brief);
  assert.ok(plan.length >= 2, `需要 ≥2 条抖音计划才能构造混合（实际 ${plan.length}）`);
  const outcome = await douyinSupplierDiscoveryAdapter.discover(brief, flaky);
  assert.ok(outcome.ok);
  if (outcome.ok) {
    assert.equal(outcome.sourceStatus, "FAILED", "混合 EMPTY+失败 → 源 FAILED（不掩盖 provider 问题）");
    assert.equal(outcome.failureReason, "PROVIDER_ERROR");
    assert.ok(outcome.providerStatuses.includes("EMPTY") && outcome.providerStatuses.includes("PROVIDER_ERROR"));
  }
  const allEmpty: Provider = { ...flaky, search: async () => ({ status: "EMPTY", results: [] }) };
  const o2 = await douyinSupplierDiscoveryAdapter.discover(brief, allEmpty);
  assert.ok(o2.ok && o2.sourceStatus === "EMPTY" && o2.failureReason === null);

  console.log("\nrun-finalization（BL-4B 决策）全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
