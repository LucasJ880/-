/**
 * P1-6 比价矩阵 + Muse compare / price_scenario — 纯逻辑测试
 * （任务书 P1-5/6 §4 用例 2、6、7、8、10、11、12 逐条在此，编号 §4-N；1/3/4/5 在 landed-cost.test、9 在 notes-parse.test）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/compare.test.ts
 */
import assert from "node:assert/strict";
import { buildScenarios, PRICING_MODEL_VERSION, type ScoringModel } from "@/lib/tender-pricing/calc";
import { formatCompareResponse, formatNoQuotesResponse, formatPriceScenarioResponse, OUTBOUND_REDACTED, sanitizeOutbound } from "@/lib/muse-bridge/router-pure";
import { museCommandResponseSchema } from "@/lib/muse-bridge/contract";
import { buildCompareMatrix, projectScenariosForMuse, scoreCandidatePrice, summarizeMatrixZh, type CompareInput } from "../compare";
import { normalizeQuote, type LandedCostSettings } from "../landed-cost";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, `${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-10-25T12:00:00Z");
const EMAIL = new Date("2026-10-25T09:00:00Z");
const SETTINGS: LandedCostSettings = {
  fxRates: { CNY: 0.19 }, fxAsOf: "2026-10-20", fxSource: "MANUAL",
  freightEstimate: { mode: "per_unit", value: 6 }, exportInlandEstimate: null, insurancePct: 1, clearanceFlatCad: 150, projects: {},
};
// 截标 2026-11-14；交付截止也设为截标日 → "交期 = 截标后 10 天" 即 回信日 10-25 + 30 天 = 11-24
const TENDER = { closeDate: "2026-11-14", deliveryDeadline: "2026-11-14", firstTierQty: 1500, mandatoryCodes: ["R-01"], now: NOW };

function q(o: {
  id: string; name: string; unit?: number | null; total?: number | null; currency?: string; incoterm?: string | null;
  days?: number | null; validUntil?: string | null; moq?: number | null; r01?: string; settings?: LandedCostSettings;
}): CompareInput {
  const quoted = {
    unitPrice: o.unit ?? null, totalPrice: o.total ?? null, currency: o.currency ?? "CAD", incoterm: o.incoterm === undefined ? "DDP" : o.incoterm,
    moq: o.moq === undefined ? 500 : o.moq, deliveryDays: o.days === undefined ? 15 : o.days, validUntil: o.validUntil === undefined ? "2026-12-31" : o.validUntil,
  };
  return {
    itemId: o.id, supplierId: `s-${o.id}`, supplierName: o.name, quoted, emailDate: EMAIL,
    mandatoryAnswers: [{ requirementCode: "R-01", answer: o.r01 ?? "满足" }],
    normalized: normalizeQuote(quoted, { settings: o.settings ?? SETTINGS, dutyRatePct: 6.5, quantity: 1500, now: NOW }),
  };
}

console.log("tender-rfq compare");

/* §4-2 */
{
  const noCny = { ...SETTINGS, fxRates: {} };
  const m = buildCompareMatrix([
    q({ id: "A", name: "A 公司", unit: 280, currency: "CNY", incoterm: "FOB", settings: noCny }),
    q({ id: "B", name: "B 公司", total: 61000 }),
  ], TENDER);
  const a = m.rows.find((r) => r.itemId === "A")!;
  ok("§4-2 无 CNY 汇率 → landedCad=null + blocker", a.landedCad.total === null && a.blockers[0].startsWith("缺 CNY→CAD 汇率"), a);
  ok("§4-2 flags 含 not_normalized", a.flags.includes("not_normalized"), a.flags);
  ok("§4-2 排最后", m.rows[m.rows.length - 1].itemId === "A" && m.rows[0].itemId === "B");
  ok("§4-2 换算不出的不参与「最便宜」", m.cheapestItemId === "B");
  ok("§4-2 结论里说明谁没换算、缺什么", m.summaryZh.includes("另有 A 公司 未能换算落地价（缺 CNY→CAD 汇率"), m.summaryZh);
}

/* §4-6 / §4-7 */
const AB = buildCompareMatrix([
  q({ id: "B", name: "B 公司", total: 54000, days: 15 }), // 贵 8%，四项全满足
  q({ id: "A", name: "A 公司", total: 50000, days: 30 }), // 最便宜，但 10-25 + 30 = 11-24 → 超截止 10 天
], TENDER);
{
  const a = AB.rows.find((r) => r.itemId === "A")!;
  ok("§4-6 A 最便宜：flags 含 cheapest 和 delivery_late", a.flags.includes("cheapest") && a.flags.includes("delivery_late"), a.flags);
  ok("§4-6 A 交期超 10 天", a.deliveryLateDays === 10, a.deliveryLateDays);
  ok("§4-6 recommendedItemId 不是 A", AB.recommendedItemId !== "A");
}
{
  const b = AB.rows.find((r) => r.itemId === "B")!;
  ok("§4-7 B 四项全 true → fully_compliant", Object.values(b.checks).every((v) => v === true) && b.flags.includes("fully_compliant"), b.checks);
  ok("§4-7 recommendedItemId = B", AB.recommendedItemId === "B");
  ok("§4-7 summaryZh 提到 A 为什么没推荐", /最低价 A 公司（50,000）未推荐：交期超出交付截止 10 天/.test(AB.summaryZh), AB.summaryZh);
  ok("§4-7 summaryZh 说明 B 贵 8%", AB.summaryZh.includes("B 公司 贵 8.0%"), AB.summaryZh);
  ok("§4-7 推荐不自动选定（矩阵里没有 isSelected）", !JSON.stringify(AB).includes("isSelected"));
}

/* §4-8 */
{
  const m = buildCompareMatrix([
    q({ id: "A", name: "A 公司", total: 50000, days: 30 }), // 交期超期
    q({ id: "B", name: "B 公司", total: 52000, validUntil: "2026-11-01" }), // 有效期早于截标 13 天
    q({ id: "C", name: "C 公司", total: 53000, r01: "不满足" }), // 强制项不满足
    q({ id: "D", name: "D 公司", unit: 40, incoterm: null }), // 贸易条款未注明，换算不出
  ], TENDER);
  ok("§4-8 所有家都有问题 → recommendedItemId=null", m.recommendedItemId === null);
  ok("§4-8 summary 说明没有推荐", m.summaryZh.includes("没有交期、有效期、强制项、起订量检查均通过的报价，暂不推荐"), m.summaryZh);
  ok("§4-8 summary 逐家列原因", m.summaryZh.includes("交期超出交付截止 10 天") && m.summaryZh.includes("有效期比截标日早 13 天") && m.summaryZh.includes("有强制项不满足"), m.summaryZh);
  ok("§4-8 summaryZh ≤ 300 字", m.summaryZh.length <= 300, m.summaryZh.length);
  const flagsOf = (id: string) => m.rows.find((r) => r.itemId === id)!.flags;
  ok("§4-8 标记：validity_short / mandatory_gap / missing_fields+not_normalized", flagsOf("B").includes("validity_short") && flagsOf("C").includes("mandatory_gap") && flagsOf("D").includes("missing_fields") && flagsOf("D").includes("not_normalized"));
}

/* 其它标记 */
{
  const m = buildCompareMatrix([q({ id: "A", name: "A", total: 50000, moq: 3000 }), q({ id: "B", name: "B", total: 51000, days: null })], TENDER);
  ok("MOQ 大于第一档 → moq_unmet；交期未知 → 不算全合规", m.rows[0].flags.includes("moq_unmet") && !m.rows[1].flags.includes("fully_compliant") && m.recommendedItemId === null);
  ok("unknown 也写进不推荐原因（交期待确认）", m.summaryZh.includes("交期待确认"), m.summaryZh);
}

/* 起订量未注明：unknown 不算不合规（§2.4），不挡推荐；明确超出才挡 */
{
  const m = buildCompareMatrix([q({ id: "A", name: "A", total: 50000, moq: null }), q({ id: "B", name: "B", total: 51000 })], TENDER);
  ok("没写 MOQ 的最便宜家仍可被推荐", m.recommendedItemId === "A" && m.rows[0].checks.moqOk === "unknown" && m.rows[0].flags.includes("fully_compliant"), m.rows[0]);
  ok("推荐语如实注明「起订量未注明」", m.summaryZh.includes("（起订量未注明）"), m.summaryZh);
}

/* §4-10 */
{
  ok("§4-10 summaryZh 含「毛利」→ sanitizeOutbound 整段替换", sanitizeOutbound("推荐 B，毛利还有 12%", { strict: true }) === OUTBOUND_REDACTED);
  ok("§4-10 summaryZh 含「成本」→ strict 整段替换", sanitizeOutbound("推荐 B，我方成本 50,000", { strict: true }) === OUTBOUND_REDACTED);
  ok("§4-10 反向：正常 summary 不误触", sanitizeOutbound(AB.summaryZh, { strict: true }) === AB.summaryZh);
  ok("§4-10 反向：默认模式不拦「成本评分」这类招标原文", sanitizeOutbound("评分：价格 40%，成本评分按最低价法") !== OUTBOUND_REDACTED);
  const res = formatCompareResponse("req-10", { projectId: "p1", inquiryId: "inq", roundNumber: 2, matrix: AB });
  ok("§4-10 compare 回复：结论 / 理由 / 下一步原样出（未被 strict 误替换）", res.message !== OUTBOUND_REDACTED && res.message.startsWith("推荐 B 公司：落地价 54,000") && res.message.includes("最低价 A 公司（50,000）未推荐：交期超出交付截止 10 天"), res.message);
  ok("§4-10 compare 回复：下一步按推荐那家算情景，备选为其它可换算的供应商", res.suggestedActions.length === 2 && res.suggestedActions.every((a) => a.command.intent === "price_scenario" && "supplierItemId" in a.command) && (res.suggestedActions[0].command as { supplierItemId?: string }).supplierItemId === "B");
  ok("§4-10 compare 回复符合契约", museCommandResponseSchema.safeParse(res).success);
}

/* §4-11 */
{
  const model: ScoringModel = {
    version: PRICING_MODEL_VERSION, priceWeightPct: 40, costFormula: "lowest_over_bid",
    otherCriteria: [{ key: "tech", nameZh: "技术", weightPct: 60, ourPct: 70, competitorPct: 65 }],
    source: "HUMAN", evidenceZh: [], derivedAt: "2026-10-01",
  };
  const b = AB.rows.find((r) => r.itemId === "B")!;
  const result = buildScenarios(model, { competitorPriceCad: 70000, ourCostCad: b.landedCad.total, targetMarginPct: 15 });
  ok("§4-11 前提：内部结果里确实有 marginPct 与成本底价情景", result.scenarios.some((s) => s.marginPct != null) && result.scenarios.some((s) => s.key === "floor"));
  const view = projectScenariosForMuse(result, scoreCandidatePrice(model, 65000, 70000));
  const res = formatPriceScenarioResponse("req-11", { projectId: "p1", supplierItemId: "B", supplierName: "B 公司", competitorPriceCad: 70000, competitorSourceZh: "人工假设", view });
  const json = JSON.stringify(res);
  ok("§4-11 price_scenario 响应 JSON 里不存在 marginPct 键", !json.includes("marginPct"));
  ok("§4-11 price_scenario 响应 JSON 里不存在 ourCostCad 键", !json.includes("ourCostCad"));
  ok("§4-11 成本底价情景（能反推成本）不出 Muse", !view.scenarios.some((s) => /成本|毛利/.test(s.labelZh)) && view.scenarios.length === result.scenarios.length - 1);
  ok("§4-11 落地价数值不出现在响应里", !json.includes(String(b.landedCad.total)) && !json.includes("54,000"));
  ok("§4-11 只出价格分 / 总分差 / 打平价", view.breakEvenPriceCad != null && view.scenarios.every((s) => Object.keys(s).sort().join() === "deltaPts,labelZh,ourPriceScore,priceCad"));
  ok("§4-11 候选价 65,000 有价格分与总分差", view.candidate?.ourPriceScore === 40 && typeof view.candidate.deltaPts === "number", view.candidate);
  ok("§4-11 消息未被 strict 脱敏误替换，且符合契约", res.message !== OUTBOUND_REDACTED && museCommandResponseSchema.safeParse(res).success, res.message);
}

/* §4-12 */
{
  const res = formatNoQuotesResponse("req-12", "第 2 轮询价还没有报价入表。", "p1");
  ok("§4-12 0 家 quoted → 回「还没有报价入表」", res.ok && res.message.includes("还没有报价入表"));
  ok("§4-12 不是空矩阵（没有 data.matrix）", res.data === undefined);
  ok("§4-12 summarize 空矩阵也只说还没有报价", summarizeMatrixZh({ rows: [], cheapestItemId: null, recommendedItemId: null, firstTierQty: null }) === "还没有报价入表。");
}

console.log(`\ntender-rfq compare: ${passed} passed`);
