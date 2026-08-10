/**
 * Phase E+F+G 核心验收（合成 fixture，无 DB / 无真实 PDF）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/phase-efg-core.test.ts
 */

import {
  ANALYSIS_TASK_SPECS,
  DELIVERABLE_DEFINITIONS,
  SECTION_KEYS,
  TASK_TEMPLATE_KEYS,
} from "../constants";
import { buildClarificationCandidates } from "../clarifications";
import {
  extractFactsFromPages,
  extractRequirementsFromPages,
} from "../extract";
import { listDeliverableKeys } from "../deliverables";
import { buildReportDraftForFacts } from "../report";
import { assertSourceSnippet } from "../source-verify";
import { buildRcmpBackpackFixturePages } from "./fixtures/rcmp-backpack-pages";

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

console.log("tender-auto-analysis phase-efg-core");

const pages = buildRcmpBackpackFixturePages();
const allText = pages.map((p) => p.contentText).join("\n");
const facts = extractFactsFromPages(pages);
const requirements = extractRequirementsFromPages(pages);
const clarifications = buildClarificationCandidates(pages, allText);
const deliverableKeys = listDeliverableKeys();
const report = buildReportDraftForFacts(
  facts.map((f) => ({
    statementKind: f.statementKind,
    contentZh: f.contentZh,
    contentOriginal: f.contentOriginal,
    confidence: f.confidence,
  })),
  requirements.map((r) => `${r.requirementCode}｜${r.chineseTranslation}`),
);

const mReqs = requirements.filter((r) =>
  /^M([1-9]|1[0-5])$/.test(r.requirementCode),
);
ok(mReqs.length === 15, "15 M1–M15 requirements");
ok(
  requirements.length >= 15 &&
    requirements.every(
      (r) =>
        /^M([1-9]|1[0-5])$/.test(r.requirementCode) ||
        /^GEN-\d{3,}$/.test(r.requirementCode),
    ),
  "extras are GEN generic mandatory only (Phase 1.1.1)",
);
ok(
  facts.some((f) => f.factKey === "qty_annex_a_up_to_1500_per_period") &&
    facts.some((f) => f.factKey === "qty_annex_b_1500_annual_evaluation"),
  "quantity ambiguity preserved (Annex A + B)",
);
ok(
  facts.some(
    (f) =>
      f.factKey === "qty_7500_evaluation_aggregate_not_guarantee" &&
      f.statementKind === "DOCUMENT_INTERPRETATION",
  ),
  "7,500 not guaranteed (DOCUMENT_INTERPRETATION)",
);

let sourceOk = true;
for (const fact of facts.filter((f) => f.statementKind === "CONFIRMED_FACT")) {
  for (const ref of fact.sourceRefs) {
    const page = pages.find(
      (p) =>
        p.documentId === ref.documentId && p.pageNumber === ref.pageNumber,
    );
    if (
      !page ||
      !assertSourceSnippet({
        snippet: ref.originalTextSnippet,
        pageText: page.contentText,
        statementKind: "CONFIRMED_FACT",
      }).verified
    ) {
      sourceOk = false;
    }
  }
}
ok(sourceOk, "source verify on CONFIRMED_FACT");
ok(
  clarifications.length >= 8,
  `clarifications >= 8 (got ${clarifications.length})`,
);
ok(
  deliverableKeys.includes("technical_offer") &&
    deliverableKeys.includes("financial_offer") &&
    deliverableKeys.includes("certifications"),
  "deliverables include technical/financial/certifications",
);
ok(
  DELIVERABLE_DEFINITIONS.length === deliverableKeys.length,
  "deliverable definitions stable",
);
ok(
  SECTION_KEYS.every((k) => report[k]?.contentZh),
  "report covers SECTION_KEYS",
);
ok(
  ANALYSIS_TASK_SPECS.length >= 11,
  `task specs >= 11 (got ${ANALYSIS_TASK_SPECS.length})`,
);
ok(
  !!TASK_TEMPLATE_KEYS.review_ai_analysis &&
    !!TASK_TEMPLATE_KEYS.review_m1_m15 &&
    !!TASK_TEMPLATE_KEYS.contact_backpack_factory &&
    !!TASK_TEMPLATE_KEYS.get_formal_spec &&
    !!TASK_TEMPLATE_KEYS.get_oem_en_certificate &&
    !!TASK_TEMPLATE_KEYS.confirm_inventory_plan &&
    !!TASK_TEMPLATE_KEYS.get_ddp_regina_quote &&
    !!TASK_TEMPLATE_KEYS.prepare_eco_packaging_declaration &&
    !!TASK_TEMPLATE_KEYS.submit_clarifications &&
    !!TASK_TEMPLATE_KEYS.prepare_three_pdfs &&
    !!TASK_TEMPLATE_KEYS.check_email_under_5mb,
  "task template keys cover required set",
);
ok(
  clarifications.every((c) =>
    c.enquiryDeadline
      ? c.enquiryDeadline.toISOString().startsWith("2026-08-13")
      : false,
  ),
  "enquiryDeadline = 2026-08-13 for clarifications",
);
ok(
  clarifications.some((c) => /MDT/.test(c.question)),
  "clarification question preserves MDT timezone label",
);

console.log(`\nphase-efg-core: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
