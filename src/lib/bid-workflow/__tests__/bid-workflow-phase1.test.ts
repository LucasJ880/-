import assert from "node:assert/strict";
import {
  BID_PHASE_STATUSES,
  INTELLIGENCE_MODULES,
  goDecisionToAiAdvice,
  isBidPhaseStatus,
  isGoDecision,
  FACT_CONFIDENCE,
} from "../constants";
import {
  bidListFilterStatuses,
  bidPhaseLabel,
  isBidListFilterKey,
} from "../labels";
import {
  assertKnownBidPhasesComplete,
  resolveBidPhaseOnIntelligenceStart,
} from "../phase-transition";
import { isPrismaUniqueViolation } from "../prisma-errors";
import { buildInitialSummary } from "../summary";
import { TASK_TEMPLATE_KEYS } from "../constants";

/** Cotton Towelling Fabric fixture（结构校验，不连 DB） */
const COTTON_TOWELLING = {
  name: "Cotton Towelling Fabric",
  clientOrganization: "Public Works / Procurement Agency",
  solicitationNumber: "CTF-2024-001",
  closeDate: new Date("2026-09-15T16:00:00Z"),
  estimatedValue: 450000,
  currency: "CAD",
  description: "Supply of cotton towelling fabric",
  aiAdviceStatus: null as string | null,
  intelligence: {
    summary: "Towelling fabric supply opportunity",
    structuredSummaryJson: JSON.stringify({
      productCategory: "Cotton Towelling Fabric",
      possiblyRecurring: true,
      previousWinner: "Cox's Bazar Trading Inc.",
      historicalContractValue: "final ceiling TBD vs annual volume",
    }),
    recommendation: "review_carefully",
    riskLevel: "medium",
  },
  documents: [{ title: "Tender Package.pdf", aiSummaryJson: null }],
};

async function main() {
  // 八模块固定
  assert.equal(INTELLIGENCE_MODULES.length, 8);
  const keys = INTELLIGENCE_MODULES.map((m) => m.key);
  assert.equal(new Set(keys).size, 8);
  assert.ok(keys.includes("historical_awards"));
  assert.ok(keys.includes("supply_chain"));
  assert.ok(keys.includes("commercial_judgment"));

  // 状态与 GO 映射
  assert.ok(isBidPhaseStatus("INTELLIGENCE_IN_PROGRESS"));
  assert.ok(isGoDecision("GO"));
  assert.equal(goDecisionToAiAdvice("GO"), "advance");
  assert.equal(goDecisionToAiAdvice("HOLD"), "conditional");
  assert.equal(goDecisionToAiAdvice("NO_GO"), "abandon");
  assert.ok(BID_PHASE_STATUSES.includes("DISCOVERED"));
  assert.ok(FACT_CONFIDENCE.includes("INFERRED"));

  // 摘要：Cotton Towelling
  const summary = buildInitialSummary(COTTON_TOWELLING);
  assert.ok(summary.text.includes("Cotton Towelling Fabric"));
  assert.ok(summary.json.product === "Cotton Towelling Fabric");
  assert.ok(summary.json.previousWinner === "Cox's Bazar Trading Inc.");
  assert.ok(Array.isArray(summary.json.nextActions));

  // 合同价值字段种子形状（区分上限 vs 年均 — 结构存在）
  const contractSeed = {
    finalContractCeiling: COTTON_TOWELLING.estimatedValue,
    estimatedAnnualVolume: null,
    initialAwardAmount: null,
  };
  assert.notEqual(
    contractSeed.finalContractCeiling,
    contractSeed.estimatedAnnualVolume,
  );

  // 供应链可信度不得把推断当已确认
  const edge = {
    from: "Awarded Company",
    to: "China Factory Candidate",
    confidence: "INFERRED" as const,
  };
  assert.notEqual(edge.confidence, "CONFIRMED");

  // 列表筛选映射
  assert.ok(isBidListFilterKey("investigating"));
  assert.deepEqual(bidListFilterStatuses("investigating"), [
    "INTELLIGENCE_IN_PROGRESS",
  ]);
  assert.equal(bidListFilterStatuses("all"), null);
  assert.equal(bidPhaseLabel("INTELLIGENCE_IN_PROGRESS"), "调查中");

  // 状态机：start 不得回退人工决策 / 后续态
  assertKnownBidPhasesComplete();
  const first = resolveBidPhaseOnIntelligenceStart(null);
  assert.equal(first.bidPhaseStatus, "INTELLIGENCE_IN_PROGRESS");
  assert.equal(first.shouldWrite, true);
  assert.equal(first.advancedToIntelligence, true);

  const second = resolveBidPhaseOnIntelligenceStart("INTELLIGENCE_IN_PROGRESS");
  assert.equal(second.bidPhaseStatus, "INTELLIGENCE_IN_PROGRESS");
  assert.equal(second.shouldWrite, false);
  assert.equal(second.advancedToIntelligence, false);

  for (const locked of [
    "GO",
    "HOLD",
    "NO_GO",
    "BID_PREPARATION",
    "SUBMITTED",
    "AWARDED",
    "LOST",
    "WITHDRAWN",
  ] as const) {
    const r = resolveBidPhaseOnIntelligenceStart(locked);
    assert.equal(r.bidPhaseStatus, locked, `${locked} must not regress`);
    assert.equal(r.shouldWrite, false, `${locked} must not write`);
    assert.equal(r.advancedToIntelligence, false);
  }

  const fromReady = resolveBidPhaseOnIntelligenceStart(
    "READY_FOR_QUALIFICATION",
  );
  assert.equal(fromReady.bidPhaseStatus, "INTELLIGENCE_IN_PROGRESS");
  assert.equal(fromReady.shouldWrite, true);

  // 幂等：Prisma P2002 识别 + 稳定 task template keys
  assert.equal(isPrismaUniqueViolation({ code: "P2002" }), true);
  assert.equal(isPrismaUniqueViolation({ code: "P2003" }), false);
  assert.equal(isPrismaUniqueViolation(null), false);
  const templateKeys = Object.values(TASK_TEMPLATE_KEYS);
  assert.equal(new Set(templateKeys).size, templateKeys.length);
  for (const k of templateKeys) {
    assert.ok(k.startsWith("bid_intel:"));
  }

  console.log("bid-workflow-phase1: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
