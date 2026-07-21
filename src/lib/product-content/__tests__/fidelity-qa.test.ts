/**
 * 视觉保真 QA 启发式
 * 运行：npx tsx src/lib/product-content/__tests__/fidelity-qa.test.ts
 */

import {
  FIDELITY_QA_THRESHOLDS,
  recommendedStatusFromScore,
  runHeuristicFidelityQa,
} from "../qa/fidelity";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

ok(FIDELITY_QA_THRESHOLDS.approve === 90, "approve 阈值 90");
ok(FIDELITY_QA_THRESHOLDS.review === 75, "review 阈值 75");
ok(recommendedStatusFromScore(92, "EXACT") === "APPROVE", "92 分 EXACT → APPROVE");
ok(recommendedStatusFromScore(82, "STUDIO") === "REVIEW", "82 分 STUDIO → REVIEW");
ok(recommendedStatusFromScore(60, "CREATIVE") === "REJECT", "60 分 CREATIVE → REJECT");

const dryRun = runHeuristicFidelityQa({
  mode: "EXACT",
  metadata: { provider: "placeholder", placeholder: true },
});
ok(dryRun.overallScore < 82, "dry-run placeholder 降分");
ok(
  dryRun.detectedChanges.some((c) => c.description.includes("占位")),
  "记录 placeholder 变更",
);
ok(dryRun.recommendedStatus === "REVIEW", "EXACT dry-run 默认 REVIEW");

const violation = runHeuristicFidelityQa({
  mode: "EXACT",
  protectionViolations: ["logo_changed"],
});
ok(violation.recommendedStatus !== "APPROVE", "logo 违规不应直接 APPROVE");
ok(
  violation.detectedChanges.some((c) => c.category === "logo" && c.severity === "high"),
  "logo 违规结构化记录",
);

console.log(`\nfidelity-qa: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
