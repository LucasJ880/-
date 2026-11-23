/**
 * FIX-25 目标毛利只给有财务查看权的人：纯函数 + 接线（源码断言），不连库
 *
 * 起因：CHAIN-2d 交叉验证 F4——项目读者从房间 JSON 与报价表助手拿到目标毛利，配上我方报价即可反推成本
 * （成本 87,654.32、目标毛利 23.7%、报价 114,881.15：114,881.15 × (1 − 0.237) = 87,654.32）。
 *
 * 运行：npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts
 *
 * 用命名空间 import：在改动前的 finance-view.ts 上跑时缺的导出是 undefined，逐条算失败，而不是整个文件 import 不了。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildScenarios, PRICING_MODEL_VERSION, type PricingInputs, type ScoringModel } from "../calc";
import * as fv from "../finance-view";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : ""); }
}
function safe<T>(f: () => T): T | undefined {
  try { return f(); } catch { return undefined; }
}
type Rec = Record<string, unknown>;
const ex = fv as unknown as Rec;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** 复现数据 */
const COST = 87654.32;
const MARGIN = 23.7;
const model: ScoringModel = {
  version: PRICING_MODEL_VERSION,
  priceWeightPct: 60,
  costFormula: "lowest_over_bid",
  otherCriteria: [],
  source: "HUMAN",
  evidenceZh: [],
  derivedAt: "2026-11-23T00:00:00.000Z",
};
const full: PricingInputs = { competitorPriceCad: 100000, ourCostCad: COST, targetMarginPct: MARGIN };

console.log("夹具");
{
  const both = JSON.stringify(buildScenarios(model, { ...full, ourCostCad: null, targetMarginPct: null }));
  ok("夹具：不带成本与目标毛利算出的情景里本来就没有这两个数（后面搜得到就是漏）", !both.includes("23.7") && !both.includes("87654"), both.slice(0, 300));
  const withCost = JSON.stringify(buildScenarios(model, full));
  ok("夹具对照：带成本与目标毛利时情景里有「目标毛利 23.7%」底价情景", withCost.includes("成本 + 目标毛利 23.7%"));
}

console.log("固定文字");
{
  ok("目标毛利格那句", ex.TARGET_MARGIN_HIDDEN_FIELD_ZH === "需要财务查看权才能看目标毛利。");
  ok("403 那句：句首说页面已更新，成本与目标毛利共用", fv.COST_WRITE_FORBIDDEN_ZH === "页面已更新，没有保存：需要财务查看权才能修改我方成本和目标毛利。请刷新页面，重新填写后再保存。");
  ok("「目标毛利只用于按成本算的底价情景」那句已删掉", !("COST_TARGET_MARGIN_NOTE_ZH" in ex));
  ok(
    "CHAIN-2b 的四句不变（CHAIN-2e 的 view-hint.ts 拼 COST_ACCESS_HINT_ZH）",
    fv.COST_ACCESS_HINT_ZH === "只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。" &&
      fv.COST_HIDDEN_FIELD_ZH === "需要财务查看权才能看我方成本。" &&
      fv.COST_HIDDEN_NOTE_ZH === "需要财务查看权才能看我方成本；毛利一栏和「成本 + 目标毛利」「成本价」两种情景也不显示。" &&
      fv.NO_COST_ASSUMPTION_ZH === "未填我方成本——毛利列为空；成本底价情景未生成",
  );
}

console.log("读取视图：没有财务查看权");
{
  const v = fv.buildPricingHelperView({ model, inputs: full, canSeeCost: false, compareEnabled: true, compareCost: null });
  ok("目标毛利与成本都为 null、对手价照旧、costHidden 一个标记", v.inputs.targetMarginPct === null && v.inputs.ourCostCad === null && v.inputs.competitorPriceCad === 100000 && v.costHidden === true && !("marginHidden" in v), v.inputs);
  ok("整份读取视图里搜不到目标毛利与成本", !JSON.stringify(v).includes("23.7") && !JSON.stringify(v).includes("87654"), JSON.stringify(v).slice(0, 400));
  const sc = v.result?.scenarios ?? [];
  ok("情景与「成本、目标毛利都为 null」直接计算的结果相同", JSON.stringify(sc) === JSON.stringify(buildScenarios(model, { ...full, ourCostCad: null, targetMarginPct: null }).scenarios));
  ok("情景标签里没有目标毛利的数字、没有成本底价情景", sc.length > 0 && !sc.some((s) => /目标毛利/.test(s.labelZh) || s.key === "floor" || s.key === "cost"), sc);
  const variants = [
    full,
    { ...full, ourCostCad: null, targetMarginPct: null },
    { ...full, ourCostCad: null },
    { ...full, targetMarginPct: null },
  ].map((inputs) => JSON.stringify(fv.buildPricingHelperView({ model, inputs, canSeeCost: false, compareEnabled: false, compareCost: null })));
  ok("填了 / 都没填 / 只填目标毛利 / 只填成本：读取结果逐字节相同（不泄露填没填）", variants.every((x) => x === variants[0]));
  ok("入参没被改", full.targetMarginPct === MARGIN && full.ourCostCad === COST);
  const noModel = fv.buildPricingHelperView({ model: null, inputs: full, canSeeCost: false, compareEnabled: false, compareCost: null });
  ok("没有评分模型：仍置空目标毛利", noModel.result === null && noModel.inputs.targetMarginPct === null && noModel.costHidden === true);
}

console.log("读取视图：有财务查看权");
{
  const v = fv.buildPricingHelperView({ model, inputs: full, canSeeCost: true, compareEnabled: true, compareCost: null });
  ok("inputs 是同一个对象、目标毛利原样", v.inputs === full && v.inputs.targetMarginPct === MARGIN && !("costHidden" in v));
  ok("结果与直接 buildScenarios 逐字节相同（带「成本 + 目标毛利」底价情景）", JSON.stringify(v.result) === JSON.stringify(buildScenarios(model, full)) && (v.result?.scenarios ?? []).some((s) => s.key === "floor"));
}

console.log("保存返回");
{
  const resp = { ok: true, inputs: full, model: null, ourCostSource: { kind: "manual", recordedAt: "x" } };
  const h = fv.buildSavedInputsView(resp, false) as Rec;
  const hi = (h.inputs ?? {}) as PricingInputs;
  ok("没有财务查看权：目标毛利与成本为 null、costHidden、没有 ourCostSource，对手价照旧", hi.targetMarginPct === null && hi.ourCostCad === null && hi.competitorPriceCad === 100000 && h.costHidden === true && !("ourCostSource" in h), h);
  ok("没有财务查看权：整份返回里搜不到目标毛利与成本", !JSON.stringify(h).includes("23.7") && !JSON.stringify(h).includes("87654"));
  ok("没有财务查看权：入参没被改", resp.inputs.targetMarginPct === MARGIN && "ourCostSource" in resp);
  ok("有财务查看权：原样（同一个对象）", fv.buildSavedInputsView(resp, true) === resp);
}

console.log("请求里有没有这个键");
{
  const hasKey = ex.hasKey as ((o: unknown, k: string) => boolean) | undefined;
  ok("导出了共用判断", typeof hasKey === "function");
  if (typeof hasKey === "function") {
    ok("数字与 null 都算有", hasKey({ targetMarginPct: 5 }, "targetMarginPct") && hasKey({ targetMarginPct: null }, "targetMarginPct"));
    ok("没有这个键 / 不是对象 / 数组 / null：算没有（不抛错）", !hasKey({}, "targetMarginPct") && !hasKey("x", "targetMarginPct") && !hasKey(["targetMarginPct"], "0") && !hasKey(null, "x") && !hasKey(undefined, "x"));
    ok("继承来的键不算（只认请求自己带的）", !hasKey({}, "toString") && !hasKey(Object.create({ targetMarginPct: 1 }), "targetMarginPct"));
  }
}

console.log("这次保存碰了受限的键");
{
  ok("inputs 带 targetMarginPct（数字 / null）：碰了", fv.touchesCost({ inputs: { targetMarginPct: 12 } }) && fv.touchesCost({ inputs: { targetMarginPct: null } }) && fv.touchesCost({ inputs: { competitorPriceCad: 1, targetMarginPct: 0 } }));
  ok("成本与成本来源照旧算碰了", fv.touchesCost({ inputs: { ourCostCad: 5 } }) && fv.touchesCost({ ourCostSource: null }));
  ok("只带对手价 / 只带评分模型：没碰", !fv.touchesCost({ inputs: { competitorPriceCad: 1 } }) && !fv.touchesCost({ model: { priceWeightPct: 50 } }) && !fv.touchesCost({ action: "save" }));
  ok("inputs 不是对象、请求不是对象：没碰（不抛错）", !fv.touchesCost({ inputs: "targetMarginPct" }) && !fv.touchesCost({ inputs: ["targetMarginPct"] }) && !fv.touchesCost(null) && !fv.touchesCost("x"));
}

console.log("房间 JSON");
{
  const sj = {
    pricingModel: { a: 1 },
    pricingInputs: { competitorPriceCad: 100000, ourCostCad: COST, targetMarginPct: MARGIN, ourPriceCad: 114881.15, ourPrice: 114881.15, ourPriceStatus: "AUTHORITATIVE" },
    bidDraft: { version: "x", internalNotesZh: ["内部注：按成本加二成报"] },
    bidStrategyMemo: { pricingStrategyZh: "按成本 87654 定价" },
    majorBlockers: ["fixture blocker"],
    other: { keep: true },
  };
  const r = safe(() => fv.redactRoomSummaryCost(sj)) as Rec | undefined;
  ok("去掉整个 pricingInputs、bidDraft 与备忘", !!r && !("pricingInputs" in r) && !("bidDraft" in r) && !("bidStrategyMemo" in r), r);
  ok("其它键原样", !!r && (r.pricingModel as Rec)?.a === 1 && Array.isArray(r.majorBlockers) && (r.other as Rec)?.keep === true);
  ok("裁剪结果里搜不到目标毛利、成本、我方报价镜像与内部注", !!r && !/23\.7|87654|114881|内部注/.test(JSON.stringify(r)));
  ok("不改入参", "pricingInputs" in sj && "bidDraft" in sj && sj.pricingInputs.targetMarginPct === MARGIN);
  const onlyDraft = { bidDraft: { internalNotesZh: ["x"] }, majorBlockers: [] };
  ok("只有 bidDraft 也去掉", !("bidDraft" in (fv.redactRoomSummaryCost(onlyDraft) as Rec)));
  const clean = { majorBlockers: ["x"], pricingModel: { a: 1 } };
  ok("三者都没有：返回同一个对象", fv.redactRoomSummaryCost(clean) === clean);
  ok("不是对象 / null / 数组：原样返回", fv.redactRoomSummaryCost(null) === null && fv.redactRoomSummaryCost("x") === "x" && Array.isArray(fv.redactRoomSummaryCost([1])));
}

console.log("接线（源码断言）");
{
  const view = read("src/lib/tender-pricing/finance-view.ts");
  const imports = view.split("\n").filter((l) => /^import\b/.test(l));
  ok(
    "finance-view.ts 只 import ./calc 与 ./compare-cost-source 的类型（不引用 node: / @/lib/db / next/ / project-finance/access）",
    imports.length === 2 && imports.some((l) => l.endsWith('from "./calc";')) && imports.some((l) => l.startsWith("import type") && l.endsWith('from "./compare-cost-source";')) && !/from "node:|@\/lib\/db|from "next\/|project-finance\/access/.test(view),
    imports,
  );
  const route = read("src/app/api/projects/[id]/pricing-helper/route.ts");
  ok(
    "保存：三项输入与成本来源的「请求里带了没有」都用共用判断，不再用 in",
    ['hasKey(body.inputs, "competitorPriceCad")', 'hasKey(body.inputs, "ourCostCad")', 'hasKey(body.inputs, "targetMarginPct")', 'costInBody: hasKey(body.inputs, "ourCostCad"),'].every((x) => route.includes(x)) && !/" in body\.inputs/.test(route),
  );
  ok("保存：403 判定仍在写锁之前、仍经 touchesCost", route.indexOf("if (!canSeeCost && touchesCost(body)) {") > 0 && route.indexOf("touchesCost(body)") < route.indexOf("const out = await writeRoomLocked(projectId, room.id, (latest) => {\n    const built"));
  ok("读取与保存返回仍经裁剪视图", route.includes("buildPricingHelperView({ model, inputs, canSeeCost, compareEnabled, compareCost })") && route.includes("buildSavedInputsView("));
  const card = read("src/components/tender/pricing-helper-card.tsx");
  ok("卡片：目标毛利格换成标签 + 那句话", /k === "margin" && costHidden \? \(\s*<p key=\{k\} className="text-\[10px\] text-muted" data-testid="pricing-margin-hidden">\s*\{label\}\s*<span className="mt-0\.5 block text-\[11px\] text-foreground\/80">\{TARGET_MARGIN_HIDDEN_FIELD_ZH\}<\/span>/.test(card));
  ok("卡片：标签按开关（开关开着时「目标毛利率 %（按售价）」）", card.includes('["margin", compareOn ? TARGET_MARGIN_ON_PRICE_ZH : "目标毛利 %"]'));
  ok("卡片：没有财务查看权时保存不带目标毛利", card.includes("...(data.costHidden ? {} : { targetMarginPct: n(form.margin) }),") && !/\n\s*targetMarginPct: n\(form\.margin\),/.test(card));
  ok("卡片：没有财务查看权时不渲染成本加成提示", card.includes("<MarkupHint enabled={compareOn && !costHidden} margin={form.margin} />") && (card.match(/<MarkupHint /g) ?? []).length === 1);
  ok("卡片：「目标毛利只用于…」那句不再出现", !card.includes("COST_TARGET_MARGIN_NOTE_ZH") && !card.includes("目标毛利只用于"));
  ok("卡片：有财务查看权时目标毛利仍是输入框（同一个 input 分支）", card.includes("value={form[k]}") && card.includes('["cost", "我方成本"],'));
  const list = read("src/app/api/projects/route.ts");
  const room = read("src/app/api/projects/[id]/bid-intelligence/route.ts");
  ok("两个房间 JSON 接口仍经同一个裁剪", list.includes("summaryJson: redactRoomSummaryCost(room.summaryJson)") && room.includes("summaryJson: redactRoomSummaryCost(room.summaryJson)"));
}

console.log(`\ntarget-margin-finance-view: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
