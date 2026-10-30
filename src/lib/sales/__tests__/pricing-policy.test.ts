/**
 * PERM-2：合价上限读取（纯函数）
 * 运行：npx tsx src/lib/sales/__tests__/pricing-policy.test.ts
 */
import { DEFAULT_LEAD_MAX_PCT, readLeadMaxPct, resolvePricingPolicy } from "../pricing-policy";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); }
}

console.log("PERM-2 合价上限");
ok(DEFAULT_LEAD_MAX_PCT === 0.35, "默认 0.35");
ok(readLeadMaxPct(null) === 0.35 && readLeadMaxPct({}) === 0.35, "未配置 → 0.35");
ok(readLeadMaxPct({ pricing: { leadMaxPct: 0.4 } }) === 0.4, "企业覆盖 0.4");
ok(readLeadMaxPct({ pricing: { leadMaxPct: "abc" } }) === 0.35, "\"abc\" → 回落");
ok(readLeadMaxPct({ pricing: { leadMaxPct: 1.5 } }) === 0.35, "1.5 → 回落");
ok(readLeadMaxPct({ pricing: { leadMaxPct: -0.1 } }) === 0.35, "-0.1 → 回落");
ok(readLeadMaxPct({ pricing: { leadMaxPct: NaN } }) === 0.35, "NaN → 回落");
ok(readLeadMaxPct({ museBridge: {} }) === 0.35, "settingsJson 其它键不影响");
ok(resolvePricingPolicy({ pricing: { leadMaxPct: 0.2 } }, 0.25).leadMaxPct === 0.25, "低于销售上限 → 取销售上限");
ok(resolvePricingPolicy(null, 0.25).leadMaxPct === 0.35 && resolvePricingPolicy(null, 0.25).promoMaxPct === 0.25, "默认策略 {0.25, 0.35}");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
