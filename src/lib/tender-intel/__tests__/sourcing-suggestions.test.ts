/**
 * CHAIN-2 寻源建议 — 开关 / 推荐型号 / 价格三栏 / 不合并 / 接线（纯函数 + 源码断言）
 * 运行：npx tsx src/lib/tender-intel/__tests__/sourcing-suggestions.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isAutoSupplierRunEnabledForOrgWithEnv } from "../sourcing-flags";
import type { CompareCostSuggestion } from "@/lib/tender-pricing/compare-cost-source";
import {
  AWARD_TEXT,
  LANDED_TEXT,
  MARKET_TEXT,
  RECOMMENDATION_TEXT,
  SOURCING_PRICE_NOTE_ZH,
  assembleSourcingSuggestions,
  buildAwardColumn,
  buildLandedColumn,
  buildMarketColumn,
  buildRecommendations,
  poolNoteZh,
  supplyChainHref,
  type RankedCandidateInput,
} from "../sourcing-suggestions-pure";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 800)); }
}

console.log("sourcing suggestions");

// ── 开关 ──
{
  const on = (v: string | undefined, list: string | undefined, org = "org_1") =>
    isAutoSupplierRunEnabledForOrgWithEnv(org, { TENDER_AUTO_SUPPLIER_RUN_ENABLED: v, TENDER_AUTO_SUPPLIER_RUN_ORG_ALLOWLIST: list } as NodeJS.ProcessEnv);
  ok(!on(undefined, undefined) && !on("0", undefined) && !on("false", "org_1"), "开关未设 / 0 / false → 关");
  ok(on("1", undefined) && on(" TRUE ", "") && on("yes", "org_1, org_2") && on("On", undefined), "开关为 1 / true / on / yes（不分大小写、去空白）且白名单为空或含本组织 → 开");
  ok(!on("1", "org_2") && !on("1", undefined, ""), "白名单只含别的组织 / 没有组织 → 关");
}

// ── 推荐型号 ──
const gate = (pass: number, total: number) => Array.from({ length: total }, (_, i) => ({ requirementKey: `R-00${i + 1}`, gateVerdict: "PASS", evidenceAdmissible: i < pass }));
const row = (o: Partial<RankedCandidateInput> & { candidateId: string }): RankedCandidateInput => ({
  supplierId: `s_${o.candidateId}`, supplierName: `供应商 ${o.candidateId}`, offeringName: "睡袋 A1", offeringSku: "SB-A1", section: "PRIMARY", rank: 1, mandatoryGateResult: "PASS",
  scores: { technical: 80, commercial: 70, reliability: 75, importRisk: 60, total: 72.5 }, gateItems: gate(3, 3), ...o,
});
const base = { projectId: "proj 1", intelEnabled: true, analysisApproved: true, autoPoolCount: null as number | null };
{
  ok(supplyChainHref("proj 1") === "/projects/intelligence/supply-chain?projectId=proj%201", "供应链页链接");
  const ready = buildRecommendations({
    ...base, autoPoolCount: 12,
    ranked: [
      row({ candidateId: "c3", section: "BACKUP", rank: 3 }),
      row({ candidateId: "c1", section: "PRIMARY", rank: 1, gateItems: gate(2, 3) }),
      row({ candidateId: "c4", section: "NOT_ELIGIBLE", rank: null, mandatoryGateResult: "FAIL" }),
      row({ candidateId: "c2", section: "BACKUP", rank: 2, gateItems: [] }),
      row({ candidateId: "c5", section: "BACKUP", rank: 4 }),
    ],
  });
  ok(ready.status === "ready" && ready.items.map((i) => i.candidateId).join() === "c1,c2,c3", "取首选 / 备选、强制项通过的前 3 个，按名次", ready);
  const i0 = ready.status === "ready" ? ready.items[0] : null;
  ok(!!i0 && i0.section === "PRIMARY" && i0.rank === 1 && i0.offeringName === "睡袋 A1" && i0.offeringSku === "SB-A1" && i0.scores.technical === 80 && i0.scores.commercial === 70 && i0.scores.reliability === 75 && i0.scores.importRisk === 60 && i0.scores.total === 72.5, "每个带名次、分区、型号与五项分数", i0);
  ok(ready.status === "ready" && ready.items[0].mandatoryZh === "强制项全部通过（3 条里 2 条有可采信的证据）" && ready.items[1].mandatoryZh === "没有强制项" && ready.items[2].mandatoryZh === "强制项全部通过（3 条都有可采信的证据）", "强制项一句话：几条、证据是否都可采信；没有强制项另说", ready);
  ok(ready.href === "/projects/intelligence/supply-chain?projectId=proj%201" && ready.hrefLabelZh === "查看完整排名 →" && ready.poolNoteZh === poolNoteZh(12), "带「查看完整排名」链接与候选池那一句");

  ok(poolNoteZh(7) === "系统已在批准分析后从内部供应商库建了候选池（7 家，未筛选，还要逐个评估）。" && poolNoteZh(0) === "系统已在批准分析后查过内部供应商库，没有找到可放进候选池的供应商。" && poolNoteZh(null) === null, "候选池那一句：有家数 / 0 家 / 没有自动建过");
  const none = buildRecommendations({ ...base, autoPoolCount: 7, ranked: [] });
  ok(none.status === "not_evaluated" && none.messageZh === RECOMMENDATION_TEXT.notEvaluated && none.messageZh === "还没有评估过的候选。请到供应链页逐个评估候选（逐条判定要求），评估完这里会列出推荐。" && none.poolNoteZh === poolNoteZh(7) && none.hrefLabelZh === "去供应链页评估 →", "没有评估：照实说，带候选池家数与「去供应链页评估」", none);
  const notApproved = buildRecommendations({ ...base, analysisApproved: false, ranked: [] });
  ok(notApproved.status === "not_evaluated" && notApproved.messageZh === "招标分析还没有批准。批准后系统会从内部供应商库建候选池；候选在供应链页评估完，这里会列出推荐。" && notApproved.href === null, "分析还没批准：不催人去评估、不给链接", notApproved);

  const failGate = (k: string, v: string) => ({ requirementKey: k, gateVerdict: v, evidenceAdmissible: false });
  const blocked = buildRecommendations({
    ...base,
    ranked: [
      row({ candidateId: "x1", section: "NOT_ELIGIBLE", rank: null, mandatoryGateResult: "FAIL", gateItems: [failGate("R-007", "FAIL"), failGate("R-002", "UNKNOWN")] }),
      row({ candidateId: "x2", section: "NEEDS_VERIFICATION", rank: null, mandatoryGateResult: "INCOMPLETE", gateItems: [failGate("R-007", "UNKNOWN"), { requirementKey: "R-001", gateVerdict: "PASS", evidenceAdmissible: true }] }),
    ],
  });
  ok(blocked.status === "none_passed" && blocked.messageZh === "评估过 2 个候选，都没有通过强制项。卡得最多的强制项：R-007（不满足 1 个、资料不足 1 个）、R-002（资料不足 1 个）。", "都没过强制项：写个数与卡得最多的强制项，不满足与资料不足分开数", blocked);
  const notRanked = buildRecommendations({
    ...base,
    ranked: [
      row({ candidateId: "y1", section: "NEEDS_VERIFICATION", rank: null, mandatoryGateResult: "PASS" }),
      row({ candidateId: "y2", section: "HIGH_RISK", rank: null, mandatoryGateResult: "PASS" }),
      row({ candidateId: "y3", section: "NOT_ELIGIBLE", rank: null, mandatoryGateResult: "FAIL", gateItems: [failGate("R-003", "FAIL")] }),
    ],
  });
  ok(notRanked.status === "not_ranked" && notRanked.messageZh === "评估过 3 个候选，暂时没有可推荐的：2 个通过了强制项，但还待核实、风险高或分数不全；1 个没有通过强制项。", "过了强制项但待核实 / 高风险：不说成「都没通过」", notRanked);
  const off = buildRecommendations({ ...base, intelEnabled: false, ranked: [] });
  ok(off.status === "intel_off" && off.messageZh === "供应商情报没有开启，暂时没有推荐型号。" && off.href === null && off.poolNoteZh === null, "供应商情报没开：照实说、不给链接");
  const err = buildRecommendations({ ...base, autoPoolCount: 3, ranked: null });
  ok(err.status === "unavailable" && err.messageZh === "推荐型号暂时读不出来，请稍后刷新。" && err.poolNoteZh === poolNoteZh(3), "取数出错：写暂时读不出来");
}

// ── 价格：可比授标 ──
{
  const g = (buyerName: string, n: number, currency = "CAD", scope = "sleeping bags") => ({ buyerName, comparableScopeKey: scope, currency, sampleSize: n, min: 100, max: 300, median: 200, from: "2024-01-05", to: "2025-06-30" });
  const okCol = buildAwardColumn({ schemaReady: true, projectBuyer: "city of fixture", groups: [g("City of Fixture", 3), g("Other Buyer", 5), g("City of Fixture", 4, "UNSPECIFIED", "tents")] });
  const g0 = okCol.status === "ok" ? okCol.groups[0] : null;
  ok(okCol.status === "ok" && okCol.groups.length === 1 && !!g0 && g0.sampleSize === 3 && g0.min === 100 && g0.median === 200 && g0.max === 300 && g0.currency === "CAD" && g0.scope === "sleeping bags" && g0.from === "2024-01-05" && g0.to === "2025-06-30", "同采购方（规整后大小写不同也算）、≥3 样本：列出区间、起止日期，原币；没写币种的分组不列", okCol);
  const a = (c: ReturnType<typeof buildAwardColumn>) => (c.status === "missing" ? c.messageZh : "");
  ok(a(buildAwardColumn({ schemaReady: false, projectBuyer: "X", groups: [] })) === "授标记录还没有接通。", "授标记录没接通");
  ok(a(buildAwardColumn({ schemaReady: true, projectBuyer: "X", groups: null })) === "授标记录暂时读不出来，请稍后刷新。" && AWARD_TEXT.unavailable.includes("暂时读不出来"), "授标记录取数出错：不说成没接通");
  ok(a(buildAwardColumn({ schemaReady: true, projectBuyer: "  ", groups: [g("X", 3)] })) === "项目没有采购方名称，没法比对。", "项目没有采购方名称");
  ok(a(buildAwardColumn({ schemaReady: true, projectBuyer: "Other Buyer", groups: [g("City of Fixture", 3)] })) === "同一采购方、同口径、同币种的授标（不含我方结果）不足 3 个，不做区间。", "没有同采购方的够数分组");
}

// ── 价格：市场价格基准 ──
const REAL_FX_NOTE = "基准价按来源原币呈现，未做汇率换算——换算与目标价测算请在报价引擎（Sunny 定价链）中以人工确认的汇率完成。";
{
  const bm = (i: number) => ({ productName: `睡袋 ${i}`, vendor: `厂商 ${i}`, priceRaw: `$${100 + i}`, currency: "USD", unit: "each", comparabilityZh: "x", sourceIndex: i });
  const m = buildMarketColumn({ status: "ran", benchmarks: Array.from({ length: 7 }, (_, i) => bm(i)), fxNoteZh: REAL_FX_NOTE });
  ok(m.status === "ok" && m.items.length === 5 && m.items[0].productName === "睡袋 0" && m.items[0].vendor === "厂商 0" && m.items[0].priceRaw === "$100" && m.items[0].currency === "USD" && m.items[0].unit === "each" && m.fxNoteZh === REAL_FX_NOTE, "已存的基准：列前 5 条（产品、来源方、原文价格、币种、单位）与换汇说明", m);
  const t = (v: unknown, readError = false) => { const c = buildMarketColumn(v, readError); return c.status === "missing" ? c.messageZh : ""; };
  ok(t({ status: "ran", benchmarks: [] }) === "已查询，没有找到可比的市场价格。" && t({ status: "unavailable" }) === "市场价格基准还没有接通。" && t({ status: "no_product" }) === "分析里没有可检索的产品名称。" && t(undefined) === "还没有做过外部情报检索（可在情报室发起）。" && t(null, true) === "市场价格基准暂时读不出来，请稍后刷新。", "五种缺项文案", MARKET_TEXT);
  const fb = buildMarketColumn({ status: "ran", benchmarks: [bm(1)] });
  ok(fb.status === "ok" && fb.fxNoteZh === "基准价按来源原币呈现，未做汇率换算。", "存的结果没有换汇说明时用固定一句");
}

// ── 价格：我方落地价 ──
const okSuggestion: CompareCostSuggestion = {
  status: "ok", landedCadTotal: 12345.6, quantityBasis: { kind: "first_tier", qty: 200 },
  breakdown: { goods: 10000, inland: null, freight: 1000, insurance: null, duty: 1345.6, clearance: null, feesIncludedInQuote: false },
  assumptions: ["汇率 1.35（手工）"], warnings: ["报价已过期 3 天"], inquiryId: "q", inquiryItemId: "qi", roundNumber: 2, supplierName: "供应商 B", laterUnselectedRounds: [],
};
{
  const l = buildLandedColumn(okSuggestion);
  ok(l.status === "ok" && l.landedCadTotal === 12345.6 && l.roundNumber === 2 && l.supplierName === "供应商 B" && l.taxNoteZh.startsWith("不含 GST/HST") && l.basisZh === "按询价单首档数量 200" && l.warnings.join() === "报价已过期 3 天", "选定报价：供应商、轮次、落地价、税务与数量口径、提醒", l);
  const m = (s: CompareCostSuggestion | null, enabled = true) => { const c = buildLandedColumn(s, enabled); return c.status === "missing" ? c.messageZh : ""; };
  ok(m({ status: "none_selected", messageZh: "" }) === "比价矩阵里还没有选定报价。" && m({ status: "unconvertible", reasons: [], inquiryId: "q", inquiryItemId: "qi", roundNumber: 1, supplierName: "B", laterUnselectedRounds: [] }) === "选定的报价换算不了落地价。" && m({ status: "unavailable", messageZh: "" }) === "我方落地价暂时读不出来，请稍后刷新。" && m(okSuggestion, false) === "我方落地价还没有接通。", "四种缺项文案（含比价矩阵成本来源开关关闭）", LANDED_TEXT);
}

// ── 整体：不合并、落地价按权限 ──
{
  const view = assembleSourcingSuggestions({
    recommendations: buildRecommendations({ ...base, ranked: [row({ candidateId: "c1" })] }),
    awards: buildAwardColumn({ schemaReady: true, projectBuyer: "B", groups: [{ buyerName: "B", comparableScopeKey: "s", currency: "CAD", sampleSize: 3, min: 1, max: 3, median: 2, from: null, to: null }] }),
    market: buildMarketColumn({ status: "ran", benchmarks: [{ productName: "p", vendor: "v", priceRaw: "$1", currency: "USD", unit: "each" }], fxNoteZh: REAL_FX_NOTE }),
    landed: buildLandedColumn(okSuggestion),
  });
  ok(view.prices.awards.status === "ok" && view.prices.market.status === "ok" && view.prices.landed?.status === "ok", "三栏都有数据");
  const noFinance = assembleSourcingSuggestions({ recommendations: buildRecommendations({ ...base, intelEnabled: false, ranked: [] }), awards: { status: "missing", messageZh: "a" }, market: { status: "missing", messageZh: "m" }, landed: null });
  ok(Object.keys(view).sort().join() === "noteZh,prices,recommendations" && Object.keys(view.prices).sort().join() === "awards,landed,market" && view.noteZh === SOURCING_PRICE_NOTE_ZH, "响应只有推荐、三栏与口径说明");
  ok(!("landed" in noFinance.prices), "没有财务查看权：响应里没有我方落地价这个键");
  // 逐层收集所有键：只许出现这些——没有任何「合并出来的数」的位置
  const keys = new Set<string>();
  const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  walk(view);
  const allowed = new Set(["recommendations", "status", "items", "href", "hrefLabelZh", "poolNoteZh", "candidateId", "supplierName", "offeringName", "offeringSku", "section", "rank", "scores", "technical", "commercial", "reliability", "importRisk", "total", "mandatoryZh", "prices", "awards", "groups", "scope", "currency", "sampleSize", "min", "median", "max", "from", "to", "market", "productName", "vendor", "priceRaw", "unit", "fxNoteZh", "landed", "roundNumber", "landedCadTotal", "basisZh", "taxNoteZh", "warnings", "noteZh", "messageZh"]);
  const extra = [...keys].filter((k) => !allowed.has(k));
  ok(extra.length === 0, "三栏都有数据时，响应的键只在白名单里（没有建议报价、目标价、毛利率、估值、我方报价）", extra);
  ok(![...keys].some((k) => /suggest|target|margin|estimat|ourBid|winningBid|valuation|bidPrice/i.test(k)), "没有任何键名像建议报价、目标价、毛利率、估值或我方报价", [...keys]);
}

// ── 源码断言 ──
{
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  const run = read("src/lib/tender-intel/auto-supplier-run.ts");
  ok(/createProjectSearchRun\(actor, \{ projectId: input\.projectId, allowLlm: false \}\)/.test(run), "自动建池：allowLlm: false（检索简报不调模型）");
  ok(/executeSupplierSearchRun\(actor, searchRunId, \{\s*adapters: \[\],\s*includeInternalPool: true,\s*internalPoolLimit: AUTO_POOL_INTERNAL_LIMIT,\s*finalize: true,\s*\}\)/.test(run), "自动建池：外部适配器为空，只跑内部来源，每个来源有上限");
  ok(/catch \(err\) \{\s*console\.warn/.test(run) && /return \{ created: false, reason: "FAILED" \}/.test(run), "自动建池：出错只记日志、不向上抛");
  ok(/failSearchRun\(actor, searchRunId/.test(run) && /status: \{ in: \["PLANNED", "RUNNING", "COMPLETED"\] \}/.test(run), "自动建池：执行出错标为失败；失败与取消的不算「已经有了」");
  ok(/sourceConfigJson: \{ path: \["canonicalAnalysisRunId"\], equals: analysisRunId \}/.test(run), "判重按需求来源在库里筛");
  ok(/isActiveOrgMember\(input\.userId, input\.orgId\)/.test(run) && /membership\?\.status === "active"/.test(run), "自动建池：触发人须是组织有效成员");
  const routeBase = "src/app/api/projects/[id]/tender-analysis/runs/[runId]/";
  for (const f of ["approve/route.ts", "requirements/[requirementId]/confirm/route.ts", "requirements/[requirementId]/reject/route.ts", "requirements/batch-confirm/route.ts"]) {
    const src = read(routeBase + f);
    ok(src.indexOf("maybeAutoSupplierRun(") > 0 && src.indexOf("maybeAutoSupplierRun(") < src.indexOf("await maybeAutoDraftRfq("), `${f}：在自动起草之前建候选池`);
  }
  ok(/if \(!result\.idempotent\) await maybeAutoSupplierRun/.test(read(routeBase + "approve/route.ts")), "重复批准（幂等）不建候选池");
  for (const f of ["src/lib/tender-intel/auto-supplier-run.ts", "src/lib/tender-intel/sourcing-suggestions.ts", "src/lib/tender-intel/sourcing-suggestions-pure.ts", "src/app/api/projects/[id]/tender-intel/sourcing/route.ts", "src/lib/tender-rfq/intel-recipients.ts"]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok(!/from ["'][^"']*(openai|anthropic|@ai-sdk|\/llm|\/ai\/)[^"']*["']|generateText\(|callStructured\(|researchMarketPricing\(|tavilySearch\(/.test(code), `${f} 没有模型调用、不重新检索`);
  }
  const svc = read("src/lib/tender-intel/sourcing-suggestions.ts");
  ok(/\.canReadAll;/.test(svc) && /if \(!canRead\) return null;/.test(svc) && /isPricingCompareSourceEnabledForOrg\(orgId\)/.test(svc), "落地价只在有财务查看权时取；比价矩阵成本来源开关关闭时写没接通");
  ok(/listAwardsForBuyer\(\{ orgId, buyerName: buyer \}\)/.test(svc) && /r\.projectId === null && \(!ownName \|\| r\.winnerNameNormalized !== ownName\)/.test(svc), "可比授标：按项目采购方在库里筛；剔除本组织项目回灌的与我方中标的");
  const route = read("src/app/api/projects/[id]/tender-intel/sourcing/route.ts");
  ok(/!isSuperAdmin\(access\.user\.role\) && !access\.orgRole/.test(route), "寻源建议接口：要求组织有效成员（平台超级管理员除外）");
  const card = read("src/components/tender-intel/sourcing-suggestions-card.tsx");
  ok(/state\.view\.noteZh/.test(card) && SOURCING_PRICE_NOTE_ZH === "三种价格口径不同，不合并成一个数；报价由人定。" && /SOURCING_CARD_ERROR_ZH = "寻源建议暂时读不出来，请稍后刷新。"/.test(card) && /res\.status === 404/.test(card), "卡：写明三种口径不合并、报价由人定；404 不显示；出错一句话");
  ok(/landed \? "sm:grid-cols-3" : "sm:grid-cols-2"/.test(card) && /import type \{[^}]*\} from "@\/lib\/tender-intel\/sourcing-suggestions-pure"/.test(card) && /SCORE_COMPONENT_LABELS\[k\]\.label/.test(card) && /key=\{r\.candidateId\}/.test(card), "卡：栏并排（窄屏上下排，没有落地价时两栏）；分数用评估页同一套名称；寻源模块只导入类型");
  const tab = read("src/components/project-detail/tabs/intel-tab.tsx");
  ok(tab.indexOf("<SourcingSuggestionsCard projectId={projectId} />") > tab.indexOf("<ProjectIntelSections") && tab.indexOf("<SourcingSuggestionsCard") < tab.indexOf("<OrgAwardIntelSlots"), "情报页签：卡在调查区块之后、组织授标槽位之上");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
