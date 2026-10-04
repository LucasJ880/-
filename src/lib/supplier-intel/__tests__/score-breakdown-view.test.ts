/**
 * FR3 — 评分快照对外读投影（纯核）。
 * 别项目历史明细（InquiryItem id / 项目 id / 状态）不出读面；聚合与当前项目指针保留；白名单丢未知键；
 * 投影不带 actor 参数（评分与投影都 actor 无关）；两个读面（评估视图 / 项目排名）必须经过投影（源码守卫）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toEvaluationScoreBreakdownView } from "../score-breakdown-view";

const H_PROJECT = "proj_hidden_H_7f3c"; const H_ITEM_1 = "item_hidden_1_9a1d"; const H_ITEM_2 = "item_hidden_2_9a1e"; const H_QUOTE = "7340021";

/** 内部审计快照（与 buildCandidateScoreSnapshot 同形），外加几处「不该出去」的东西 */
const snapshot = {
  scoreVersion: "supplier-score-v1", recommendationContractVersion: "recommendation-contract-v1",
  componentRuleVersions: { technical: "technical-v1", commercial: "commercial-v1", reliability: "reliability-v1", importRisk: "import-risk-v1" },
  computedAt: "2026-10-04T00:00:00.000Z", capturedAt: "2026-10-04T00:00:01.000Z", gateResult: "PASS",
  technical: { rule: "technical-v1", score: 100, scorableCount: 2, items: [{ key: "R-001", category: "safety", verdict: "PASS", evaluatedBy: "HUMAN", points: 100, reason: null }, { key: "R-002", category: "technical", verdict: "PASS", evaluatedBy: "DETERMINISTIC", points: 100, reason: "600 lb ≥ 300 lb" }], excluded: [{ key: "R-004", category: "delivery" }], unmapped: [], reasonCodes: [] },
  commercial: {
    rule: "commercial-v1", score: 90, priceEvidenceTier: "CONFIRMED_RFQ", round: { inquiryId: "inq_cur", roundNumber: 1, scope: "chairs" }, priceBasis: "totalPrice", currency: "CAD",
    candidate: { itemId: "item_cur_mine", price: 110000, deliveryDays: 60, validUntil: "2026-12-01T00:00:00.000Z" },
    comparableGroup: [{ supplierId: "sup_Y", itemId: "item_cur_mine", price: 110000, deliveryDays: 60 }, { supplierId: "sup_Z", itemId: "item_cur_other", price: 90000, deliveryDays: 40 }],
    sub: { price: 82, delivery: 100, completeness: 100 }, reasonCodes: ["COMMERCIAL_CONFIRMED_RFQ"],
    binding: { inquiryId: "inq_cur", inquiryItemId: "item_cur_mine", supplierId: "sup_Y", offeringId: "off_Y", roundNumber: 1, scope: "chairs", confirmedByUserId: "user_buyer", status: "BOUND_CONFIRMED" },
    offeringPriceEvidence: { tier: "CONFIRMED_RFQ", listedPrice: "80", currency: "CNY", priceStatus: "KNOWN", sourceKind: "DISCOVERY", sourceUrl: "https://detail.1688.com/offer/x.html", sourceSignalId: "sig_offering_source_4b2e", sourceSignalPlatform: "ONE688" },
  },
  reliability: {
    rule: "reliability-v1", score: 75, contacted: 2, replied: 2, selected: 1, sub: { responseRate: 100, priorSelection: 50 },
    history: [
      { itemId: H_ITEM_1, projectId: H_PROJECT, status: "quoted", replied: true, selected: true, __unknownNested: Number(H_QUOTE) },
      { itemId: H_ITEM_2, projectId: H_PROJECT, status: "quoted", replied: true, selected: false },
    ],
    reasonCodes: ["RELIABILITY_FROM_HISTORY"],
  },
  importRisk: { rule: "import-risk-v1", score: 80, verified: [{ id: "cap_cur", type: "CANADA_EXPORT", discoverySignalId: "sig_cur", projectScope: "CURRENT_PROJECT" }], unverified: [{ id: "cap_claimed", type: "EXPORT_PACKAGING", evidenceStatus: "CLAIMED", discoverySignalId: "sig_cur" }], sub: { readiness: 50, packaging: 0, incoterm: 15, leadTime: 15 }, offering: { incoterm: "FOB", leadTimeDays: 45 }, reasonCodes: [] },
  contract: { version: "supplier-score-v1", components: { technical: { score: 100, weight: 0.4, status: "KNOWN" } }, knownWeightShare: 1, totalScore: 81, unknownComponents: [] },
  knownWeightShare: 1, unknownComponents: [], normalizedKnownScore: 81, officialTotalScore: 81, recommendation: null, rankable: true, reasonCodes: ["SCORE_COMPLETE"],
  provenance: { projectId: "proj_current", supplierId: "sup_Y", offeringId: "off_Y", originSource: "MANUAL", inquiryId: "inq_cur", historyItemIds: [H_ITEM_1, H_ITEM_2], capabilityIds: ["cap_cur"] },
  __unknownTopLevel: { leaks: H_PROJECT },
};

async function main() {
  console.log("纯度：score-breakdown-view.ts 零 import、无 IO / 时钟 / 随机 / 无 actor 参数");
  const src = readFileSync(join(__dirname, "..", "score-breakdown-view.ts"), "utf8");
  assert.equal([...src.matchAll(/^import .*$/gm)].length, 0, "投影模块不得 import 任何东西");
  assert.ok(!/fetch\(|prisma|\bdb\.|Date\.now|new Date\(|Math\.random/.test(src), "无 IO / 时钟 / 随机");
  assert.ok(!/\bactor\b|SupplierIntelActor|userId/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "代码里没有 actor / userId 分支（注释除外）");
  assert.equal(toEvaluationScoreBreakdownView.length, 1);

  console.log("P1：reliability 只留聚合，history 整个消失");
  const v = toEvaluationScoreBreakdownView(snapshot);
  assert.ok(v && v.reliability);
  assert.deepEqual(v.reliability, { rule: "reliability-v1", score: 75, contacted: 2, replied: 2, selected: 1, sub: { responseRate: 100, priorSelection: 50 }, reasonCodes: ["RELIABILITY_FROM_HISTORY"] });
  assert.ok(!("history" in v.reliability));

  console.log("P2：provenance 去 historyItemIds → historicalInteractionCount；当前项目指针保留");
  assert.deepEqual(v.provenance, { projectId: "proj_current", supplierId: "sup_Y", offeringId: "off_Y", originSource: "MANUAL", inquiryId: "inq_cur", capabilityIds: ["cap_cur"], historicalInteractionCount: 2 });

  console.log("P3：序列化后不含隐藏项目 id / 历史 item id / 历史报价 / 未知键 / 报盘来源线索 id；也不含 history / historyItemIds 键");
  const json = JSON.stringify(v);
  for (const needle of [H_PROJECT, H_ITEM_1, H_ITEM_2, H_QUOTE, '"history"', "historyItemIds", "sourceSignalId", "sig_offering_source_4b2e", "__unknownTopLevel", "__unknownNested"]) assert.ok(!json.includes(needle), `读面不得含 ${needle}`);

  console.log("P4：当前项目数据按白名单透传（FR1 绑定 / 可比组 / FR2 当前项目能力 id / 合同聚合 / 版本）");
  assert.equal(v.commercial?.binding?.inquiryItemId, "item_cur_mine"); assert.equal(v.commercial?.binding?.status, "BOUND_CONFIRMED");
  assert.deepEqual(v.commercial?.comparableGroup.map((g) => g.itemId), ["item_cur_mine", "item_cur_other"]);
  assert.equal(v.commercial?.offeringPriceEvidence?.sourceSignalPlatform, "ONE688");
  assert.deepEqual(v.importRisk?.verified, [{ id: "cap_cur", type: "CANADA_EXPORT", discoverySignalId: "sig_cur", projectScope: "CURRENT_PROJECT" }]);
  assert.deepEqual(v.technical?.items.map((i) => i.points), [100, 100]);
  assert.equal(v.contract?.totalScore, 81); assert.deepEqual(v.contract?.unknownComponents, []);
  assert.equal(v.officialTotalScore, 81); assert.equal(v.rankable, true); assert.equal(v.gateResult, "PASS"); assert.equal(v.scoreVersion, "supplier-score-v1"); assert.equal(v.capturedAt, "2026-10-04T00:00:01.000Z");
  assert.deepEqual(v.componentRuleVersions, snapshot.componentRuleVersions);

  console.log("P5：actor 无关——同一快照永远同一投影（纯函数、无 actor 参数）；输入不被改写");
  assert.equal(JSON.stringify(toEvaluationScoreBreakdownView(snapshot)), json);
  assert.equal(snapshot.reliability.history.length, 2); assert.equal(snapshot.provenance.historyItemIds.length, 2);

  console.log("P6：非对象 / 残缺输入 → null 或安全默认，且仍不泄露");
  assert.equal(toEvaluationScoreBreakdownView(null), null); assert.equal(toEvaluationScoreBreakdownView("x"), null); assert.equal(toEvaluationScoreBreakdownView([1]), null); assert.equal(toEvaluationScoreBreakdownView(undefined), null);
  const sparse = toEvaluationScoreBreakdownView({ reliability: { history: [{ itemId: H_ITEM_1, projectId: H_PROJECT }] }, provenance: { historyItemIds: [H_ITEM_1] } });
  assert.ok(sparse);
  assert.deepEqual(sparse.reliability, { rule: null, score: null, contacted: 0, replied: 0, selected: 0, sub: { responseRate: null, priorSelection: null }, reasonCodes: [] });
  assert.equal(sparse.provenance?.historicalInteractionCount, 1); assert.equal(sparse.technical, null); assert.equal(sparse.rankable, false);
  assert.ok(!JSON.stringify(sparse).includes(H_ITEM_1) && !JSON.stringify(sparse).includes(H_PROJECT));

  console.log("P7：源码守卫——评估视图与项目排名两个读面不再直出 scoreBreakdownJson");
  const evalSvc = readFileSync(join(__dirname, "..", "evaluation-run-service.ts"), "utf8");
  assert.ok(!/scoreBreakdown:\s*c\.scoreBreakdownJson/.test(evalSvc), "loadEvaluationView 不得直出 c.scoreBreakdownJson");
  assert.ok(/scoreBreakdown:\s*toEvaluationScoreBreakdownView\(c\.scoreBreakdownJson\)/.test(evalSvc), "loadEvaluationView 必须经投影");
  const ranking = readFileSync(join(__dirname, "..", "project-supplier-ranking.ts"), "utf8");
  assert.ok(!/scoreBreakdownJson\s*\?\?\s*null\)\s*as\s*\{/.test(ranking), "排名 read-model 不得把 scoreBreakdownJson 直接 cast 使用");
  assert.equal((ranking.match(/toEvaluationScoreBreakdownView\(cand\.scoreBreakdownJson\)/g) ?? []).length, 2, "排名行 + 赛马行各经一次投影");

  console.log("score-breakdown-view：全部通过");
}

main().catch((e) => { console.error(e); process.exit(1); });
