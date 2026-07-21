/**
 * 多模态 QA 硬规则合并
 * 运行：npx tsx src/lib/product-content/__tests__/multimodal-merge.test.ts
 */

import { runHeuristicFidelityQa } from "../qa/fidelity";
import { applyMultimodalHardRules, mergeFidelityQaResults } from "../qa/multimodal";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const heuristic = runHeuristicFidelityQa({ mode: "EXACT", metadata: { referenceCount: 2 } });

const multimodalHighLogo = applyMultimodalHardRules({
  overallScore: 95,
  shapeScore: 95,
  colorScore: 95,
  patternScore: 95,
  textureScore: 95,
  logoScore: 40,
  textScore: 95,
  detectedChanges: [
    { category: "logo", severity: "high", description: "品牌 Logo 位置偏移" },
  ],
  recommendedStatus: "APPROVE",
});

ok(
  multimodalHighLogo.recommendedStatus !== "APPROVE",
  "多模态 high logo 不可 APPROVE",
);

const merged = mergeFidelityQaResults(heuristic, multimodalHighLogo, "EXACT");
ok(merged.recommendedStatus !== "APPROVE", "合并后 high logo 不可 APPROVE");
ok(
  merged.detectedChanges.some((c) => c.description.includes("Logo")),
  "合并保留中文 detectedChanges",
);
ok(merged.overallScore <= heuristic.overallScore, "合并 overall 取 min");

console.log(`\nmultimodal-merge: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
