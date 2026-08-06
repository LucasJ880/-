/**
 * RCMP Fixture 回归：页码误匹配 / Annex B 五行 / 7500 计算 / closing MDT / DDP
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/rcmp-regression.test.ts
 */

import {
  buildQuantityEvaluationSummary,
  extractFactsFromPages,
} from "../extract/facts";
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

console.log("tender-auto-analysis rcmp-regression");

const pages = buildRcmpBackpackFixturePages();
const facts = extractFactsFromPages(pages);
const byKey = new Map(facts.map((f) => [f.factKey, f]));

const delivery = byKey.get("delivery_lead_time");
ok(Boolean(delivery), "delivery_lead_time 存在");
ok(
  delivery?.sourceRefs[0]?.pageNumber === 30 ||
    delivery?.sourceRefs[0]?.pageNumber === 34,
  `delivery_lead_time 页码为 30/34（实际 ${delivery?.sourceRefs[0]?.pageNumber}）`,
);
ok(
  delivery?.sourceRefs.every((r) => r.pageNumber !== 23),
  "delivery_lead_time 不得为 page 23",
);
ok(
  /call-up\s+issuance/i.test(delivery?.contentOriginal ?? ""),
  "delivery_lead_time 原文含 call-up issuance",
);

// 陷阱页 23 的 30 days 不得成为交付周期
ok(
  !facts.some(
    (f) =>
      f.factKey === "delivery_lead_time" &&
      f.sourceRefs.some((r) => r.pageNumber === 23),
  ),
  "「30 days before expiry」不得识别为 delivery lead time",
);

const yearKeys = [
  "qty_annex_b_standing_offer_year_1_1500",
  "qty_annex_b_standing_offer_year_2_1500",
  "qty_annex_b_standing_offer_year_3_1500",
  "qty_annex_b_option_year_1_1500",
  "qty_annex_b_option_year_2_1500",
] as const;
ok(
  yearKeys.every((k) => byKey.has(k)),
  "Annex B 五个年度 1500 全部提取",
);

const agg = byKey.get("qty_7500_evaluation_aggregate_not_guarantee");
ok(Boolean(agg), "7500 由计算生成");
ok(
  agg?.statementKind === "DOCUMENT_INTERPRETATION",
  "calculated 7500 不得为 CONFIRMED_FACT",
);
ok(
  /1500\s*[×x]\s*5|7,?500/i.test(agg?.contentZh ?? ""),
  "7500 内容含计算公式或合计",
);

const qtySummary = buildQuantityEvaluationSummary(facts);
ok(qtySummary?.calculatedEvaluatedAggregate === 7500, "summary.calculatedEvaluatedAggregate=7500");
ok(qtySummary?.guaranteedQuantity === false, "guaranteedQuantity=false");
ok(qtySummary?.quantityAmbiguity === true, "quantityAmbiguity=true");
ok(qtySummary?.calculationKind === "DOCUMENT_INTERPRETATION", "calculationKind=DOCUMENT_INTERPRETATION");

const closing = byKey.get("closing_datetime");
ok(Boolean(closing), "closing_datetime 存在");
ok(
  /MDT/i.test(closing?.contentOriginal ?? "") ||
    /MDT/i.test(closing?.contentZh ?? ""),
  "closing time 必须包含 MDT",
);

const ddp = byKey.get("delivery_term");
ok(Boolean(ddp), "delivery_term 存在");
ok(/Regina/i.test(ddp?.contentOriginal ?? ""), "DDP 含 Regina");
ok(/Incoterms\s*2020/i.test(ddp?.contentOriginal ?? ""), "DDP 含 Incoterms 2020");

ok(byKey.has("submission_sections"), "三 PDF 提交章节已提取");
ok(
  /Technical Offer/i.test(byKey.get("submission_sections")?.contentOriginal ?? "") &&
    /Financial Offer/i.test(byKey.get("submission_sections")?.contentOriginal ?? "") &&
    /Certifications/i.test(byKey.get("submission_sections")?.contentOriginal ?? ""),
  "三 PDF 必须提取为 Technical/Financial/Certifications",
);

ok(byKey.has("price_only_in_financial_offer"), "price-only-in-financial-offer 必须提取");

ok(byKey.has("qty_ambiguity_interpretation"), "数量歧义保留");
ok(
  byKey.get("qty_ambiguity_interpretation")?.statementKind ===
    "DOCUMENT_INTERPRETATION",
  "数量歧义为 DOCUMENT_INTERPRETATION",
);

console.log(`\nrcmp-regression: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
