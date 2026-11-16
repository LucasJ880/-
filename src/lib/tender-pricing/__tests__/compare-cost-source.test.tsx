/**
 * FLOW-H2 报价表助手的成本来源：落地价逐项、规则、来源核对、过时提示、成本加成换算、卡片呈现与接线
 * 运行：npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompareCostSourceBlock, MarkupHint } from "@/components/tender/pricing-compare-source";
import { normalizeQuote, type LandedBreakdown, type LandedCostSettings, type NormalizeContext } from "@/lib/tender-rfq/landed-cost";
import { buildCompareMatrix, type CompareInput } from "@/lib/tender-rfq/compare";
import { buildScenarios, type ScoringModel } from "../calc";
import {
  DDP_GST_ZH,
  GST_EXCLUDED_ZH,
  UNAVAILABLE_ZH,
  NONE_SELECTED_ZH,
  breakdownLinesZh,
  fillFromSuggestion,
  isPricingCompareSourceEnabledForOrgWithEnv,
  markupHintZh,
  markupPctFromMarginPct,
  nextCostSource,
  quantityBasisOf,
  quantityBasisZh,
  readCostClaim,
  readCostSource,
  staleNoteZh,
  verifyCostSource,
  type CompareCostSuggestion,
  type CompareCostView,
  type OurCostSource,
} from "../compare-cost-source";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-11-15T12:00:00Z");
const FULL: LandedCostSettings = {
  fxRates: { CNY: 0.19, USD: 1.36 },
  fxAsOf: "2026-11-10",
  fxSource: "MANUAL",
  freightEstimate: { mode: "per_unit", value: 6 },
  exportInlandEstimate: { mode: "per_shipment", value: 800 },
  insurancePct: 1,
  clearanceFlatCad: 150,
  projects: {},
};
const ctx = (o: Partial<NormalizeContext> = {}): NormalizeContext => ({ settings: FULL, dutyRatePct: 6.5, quantity: 1500, now: NOW, ...o });
const sumOf = (b: LandedBreakdown) => [b.goods, b.inland, b.freight, b.insurance, b.duty, b.clearance].reduce<number>((a, x) => a + (x ?? 0), 0);

console.log("落地价逐项");
{
  const fob = normalizeQuote({ unitPrice: 280, totalPrice: null, currency: "CNY", incoterm: "FOB" }, ctx());
  const b = fob.breakdownCad!;
  ok("FOB：货值 79,800、海运 9,000、保险 888、关税 5,187、清关 150；没有内陆", b.goods === 79800 && b.freight === 9000 && b.insurance === 888 && b.duty === 5187 && b.clearance === 150 && b.inland === null && b.feesIncludedInQuote === false, b);
  ok("FOB：逐项之和 = 落地总价 95,025（总价与改动前相同）", Math.abs(sumOf(b) - fob.landedCad.total!) < 0.01 && fob.landedCad.total === 95025, { sum: sumOf(b), total: fob.landedCad.total });
  const exw = normalizeQuote({ unitPrice: 280, totalPrice: null, currency: "CNY", incoterm: "EXW" }, ctx());
  ok("EXW：多一项出口内陆 800；逐项之和 = 落地总价", exw.breakdownCad!.inland === 800 && Math.abs(sumOf(exw.breakdownCad!) - exw.landedCad.total!) < 0.01, exw.breakdownCad);
  const cif = normalizeQuote({ unitPrice: 280, totalPrice: null, currency: "CNY", incoterm: "CIF" }, ctx());
  ok("CIF：只有关税与清关，海运、保险为空", cif.breakdownCad!.freight === null && cif.breakdownCad!.insurance === null && cif.breakdownCad!.duty != null && cif.breakdownCad!.clearance === 150 && Math.abs(sumOf(cif.breakdownCad!) - cif.landedCad.total!) < 0.01, cif.breakdownCad);
  const ddp = normalizeQuote({ unitPrice: null, totalPrice: 61000, currency: "CAD", incoterm: "DDP" }, ctx());
  ok("DDP：各项费用为空，写明已含在报价里；总价 = 货值", ddp.breakdownCad!.feesIncludedInQuote === true && ddp.breakdownCad!.goods === 61000 && ddp.landedCad.total === 61000 && ddp.breakdownCad!.duty === null, ddp.breakdownCad);
  const noDuty = normalizeQuote({ unitPrice: 280, totalPrice: null, currency: "CNY", incoterm: "FOB" }, ctx({ dutyRatePct: null }));
  ok("缺关税率：没有落地总价，也没有逐项", noDuty.landedCad.total === null && noDuty.breakdownCad === null);
  const odd = normalizeQuote({ unitPrice: 3.333, totalPrice: null, currency: "USD", incoterm: "FOB" }, ctx({ quantity: 777 }));
  const cents = (n: number) => Math.round(n * 100);
  const items = (bb: LandedBreakdown) => [bb.goods, bb.inland, bb.freight, bb.insurance, bb.duty, bb.clearance].filter((x): x is number => x != null);
  ok("不整的金额：逐项都是到分的数，之和正好等于落地总价", items(odd.breakdownCad!).every((x) => Math.abs(x * 100 - Math.round(x * 100)) < 1e-6) && items(odd.breakdownCad!).reduce((a, x) => a + cents(x), 0) === cents(odd.landedCad.total!), { b: odd.breakdownCad, total: odd.landedCad.total });
  // 随机：各种贸易条款、币种、数量、费用参数，逐项之和都正好等于总价，货值等于 goodsCad
  let bad = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const terms = ["EXW", "FCA", "FOB", "CIF", "CIP", "DAP"];
  for (let i = 0; i < 3000; i += 1) {
    const settings: LandedCostSettings = { ...FULL, freightEstimate: rnd() < 0.5 ? { mode: "per_unit", value: Math.round(rnd() * 1000) / 100 } : { mode: "pct_of_goods", value: Math.round(rnd() * 900) / 100 }, insurancePct: Math.round(rnd() * 300) / 100, clearanceFlatCad: Math.round(rnd() * 50000) / 100 };
    const q = normalizeQuote({ unitPrice: Math.round(rnd() * 100000) / 1000, totalPrice: null, currency: rnd() < 0.5 ? "USD" : "CNY", incoterm: terms[Math.floor(rnd() * terms.length)] }, ctx({ settings, dutyRatePct: Math.round(rnd() * 2000) / 100, quantity: 1 + Math.floor(rnd() * 5000) }));
    const bb = q.breakdownCad;
    if (!bb || items(bb).reduce((a, x) => a + cents(x), 0) !== cents(q.landedCad.total!) || bb.goods !== q.goodsCad.total) bad += 1;
  }
  ok("随机 3000 例：逐项之和都正好等于落地总价，货值与 goodsCad 相同", bad === 0, { bad });
  ok("落地价里没有 GST/HST 一项", !Object.keys(b).some((k) => /gst|hst|tax/i.test(k)));
  ok("逐项文字：海运、关税单列", breakdownLinesZh(b).some((l) => l.startsWith("海运（国际运费） 9,000.00")) && breakdownLinesZh(b).some((l) => l.startsWith("关税 5,187.00")));
  ok("逐项文字：DDP 写明已含在报价里", breakdownLinesZh(ddp.breakdownCad!).join("|") === "货值 61,000.00|运费、关税等已含在供应商报价里（DDP）");
  ok("逐项文字：保险也列出来", breakdownLinesZh(b).includes("保险 888.00"));
}

console.log("比价矩阵结论措辞");
{
  const q = (id: string, price: number): CompareInput => {
    const quoted = { unitPrice: price, totalPrice: null, currency: "CNY", incoterm: "FOB", moq: null, deliveryDays: 20, validUntil: "2026-12-31" };
    return { itemId: id, supplierId: id, supplierName: `${id} 公司`, quoted, emailDate: new Date("2026-11-01"), mandatoryAnswers: [], normalized: normalizeQuote(quoted, ctx()) };
  };
  const m = buildCompareMatrix([q("a", 280), q("b", 300)], { closeDate: new Date("2026-12-20"), deliveryDeadline: null, firstTierQty: 1500, mandatoryCodes: [], now: NOW });
  ok("结论写「到目的地，含关税，不含 GST/HST；DDP 以供应商报价为准」，没有「含税」", m.summaryZh.includes("到目的地，含关税，不含 GST/HST；DDP 以供应商报价为准") && !m.summaryZh.includes("含税"), m.summaryZh);
  const muse = readFileSync(join(process.cwd(), "src/lib/muse-bridge/router-pure.ts"), "utf8");
  ok("Muse 的比价理由里同一句话也改了", muse.includes("到目的地，含关税，不含 GST/HST；DDP 以供应商报价为准") && !muse.includes("到目的地含税"));
}

const okSug = (o: Partial<Extract<CompareCostSuggestion, { status: "ok" }>> = {}): CompareCostSuggestion => ({
  status: "ok",
  inquiryId: "inq2",
  inquiryItemId: "itemA",
  roundNumber: 2,
  supplierName: "甲厂",
  laterUnselectedRounds: [],
  landedCadTotal: 95025,
  quantityBasis: { kind: "first_tier", qty: 1500 },
  breakdown: { goods: 79800, inland: null, freight: 9000, insurance: 888, duty: 5187, clearance: 150, feesIncludedInQuote: false },
  assumptions: [],
  warnings: [],
  ...o,
});

console.log("数量口径");
{
  ok("供应商给了总价、询价单有首档数量：写明货值按总价、按件估算的费用按首档数量", quantityBasisZh(quantityBasisOf(61000, 1500)) === "货值按供应商报价总价；按件估算的费用按询价单首档数量 1,500");
  ok("供应商给了总价、询价单没有数量：按供应商报价总价", quantityBasisZh(quantityBasisOf(61000, null)) === "按供应商报价总价");
  ok("只有单价：按询价单首档数量", quantityBasisZh(quantityBasisOf(null, 1500)) === "按询价单首档数量 1,500");
  ok("都没有：口径未知", quantityBasisOf(null, null).kind === "unknown");
}

console.log("来源核对（服务端）");
{
  const claim = { kind: "rfq_compare" as const, inquiryItemId: "itemA" };
  const v = verifyCostSource(claim, 95025, okSug(), NOW);
  ok("同一条、到分相同：记来自比价矩阵（轮次、条目、落地价、数量口径、时间）", v?.kind === "rfq_compare" && v.inquiryItemId === "itemA" && v.inquiryId === "inq2" && v.roundNumber === 2 && v.landedCadTotal === 95025 && v.quantityBasis.kind === "first_tier" && v.recordedAt === NOW.toISOString(), v);
  ok("差 1 分：不记", verifyCostSource(claim, 95025.01, okSug(), NOW) === null);
  ok("差半分以内：记", verifyCostSource(claim, 95025.004, okSug(), NOW)?.kind === "rfq_compare");
  ok("声明的条目不是当前选定的那一条：不记", verifyCostSource({ kind: "rfq_compare", inquiryItemId: "itemB" }, 95025, okSug(), NOW) === null);
  ok("当前没有可用的建议：不记", verifyCostSource(claim, 95025, { status: "none_selected", messageZh: NONE_SELECTED_ZH }, NOW) === null && verifyCostSource(claim, 95025, null, NOW) === null);
  ok("换算不出：不记", verifyCostSource(claim, 95025, { status: "unconvertible", inquiryId: "inq2", inquiryItemId: "itemA", roundNumber: 2, supplierName: "甲厂", laterUnselectedRounds: [], reasons: ["缺汇率"] }, NOW) === null);
  ok("请求里只认条目 id：带金额、轮次、组织都不读", JSON.stringify(readCostClaim({ kind: "rfq_compare", inquiryItemId: "itemA", landedCadTotal: 1, roundNumber: 9, orgId: "evil" })) === JSON.stringify({ kind: "rfq_compare", inquiryItemId: "itemA" }));
  ok("形状不对的声明：当没有", readCostClaim({ kind: "manual" }) === null && readCostClaim({ kind: "rfq_compare", inquiryItemId: 5 }) === null && readCostClaim("x") === null && readCostClaim({ kind: "rfq_compare", inquiryItemId: "x".repeat(65) }) === null);
}

console.log("保存时的来源");
{
  const rfq: OurCostSource = { kind: "rfq_compare", inquiryId: "inq2", inquiryItemId: "itemA", roundNumber: 2, supplierName: "甲厂", landedCadTotal: 95025, quantityBasis: { kind: "first_tier", qty: 1500 }, recordedAt: "2026-11-01T00:00:00.000Z" };
  const base = { enabled: true, costInBody: true, ourCostCad: 95025, prevCostCad: null, prevSource: null, claim: { kind: "rfq_compare" as const, inquiryItemId: "itemA" }, suggestion: okSug(), now: NOW };
  ok("点按钮后直接保存：来自比价矩阵", nextCostSource(base)?.kind === "rfq_compare");
  ok("点按钮后改了数字：手填", nextCostSource({ ...base, ourCostCad: 96000 })?.kind === "manual");
  ok("没有声明、新数字：手填", nextCostSource({ ...base, claim: null })?.kind === "manual");
  ok("请求没改成本：保留原来的来源", nextCostSource({ ...base, costInBody: false, prevSource: rfq }) === rfq);
  ok("成本没变、也没有新声明（只改了毛利）：保留原来的来源，即使矩阵变了", nextCostSource({ ...base, claim: null, prevCostCad: 95025, prevSource: rfq, suggestion: okSug({ landedCadTotal: 99000 }) }) === rfq);
  ok("成本没变、带了声明但核对不过（矩阵已经换了一家）：保留原来的来源，不改成手填（过时提示照样出现）", nextCostSource({ ...base, claim: { kind: "rfq_compare", inquiryItemId: "itemB" }, prevCostCad: 95025, prevSource: rfq, suggestion: okSug({ inquiryItemId: "itemC", landedCadTotal: 99000 }) }) === rfq);
  ok("成本没变、原来是手填、带了核对不过的声明：仍是手填", nextCostSource({ ...base, claim: { kind: "rfq_compare", inquiryItemId: "itemB" }, prevCostCad: 95025, prevSource: { kind: "manual", recordedAt: "t" } })?.kind === "manual");
  ok("成本清空：没有来源", nextCostSource({ ...base, ourCostCad: null, prevSource: rfq }) === null);
  ok("开关关闭：不看声明；成本变了去掉原来的来源", nextCostSource({ ...base, enabled: false, prevSource: rfq, prevCostCad: 80000 }) === null);
  ok("开关关闭：成本没变，原来的来源留着", nextCostSource({ ...base, enabled: false, prevSource: rfq, prevCostCad: 95025 }) === rfq);
}

console.log("矩阵变了只提示");
{
  const rfq: OurCostSource = { kind: "rfq_compare", inquiryId: "inq2", inquiryItemId: "itemA", roundNumber: 2, supplierName: "甲厂", landedCadTotal: 95025, quantityBasis: { kind: "first_tier", qty: 1500 }, recordedAt: "2026-11-01T00:00:00.000Z" };
  ok("同一条、同一个数：没有提示", staleNoteZh(rfq, 95025, okSug()) === null);
  const swapped = staleNoteZh(rfq, 95025, okSug({ inquiryItemId: "itemB", supplierName: "乙厂", landedCadTotal: 88000.5 }));
  ok("选定换了一家：写明现在是哪家多少、已保存的是哪家多少、没有自动更新", swapped === "比价矩阵现在是 乙厂 第 2 轮 88,000.50 CAD；已保存的我方成本 95,025.00 CAD 是按 甲厂 第 2 轮的落地价记的，没有自动更新。", swapped);
  ok("同一家、落地价变了 1 分：提示", staleNoteZh(rfq, 95025, okSug({ landedCadTotal: 95025.01 })) != null);
  ok("现在换算不出：提示", (staleNoteZh(rfq, 95025, { status: "unconvertible", inquiryId: "inq3", inquiryItemId: "itemC", roundNumber: 3, supplierName: "丙厂", laterUnselectedRounds: [], reasons: ["缺汇率"] }) ?? "").includes("丙厂 第 3 轮换算不出落地价"));
  ok("现在没有选定：提示", (staleNoteZh(rfq, 95025, { status: "none_selected", messageZh: NONE_SELECTED_ZH }) ?? "").startsWith("比价矩阵现在没有选定的供应商"));
  ok("取数出错（暂不可用）：不下「过时」的结论", staleNoteZh(rfq, 95025, { status: "unavailable", messageZh: UNAVAILABLE_ZH }) === null);
  ok("取数出错时保存带声明：不记来自比价矩阵", verifyCostSource({ kind: "rfq_compare", inquiryItemId: "itemA" }, 95025, { status: "unavailable", messageZh: UNAVAILABLE_ZH }, NOW) === null);
  ok("手填的：没有提示", staleNoteZh({ kind: "manual", recordedAt: "x" }, 95025, okSug({ landedCadTotal: 1 })) === null);
  ok("没有来源：没有提示", staleNoteZh(null, 95025, okSug({ landedCadTotal: 1 })) === null);
  ok("读取已存的来源：形状不对当没有", readCostSource({ kind: "rfq_compare", inquiryItemId: "x" }) === null && readCostSource(null) === null && readCostSource({ kind: "manual", recordedAt: "t" })?.kind === "manual");
}

console.log("毛利率与成本加成");
{
  ok("目标毛利 20% → 相当于成本加成 25%", markupHintZh(20) === "相当于成本加成 25%");
  ok("目标毛利 25% → 33.3%", markupPctFromMarginPct(25) === 33.3);
  ok("0% → 0%；100% 或以上、负数、空：不显示", markupPctFromMarginPct(0) === 0 && markupPctFromMarginPct(100) === null && markupPctFromMarginPct(-1) === null && markupPctFromMarginPct(null) === null && markupPctFromMarginPct(Number.NaN) === null);
  const model: ScoringModel = { version: "tender-pricing-model/v1", priceWeightPct: 30, costFormula: "lowest_over_bid", otherCriteria: [], source: "HUMAN", evidenceZh: [], derivedAt: NOW.toISOString() };
  const before = buildScenarios(model, { competitorPriceCad: 120000, ourCostCad: 95025, targetMarginPct: 20 });
  const floor = before.scenarios.find((s) => s.key === "floor");
  ok("计算不变：成本底线仍按售价算 = 95,025 ÷ 0.8", floor != null && Math.abs(floor.priceCad - 95025 / 0.8) < 1, floor);
}

console.log("开关");
{
  ok("未设：关", !isPricingCompareSourceEnabledForOrgWithEnv("org1", {} as NodeJS.ProcessEnv));
  ok("开、无名单：开", isPricingCompareSourceEnabledForOrgWithEnv("org1", { TENDER_PRICING_COMPARE_SOURCE_ENABLED: "1" } as unknown as NodeJS.ProcessEnv));
  ok("开、不在名单：关", !isPricingCompareSourceEnabledForOrgWithEnv("org1", { TENDER_PRICING_COMPARE_SOURCE_ENABLED: "true", TENDER_PRICING_COMPARE_SOURCE_ORG_ALLOWLIST: "org2" } as unknown as NodeJS.ProcessEnv));
  ok("没有组织：关", !isPricingCompareSourceEnabledForOrgWithEnv(null, { TENDER_PRICING_COMPARE_SOURCE_ENABLED: "1" } as unknown as NodeJS.ProcessEnv));
}

console.log("按钮只填输入框");
{
  const form = { competitor: "120000", cost: "90000", margin: "20" };
  const f = fillFromSuggestion(form, okSug());
  ok("填入：只改成本，带上条目声明", f != null && f.form.cost === "95025" && f.form.competitor === "120000" && f.form.margin === "20" && f.claim.inquiryItemId === "itemA");
  ok("原表单不变（不就地改）", form.cost === "90000");
  ok("没有建议：不填", fillFromSuggestion(form, { status: "none_selected", messageZh: NONE_SELECTED_ZH }) === null);
}

console.log("卡片呈现");
{
  const view = (o: Partial<CompareCostView> = {}): CompareCostView => ({ suggestion: okSug(), source: null, staleNoteZh: null, ...o });
  const html = (v: CompareCostView, canManage = true) => renderToStaticMarkup(<CompareCostSourceBlock view={v} canManage={canManage} onFill={() => undefined} />);
  const h = html(view());
  ok("有建议：供应商、轮次、落地价、数量口径、逐项、不含 GST/HST、填入按钮", h.includes("来自比价矩阵") && h.includes("甲厂") && h.includes("第 2 轮（已选定）") && h.includes("95,025.00") && h.includes("按询价单首档数量 1,500") && h.includes("海运（国际运费） 9,000.00") && h.includes("关税 5,187.00") && h.includes(GST_EXCLUDED_ZH) && h.includes('data-testid="pricing-compare-fill"'), h);
  ok("说明按钮只填输入框、要保存才生效", h.includes("只填进输入框；点「保存并重算」才生效，手填可覆盖"));
  ok("保险一项也显示", h.includes("保险 888.00"));
  const withAssumptions = html(view({ suggestion: okSug({ assumptions: ["汇率 CNY→CAD 0.19（2026-11-10，手工）", "关税 6.5% × 货值 79,800 = 5,187 CAD"] }) }));
  ok("换算依据（汇率日期与来源、关税率）显示出来", withAssumptions.includes("换算依据：汇率 CNY→CAD 0.19（2026-11-10，手工）；关税 6.5%"), withAssumptions);
  const ddpView = html(view({ suggestion: okSug({ breakdown: { goods: 61000, inland: null, freight: null, insurance: null, duty: null, clearance: null, feesIncludedInQuote: true }, landedCadTotal: 61000 }) }));
  ok("DDP：不断言不含 GST/HST，写以供应商报价为准", ddpView.includes(DDP_GST_ZH) && !ddpView.includes(GST_EXCLUDED_ZH), ddpView);
  const unavailable = html(view({ suggestion: { status: "unavailable", messageZh: UNAVAILABLE_ZH } }));
  ok("取数出错：只这一行说暂不可用、没有按钮", unavailable.includes("暂时取不到") && !unavailable.includes("pricing-compare-fill"));
  const hint = (enabled: boolean, margin: string) => renderToStaticMarkup(<MarkupHint enabled={enabled} margin={margin} />);
  ok("成本加成换算：开关开启、目标毛利 20 → 显示 25%；开关关闭 → 什么都不显示；空 → 不显示", hint(true, "20").includes("相当于成本加成 25%") && hint(false, "20") === "" && hint(true, "") === "");
  ok("只读的人：没有按钮", !html(view(), false).includes("pricing-compare-fill"));
  const un = html(view({ suggestion: { status: "unconvertible", inquiryId: "i", inquiryItemId: "x", roundNumber: 2, supplierName: "甲厂", laterUnselectedRounds: [], reasons: ["缺 CNY→CAD 汇率，请在组织设置填写"] } }));
  ok("换算不出：写原因、没有数字、没有按钮", un.includes("换算不出落地价") && un.includes("缺 CNY→CAD 汇率") && !un.includes("pricing-compare-fill") && !/\d{1,3},\d{3}\.\d{2}/.test(un), un);
  const none = html(view({ suggestion: { status: "none_selected", messageZh: NONE_SELECTED_ZH } }));
  ok("没有选定：提示去选、没有按钮", none.includes("还没有选定供应商") && !none.includes("pricing-compare-fill"));
  ok("之后还有没选定的轮次：写出来", html(view({ suggestion: okSug({ laterUnselectedRounds: [3] }) })).includes("之后还有第 3 轮，尚未选定"));
  const stale = html(view({ source: { kind: "rfq_compare", inquiryId: "inq2", inquiryItemId: "itemA", roundNumber: 2, supplierName: "甲厂", landedCadTotal: 95025, quantityBasis: { kind: "first_tier", qty: 1500 }, recordedAt: "x" }, staleNoteZh: "比价矩阵现在是 乙厂……" }));
  ok("已保存的来源与过时提示都显示", stale.includes("已保存的我方成本：来自比价矩阵（甲厂 第 2 轮，按询价单首档数量 1,500）") && stale.includes("pricing-compare-stale"), stale);
  ok("手填的来源：写手填", html(view({ source: { kind: "manual", recordedAt: "x" } })).includes("已保存的我方成本：手填"));
}

console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const route = read("src/app/api/projects/[id]/pricing-helper/route.ts");
  const card = read("src/components/tender/pricing-helper-card.tsx");
  const load = read("src/lib/tender-pricing/compare-cost-source-load.ts");
  ok("接口：组织只用服务端鉴权得到的项目组织", (route.match(/const orgId = access\.project\.orgId;/g) ?? []).length === 2 && !/body\.orgId|orgId:\s*body/.test(route));
  ok("接口：开关开启才返回 compareCost、才看来源声明", route.includes("isPricingCompareSourceEnabledForOrg(orgId)") && route.includes("...(compareCost ? { compareCost } : {})") && route.includes("compareEnabled ? readCostClaim(body.ourCostSource) : null"));
  ok("接口：返回的 inputs 仍只有三项（来源另给）", route.includes("ourCostCad: saved.ourCostCad ?? null,") && route.includes("...(compareEnabled ? { ourCostSource: source } : {})"));
  ok("取数：只认人工选定、已报价；按轮次从新到旧；组织从调用方传入并限定项目", load.includes("isSelected: true") && load.includes("status: ITEM_STATUS.QUOTED") && load.includes('orderBy: [{ inquiry: { roundNumber: "desc" } }') && load.includes("inquiry: { projectId: input.projectId, project: { orgId: input.orgId }, status: { not: INQUIRY_STATUS.CANCELED } }"));
  ok("取数：复用比价矩阵（带组织、指定轮次）", load.includes("loadCompareMatrix({") && load.includes("orgId: input.orgId,") && load.includes("inquiryId: selected.inquiryId,"));
  ok("取数：不看推荐、最低价", !/recommendedItemId|cheapestItemId/.test(load));
  ok("卡片：按钮只改表单与声明，不调保存", /const fill = \(\) => \{[\s\S]*?setForm\(filled\.form\);\s*setCostClaim\(filled\.claim\);\s*\};/.test(card) && !/const fill = \(\) => \{[^}]*post\(/.test(card));
  ok("卡片：手改成本就去掉声明；保存时带上声明", card.includes('if (k === "cost") setCostClaim(null);') && card.includes("...(costClaim ? { ourCostSource: costClaim } : {})"));
  ok("卡片：重新读取时清掉声明（不让旧的声明跟着下一次保存）", /setForm\(\{[\s\S]*?\}\);\s*setCostClaim\(null\);/.test(card));
  ok("卡片：成本加成只在开关开启时显示", card.includes("<MarkupHint enabled={!!cc} margin={form.margin} />"));
  ok("接口：读取与保存都用不会抛错的取数（出错时卡片不挂）", (route.match(/await loadCompareCostSuggestionSafe\(\{ projectId, orgId \}\)/g) ?? []).length === 2 && !/await loadCompareCostSuggestion\(/.test(route) && load.includes("export async function loadCompareCostSuggestionSafe") && load.includes('return { status: "unavailable", messageZh: UNAVAILABLE_ZH };'));
  ok("取数：已取消轮次里的选定不算；已取消、草稿轮次不算「之后还有」", load.includes("status: { not: INQUIRY_STATUS.CANCELED }") && load.includes("status: { notIn: [INQUIRY_STATUS.CANCELED, INQUIRY_STATUS.DRAFT] }"));
  ok("卡片：开关关闭（没有 compareCost）时文字与原来相同", card.includes('cc ? TARGET_MARGIN_ON_PRICE_ZH : "目标毛利 %"') && card.includes('{cc ? MARGIN_ON_PRICE_ZH : "毛利"}') && card.includes("{cc ? <CompareCostSourceBlock"));
}

console.log(`\ncompare-cost-source: ${passed} passed`);
