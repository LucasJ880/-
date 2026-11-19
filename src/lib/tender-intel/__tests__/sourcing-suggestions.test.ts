/**
 * CHAIN-2 寻源建议 — 开关 / 推荐型号 / 价格三栏 / 不合并 / 接线（纯函数 + 源码断言）
 * 运行：npx tsx src/lib/tender-intel/__tests__/sourcing-suggestions.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isAutoSupplierRunEnabledForOrgWithEnv } from "../sourcing-flags";
import {
  SOURCING_PRICE_NOTE_ZH,
  assembleSourcingSuggestions,
  buildAwardColumn,
  buildLandedColumn,
  buildMarketColumn,
  buildRecommendations,
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
  ok(on("1", undefined) && on(" TRUE ", "") && on("yes", "org_1, org_2"), "开关为真且白名单为空或含本组织 → 开");
  ok(!on("1", "org_2") && !on("1", undefined, ""), "白名单只含别的组织 / 没有组织 → 关");
}

// ── 推荐型号 ──
const gate = (pass: number, total: number) => Array.from({ length: total }, (_, i) => ({ requirementKey: `R-00${i + 1}`, gateVerdict: i < pass ? "PASS" : "UNKNOWN", evidenceAdmissible: i < pass }));
const row = (o: Partial<RankedCandidateInput> & { candidateId: string }): RankedCandidateInput => ({
  supplierId: `s_${o.candidateId}`, supplierName: `供应商 ${o.candidateId}`, offeringName: "睡袋 A1", offeringSku: "SB-A1", section: "PRIMARY", rank: 1, mandatoryGateResult: "PASS",
  scores: { technical: 80, commercial: 70, reliability: 75, importRisk: 60, total: 72.5 }, gateItems: gate(3, 3), ...o,
});
{
  const P = "proj 1";
  ok(supplyChainHref(P) === "/projects/intelligence/supply-chain?projectId=proj%201", "供应链页链接");
  const ready = buildRecommendations({
    projectId: P, intelEnabled: true, autoPoolCount: 12,
    ranked: [
      row({ candidateId: "c3", section: "BACKUP", rank: 3 }),
      row({ candidateId: "c1", section: "PRIMARY", rank: 1, gateItems: gate(2, 3) }),
      row({ candidateId: "c4", section: "NOT_ELIGIBLE", rank: null, mandatoryGateResult: "FAIL" }),
      row({ candidateId: "c2", section: "BACKUP", rank: 2 }),
      row({ candidateId: "c5", section: "BACKUP", rank: 4 }),
    ],
  });
  ok(ready.status === "ready" && ready.items.map((i) => i.supplierName).join() === "供应商 c1,供应商 c2,供应商 c3", "取主选 / 备选、强制闸通过的前 3 个，按名次", ready);
  ok(ready.status === "ready" && ready.items[0].mandatoryEvidence.withEvidence === 2 && ready.items[0].mandatoryEvidence.total === 3 && ready.items[0].section === "PRIMARY" && ready.items[0].scores.total === 72.5 && ready.items[0].offeringSku === "SB-A1", "每个带五项分数、型号与「x / y 条」证据");
  ok(ready.status === "ready" && ready.href === "/projects/intelligence/supply-chain?projectId=proj%201", "带去供应链页的链接");

  const none = buildRecommendations({ projectId: P, intelEnabled: true, autoPoolCount: 7, ranked: [] });
  ok(none.status === "not_evaluated" && none.messageZh === "还没有评估过的候选。系统已在批准分析后建了候选池（7 家），请在供应链页逐条判定要求后，这里会列出推荐。", "没有评估：照实说，提到自动建的候选池家数", none);
  const noneNoPool = buildRecommendations({ projectId: P, intelEnabled: true, autoPoolCount: null, ranked: [] });
  ok(noneNoPool.status === "not_evaluated" && noneNoPool.messageZh === "还没有评估过的候选。请在供应链页逐条判定要求后，这里会列出推荐。", "没有自动建过候选池：不提家数");
  const blocked = buildRecommendations({
    projectId: P, intelEnabled: true, autoPoolCount: null,
    ranked: [
      row({ candidateId: "x1", section: "NOT_ELIGIBLE", rank: null, mandatoryGateResult: "FAIL", gateItems: [{ requirementKey: "R-007", gateVerdict: "FAIL", evidenceAdmissible: false }, { requirementKey: "R-002", gateVerdict: "UNKNOWN", evidenceAdmissible: false }] }),
      row({ candidateId: "x2", section: "NEEDS_VERIFICATION", rank: null, mandatoryGateResult: "INCOMPLETE", gateItems: [{ requirementKey: "R-007", gateVerdict: "UNKNOWN", evidenceAdmissible: false }, { requirementKey: "R-001", gateVerdict: "PASS", evidenceAdmissible: true }] }),
    ],
  });
  ok(blocked.status === "none_passed" && blocked.messageZh === "评估过 2 个候选，都没有通过强制闸。卡得最多的要求：R-007、R-002。", "评估过但都没过闸：写个数与卡得最多的要求", blocked);
  const off = buildRecommendations({ projectId: P, intelEnabled: false, autoPoolCount: null, ranked: [] });
  ok(off.status === "intel_off" && off.messageZh === "供应商情报没有开启，暂时没有推荐型号。" && off.href === null, "供应商情报没开：照实说、不给链接");
  const err = buildRecommendations({ projectId: P, intelEnabled: true, autoPoolCount: null, ranked: null });
  ok(err.status === "unavailable" && err.messageZh.includes("暂时读不出来"), "取数出错：写暂时读不出来");
}

// ── 价格：可比授标 ──
{
  const g = (buyerName: string, n: number) => ({ buyerName, comparableScopeKey: "sleeping bags", currency: "CAD", sampleSize: n, min: 100, max: 300, median: 200, from: "2024-01-05", to: "2025-06-30" });
  const okCol = buildAwardColumn({ schemaReady: true, projectBuyer: "city of fixture", groups: [g("City of Fixture", 3), g("Other Buyer", 5)] });
  ok(okCol.status === "ok" && okCol.groups.length === 1 && okCol.groups[0].sampleSize === 3 && okCol.groups[0].min === 100 && okCol.groups[0].median === 200 && okCol.groups[0].max === 300 && okCol.groups[0].currency === "CAD", "同采购方（规整后大小写不同也算）、≥3 样本：列出区间，原币", okCol);
  const a = (c: ReturnType<typeof buildAwardColumn>) => (c.status === "missing" ? c.messageZh : "");
  ok(a(buildAwardColumn({ schemaReady: false, projectBuyer: "X", groups: [] })) === "授标记录还没有接通。", "授标记录没接通");
  ok(a(buildAwardColumn({ schemaReady: true, projectBuyer: "  ", groups: [g("X", 3)] })) === "项目没有采购方名称，没法比对。", "项目没有采购方名称");
  ok(a(buildAwardColumn({ schemaReady: true, projectBuyer: "Other Buyer", groups: [g("City of Fixture", 3)] })) === "同一采购方、同口径的授标不足 3 个，不做区间。", "没有同采购方的够数分组");
}

// ── 价格：市场价格基准 ──
{
  const bm = (i: number) => ({ productName: `睡袋 ${i}`, vendor: `厂商 ${i}`, priceRaw: `$${100 + i}`, currency: "USD", unit: "each", comparabilityZh: "x", sourceIndex: i });
  const m = buildMarketColumn({ status: "ran", benchmarks: Array.from({ length: 7 }, (_, i) => bm(i)), fxNoteZh: "按原币。" });
  ok(m.status === "ok" && m.items.length === 5 && m.items[0].productName === "睡袋 0" && m.items[0].priceRaw === "$100" && m.fxNoteZh === "按原币。", "已存的基准：列前 5 条与换汇说明", m);
  const t = (v: unknown) => { const c = buildMarketColumn(v); return c.status === "missing" ? c.messageZh : ""; };
  ok(t({ status: "ran", benchmarks: [] }) === "已查询，没有找到可比的市场价格。" && t({ status: "unavailable" }) === "市场价格基准还没有接通。" && t({ status: "no_product" }) === "分析里没有可检索的产品名称。" && t(undefined) === "还没有跑过外部情报。", "四种缺项文案");
}

// ── 价格：我方落地价 ──
{
  const l = buildLandedColumn({ status: "ok", landedCadTotal: 12345.6, supplierName: "供应商 B", roundNumber: 2 });
  ok(l.status === "ok" && l.landedCadTotal === 12345.6 && l.roundNumber === 2 && l.supplierName === "供应商 B", "选定报价：供应商、轮次与落地价");
  const m = (s: { status: string }) => { const c = buildLandedColumn(s); return c.status === "missing" ? c.messageZh : ""; };
  ok(m({ status: "none_selected" }) === "比价矩阵里还没有选定报价。" && m({ status: "unconvertible" }) === "选定的报价换算不了落地价。" && m({ status: "unavailable" }) === "我方落地价暂时读不出来。", "三种缺项文案");
}

// ── 整体：不合并、落地价按权限 ──
{
  const view = assembleSourcingSuggestions({
    recommendations: { status: "not_evaluated", messageZh: "x", href: "/h" },
    awards: { status: "ok", groups: [] },
    market: { status: "missing", messageZh: "m" },
    landed: { status: "ok", supplierName: "B", roundNumber: 1, landedCadTotal: 10 },
  });
  const noFinance = assembleSourcingSuggestions({ recommendations: { status: "intel_off", messageZh: "x", href: null }, awards: { status: "missing", messageZh: "a" }, market: { status: "missing", messageZh: "m" }, landed: null });
  ok(Object.keys(view).sort().join() === "noteZh,prices,recommendations" && Object.keys(view.prices).sort().join() === "awards,landed,market" && view.noteZh === SOURCING_PRICE_NOTE_ZH, "响应只有推荐、三栏与口径说明");
  ok(!("landed" in noFinance.prices), "没有财务查看权：响应里没有我方落地价这个键");
  const json = JSON.stringify(view);
  ok(!/suggest|target|建议报价|目标价|margin|毛利|estimatedValue|ourBidPrice|winningBidPrice|估值/i.test(json), "没有建议报价、目标价、毛利率、估值或我方报价的字段", json);
}

// ── 源码断言 ──
{
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  const run = read("src/lib/tender-intel/auto-supplier-run.ts");
  ok(/createProjectSearchRun\(actor, \{ projectId: input\.projectId, allowLlm: false \}\)/.test(run), "自动建池：allowLlm: false（检索简报不调模型）");
  ok(/executeSupplierSearchRun\(actor, searchRunId, \{ adapters: \[\], includeInternalPool: true, finalize: true \}\)/.test(run), "自动建池：外部适配器为空，只跑内部来源");
  ok(/catch \(err\) \{\s*console\.warn/.test(run) && /return \{ created: false, reason: "FAILED" \}/.test(run), "自动建池：出错只记日志、不向上抛");
  const base = "src/app/api/projects/[id]/tender-analysis/runs/[runId]/";
  for (const f of ["approve/route.ts", "requirements/[requirementId]/confirm/route.ts", "requirements/[requirementId]/reject/route.ts", "requirements/batch-confirm/route.ts"]) {
    const src = read(base + f);
    ok(src.indexOf("maybeAutoSupplierRun(") > 0 && src.indexOf("maybeAutoSupplierRun(") < src.indexOf("await maybeAutoDraftRfq("), `${f}：在自动起草之前建候选池`);
  }
  ok(/if \(!result\.idempotent\) await maybeAutoSupplierRun/.test(read(base + "approve/route.ts")), "重复批准（幂等）不建候选池");
  for (const f of ["src/lib/tender-intel/auto-supplier-run.ts", "src/lib/tender-intel/sourcing-suggestions.ts", "src/lib/tender-intel/sourcing-suggestions-pure.ts", "src/app/api/projects/[id]/tender-intel/sourcing/route.ts", "src/lib/tender-rfq/intel-recipients.ts"]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok(!/from ["'][^"']*(openai|anthropic|@ai-sdk|\/llm|\/ai\/)[^"']*["']|generateText\(|callStructured\(|researchMarketPricing\(|tavilySearch\(/.test(code), `${f} 没有模型调用、不重新检索`);
  }
  const svc = read("src/lib/tender-intel/sourcing-suggestions.ts");
  ok(/privilege\.canReadAll\s*\?/.test(svc) && /resolveFinancePrivilege\(user, orgId/.test(svc), "落地价只在有财务查看权时取");
  const card = read("src/components/tender-intel/sourcing-suggestions-card.tsx");
  ok(/state\.view\.noteZh/.test(card) && SOURCING_PRICE_NOTE_ZH === "三种价格口径不同，不合并成一个数；报价由人定。" && /寻源建议暂时读不出来/.test(card) && /res\.status === 404/.test(card), "卡：写明三种口径不合并、报价由人定；404 不显示；出错一句话");
  ok(/sm:grid-cols-3/.test(card) && /import type \{/.test(card), "卡：三栏并排（窄屏上下排）；只导入类型（客户端不带服务端代码）");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
