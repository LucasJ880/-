/**
 * Phase C — Tender Package Ready Gate（纯函数）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/package-ready.test.ts
 */

import {
  assessPackageReadiness,
  readinessReason,
  type ReadinessRow,
} from "../package-ready";

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

const pdf = (over: Partial<ReadinessRow>): ReadinessRow => ({
  fileType: "pdf",
  parseStatus: "done",
  contentHash: "h",
  hasBlob: true,
  addendumOnly: false,
  ...over,
});

console.log("tender-auto-analysis package-ready");

// 空 / 无 PDF → NO_PACKAGE_DOCUMENTS
{
  const r = assessPackageReadiness([]);
  ok(!r.ready && r.code === "NO_PACKAGE_DOCUMENTS", "空项目 → NO_PACKAGE_DOCUMENTS");
}
{
  const r = assessPackageReadiness([pdf({ fileType: "docx" }), pdf({ fileType: "xlsx" })]);
  ok(!r.ready && r.code === "NO_PACKAGE_DOCUMENTS", "无 PDF → NO_PACKAGE_DOCUMENTS");
}

// 任一文件仍在解析 → DOCUMENT_PROCESSING（关键：不提前分析半包）
{
  const r = assessPackageReadiness([
    pdf({ parseStatus: "done" }),
    pdf({ parseStatus: "parsing" }),
    pdf({ parseStatus: "pending" }),
  ]);
  ok(
    !r.ready && r.code === "DOCUMENT_PROCESSING",
    "存在 parsing/pending → DOCUMENT_PROCESSING",
  );
  ok(!r.ready && r.pendingCount === 2, "pendingCount 统计正确");
}

// CASE 3 语义：10 文件仍在 processing → 不就绪
{
  const rows = Array.from({ length: 10 }, (_, i) =>
    pdf({ parseStatus: i < 3 ? "done" : "pending" }),
  );
  const r = assessPackageReadiness(rows);
  ok(!r.ready && r.code === "DOCUMENT_PROCESSING", "10 文件仍处理中 → 不就绪");
}

// CASE 4 语义：缺 contentHash 且无 blob 可回填 → MISSING_CONTENT_HASH（不静默忽略）
{
  const r = assessPackageReadiness([
    pdf({ contentHash: null, hasBlob: false }),
  ]);
  ok(
    !r.ready && r.code === "MISSING_CONTENT_HASH",
    "缺 hash 且无 blob → MISSING_CONTENT_HASH",
  );
}
{
  // 缺 hash 但有 blob 可回填 → 视为可就绪
  const r = assessPackageReadiness([pdf({ contentHash: "", hasBlob: true })]);
  ok(r.ready, "缺 hash 但可回填 → 就绪");
}

// failed 文件不阻塞（跳过），其余就绪 → READY
{
  const r = assessPackageReadiness([
    pdf({ parseStatus: "failed" }),
    pdf({ parseStatus: "done" }),
  ]);
  ok(r.ready && r.documentCount === 1, "failed 文件跳过，其余就绪 → READY");
}

// addendum-only 文档不计入候选
{
  const r = assessPackageReadiness([pdf({ addendumOnly: true })]);
  ok(!r.ready && r.code === "NO_PACKAGE_DOCUMENTS", "仅 addendum-only → 无候选");
}

// CASE 1/2 语义：全部就绪 → READY（数量正确，供单包单 run）
{
  const rows = Array.from({ length: 10 }, () => pdf({}));
  const r = assessPackageReadiness(rows);
  ok(r.ready && r.documentCount === 10, "10 文件全就绪 → READY(count=10)");
}
{
  const r = assessPackageReadiness([pdf({})]);
  ok(r.ready && r.documentCount === 1, "单 PDF 就绪 → READY");
}

// reason 映射
{
  ok(readinessReason("NO_PACKAGE_DOCUMENTS") === "no_package_documents", "reason NO_PACKAGE_DOCUMENTS");
  ok(readinessReason("DOCUMENT_PROCESSING") === "document_processing", "reason DOCUMENT_PROCESSING");
  ok(readinessReason("MISSING_CONTENT_HASH") === "missing_content_hash", "reason MISSING_CONTENT_HASH");
}

console.log(`\npackage-ready: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
