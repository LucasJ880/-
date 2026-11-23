/**
 * CHAIN-2b 报价表助手的我方成本只给有财务查看权的人：纯函数 + 接线（源码断言）
 * FIX-25 起目标毛利同一个门；目标毛利的专门断言在 target-margin-finance-view.test.ts，这里只改随行为变的几条。
 *
 * 运行：npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildScenarios, PRICING_MODEL_VERSION, type PricingInputs, type ScoringModel } from "../calc";
import {
  COST_ACCESS_HINT_ZH,
  COST_HIDDEN_FIELD_ZH,
  COST_HIDDEN_NOTE_ZH,
  COST_WRITE_FORBIDDEN_ZH,
  TARGET_MARGIN_HIDDEN_FIELD_ZH,
  NO_COST_ASSUMPTION_ZH,
  buildPricingHelperView,
  buildSavedInputsView,
  redactRoomSummaryCost,
  resolvePricingCostVisibility,
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
  ok("固定文字", COST_HIDDEN_NOTE_ZH === "需要财务查看权才能看我方成本；毛利一栏和「成本 + 目标毛利」「成本价」两种情景也不显示。" && COST_HIDDEN_FIELD_ZH === "需要财务查看权才能看我方成本。" && COST_ACCESS_HINT_ZH === "只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。" && TARGET_MARGIN_HIDDEN_FIELD_ZH === "需要财务查看权才能看目标毛利。" && COST_WRITE_FORBIDDEN_ZH === "没有保存：页面已更新，目标毛利现在和我方成本一样，只给有财务查看权的人改。请刷新页面，重新填写后再保存。");
  ok("两种情景的名字与 calc.ts 里的情景标签一致", calc.includes("成本 + 目标毛利") && calc.includes("成本价（零毛利）"));
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
  ok("成本与目标毛利为 null（FIX-25）、costHidden、compareCostHidden、没有 compareCost", v.inputs.ourCostCad === null && v.inputs.competitorPriceCad === 100000 && v.inputs.targetMarginPct === null && v.costHidden === true && v.compareCostHidden === true && !("compareCost" in v));
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

console.log("财务查看权的判定（出错与没有组织时）");
const asyncChecks = (async () => {
  const yes = async () => true;
  const no = async () => false;
  const boom = async (): Promise<boolean> => { throw new Error("authorize down"); };
  const base = { isPlatformSuperAdmin: false, isProjectOwner: false, orgId: "org1" };
  ok("有组织：照判定结果", (await resolvePricingCostVisibility(base, yes)) === true && (await resolvePricingCostVisibility(base, no)) === false);
  ok("判定抛错：只剩负责人与平台超级管理员", (await resolvePricingCostVisibility(base, boom)) === false && (await resolvePricingCostVisibility({ ...base, isProjectOwner: true }, boom)) === true && (await resolvePricingCostVisibility({ ...base, isPlatformSuperAdmin: true }, boom)) === true);
  let called = false;
  const spy = async () => { called = true; return true; };
  ok("项目没有组织：不调判定，只剩负责人与平台超级管理员", (await resolvePricingCostVisibility({ ...base, orgId: null }, spy)) === false && !called && (await resolvePricingCostVisibility({ ...base, orgId: null, isProjectOwner: true }, spy)) === true);
})();

console.log("这次保存是否碰了成本");
{
  ok("inputs 带 ourCostCad（数字 / null）", touchesCost({ inputs: { ourCostCad: 5 } }) && touchesCost({ inputs: { ourCostCad: null } }));
  ok("顶层带 ourCostSource（含 null）", touchesCost({ ourCostSource: null }) && touchesCost({ ourCostSource: { kind: "rfq_compare" } }));
  ok("只带对手价 / 模型：没碰", !touchesCost({ inputs: { competitorPriceCad: 1 } }) && !touchesCost({ model: { priceWeightPct: 50 } }));
  ok("带目标毛利（数字 / null）：碰了（FIX-25）", touchesCost({ inputs: { competitorPriceCad: 1, targetMarginPct: 2 } }) && touchesCost({ inputs: { targetMarginPct: null } }));
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
  ok("去掉整个 pricingInputs（FIX-25：含目标毛利与镜像的我方报价），其它键原样", !("pricingInputs" in r) && r.other.keep === true && r.pricingModel.a === 1);
  const withMemo = redactRoomSummaryCost({ bidStrategyMemo: { pricingStrategyZh: "成本 91,234" }, majorBlockers: ["x"] }) as Record<string, unknown>;
  ok("去掉投标策略备忘（可能转述成本），其它键原样", !("bidStrategyMemo" in withMemo) && Array.isArray(withMemo.majorBlockers));
  ok("不改入参", sj.pricingInputs.ourCostCad === 2 && "ourCostSource" in sj.pricingInputs);
  ok("没有 pricingInputs / 不是对象 / null：原样返回", redactRoomSummaryCost({ a: 1 }).a === 1 && redactRoomSummaryCost(null) === null && redactRoomSummaryCost("x") === "x");
  const clean = { majorBlockers: ["x"], pricingModel: { a: 1 } };
  ok("没有 pricingInputs、bidDraft 与备忘：返回同一个对象", redactRoomSummaryCost(clean) === clean);
}

console.log("接线（源码断言）");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const route = read("src/app/api/projects/[id]/pricing-helper/route.ts");
  const card = read("src/components/tender/pricing-helper-card.tsx");
  ok("读取：财务判定用与成本核算相同的函数与参数，经 resolvePricingCostVisibility 兜底", route.includes("async (orgId) => (await resolveFinancePrivilege(user, orgId, project.ownerId)).canReadAll,") && route.includes("resolvePricingCostVisibility(") && route.includes("isProjectOwner: !!project.ownerId && project.ownerId === user.id, orgId: project.orgId"));
  ok("读取：没有财务查看权时不取比价建议", route.includes("if (orgId && canSeeCost && compareEnabled) {"));
  const getBody = route.slice(route.indexOf("export async function GET("), route.indexOf("type PricingPostBody"));
  ok("读取：返回的是裁剪后的 inputs 与情景，带 costHidden / compareCostHidden", getBody.includes("    inputs: view.inputs,\n    result: view.result,") && getBody.includes("...(view.costHidden ? { costHidden: true } : {}),") && getBody.includes("...(view.compareCostHidden ? { compareCostHidden: true } : {}),") && !/\n    inputs,\n/.test(getBody) && !/\n    result,\n/.test(getBody));
  ok("保存：inputs 不是对象时当作没带（不再 500）", route.includes("...(raw.inputs !== undefined ? { inputs: asRec(raw.inputs) } : {})"));
  ok("读取：用 buildPricingHelperView，路由里不再直接算情景", route.includes("buildPricingHelperView({ model, inputs, canSeeCost, compareEnabled, compareCost })") && !route.includes("buildScenarios("));
  ok("保存：锁外判定，碰了成本就 403", /const canSeeCost = await canSeePricingCost\(access\);\s*if \(!canSeeCost && touchesCost\(body\)\) \{\s*return NextResponse\.json\(\{ error: COST_WRITE_FORBIDDEN_ZH \}, \{ status: 403 \}\);/.test(route));
  ok("保存：403 在没有调查室 409 之后、在写锁之前", route.indexOf("return NextResponse.json({ error: NO_ROOM_ERROR }, { status: 409 });") < route.indexOf("touchesCost(body)") && route.indexOf("touchesCost(body)") < route.indexOf("const out = await writeRoomLocked(projectId, room.id, (latest) => {\n    const built"));
  ok("保存：返回经 buildSavedInputsView", route.includes("buildSavedInputsView(") && route.includes("canSeeCost,\n    ),"));
  ok("重新推导不做财务判定（derive 分支在判定之前返回）", route.indexOf('if (body.action === "derive") {') < route.indexOf("touchesCost(body)"));
  ok("卡片：成本格换成那句话", card.includes('k === "cost" && costHidden ? (') && card.includes("{COST_HIDDEN_FIELD_ZH}"));
  ok("卡片：没有财务查看权时保存不带 ourCostCad（FIX-25 起请求体由 buildPricingSaveBody 给出，行为断言在 target-margin-finance-view.test.ts）", card.includes("buildPricingSaveBody(form, data.costHidden === true, costClaim)"));
  ok("卡片：没有财务查看权时不显示毛利一栏", card.includes('{costHidden ? null : <th className="py-1 pr-2">{cc ? MARGIN_ON_PRICE_ZH : "毛利"}</th>}') && card.includes("{costHidden ? null : ("));
  ok("卡片：目标毛利写法按开关（含 compareCostHidden）；成本加成提示没有财务查看权时不渲染（FIX-25）", card.includes("const compareOn = !!cc || data.compareCostHidden === true;") && card.includes("<MarkupHint enabled={compareOn && !costHidden} margin={form.margin} />"));
  ok("卡片：假设说明不重复那句（已写在情景表上方）", card.includes("!(costHidden && a === COST_HIDDEN_NOTE_ZH)"));
  ok("卡片：没有财务查看权时情景表上方写明少了什么、找谁", /\{costHidden && r \? \(\s*<p className="mt-3 text-\[11px\] text-muted" data-testid="pricing-cost-hidden-note">\s*\{COST_HIDDEN_NOTE_ZH\}\s*\{COST_ACCESS_HINT_ZH\}/.test(card));
  ok("卡片：没有财务查看权时目标毛利格换成那句话（FIX-25，原来目标毛利下面那句删掉）", card.includes("{TARGET_MARGIN_HIDDEN_FIELD_ZH}") && !card.includes("目标毛利只用于"));
  ok("卡片：403 时保留表单、不重新读取；错误红字并读屏播报", card.includes("if (res.status === 403) return;") && card.includes('msgIsError ? "text-danger" : "text-muted"') && card.includes('role="status" aria-live="polite"'));
  const list = read("src/app/api/projects/route.ts");
  const room = read("src/app/api/projects/[id]/bid-intelligence/route.ts");
  ok("房间 JSON：两个接口都经 redactRoomSummaryCost", list.includes("summaryJson: redactRoomSummaryCost(room.summaryJson)") && room.includes("summaryJson: redactRoomSummaryCost(room.summaryJson)"));
}

void asyncChecks.then(() => {
  console.log(`\nfinance-view: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
