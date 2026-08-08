/**
 * 确定性抽取核心（无 DB / 无 LLM）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/extract-core.test.ts
 */

import {
  computeEnquiryDeadline,
  extractFactsFromPages,
  extractRequirementsFromPages,
  formatDateYmd,
  parseClosingFromText,
  summarizeExtractedFacts,
} from "../extract";
import { assertSourceSnippet, canMarkConfirmed } from "../source-verify";
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

console.log("tender-auto-analysis extract-core");

const pages = buildRcmpBackpackFixturePages();
const facts = extractFactsFromPages(pages);
const requirements = extractRequirementsFromPages(pages);
const summary = summarizeExtractedFacts(facts);
const byKey = new Map(facts.map((f) => [f.factKey, f]));

const mReqs = requirements.filter((r) =>
  /^M([1-9]|1[0-5])$/.test(r.requirementCode),
);
ok(mReqs.length === 15, "抽取 15 条 M1–M15");
ok(
  mReqs.every((r) => /^M([1-9]|1[0-5])$/.test(r.requirementCode)),
  "requirementCode 为 M1…M15",
);
ok(
  requirements.length >= 15,
  "允许额外 GEN 通用 mandatory（Phase 1.1.1）",
);
ok(
  requirements.every((r) => r.complianceStatus !== "COMPLIANT"),
  "绝不自动标 COMPLIANT",
);
ok(
  requirements.every((r) => r.reviewStatus === "AI_EXTRACTED"),
  "reviewStatus=AI_EXTRACTED",
);
ok(
  requirements.every((r) => r.mandatory === true),
  "mandatory=true",
);

ok(byKey.has("qty_annex_a_up_to_1500_per_period"), "保留 Annex A Up to 1500");
ok(
  byKey.has("qty_annex_b_1500_annual_evaluation"),
  "保留 Annex B 1,500 annual",
);
ok(
  byKey.has("qty_7500_evaluation_aggregate_not_guarantee"),
  "7,500 标记为 evaluation aggregate",
);
ok(
  /NOT a guaranteed purchase|不是保证采购|非保证/i.test(
    byKey.get("qty_7500_evaluation_aggregate_not_guarantee")!.contentZh +
      (byKey.get("qty_7500_evaluation_aggregate_not_guarantee")!.contentOriginal ??
        ""),
  ),
  "7,500 非保证采购",
);
ok(
  byKey.get("qty_7500_evaluation_aggregate_not_guarantee")?.statementKind ===
    "DOCUMENT_INTERPRETATION",
  "7,500 解释为 DOCUMENT_INTERPRETATION",
);
ok(byKey.has("qty_ambiguity_interpretation"), "数量歧义 DOCUMENT_INTERPRETATION");
ok(
  summary.purchaseGuarantee.toLowerCase().includes("guarantee") ||
    summary.purchaseGuarantee.includes("保证"),
  "summary 声明无保证采购",
);

ok(byKey.has("project_name"), "项目名 Backpacks for Cadets");
ok(byKey.has("solicitation_number"), "招标号 M5000");
ok(byKey.has("buyer_rcmp"), "RCMP");
ok(byKey.has("delivery_ddp_regina"), "DDP Regina");
ok(byKey.has("email_size_5mb"), "5MB");
ok(byKey.has("three_pdfs"), "three PDFs");
ok(byKey.has("reciprocal_procurement"), "Reciprocal Procurement");

// source-verify：每条 CONFIRMED_FACT 的 snippet 须能在引用页核验
let confirmedOk = true;
for (const fact of facts) {
  if (fact.statementKind !== "CONFIRMED_FACT") continue;
  for (const ref of fact.sourceRefs) {
    const page = pages.find(
      (p) =>
        p.documentId === ref.documentId && p.pageNumber === ref.pageNumber,
    );
    if (!page) {
      confirmedOk = false;
      break;
    }
    const v = assertSourceSnippet({
      snippet: ref.originalTextSnippet,
      pageText: page.contentText,
      statementKind: "CONFIRMED_FACT",
    });
    if (!v.verified || !canMarkConfirmed({
      snippet: ref.originalTextSnippet,
      pageText: page.contentText,
      statementKind: "CONFIRMED_FACT",
    })) {
      confirmedOk = false;
      console.error(
        `    source-verify fail: ${fact.factKey} snippet=${ref.originalTextSnippet.slice(0, 60)}`,
      );
    }
  }
}
ok(confirmedOk, "CONFIRMED_FACT 均通过 source-verify");

const closing = parseClosingFromText(pages[0]!.contentText);
ok(!!closing, "解析 closing");
ok(closing?.timezoneLabel === "MDT", "保留时区 MDT");
ok(
  closing?.enquiryDeadline != null &&
    formatDateYmd(closing.enquiryDeadline) === "2026-08-13",
  "enquiryDeadline = closing − 5 = 2026-08-13",
);
ok(
  formatDateYmd(computeEnquiryDeadline(closing!.closingDate!)) === "2026-08-13",
  "computeEnquiryDeadline 一致",
);

// 伪造 snippet 不得保持 CONFIRMED
const fake = assertSourceSnippet({
  snippet: "Awarded to FakeFactory Ltd in 2019 for $9,999,999",
  pageText: pages.map((p) => p.contentText).join("\n"),
  statementKind: "CONFIRMED_FACT",
});
ok(fake.verified === false, "伪造历史中标无法 verified");
ok(
  fake.statementKind === "DOCUMENT_INTERPRETATION",
  "伪造事实降级 statementKind",
);

console.log(`\nextract-core: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
