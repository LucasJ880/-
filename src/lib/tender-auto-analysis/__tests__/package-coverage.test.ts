/**
 * BLOCKER 3 — Package 覆盖率（纯汇总）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts
 */

import {
  summarizePackageCoverage,
  type CoverageRow,
} from "../package-coverage";

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

const row = (over: Partial<CoverageRow>): CoverageRow => ({
  documentId: Math.random().toString(),
  fileType: "pdf",
  parseStatus: "done",
  analyzed: true,
  ...over,
});

console.log("tender-auto-analysis package-coverage");

// 10 上传，7 PDF 进入分析，3 非 PDF → 禁止谎报「已分析 10」
{
  const rows: CoverageRow[] = [
    ...Array.from({ length: 7 }, () => row({ fileType: "pdf", analyzed: true })),
    ...Array.from({ length: 3 }, () => row({ fileType: "docx", analyzed: false })),
  ];
  const c = summarizePackageCoverage(rows);
  ok(c.uploaded === 10, "uploaded=10");
  ok(c.eligible === 7, "eligible=7");
  ok(c.analyzed === 7, "analyzed=7");
  ok(c.excluded === 3, "excluded=3");
  ok(c.excludedReasons.unsupported_format === 3, "3 非 PDF → unsupported_format");
  ok(c.label === "已分析 7 / 10 个文件", "label 真实覆盖：已分析 7/10（非 10）");
  ok(!!c.note && c.note.includes("PDF"), "note 说明 3 个非 PDF 未纳入");
}

// 解析失败计入 parse_failed
{
  const rows: CoverageRow[] = [
    row({ fileType: "pdf", parseStatus: "done", analyzed: true }),
    row({ fileType: "pdf", parseStatus: "failed", analyzed: false }),
  ];
  const c = summarizePackageCoverage(rows);
  ok(c.eligible === 1 && c.excluded === 1, "failed PDF 不计 eligible");
  ok(c.excludedReasons.parse_failed === 1, "parse_failed 计数");
}

// 全部 PDF 且都分析 → 无 note
{
  const rows = Array.from({ length: 5 }, () => row({}));
  const c = summarizePackageCoverage(rows);
  ok(c.label === "已分析 5 / 5 个文件" && c.note === null, "全覆盖无 note");
}

// eligible 但未纳入本次 run（analyzed<eligible）→ note 提示
{
  const rows: CoverageRow[] = [
    row({ analyzed: true }),
    row({ analyzed: false }),
  ];
  const c = summarizePackageCoverage(rows);
  ok(c.analyzed === 1 && c.eligible === 2, "analyzed<eligible");
  ok(!!c.note && c.note.includes("尚未纳入"), "提示未纳入本次分析");
}

// 空项目
{
  const c = summarizePackageCoverage([]);
  ok(c.uploaded === 0 && c.label === "已分析 0 / 0 个文件", "空项目安全");
}

console.log(`\npackage-coverage: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
