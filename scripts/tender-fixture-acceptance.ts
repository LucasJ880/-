/**
 * 真实 Fixture PDF：解析 + 确定性抽取指标（不入库、不输出全文）。
 *
 * 用法：
 *   TENDER_FIXTURE_PDF_PATH=/path/to/rfp.pdf npx tsx scripts/tender-fixture-acceptance.ts
 *
 * 环境变量未设置时 graceful skip。
 */

import { readFile } from "node:fs/promises";
import { extractPdfPagesFromBuffer } from "../src/lib/tender-auto-analysis/page-parse";
import { extractFactsFromPages } from "../src/lib/tender-auto-analysis/extract/facts";
import { extractRequirementsFromPages } from "../src/lib/tender-auto-analysis/extract/requirements";
import { buildClarificationCandidates } from "../src/lib/tender-auto-analysis/clarifications";
import { listDeliverableKeys } from "../src/lib/tender-auto-analysis/deliverables";

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
  const { totalPages, pages: rawPages } = await extractPdfPagesFromBuffer(buffer);

  const pages = rawPages.map((p) => ({
    documentId: "fixture_pdf",
    pageNumber: p.pageNumber,
    contentText: p.contentText,
  }));
  const allText = pages.map((p) => p.contentText).join("\n");

  const facts = extractFactsFromPages(pages);
  const requirements = extractRequirementsFromPages(pages);
  const clarifications = buildClarificationCandidates(pages, allText);
  const deliverableKeys = listDeliverableKeys();

  const confirmed = facts.filter((f) => f.statementKind === "CONFIRMED_FACT");
  const qtyAmbiguity = facts.some((f) => f.factKey === "qty_ambiguity_interpretation");
  const has7500Interp = facts.some(
    (f) => f.factKey === "qty_7500_evaluation_aggregate_not_guarantee",
  );

  console.log(
    JSON.stringify({
      skipped: false,
      pageCount: totalPages,
      nonEmptyPages: pages.filter((p) => p.contentText.trim().length > 0).length,
      factCount: facts.length,
      confirmedFactCount: confirmed.length,
      requirementCount: requirements.length,
      clarificationCount: clarifications.length,
      deliverableCount: deliverableKeys.length,
      qtyAmbiguity,
      has7500EvaluationAggregateInterpretation: has7500Interp,
      sampleFactKeys: facts.slice(0, 12).map((f) => f.factKey),
      sampleRequirementCodes: requirements.slice(0, 15).map((r) => r.requirementCode),
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
