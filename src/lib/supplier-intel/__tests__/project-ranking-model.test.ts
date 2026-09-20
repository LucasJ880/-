/**
 * S4-B §69–§71 / §51 — 项目级当前排名 read-model 纯核：Q1–Q7、最低价 / 历史都绕不过硬门、1688 例子。
 */
import assert from "node:assert/strict";
import { compareRankable, deriveNextAction, deriveRacingState, isRankingEligible, rankCandidates, type RankableCandidateInput, type RacingFacts } from "../project-ranking-model";

const c = (candidateId: string, over: Partial<RankableCandidateInput> & { scores?: Partial<RankableCandidateInput["scores"]> }): RankableCandidateInput => ({
  candidateId, supplierId: `s-${candidateId}`, offeringId: null, mandatoryGateResult: "PASS", recommendation: null,
  ...over, scores: { technical: 80, commercial: 80, reliability: 80, importRisk: 80, total: 80, ...(over.scores ?? {}) },
});

async function main() {
  console.log("Q1 / Q2 / Q3：NOT_ELIGIBLE / NEEDS_VERIFICATION / HIGH_RISK 永不进入排名，HIGH_RISK 永不 PRIMARY");
  const ranked = rankCandidates([
    c("ne", { mandatoryGateResult: "FAIL", recommendation: "NOT_ELIGIBLE", scores: { total: 100, technical: 100, commercial: 100, reliability: 100, importRisk: 100 } }),
    c("nv", { recommendation: "NEEDS_VERIFICATION", scores: { commercial: null, total: null } }),
    c("hr", { recommendation: "HIGH_RISK", scores: { total: 99 } }),
    c("b", { scores: { total: 82 } }),
    c("a", { scores: { total: 90 } }),
  ]);
  const byId = Object.fromEntries(ranked.map((r) => [r.candidateId, r]));
  assert.equal(byId.ne.section, "NOT_ELIGIBLE"); assert.equal(byId.ne.rank, null);
  assert.equal(byId.nv.section, "NEEDS_VERIFICATION"); assert.equal(byId.nv.rank, null);
  assert.equal(byId.hr.section, "HIGH_RISK"); assert.equal(byId.hr.rank, null);
  console.log("Q5 / Q6：第一名 PRIMARY，其余 eligible BACKUP，并带具体名次");
  assert.equal(byId.a.section, "PRIMARY"); assert.equal(byId.a.rank, 1);
  assert.equal(byId.b.section, "BACKUP"); assert.equal(byId.b.rank, 2);
  assert.deepEqual(ranked.slice(0, 2).map((r) => r.candidateId), ["a", "b"], "eligible 在前按名次");

  console.log("Q4：确定性排序 total ↓ technical ↓ commercial ↓ reliability ↓ importRisk ↓ candidateId ↑");
  const tie = rankCandidates([
    c("z", { scores: { total: 80, technical: 80, commercial: 80, reliability: 80, importRisk: 80 } }),
    c("y", { scores: { total: 80, technical: 80, commercial: 80, reliability: 80, importRisk: 80 } }),
    c("x", { scores: { total: 80, technical: 90, commercial: 10, reliability: 10, importRisk: 10 } }),
    c("w", { scores: { total: 80, technical: 80, commercial: 85, reliability: 10, importRisk: 10 } }),
  ]);
  assert.deepEqual(tie.map((r) => r.candidateId), ["x", "w", "y", "z"]);
  assert.ok(compareRankable(c("a", { scores: { total: 81 } }), c("b", { scores: { total: 80 } })) < 0);

  console.log("§44：门 PASS 但任一维 null（recommendation 为 null 的异常态）也不进排名");
  assert.deepEqual(isRankingEligible(c("p", { scores: { importRisk: null, total: null } })), { eligible: false, reason: "SCORE_INCOMPLETE" });
  assert.deepEqual(isRankingEligible(c("g", { mandatoryGateResult: "INCOMPLETE" })), { eligible: false, reason: "GATE_NOT_PASS" });

  console.log("§70 / §71：最低价 + 门 FAIL、历史很强 + 门 FAIL → NOT_ELIGIBLE，不进排名");
  const bypass = rankCandidates([
    c("cheap", { mandatoryGateResult: "FAIL", recommendation: "NOT_ELIGIBLE", scores: { commercial: 100, total: null, technical: null, reliability: null, importRisk: null } }),
    c("history", { mandatoryGateResult: "FAIL", recommendation: "NOT_ELIGIBLE", scores: { reliability: 100, total: null, technical: null, commercial: null, importRisk: null } }),
    c("ok", { scores: { total: 60 } }),
  ]);
  assert.deepEqual(bypass.map((r) => [r.candidateId, r.section]), [["ok", "PRIMARY"], ["cheap", "NOT_ELIGIBLE"], ["history", "NOT_ELIGIBLE"]]);

  console.log("§51：1688 便宜挂牌价 + 门 PASS + 无 RFQ（Commercial UNKNOWN → NEEDS_VERIFICATION）不可 PRIMARY；历史供应商正式评分进入排名");
  const ex = rankCandidates([
    c("one688", { recommendation: "NEEDS_VERIFICATION", scores: { commercial: null, total: null } }),
    c("hist", { scores: { total: 82 } }),
  ]);
  assert.equal(ex.find((r) => r.candidateId === "one688")?.section, "NEEDS_VERIFICATION");
  assert.equal(ex.find((r) => r.candidateId === "hist")?.section, "PRIMARY");

  console.log("Q7：新评估完成后当前排名可变，但输入（历史候选）对象不被改写");
  const old = c("old", { scores: { total: 90 } });
  const before = JSON.stringify(old);
  rankCandidates([old, c("new", { scores: { total: 95 } })]);
  assert.equal(JSON.stringify(old), before);

  console.log("赛马态派生 + 下一步动作（确定性）");
  const base: RacingFacts = { linked: true, hasOffering: true, verifiedEvidenceCount: 0, claimedCertificationCount: 0, latestGate: null, latestRecommendation: null, scoreComplete: false, rfqConfirmed: false, rfqSent: false, priceEvidenceTier: null, unknownComponents: [], evaluationInProgress: false };
  assert.equal(deriveRacingState({ ...base, linked: false, hasOffering: false }), "FOUND");
  assert.equal(deriveRacingState({ ...base, hasOffering: false }), "LINKED");
  assert.equal(deriveRacingState(base), "OFFERING_READY");
  assert.equal(deriveRacingState({ ...base, verifiedEvidenceCount: 1 }), "EVIDENCE_READY");
  assert.equal(deriveRacingState({ ...base, latestGate: "PASS" }), "GATE_PASS");
  assert.equal(deriveRacingState({ ...base, latestGate: "PASS", rfqConfirmed: true }), "RFQ_CONFIRMED");
  assert.equal(deriveRacingState({ ...base, latestGate: "PASS", rfqConfirmed: true, scoreComplete: true }), "SCORED");
  assert.equal(deriveRacingState({ ...base, latestGate: "INCOMPLETE", latestRecommendation: "NEEDS_VERIFICATION" }), "NEEDS_VERIFICATION");
  assert.equal(deriveRacingState({ ...base, latestGate: "FAIL", latestRecommendation: "NOT_ELIGIBLE" }), "NOT_ELIGIBLE");
  assert.equal(deriveRacingState({ ...base, latestGate: "PASS", latestRecommendation: "HIGH_RISK", scoreComplete: true }), "HIGH_RISK");
  assert.equal(deriveNextAction({ ...base, linked: false }).code, "LINK_SUPPLIER");
  assert.equal(deriveNextAction({ ...base, hasOffering: false }).label, "登记具体型号 / 产品");
  assert.equal(deriveNextAction({ ...base, latestGate: "INCOMPLETE" }).label, "补齐强制项证据");
  assert.equal(deriveNextAction({ ...base, latestGate: "PASS", claimedCertificationCount: 1 }).label, "核验证书");
  assert.equal(deriveNextAction({ ...base, latestGate: "PASS", verifiedEvidenceCount: 1 }).label, "向厂家正式询价");
  assert.equal(deriveNextAction({ ...base, latestGate: "PASS", verifiedEvidenceCount: 1, rfqSent: true }).label, "等待厂家正式回复报价");
  assert.equal(deriveNextAction({ ...base, latestGate: "PASS", rfqConfirmed: true, unknownComponents: ["commercial"] }).label, "等待同轮可比报价");
  assert.equal(deriveNextAction({ ...base, latestGate: "PASS", rfqConfirmed: true, unknownComponents: ["reliability"] }).label, "新供应商：需要更多交互 / 样品验证");
  assert.equal(deriveNextAction({ ...base, latestGate: "PASS", rfqConfirmed: true, unknownComponents: ["importRisk"] }).label, "核实出口加拿大能力");
  assert.equal(deriveNextAction({ ...base, latestGate: "PASS", rfqConfirmed: true, scoreComplete: true }).code, "IN_RANKING");
  assert.equal(deriveNextAction({ ...base, latestGate: "FAIL", latestRecommendation: "NOT_ELIGIBLE" }).code, "NOT_ELIGIBLE");

  console.log("\nS4-B 项目排名 read-model 纯核全部通过");
}
main().catch((e) => { console.error(e); process.exit(1); });
