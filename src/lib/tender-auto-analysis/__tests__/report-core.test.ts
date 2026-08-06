/**
 * 报告章节纯函数覆盖
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/report-core.test.ts
 */

import { SECTION_KEYS } from "../constants";
import { extractFactsFromPages } from "../extract";
import {
  buildReportDraftForFacts,
  buildReportSectionKeys,
} from "../report";
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

console.log("tender-auto-analysis report-core");

ok(
  buildReportSectionKeys().length === SECTION_KEYS.length,
  "SECTION_KEYS 全覆盖",
);

const facts = extractFactsFromPages(buildRcmpBackpackFixturePages()).map(
  (f) => ({
    statementKind: f.statementKind,
    contentZh: f.contentZh,
    contentOriginal: f.contentOriginal,
    confidence: f.confidence,
  }),
);

const reqLines = Array.from({ length: 15 }, (_, i) => `M${i + 1}｜测试`);
const draft = buildReportDraftForFacts(facts, reqLines);

for (const key of SECTION_KEYS) {
  ok(!!draft[key]?.contentZh && draft[key].contentZh.length > 20, `章节 ${key} 有中文内容`);
}

ok(
  /NOT_ASSESSED|未评估/.test(draft.MANDATORY_REQUIREMENTS.contentZh),
  "强制要求强调未评估",
);
ok(
  /7,?500|非保证|不是保证/.test(draft.PRICING_EVALUATION.contentZh),
  "价格章保留 7,500 非保证",
);
ok(
  /不编造历史中标/.test(draft.RISKS.contentZh + draft.FINAL_RECOMMENDATION.contentZh),
  "禁止编造历史中标",
);
ok(
  draft.FINAL_RECOMMENDATION.structuredJson.aiRecommendation ===
    "HOLD_PENDING_CLARIFICATION",
  "综合结论 HOLD_PENDING_CLARIFICATION",
);
ok(
  /澄清/.test(draft.CLARIFICATION_QUESTIONS.contentZh),
  "含澄清问题摘要",
);

console.log(`\nreport-core: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
