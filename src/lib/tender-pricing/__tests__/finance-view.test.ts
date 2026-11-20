/**
 * CHAIN-2b 报价表助手的我方成本只给有财务查看权的人：纯函数 + 接线（源码断言）
 *
 * 运行：npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildScenarios, PRICING_MODEL_VERSION, type PricingInputs, type ScoringModel } from "../calc";
import {
  COST_HIDDEN_FIELD_ZH,
  COST_HIDDEN_NOTE_ZH,
  COST_WRITE_FORBIDDEN_ZH,
  NO_COST_ASSUMPTION_ZH,
  buildPricingHelperView,
  buildSavedInputsView,
  redactRoomSummaryCost,
  touchesCost,
} from "../finance-view";
import type { CompareCostView } from "../compare-cost-source";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : ""); }
}

const model: ScoringModel = {
  version: PRICING_MODEL_VERSION,
  priceWeightPct: 60,
  costFormula: "lowest_over_bid",
  otherCriteria: [],
  source: "HUMAN",
  evidenceZh: [],
  derivedAt: "2026-11-20T00:00:00.000Z",
};
const full: PricingInputs = { competitorPriceCad: 100000, ourCostCad: 90000, targetMarginPct: 15 };
const cc = { suggestion: { status: "none_selected", messageZh: "x" }, source: null, staleNoteZh: null } as unknown as CompareCostView;

console.log("固定文字");
{
  const calc = readFileSync(join(process.cwd(), "src/lib/tender-pricing/calc.ts"), "utf8");
  ok("calc.ts 里没有成本时写的那句与 NO_COST_ASSUMPTION_ZH 逐字相同", calc.includes(`"${NO_COST_ASSUMPTION_ZH}"`));
  ok("三句文字", COST_HIDDEN_NOTE_ZH === "需要财务查看权才能看我方成本；毛利一栏与成本底价情景也不显示。" && COST_HIDDEN_FIELD_ZH === "需要财务查看权才能看我方成本。" && COST_WRITE_FORBIDDEN_ZH === "需要财务查看权才能修改我方成本。");
}

console.log("读取视图：有财务查看权");
{
  const v = buildPricingHelperView({ model, inputs: full, canSeeCost: true, compareEnabled: true, compareCost: cc });
  ok("结果与直接 buildScenarios 逐字节相同", JSON.stringify(v.result) === JSON.stringify(buildScenarios(model, full)));
  ok("inputs 原样、带 compareCost、没有 costHidden / compareCostHidden", v.inputs === full && v.compareCost === cc && !("costHidden" in v) && !("compareCostHidden" in v));
  const none = buildPricingHelperView({ model: null, inputs: full, canSeeCost: true, compareEnabled: false, compareCost: null });
  ok("没有评分模型：result 为 null、没有 compareCost", none.result === null && !("compareCost" in none));
}

console.log("读取视图：没有财务查看权");
{
  const v = buildPricingHelperView({ model, inputs: full, canSeeCost: false, compareEnabled: true, compareCost: cc });
  ok("成本为 null、costHidden、compareCostHidden、没有 compareCost", v.inputs.ourCostCad === null && v.inputs.competitorPriceCad === 100000 && v.inputs.targetMarginPct === 15 && v.costHidden === true && v.compareCostHidden === true && !("compareCost" in v));
  const sc = v.result?.scenarios ?? [];
  ok("情景按没有成本算：没有毛利、没有成本底价情景", sc.length > 0 && sc.every((s) => s.marginPct === null) && !sc.some((s) => s.key === "floor" || s.key === "cost"), sc);
  ok("情景与「成本为 null」直接计算的价格与分数相同", JSON.stringify(sc) === JSON.stringify(buildScenarios(model, { ...full, ourCostCad: null }).scenarios));
  ok("假设说明：没有「未填我方成本」，末尾是那句", !v.result!.assumptionsZh.includes(NO_COST_ASSUMPTION_ZH) && v.result!.assumptionsZh[v.result!.assumptionsZh.length - 1] === COST_HIDDEN_NOTE_ZH);
  ok("入参没被改", full.ourCostCad === 90000);
  const noComp = buildPricingHelperView({ model, inputs: { ...full, competitorPriceCad: null }, canSeeCost: false, compareEnabled: false, compareCost: null });
  ok("没有对手价（情景为空）：假设说明仍有那句、没有 compareCostHidden", (noComp.result?.scenarios.length ?? -1) === 0 && noComp.result!.assumptionsZh.includes(COST_HIDDEN_NOTE_ZH) && !("compareCostHidden" in noComp));
  const notFilled = buildPricingHelperView({ model, inputs: { ...full, ourCostCad: null }, canSeeCost: false, compareEnabled: false, compareCost: null });
  ok("成本本来没填：与填了的读取结果相同（不泄露填没填）", JSON.stringify(notFilled.result) === JSON.stringify(buildPricingHelperView({ model, inputs: full, canSeeCost: false, compareEnabled: false, compareCost: null }).result));
  const noModel = buildPricingHelperView({ model: null, inputs: full, canSeeCost: false, compareEnabled: true, compareCost: null });
  ok("没有评分模型：result 为 null，仍 costHidden", noModel.result === null && noModel.costHidden === true && noModel.inputs.ourCostCad === null);
}

console.log("这次保存是否碰了成本");
{
  ok("inputs 带 ourCostCad（数字 / null）", touchesCost({ inputs: { ourCostCad: 5 } }) && touchesCost({ inputs: { ourCostCad: null } }));
  ok("顶层带 ourCostSource（含 null）", touchesCost({ ourCostSource: null }) && touchesCost({ ourCostSource: { kind: "rfq_compare" } }));
  ok("只带对手价 / 目标毛利 / 模型：没碰", !touchesCost({ inputs: { competitorPriceCad: 1, targetMarginPct: 2 } }) && !touchesCost({ model: { priceWeightPct: 50 } }));
  ok("inputs 不是对象、请求不是对象：没碰（不抛错）", !touchesCost({ inputs: "x" }) && !touchesCost(null) && !touchesCost("x") && !touchesCost({ inputs: ["ourCostCad"] }));
}

console.log("保存的返回");
{
  const resp = { ok: true, inputs: full, model: null, ourCostSource: { kind: "manual", recordedAt: "x" } };
  ok("有权限：原样（同一个对象）", buildSavedInputsView(resp, true) === resp);
  const h = buildSavedInputsView(resp, false) as Record<string, unknown>;
  ok("没有权限：成本为 null、costHidden、没有 ourCostSource，其它照旧", (h.inputs as PricingInputs).ourCostCad === null && h.costHidden === true && !("ourCostSource" in h) && h.ok === true && (h.inputs as PricingInputs).competitorPriceCad === 100000);
  ok("没有权限：入参没被改", resp.inputs.ourCostCad === 90000 && "ourCostSource" in resp);
}

console.log("房间 JSON");
{
  const sj = { pricingModel: { a: 1 }, pricingInputs: { competitorPriceCad: 1, ourCostCad: 2, targetMarginPct: 3, ourCostSource: { landedCadTotal: 2 }, ourPriceCad: 4 }, other: { keep: true } };
  const r = redactRoomSummaryCost(sj) as typeof sj;
  ok("去掉成本与来源，其它键原样", !("ourCostCad" in r.pricingInputs) && !("ourCostSource" in r.pricingInputs) && r.pricingInputs.ourPriceCad === 4 && r.pricingInputs.competitorPriceCad === 1 && r.other.keep === true && r.pricingModel.a === 1);
  ok("不改入参", sj.pricingInputs.ourCostCad === 2 && "ourCostSource" in sj.pricingInputs);
  ok("没有 pricingInputs / 不是对象 / null：原样返回", redactRoomSummaryCost({ a: 1 }).a === 1 && redactRoomSummaryCost(null) === null && redactRoomSummaryCost("x") === "x");
  const clean = { pricingInputs: { ourPriceCad: 1 } };
  ok("pricingInputs 里本来就没有成本：返回同一个对象", redactRoomSummaryCost(clean) === clean);
}

console.log("接线（源码断言）");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const route = read("src/app/api/projects/[id]/pricing-helper/route.ts");
  const card = read("src/components/tender/pricing-helper-card.tsx");
  ok("读取：财务判定用与成本核算相同的函数与参数", route.includes("resolveFinancePrivilege(user, project.orgId, project.ownerId)).canReadAll") && route.includes("decideFinancePrivilege({"));
  ok("读取：没有财务查看权时不取比价建议", route.includes("if (orgId && canSeeCost && isPricingCompareSourceEnabledForOrg(orgId)) {"));
  ok("读取：用 buildPricingHelperView，路由里不再直接算情景", route.includes("buildPricingHelperView({ model, inputs, canSeeCost, compareEnabled, compareCost })") && !route.includes("buildScenarios("));
  ok("保存：锁外判定，碰了成本就 403", /const canSeeCost = await canSeePricingCost\(access\);\s*if \(!canSeeCost && touchesCost\(body\)\) \{\s*return NextResponse\.json\(\{ error: COST_WRITE_FORBIDDEN_ZH \}, \{ status: 403 \}\);/.test(route));
  ok("保存：403 在没有调查室 409 之后、在写锁之前", route.indexOf("return NextResponse.json({ error: NO_ROOM_ERROR }, { status: 409 });") < route.indexOf("touchesCost(body)") && route.indexOf("touchesCost(body)") < route.indexOf("const out = await writeRoomLocked(projectId, room.id, (latest) => {\n    const built"));
  ok("保存：返回经 buildSavedInputsView", route.includes("buildSavedInputsView(") && route.includes("canSeeCost,\n    ),"));
  ok("重新推导不做财务判定（derive 分支在判定之前返回）", route.indexOf('if (body.action === "derive") {') < route.indexOf("touchesCost(body)"));
  ok("卡片：成本格换成那句话", card.includes('k === "cost" && costHidden ? (') && card.includes("{COST_HIDDEN_FIELD_ZH}"));
  ok("卡片：没有财务查看权时保存不带 ourCostCad", card.includes("...(data.costHidden ? {} : { ourCostCad: n(form.cost) }),"));
  ok("卡片：没有财务查看权时不显示毛利一栏", card.includes('{costHidden ? null : <th className="py-1 pr-2">{cc ? MARGIN_ON_PRICE_ZH : "毛利"}</th>}') && card.includes("{costHidden ? null : ("));
  ok("卡片：目标毛利写法与成本加成提示按开关（含 compareCostHidden）", card.includes("const compareOn = !!cc || data.compareCostHidden === true;") && card.includes("<MarkupHint enabled={compareOn} margin={form.margin} />"));
  ok("卡片：假设说明不重复那句", card.includes("!(costHidden && a === COST_HIDDEN_NOTE_ZH)"));
  const list = read("src/app/api/projects/route.ts");
  const room = read("src/app/api/projects/[id]/bid-intelligence/route.ts");
  ok("房间 JSON：两个接口都经 redactRoomSummaryCost", list.includes("summaryJson: redactRoomSummaryCost(room.summaryJson)") && room.includes("summaryJson: redactRoomSummaryCost(room.summaryJson)"));
}

console.log(`\nfinance-view: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
