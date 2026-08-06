/**
 * Addendum diff 纯函数
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/addendum-diff.test.ts
 */

import {
  diffRequirements,
  type DiffRequirement,
} from "../addendum-diff-pure";

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

console.log("tender-auto-analysis addendum-diff");

const before: DiffRequirement[] = [
  {
    requirementCode: "M1",
    chineseTranslation: "面料须为 1000D",
    originalRequirement: "Fabric shall be 1000D",
  },
  {
    requirementCode: "M2",
    chineseTranslation: "截标日期 2026-09-15",
    originalRequirement: "Closing 2026-09-15",
    dueDateHint: "2026-09-15",
  },
  {
    requirementCode: "M3",
    chineseTranslation: "需提供样品",
    originalRequirement: "Sample required",
  },
];

const after: DiffRequirement[] = [
  {
    requirementCode: "M1",
    chineseTranslation: "面料须为 1000D 尼龙",
    originalRequirement: "Fabric shall be 1000D nylon",
  },
  {
    requirementCode: "M2",
    chineseTranslation: "截标日期 2026-10-01",
    originalRequirement: "Closing 2026-10-01",
    dueDateHint: "2026-10-01",
  },
  {
    requirementCode: "M4",
    chineseTranslation: "需 OEM 证明",
    originalRequirement: "OEM certificate required",
  },
];

const diffs = diffRequirements(before, after);

ok(
  diffs.some((d) => d.changeType === "MODIFIED" && d.entityKey === "M1"),
  "M1 文本变更 → MODIFIED",
);
ok(
  diffs.some((d) => d.changeType === "DATE_CHANGED" && d.entityKey === "M2"),
  "M2 日期变更 → DATE_CHANGED",
);
ok(
  diffs.some((d) => d.changeType === "REMOVED" && d.entityKey === "M3"),
  "M3 删除 → REMOVED",
);
ok(
  diffs.some((d) => d.changeType === "ADDED" && d.entityKey === "M4"),
  "M4 新增 → ADDED",
);
ok(diffs.length === 4, `共 4 项变更（实际 ${diffs.length}）`);

const identical = diffRequirements(before, before);
ok(identical.length === 0, "相同列表无变更");

const empty = diffRequirements([], []);
ok(empty.length === 0, "空列表无变更");

console.log(`\naddendum-diff: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
