/**
 * 真实 Fixture PDF：解析 + 确定性抽取 FULL_PASS 门禁（不入库、不输出全文）。
 *
 * 用法：
 *   TENDER_FIXTURE_PDF_PATH=/path/to/rfp.pdf npx tsx scripts/tender-fixture-acceptance.ts
 */

import { readFile } from "node:fs/promises";
import { extractPdfPagesFromBuffer } from "../src/lib/tender-auto-analysis/page-parse";
import {
  buildQuantityEvaluationSummary,
  extractFactsFromPages,
} from "../src/lib/tender-auto-analysis/extract/facts";
import { extractRequirementsFromPages } from "../src/lib/tender-auto-analysis/extract/requirements";
import { buildClarificationCandidates } from "../src/lib/tender-auto-analysis/clarifications";
import { listDeliverableKeys } from "../src/lib/tender-auto-analysis/deliverables";
import { assertSourceSnippet } from "../src/lib/tender-auto-analysis/source-verify";

const REQUIRED_FACT_KEYS = [
  "solicitation_number",
  "solicitation_title",
  "issue_date",
  "closing_datetime",
  "solicitation_type",
  "standing_offer_main_period",
  "option_period_1",
  "option_period_2",
  "no_security_requirement",
  "submission_sections",
  "email_max_size",
  "zip_and_links_not_accepted",
  "price_only_in_financial_offer",
  "offer_validity",
  "evaluation_method",
  "delivery_term",
  "delivery_lead_time",
  "callup_confirmation",
  "environmentally_preferable_packaging_mandatory",
  "reciprocal_procurement_eligibility",
  "forced_labour_requirement",
  "qty_annex_a_up_to_1500_per_period",
  "qty_annex_b_standing_offer_year_1_1500",
  "qty_annex_b_standing_offer_year_2_1500",
  "qty_annex_b_standing_offer_year_3_1500",
  "qty_annex_b_option_year_1_1500",
  "qty_annex_b_option_year_2_1500",
  "qty_estimated_for_evaluation_only_not_guarantee",
  "qty_7500_evaluation_aggregate_not_guarantee",
  "qty_actual_purchase_not_guaranteed",
  "qty_ambiguity_interpretation",
] as const;

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
  const byPage = new Map(pages.map((p) => [p.pageNumber, p.contentText]));
  const allText = pages.map((p) => p.contentText).join("\n");

  const facts = extractFactsFromPages(pages);
  const requirements = extractRequirementsFromPages(pages);
  const clarifications = buildClarificationCandidates(pages, allText);
  const deliverableKeys = listDeliverableKeys();
  const byKey = new Map(facts.map((f) => [f.factKey, f]));
  const qty = buildQuantityEvaluationSummary(facts);

  const missingFacts = REQUIRED_FACT_KEYS.filter((k) => !byKey.has(k));
  const mCodes = Array.from({ length: 15 }, (_, i) => `M${i + 1}`);
  const reqCodes = new Set(requirements.map((r) => r.requirementCode));
  const missingM = mCodes.filter((c) => !reqCodes.has(c));

  let factVerified = 0;
  let confirmedWithoutSource = 0;
  for (const f of facts) {
    const ref = f.sourceRefs[0];
    if (!ref) {
      if (f.statementKind === "CONFIRMED_FACT") confirmedWithoutSource += 1;
      continue;
    }
    const pageText = byPage.get(ref.pageNumber) ?? "";
    if (
      assertSourceSnippet({
        snippet: ref.originalTextSnippet,
        pageText,
        statementKind: f.statementKind,
        confidence: f.confidence,
      }).verified
    ) {
      factVerified += 1;
    } else if (f.statementKind === "CONFIRMED_FACT") {
      confirmedWithoutSource += 1;
    }
  }

  let reqVerified = 0;
  for (const r of requirements) {
    const ref = r.sourceRefs[0];
    const page = ref?.pageNumber ?? r.sourcePage;
    const snippet =
      ref?.originalTextSnippet ?? (r.originalRequirement || "").slice(0, 160);
    const pageText = page != null ? byPage.get(page) ?? "" : "";
    if (assertSourceSnippet({ snippet, pageText, statementKind: "CONFIRMED_FACT" }).verified) {
      reqVerified += 1;
    }
  }

  const delivery = byKey.get("delivery_lead_time");
  const deliveryPage = delivery?.sourceRefs[0]?.pageNumber ?? null;
  const closing = byKey.get("closing_datetime");
  const agg = byKey.get("qty_7500_evaluation_aggregate_not_guarantee");

  const checks = {
    pageCount43: totalPages === 43,
    nonEmpty43: pages.filter((p) => p.contentText.trim()).length === 43,
    m1m15: missingM.length === 0 && requirements.length >= 15,
    requirementSourceCoverage100:
      requirements.length > 0 && reqVerified === requirements.length,
    factSourceCoverage100: facts.length > 0 && factVerified === facts.length,
    noConfirmedWithoutSource: confirmedWithoutSource === 0,
    requiredFactsPresent: missingFacts.length === 0,
    closingHasMdt: /MDT/i.test(closing?.contentOriginal ?? closing?.contentZh ?? ""),
    deliveryLeadTimePageOk: deliveryPage === 30 || deliveryPage === 34,
    deliveryNotPage23: deliveryPage !== 23,
    annexBFiveYears: [
      "qty_annex_b_standing_offer_year_1_1500",
      "qty_annex_b_standing_offer_year_2_1500",
      "qty_annex_b_standing_offer_year_3_1500",
      "qty_annex_b_option_year_1_1500",
      "qty_annex_b_option_year_2_1500",
    ].every((k) => byKey.has(k)),
    aggregate7500Interp:
      agg?.statementKind === "DOCUMENT_INTERPRETATION" &&
      qty?.calculatedEvaluatedAggregate === 7500,
    guaranteedFalse: qty?.guaranteedQuantity === false,
    quantityAmbiguity: byKey.has("qty_ambiguity_interpretation") === true,
    ddpHasReginaIncoterms:
      /Regina/i.test(byKey.get("delivery_term")?.contentOriginal ?? "") &&
      /Incoterms\s*2020/i.test(byKey.get("delivery_term")?.contentOriginal ?? ""),
  };

  const fullPass = Object.values(checks).every(Boolean);
  const verdict = fullPass
    ? "FULL_PASS"
    : missingFacts.length > 10
      ? "FAILED"
      : "PARTIAL_PASS";

  console.log(
    JSON.stringify(
      {
        skipped: false,
        verdict,
        pageCount: totalPages,
        nonEmptyPages: pages.filter((p) => p.contentText.trim()).length,
        factCount: facts.length,
        requirementCount: requirements.length,
        clarificationCount: clarifications.length,
        deliverableCount: deliverableKeys.length,
        missingFacts,
        missingM,
        deliveryLeadTimePage: deliveryPage,
        quantitySummary: qty,
        aggregateStatementKind: agg?.statementKind ?? null,
        checks,
        factKeys: facts.map((f) => f.factKey),
        requirementSourcePages: requirements.map((r) => ({
          code: r.requirementCode,
          page: r.sourcePage,
        })),
      },
      null,
      2,
    ),
  );

  if (!fullPass) process.exit(1);
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      skipped: false,
      verdict: "FAILED",
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  process.exit(1);
});
