/**
 * 真实 Fixture PDF 页级解析冒烟（不入库）。
 *
 * 用法：
 *   TENDER_FIXTURE_PDF_PATH=/path/to/rfp.pdf npx tsx scripts/tender-fixture-parse-pages.ts
 *
 * 仅打印：pageCount / nonEmptyPages / ocrRequiredPages / first&last char counts
 * 绝不输出 PDF 全文。环境变量未设置时 graceful skip。
 */

import { readFile } from "node:fs/promises";
import { extractPdfPagesFromBuffer } from "../src/lib/tender-auto-analysis/page-parse";

async function main() {
  const path = process.env.TENDER_FIXTURE_PDF_PATH?.trim();
  if (!path) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: "TENDER_FIXTURE_PDF_PATH unset",
      }),
    );
    return;
  }

  const buffer = await readFile(path);
  const { totalPages, pages } = await extractPdfPagesFromBuffer(buffer);

  const nonEmptyPages = pages.filter((p) => p.charCount > 0).length;
  const ocrRequiredPages = pages.filter(
    (p) => p.parseStatus === "OCR_REQUIRED" || p.parseStatus === "empty",
  ).length;
  const first = pages[0];
  const last = pages[pages.length - 1];

  console.log(
    JSON.stringify({
      skipped: false,
      pageCount: totalPages,
      nonEmptyPages,
      ocrRequiredPages,
      firstPageCharCount: first?.charCount ?? 0,
      lastPageCharCount: last?.charCount ?? 0,
    }),
  );
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      skipped: false,
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  process.exit(1);
});
