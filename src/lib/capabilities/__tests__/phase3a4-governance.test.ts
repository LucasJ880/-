/**
 * Phase 3A-4：治理 / 配额解析纯逻辑测试
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a4-governance.test.ts
 */

import { PLATFORM_DEFAULT_QUOTAS, ALL_QUOTA_METRICS } from "../governance/defaults";
import type { EffectiveQuotaProjection, QuotaMetric } from "../governance/types";

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

/** 与 resolve.ts 对齐的纯函数合并（供无 DB 断言） */
function tighter(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.min(a, b);
}

function mergeQuota(layers: Array<{
  scope: "PLATFORM" | "ORGANIZATION" | "WORKSPACE";
  warningLimit?: number | null;
  softLimit?: number | null;
  hardLimit?: number | null;
}>): Pick<EffectiveQuotaProjection, "warningLimit" | "softLimit" | "hardLimit" | "sourcePolicies"> {
  let warningLimit: number | null = null;
  let softLimit: number | null = null;
  let hardLimit: number | null = null;
  const sourcePolicies: EffectiveQuotaProjection["sourcePolicies"] = [];
  for (const layer of layers) {
    sourcePolicies.push({ scope: layer.scope });
    warningLimit = tighter(warningLimit, layer.warningLimit);
    softLimit = tighter(softLimit, layer.softLimit);
    // Workspace 放宽：忽略
    if (
      layer.scope === "WORKSPACE" &&
      layer.hardLimit != null &&
      hardLimit != null &&
      layer.hardLimit > hardLimit
    ) {
      continue;
    }
    hardLimit = tighter(hardLimit, layer.hardLimit);
  }
  return { warningLimit, softLimit, hardLimit, sourcePolicies };
}

function levelOf(
  projected: number,
  limits: { warningLimit: number | null; softLimit: number | null; hardLimit: number | null },
): "OK" | "WARNING" | "SOFT_LIMIT" | "HARD_LIMIT" {
  if (limits.hardLimit != null && projected > limits.hardLimit) return "HARD_LIMIT";
  if (limits.softLimit != null && projected > limits.softLimit) return "SOFT_LIMIT";
  if (limits.warningLimit != null && projected > limits.warningLimit) return "WARNING";
  return "OK";
}

console.log("phase3a4 governance logic");

ok(ALL_QUOTA_METRICS.length === 6, "6 个首批 metric");
ok(
  PLATFORM_DEFAULT_QUOTAS.MONTHLY_AI_COST.hardLimit === 50,
  "平台月费用默认 hard=50",
);
ok(
  PLATFORM_DEFAULT_QUOTAS.MAX_CONCURRENT_RUNS.period === "CONCURRENT",
  "并发指标 period=CONCURRENT",
);

const inherit = mergeQuota([
  { scope: "PLATFORM", ...PLATFORM_DEFAULT_QUOTAS.DAILY_AGENT_RUNS },
  { scope: "ORGANIZATION", hardLimit: 100, softLimit: 80, warningLimit: 60 },
]);
ok(inherit.hardLimit === 100, "Org 可收紧 Platform hard 200→100");
ok(
  inherit.sourcePolicies.map((s) => s.scope).join(",") ===
    "PLATFORM,ORGANIZATION",
  "来源含 PLATFORM+ORGANIZATION",
);

const relaxDenied = mergeQuota([
  { scope: "PLATFORM", hardLimit: 200 },
  { scope: "ORGANIZATION", hardLimit: 100 },
  { scope: "WORKSPACE", hardLimit: 150 },
]);
ok(relaxDenied.hardLimit === 100, "Workspace 无法放宽 Org hard");

const tighterWs = mergeQuota([
  { scope: "PLATFORM", hardLimit: 200 },
  { scope: "ORGANIZATION", hardLimit: 100 },
  { scope: "WORKSPACE", hardLimit: 40 },
]);
ok(tighterWs.hardLimit === 40, "Workspace 可继续收紧");

const platformFloor = mergeQuota([
  { scope: "PLATFORM", hardLimit: 50 },
  { scope: "ORGANIZATION", hardLimit: 999 },
]);
ok(platformFloor.hardLimit === 50, "Org 无法放宽 Platform hard");

ok(levelOf(10, { warningLimit: 20, softLimit: 30, hardLimit: 40 }) === "OK", "OK");
ok(
  levelOf(25, { warningLimit: 20, softLimit: 30, hardLimit: 40 }) === "WARNING",
  "WARNING 仍允许语义",
);
ok(
  levelOf(35, { warningLimit: 20, softLimit: 30, hardLimit: 40 }) === "SOFT_LIMIT",
  "SOFT_LIMIT",
);
ok(
  levelOf(41, { warningLimit: 20, softLimit: 30, hardLimit: 40 }) === "HARD_LIMIT",
  "HARD_LIMIT 阻止",
);

const metrics: QuotaMetric[] = [
  "MONTHLY_AI_COST",
  "DAILY_AGENT_RUNS",
  "DAILY_HIGH_RISK_TOOL_CALLS",
  "DAILY_IMAGE_GENERATIONS",
  "MAX_CONCURRENT_RUNS",
  "SINGLE_RUN_ESTIMATED_COST",
];
ok(
  metrics.every((m) => PLATFORM_DEFAULT_QUOTAS[m].hardLimit > 0),
  "所有默认 hard > 0",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
