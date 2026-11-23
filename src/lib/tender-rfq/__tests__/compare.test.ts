/**
 * P1-6 比价矩阵 + Muse compare / price_scenario — 纯逻辑测试
 * （任务书 P1-5/6 §4 用例 2、6、7、8、10、11、12 逐条在此，编号 §4-N；1/3/4/5 在 landed-cost.test、9 在 notes-parse.test）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/compare.test.ts
 */
import assert from "node:assert/strict";
import { buildScenarios, PRICING_MODEL_VERSION, type ScoringModel } from "@/lib/tender-pricing/calc";
import { formatCompareResponse, formatNoQuotesResponse, formatPriceScenarioResponse, OUTBOUND_REDACTED, sanitizeOutbound } from "@/lib/muse-bridge/router-pure";
import { museCommandResponseSchema } from "@/lib/muse-bridge/contract";
import * as compareModule from "../compare";
import { buildCompareMatrix, buildInterpretationPayload, buildMatrixInterpretationPrompt, projectScenariosForMuse, scoreCandidatePrice, summarizeMatrixZh, type CompareInput, type CompareMatrix } from "../compare";
import { checkInterpretationNumbers, collectAllowedNumbers } from "../interpretation-guard";
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
  ok("§4-10 决定 A：含「成本」不再被 strict 替换（落地价/成本线可以出）", sanitizeOutbound("推荐 B，落地价（成本线）50,000", { strict: true }) === "推荐 B，落地价（成本线）50,000");
  ok("§4-10 决定 A：含「利润」仍被 strict 整段替换", sanitizeOutbound("推荐 B，利润还有 6,000", { strict: true }) === OUTBOUND_REDACTED);
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
  const view = projectScenariosForMuse(result, scoreCandidatePrice(model, 65000, 70000), b.landedCad.total);
  const res = formatPriceScenarioResponse("req-11", { projectId: "p1", supplierItemId: "B", supplierName: "B 公司", competitorPriceCad: 70000, competitorSourceZh: "人工假设", view });
  const json = JSON.stringify(res);
  ok("§4-11 price_scenario 响应 JSON 里不存在 marginPct 键", !json.includes("marginPct"));
  ok("§4-11 price_scenario 响应 JSON 里不存在 estimatedValue 键", !json.includes("estimatedValue"));
  ok("§4-11 决定 A：landedCostCad 允许存在，且等于所选供应商落地价", view.landedCostCad === b.landedCad.total && (res.data as { landedCostCad?: number }).landedCostCad === b.landedCad.total);
  ok("§4-11 决定 A：成本线情景照出，标签为「所选供应商落地价（成本线）」", view.scenarios.length === result.scenarios.length && view.scenarios.some((s) => s.labelZh === "所选供应商落地价（成本线）") && !view.scenarios.some((s) => /毛利/.test(s.labelZh)));
  ok("§4-11 只出价格分 / 总分差 / 打平价（情景里没有 noteZh / marginPct）", view.breakEvenPriceCad != null && view.scenarios.every((s) => Object.keys(s).sort().join() === "deltaPts,labelZh,ourPriceScore,priceCad"));
  ok("§4-11 候选价 65,000 有价格分与总分差", view.candidate?.ourPriceScore === 40 && typeof view.candidate.deltaPts === "number", view.candidate);
  ok("§4-11 候选价高于落地价 → candidate 不存在 belowCostZh 键", !!view.candidate && !("belowCostZh" in view.candidate));
  ok("§4-11 消息未被 strict 脱敏误替换，且符合契约", res.message !== OUTBOUND_REDACTED && museCommandResponseSchema.safeParse(res).success, res.message);
  ok("§4-11 消息里带出落地价", res.message.includes("落地价 54,000"), res.message);

  // 候选价低于落地价 → 写明会亏
  const low = projectScenariosForMuse(result, scoreCandidatePrice(model, 50000, 70000), b.landedCad.total);
  ok("§4-11 候选价低于落地价 → belowCostZh 非空", low.candidate?.belowCostZh === "低于该供应商落地价 54,000，会亏", low.candidate);
  const lowRes = formatPriceScenarioResponse("req-11b", { projectId: "p1", supplierItemId: "B", supplierName: "B 公司", competitorPriceCad: 70000, competitorSourceZh: "人工假设", view: low });
  ok("§4-11 会亏的提示出现在回复里且没被 strict 替换", lowRes.message.includes("会亏") && museCommandResponseSchema.safeParse(lowRes).success, lowRes.message);
  // router 走的路径：不传目标毛利 → 成本线 = 落地价本身（"成本 + 目标毛利"情景不生成，否则价格 ÷ 落地价能反推毛利率）
  const noMargin = projectScenariosForMuse(buildScenarios(model, { competitorPriceCad: 70000, ourCostCad: b.landedCad.total, targetMarginPct: null }), null, b.landedCad.total);
  ok("§4-11 不传目标毛利 → 成本线价格 = 落地价", noMargin.scenarios.find((s) => s.labelZh === "所选供应商落地价（成本线）")?.priceCad === b.landedCad.total);
  ok("§4-11 不给落地价时不判会亏", !("belowCostZh" in (projectScenariosForMuse(result, scoreCandidatePrice(model, 50000, 70000)).candidate ?? {})));
}

/* §4-12 */
{
  const res = formatNoQuotesResponse("req-12", "第 2 轮询价还没有报价入表。", "p1");
  ok("§4-12 0 家 quoted → 回「还没有报价入表」", res.ok && res.message.includes("还没有报价入表"));
  ok("§4-12 不是空矩阵（没有 data.matrix）", res.data === undefined);
  ok("§4-12 summarize 空矩阵也只说还没有报价", summarizeMatrixZh({ rows: [], cheapestItemId: null, recommendedItemId: null, firstTierQty: null }) === "还没有报价入表。");
}

/* CHAIN-2e：没有财务查看权时的比价矩阵、无金额结论、AI 解读的模型输入 */
{
  type FinanceViewFn = (m: CompareMatrix, o: { canView: boolean; firstTierQty: number | null }) => CompareMatrix & { costHidden?: true };
  const view = (compareModule as unknown as { compareMatrixFinanceView?: FinanceViewFn }).compareMatrixFinanceView;
  ok("CHAIN-2e compareMatrixFinanceView 存在", typeof view === "function");
  const noCny = { ...SETTINGS, fxRates: {} };
  const M = buildCompareMatrix([
    q({ id: "B", name: "B 公司", total: 54321.98, days: 15 }), // 推荐
    q({ id: "A", name: "A 公司", total: 50000, days: 30 }), // 最便宜但交期超 10 天
    q({ id: "C", name: "C 公司", unit: 280, currency: "CNY", incoterm: "FOB" }), // FOB 换算：有运费 / 保险 / 关税逐项金额
    q({ id: "D", name: "D 公司", unit: 280, currency: "CNY", incoterm: "FOB", settings: noCny }), // 换算不出
  ], TENDER);
  const before = JSON.stringify(M);
  const full = view!(M, { canView: true, firstTierQty: TENDER.firstTierQty });
  ok("CHAIN-2e 有财务查看权：矩阵逐字段与原来相同、没有 costHidden", JSON.stringify(full) === before && !("costHidden" in full));
  const hid = view!(M, { canView: false, firstTierQty: TENDER.firstTierQty });
  ok("CHAIN-2e 不改入参", JSON.stringify(M) === before);
  ok("CHAIN-2e 无权：costHidden: true", hid.costHidden === true);
  ok("CHAIN-2e 无权：每行落地单价 / 总价为 null、换算说明为空", hid.rows.every((r) => r.landedCad.unit === null && r.landedCad.total === null && r.assumptions.length === 0), hid.rows);
  const keep = (m: CompareMatrix) => JSON.stringify(m.rows.map((r) => [r.itemId, r.supplierId, r.supplierName, r.quoted, r.flags, r.checks, r.blockers, r.warnings, r.missingFields, r.deliveryLateDays, r.validityShortDays]));
  ok("CHAIN-2e 无权：排序、标记、检查、缺字段、换算不出的原因、供应商原价照常", keep(hid) === keep(M) && hid.cheapestItemId === M.cheapestItemId && hid.recommendedItemId === M.recommendedItemId && hid.generatedAt === M.generatedAt);
  ok("CHAIN-2e 前提：C 有逐项金额的换算说明、D 换算不出", M.rows.find((r) => r.itemId === "C")!.assumptions.some((a) => /保险|关税/.test(a)) && M.rows.find((r) => r.itemId === "D")!.flags.includes("not_normalized"));
  const tokensOf = (n: number) => [...new Set([String(n), n.toFixed(2), Math.round(n).toLocaleString("en-US"), String(Math.round(n))])].filter((t) => t.replace(/\D/g, "").length >= 4);
  // 所有落地价（模型输入与结论里都不该有——模型输入本来就不带供应商原价）
  const landedTokens = M.rows.flatMap((r) => [r.landedCad.total, r.landedCad.unit]).filter((n): n is number => n != null).flatMap(tokensOf);
  // 与供应商原价不同的落地价（DDP / CAD 报价的落地价就是原价，原价对项目读者照常返回）
  const derivedLanded = M.rows.flatMap((r) => [r.landedCad.total !== r.quoted.totalPrice ? r.landedCad.total : null, r.landedCad.unit !== r.quoted.unitPrice ? r.landedCad.unit : null]).filter((n): n is number => n != null).flatMap(tokensOf);
  const assumptionTokens = M.rows.flatMap((r) => r.assumptions).flatMap((a) => a.match(/\d[\d,]*\.\d+|\d{1,3}(?:,\d{3})+/g) ?? []);
  const hidJson = JSON.stringify(hid);
  ok("CHAIN-2e 前提：C 的落地价、逐项金额（运费 / 保险 / 关税 / 汇率）是少见数字", derivedLanded.includes("95,025") && derivedLanded.includes("63.35") && ["9,000", "888", "5,187", "0.19"].every((t) => M.rows.find((r) => r.itemId === "C")!.assumptions.join().includes(t)), { derivedLanded, assumptionTokens });
  ok("CHAIN-2e 无权：响应里搜不到由系统算出的落地价与换算说明里的逐项金额", derivedLanded.every((t) => !hidJson.includes(t)) && assumptionTokens.length >= 4 && assumptionTokens.every((t) => !hidJson.includes(t)), { found: [...derivedLanded, ...assumptionTokens].filter((t) => hidJson.includes(t)) });
  ok("CHAIN-2e 前提：原结论里有金额与百分比", M.summaryZh.includes("54,322") && M.summaryZh.includes("%"), M.summaryZh);
  ok("CHAIN-2e 无金额结论：没有金额、没有「%」", !/\d{1,3}(?:,\d{3})+|\d+\.\d/.test(hid.summaryZh) && !hid.summaryZh.includes("%") && landedTokens.every((t) => !hid.summaryZh.includes(t)), hid.summaryZh);
  ok("CHAIN-2e 无金额结论：写几家、推荐谁、最低价为什么没推荐、谁换算不出", hid.summaryZh.startsWith("共 4 家报价") && hid.summaryZh.includes("推荐 B 公司：交期、有效期、强制项、起订量检查均通过") && hid.summaryZh.includes("最低价 A 公司 未推荐：交期超出交付截止 10 天") && hid.summaryZh.includes("另有 D 公司 未能换算落地价（缺 CNY→CAD 汇率"), hid.summaryZh);
  ok("CHAIN-2e 不传 hideAmounts 时结论与原来相同", summarizeMatrixZh({ rows: M.rows, cheapestItemId: M.cheapestItemId, recommendedItemId: M.recommendedItemId, firstTierQty: TENDER.firstTierQty }) === M.summaryZh);
  const one = buildCompareMatrix([q({ id: "A", name: "A 公司", total: 50000, days: 30 })], TENDER);
  const oneH = view!(one, { canView: false, firstTierQty: TENDER.firstTierQty });
  ok("CHAIN-2e 没有推荐时：列出各家问题，不带金额", one.summaryZh.includes("50,000") && oneH.summaryZh.includes("暂不推荐") && oneH.summaryZh.includes("A 公司：交期超出交付截止 10 天") && !oneH.summaryZh.includes("50,000") && !oneH.summaryZh.includes("（）"), oneH.summaryZh);
  const empty = view!({ rows: [], cheapestItemId: null, recommendedItemId: null, summaryZh: "还没有报价入表。", generatedAt: NOW.toISOString() }, { canView: false, firstTierQty: null });
  ok("CHAIN-2e 空矩阵：结论照旧", empty.summaryZh === "还没有报价入表。" && empty.costHidden === true);

  // AI 解读的模型输入
  const ctx = { projectName: "Fixture Tender", roundNumber: 2, closeDate: "2026-11-14" };
  const ORIGINAL_SYSTEM_PROMPT = `你是采购比价助手。下面是青砚已经用代码算好的比价矩阵（落地价 = CAD，货到目的地含关税）。
你的工作只是"解读"：用中文说明价格差异、交期与有效期风险、需要追问供应商的点。

硬规则：
- 不得计算、换算或给出矩阵里没有的任何数字；引用数字时必须与矩阵完全一致。
- 不得改变推荐结论：推荐供应商已由代码确定（见 recommended），你只解释原因。
- 换算不出落地价的供应商（not_normalized），只说明缺什么参数，不要估算。

只输出 JSON：{"priceAnalysis": "...", "deliveryAnalysis": "...", "risks": "...", "recommendation": "..."}`;
  const pOrig = buildMatrixInterpretationPrompt(M, ctx);
  const pFull = buildMatrixInterpretationPrompt(full, ctx);
  ok("CHAIN-2e 有财务查看权：模型输入与改动前逐字相同", pFull.systemPrompt === ORIGINAL_SYSTEM_PROMPT && pFull.userPrompt === pOrig.userPrompt && !pFull.userPrompt.includes("costHidden") && pFull.userPrompt.includes("54321.98"));
  const pHid = buildMatrixInterpretationPrompt(hid, ctx);
  const hidPayload = JSON.parse(pHid.userPrompt) as { costHidden?: boolean; summary: string; rows: Array<{ landedCadTotal: unknown; landedCadUnit: unknown }> };
  ok("CHAIN-2e 无权：模型输入搜不到任何一家的落地价，结论是无金额版本，带 costHidden", landedTokens.every((t) => !pHid.userPrompt.includes(t)) && hidPayload.costHidden === true && hidPayload.summary === hid.summaryZh && hidPayload.rows.every((r) => r.landedCadTotal === null && r.landedCadUnit === null), { prompt: pHid.userPrompt.slice(0, 400) });
  ok("CHAIN-2e 无权：提示词写明不提供落地价、不得估算金额，原有硬规则都在", pHid.systemPrompt.includes("本次不提供落地价") && pHid.systemPrompt.includes("不得估算或给出任何金额") && pHid.systemPrompt.includes("换算不出看 not_normalized") && pHid.systemPrompt.startsWith(ORIGINAL_SYSTEM_PROMPT.split("\n\n只输出 JSON")[0]) && pHid.systemPrompt.endsWith(`只输出 JSON：{"priceAnalysis": "...", "deliveryAnalysis": "...", "risks": "...", "recommendation": "..."}`));
  const allowedHid = collectAllowedNumbers(buildInterpretationPayload(hid, ctx));
  const echo = checkInterpretationNumbers({ priceAnalysis: `B 公司落地价 ${Math.round(M.rows.find((r) => r.itemId === "B")!.landedCad.total!).toLocaleString("en-US")}` }, allowedHid);
  ok("CHAIN-2e 无权：解读里出现落地价会被数字校验标出（出处是不含落地价的输入）", !echo.ok && echo.unverified.length === 1, echo);
  ok("CHAIN-2e 比价面板提示句", (compareModule as unknown as { COMPARE_LANDED_HIDDEN_HINT_ZH?: string }).COMPARE_LANDED_HIDDEN_HINT_ZH === "落地价只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。");
}

console.log(`\ntender-rfq compare: ${passed} passed`);
