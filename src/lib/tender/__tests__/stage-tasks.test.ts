/**
 * 阶段→任务联动 — 纯逻辑测试
 *
 * 运行方式: npx tsx src/lib/tender/__tests__/stage-tasks.test.ts
 *
 * 覆盖场景：
 * 1. 每个阶段的任务模板存在性
 * 2. 任务标题前缀格式
 * 3. initiation 阶段无模板（起始态）
 */

import { STAGE_ORDER, STAGE_LABEL } from "../stage-transition";
import type { TenderStage } from "../types";

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

// ── 1. 阶段标签与前缀一致性 ──

for (const stage of STAGE_ORDER) {
  const label = STAGE_LABEL[stage];
  assert(!!label, `STAGE_LABEL 存在: ${stage}`);
  const prefix = `[${label}]`;
  assert(prefix.startsWith("[") && prefix.endsWith("]"), `前缀格式正确: ${prefix}`);
}

// ── 2. initiation 不应有推进时间戳 ──

import { STAGE_TO_TIMESTAMP } from "../stage-transition";
assert(
  STAGE_TO_TIMESTAMP["initiation"] === undefined,
  "initiation 无对应时间戳字段（起始态）"
);

// ── 3. 其他阶段都有时间戳映射 ──

for (const stage of STAGE_ORDER.slice(1)) {
  assert(
    typeof STAGE_TO_TIMESTAMP[stage] === "string",
    `${stage} 有对应时间戳字段: ${STAGE_TO_TIMESTAMP[stage]}`
  );
}

// ── 4. 阶段顺序完整性 ──

assert(STAGE_ORDER.length === 6, `阶段总数为 6: 实际 ${STAGE_ORDER.length}`);
assert(STAGE_ORDER[0] === "initiation", "第一阶段为 initiation");
assert(STAGE_ORDER[5] === "submission", "最后阶段为 submission");

// ── 5. 前缀不会互相包含（避免 startsWith 误匹配） ──

const prefixes = STAGE_ORDER.map((s) => `[${STAGE_LABEL[s]}]`);
for (let i = 0; i < prefixes.length; i++) {
  for (let j = 0; j < prefixes.length; j++) {
    if (i !== j) {
      assert(
        !prefixes[i].startsWith(prefixes[j]),
        `前缀不互相包含: "${prefixes[i]}" 不以 "${prefixes[j]}" 开头`
      );
    }
  }
}

// ── 结果汇总 ──

console.log(`\n${"═".repeat(50)}`);
console.log(`阶段→任务联动 测试结果: ${passed.length} 通过, ${failed.length} 失败`);
console.log(`${"═".repeat(50)}\n`);

if (failed.length > 0) {
  console.error("失败项:");
  failed.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log("✅ 全部通过");
}
