/**
 * 运行：npx tsx src/lib/ai/model-policy/__tests__/benchmark-harness.test.ts
 */
import {
  describeBenchmarkInventory,
  GPT6_BENCHMARK_CASES,
} from "../benchmark-fixtures";
import { GPT6_DEFAULT_ROLES, LOWER_COST_ROLES } from "../roles";

let total = 0;
let failed = 0;
function expect(c: boolean, m: string) {
  total++;
  if (c) console.log(`✓ ${m}`);
  else {
    failed++;
    console.error(`✗ ${m}`);
  }
}

const inv = describeBenchmarkInventory();
expect(inv.total === 40, "40 条真实形态用例");
expect(inv.counts.simple === 10, "10 simple");
expect(inv.counts.medium === 10, "10 medium");
expect(inv.counts.complex === 10, "10 complex");
expect(inv.counts["tool-heavy"] === 5, "5 tool-heavy");
expect(inv.counts["failure-recovery"] === 5, "5 failure/recovery");

const ids = new Set(GPT6_BENCHMARK_CASES.map((c) => c.id));
expect(ids.size === 40, "id 唯一");

expect(
  GPT6_BENCHMARK_CASES.filter((c) => c.band === "simple").every((c) =>
    (LOWER_COST_ROLES as readonly string[]).includes(c.role),
  ),
  "simple 全部落在低成本角色",
);

expect(
  GPT6_BENCHMARK_CASES.filter((c) => c.band === "complex").some((c) =>
    (GPT6_DEFAULT_ROLES as readonly string[]).includes(c.role),
  ),
  "complex 覆盖 Phase 1 角色",
);

expect(
  GPT6_BENCHMARK_CASES.every(
    (c) => !/sk-|api[_-]?key|password/i.test(c.prompt),
  ),
  "fixture 不含密钥",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} gpt6-benchmark-harness: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
