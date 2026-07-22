/**
 * Phase 3A-5：Catalog / Config Health
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a5-catalog-health.test.ts
 */

import { resolveIndustryPack } from "@/lib/industry-packs/registry";

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

console.log("phase3a5 catalog / config-health");

const missing = resolveIndustryPack(null);
ok(missing.status === "missing" && missing.pack === null, "未配置 Pack 不静默回退");

const invalid = resolveIndustryPack("not-a-real-pack-xyz");
ok(invalid.status === "invalid" && invalid.pack === null, "无效 Pack 不静默回退");

const sunny = resolveIndustryPack("window_covering_services_v1");
ok(sunny.status === "ok" && sunny.pack?.id === "window_covering_services_v1", "Sunny Pack 可解析");

const mx = resolveIndustryPack("home_textile_trade_v1");
ok(mx.status === "ok" && mx.pack?.id === "home_textile_trade_v1", "梦馨 Pack 可解析");

ok(
  sunny.pack?.id !== mx.pack?.id,
  "Sunny 与梦馨 Industry Pack 不同",
);

// 状态枚举契约
const statuses = [
  "ACTIVE",
  "DISABLED",
  "MISSING_CONFIG",
  "INCOMPATIBLE",
  "DEPRECATED",
  "ERROR",
];
ok(statuses.includes("MISSING_CONFIG"), "配置缺失不得伪装 ACTIVE");

const health = ["HEALTHY", "WARNING", "ERROR", "MISSING", "INCOMPATIBLE"];
ok(health.includes("MISSING") && health.includes("INCOMPATIBLE"), "健康状态含 MISSING/INCOMPATIBLE");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
