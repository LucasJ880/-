/**
 * Quote Engine · 契约/安全探针（QE-01..12）：状态机 / 权限映射 / 客户视图零泄露 / 模板与 demo / 分析 / 结构守卫
 * 运行：npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeQuote } from "@/lib/quote-engine/calc";
import { analyzeQuote } from "@/lib/quote-engine/analyze";
import { buildCustomerView, customerViewLeaks, CUSTOMER_LINE_ALLOWED_KEYS, CUSTOMER_VIEW_ALLOWED_KEYS } from "@/lib/quote-engine/customer-view";
import { FROZEN_STATUSES, QUOTE_STATUSES, QUOTE_TRANSITIONS, COST_CATEGORIES } from "@/lib/quote-engine/contract";
import { resolveQuoteCapabilities } from "@/lib/quote-engine/access";
import { demoStandingOffer, demoSupplyInstall, templateStandingOfferLines, templateSupplyInstallLines } from "@/lib/quote-engine/templates";
import { computeTiers, computeUnitEconomics } from "@/lib/quote-engine/standing-offer";
import { COST_TO_BUDGET_CATEGORY, mapQuoteToBudgetLines } from "@/lib/quote-engine/service";
import { BUDGET_LINE_CATEGORIES } from "@/lib/project-finance/types";
import type { CostLineInput } from "@/lib/quote-engine/contract";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;
const toInputs = (seeds: ReturnType<typeof templateSupplyInstallLines>): CostLineInput[] => seeds.map((s, i) => ({ id: `d${i}`, sortOrder: s.sortOrder, category: s.category, subcategory: s.subcategory, description: s.description, quantity: s.quantity ?? null, unit: s.unit, unitCost: s.unitCost ?? null, sourceCurrency: s.sourceCurrency, fxRate: s.fxRate ?? null, calculationType: s.calculationType, calculationBase: s.calculationBase, rate: s.rate ?? null, duration: s.duration ?? null, included: s.included, supplierName: s.supplierName, notes: s.notes }));

console.log("Quote Engine 契约/安全探针");

// QE-01 状态机：approved 不可回 draft；终态无出边；冻结集
ok(QUOTE_TRANSITIONS.approved.includes("superseded") && QUOTE_TRANSITIONS.approved.includes("awarded") && !QUOTE_TRANSITIONS.approved.includes("draft") && QUOTE_TRANSITIONS.superseded.length === 0 && QUOTE_TRANSITIONS.awarded.length === 0 && QUOTE_TRANSITIONS.cancelled.length === 0 && FROZEN_STATUSES.includes("approved") && FROZEN_STATUSES.includes("cancelled") && QUOTE_STATUSES.length === 6, "QE-01: 状态机——approved 不可回 draft（只能修订），superseded/awarded/cancelled 终态，冻结集含 approved + cancelled（B4）");

// QE-02 权限映射
{
  const base = { user: { id: "u1", role: "member" }, project: { orgId: "o1", ownerId: "owner" }, orgRole: "org_member", projectRole: "project_viewer" } as never;
  const viewer = resolveQuoteCapabilities(base);
  const owner = resolveQuoteCapabilities({ ...base, project: { orgId: "o1", ownerId: "u1" } } as never);
  const admin = resolveQuoteCapabilities({ ...base, orgRole: "org_admin" } as never);
  ok(!viewer.canViewInternal && !viewer.canEdit && !viewer.canApprove && owner.privileged && owner.canApprove && admin.privileged, "QE-02: 普通成员默认看不到内部成本/不能编辑/不能批准；owner 与 org_admin 直通");
}

// QE-03 客户视图零泄露（白名单键 + 反例守卫）
{
  const dA = demoSupplyInstall();
  const calc = computeQuote({ quoteCurrency: "CAD", lines: toInputs(dA.lines), pricing: dA.pricing, engine: dA.engine });
  ok(calc.ok, "QE-03a: Demo A 可计算", calc.ok ? null : calc.errors);
  if (calc.ok) {
    const view = buildCustomerView({ quote: { quoteNumber: "Q-1", title: "Demo", name: null, currency: "CAD", version: 1, status: "draft", validUntil: null, quoteType: "PROJECT_SUPPLY_INSTALL", lineItems: [{ itemName: "internal", specification: null, unit: null, quantity: 1, unitPrice: 1, totalPrice: 1, isInternal: true, category: "product" }] }, calc, tax: dA.engine.tax });
    const leaks = customerViewLeaks(view);
    const keysOk = Object.keys(view).every((k) => CUSTOMER_VIEW_ALLOWED_KEYS.has(k)) && view.lines.every((l) => Object.keys(l).every((k) => CUSTOMER_LINE_ALLOWED_KEYS.has(k)));
    ok(leaks.length === 0 && keysOk && view.lines.length === 1 && view.lines[0]!.amount === calc.sellingPrice && !JSON.stringify(view).includes("Demo Supplier"), "QE-03b（反例守卫）: 客户视图只含白名单键；isInternal 行不出现；无供应商/成本/毛利/佣金字段；金额 = 售价", leaks);
    ok(customerViewLeaks({ lines: [{ supplierName: "x" }] }).length === 1 && customerViewLeaks({ total: 1, internalMargin: 2 }).length === 1, "QE-03c: 泄露自检能抓 supplier*/internal* 键");
    ok(near(view.total, calc.sellingPrice * 1.13) && view.tax.hst === calc.tax.hst, "QE-03d: 税与内部成本分离——客户可见小计 = 售价时，按客户小计重算的 HST 与引擎一致");
  }
}

// QE-04 模板 A/B 骨架 + Demo B = 回归算例 1/2 口径
{
  const a = templateSupplyInstallLines();
  const cats = new Set(a.map((l) => l.category));
  ok(a.length >= 25 && ["PROCUREMENT", "FREIGHT", "DUTY", "LABOUR", "EQUIPMENT", "PERMIT", "PROJECT_MANAGEMENT", "BOND", "FINANCING", "ADMIN", "COMMISSION", "CONTINGENCY"].every((c) => cats.has(c)) && a.every((l) => (COST_CATEGORIES as readonly string[]).includes(l.category)), "QE-04a: Template A 覆盖采购/物流/人工/设备/工程合规/项目管理/商务全部章节，类别合法");
  ok(templateStandingOfferLines().every((l) => l.calculationType === "PERCENT_OF_REVENUE"), "QE-04b: Template B 成本行骨架为收入基数（单位经济在 engine，分级在 tiers）");
  const dB = demoStandingOffer();
  const calc = computeQuote({ quoteCurrency: "CAD", lines: toInputs(dB.lines), pricing: dB.pricing, engine: dB.engine });
  ok(calc.ok && near(calc.baseCost, 51900) && near(calc.sellingPrice, 61785.71), `QE-04c（Demo B = 回归算例 1）: 基础成本 ${calc.ok ? calc.baseCost : "?"} → 售价 ${calc.ok ? calc.sellingPrice : "?"}`);
  const unit = computeUnitEconomics(dB.engine.standingOffer!, "CAD");
  const tiers = computeTiers({ tiers: dB.tiers.map((t, i) => ({ ...t, id: `t${i}`, rate: t.rate ?? null, maxQuantity: t.maxQuantity ?? null })), unit, revenuePctTotal: calc.ok ? calc.revenuePctTotal : 0, revenueBasedProfitPct: 5, boxesPerContainer: 27167, piecesPerBox: 50 });
  ok(unit.piecesPerContainer === 1358350 && tiers[1]!.containersMath === 2.7607 && tiers[1]!.containersProcurement === 3, "QE-04d（Demo B = 回归算例 2）: 1,358,350 件/柜；Level 2 2.7607 → 3 柜");
}

// QE-05 analyzeQuote：确定性 advisory，不改报价；缺项识别
{
  const dA = demoSupplyInstall();
  const calc = computeQuote({ quoteCurrency: "CAD", lines: toInputs(dA.lines.filter((l) => l.category !== "CONTINGENCY")), pricing: dA.pricing, engine: dA.engine });
  if (calc.ok) {
    const a = analyzeQuote({ quoteType: "PROJECT_SUPPLY_INSTALL", calc });
    ok(a.summary.some((s) => /Material represents/.test(s)) && a.missingCostItems.some((m) => /contingency/i.test(m)) && a.recommendations.some((r) => /Commission/.test(r)) && a.intelligence.recommendedBidRange === null, "QE-05: 分析输出 summary/missing(contingency)/recommendations(commission)，情报钩子为 null（不伪造）");
  } else ok(false, "QE-05: Demo A 计算失败", calc.errors);
}

// QE-06 Award → Budget 映射：类别全部落在 BUDGET_LINE_CATEGORIES；百分比类别带 basis
{
  ok((Object.values(COST_TO_BUDGET_CATEGORY) as string[]).every((c) => (BUDGET_LINE_CATEGORIES as readonly string[]).includes(c)) && COST_CATEGORIES.every((c) => c in COST_TO_BUDGET_CATEGORY), "QE-06a: 成本类别 → 预算类别映射全覆盖且目标合法（不建第二套预算类别）");
  const dA = demoSupplyInstall();
  const calc = computeQuote({ quoteCurrency: "CAD", lines: toInputs(dA.lines), pricing: dA.pricing, engine: dA.engine });
  if (calc.ok) {
    const lines = mapQuoteToBudgetLines(calc, "q1");
    const pctLines = lines.filter((l) => ["OVERHEAD", "CONTINGENCY", "PROFIT"].includes(l.category));
    ok(lines.every((l) => l.sourceReference === "quote:q1") && pctLines.every((l) => l.basis === "SELLING_PRICE" && l.basisAmount === calc.sellingPrice && l.percentage != null) && near(lines.reduce((s, l) => s + l.amount, 0), calc.sellingPrice, 0.05), "QE-06b: 预算行带来源引用；百分比类别带 basis/basisAmount/percentage（可还原）；合计 = 售价");
  }
}

// QE-07 结构守卫：路由全部过 requireQuoteAccess；flag 门；approve 级别；服务层禁 NaN 入库；无 eval
{
  const routes = ["route.ts", "[quoteId]/route.ts", "[quoteId]/status/route.ts", "[quoteId]/revise/route.ts", "[quoteId]/customer-view/route.ts", "[quoteId]/analyze/route.ts", "[quoteId]/award/route.ts", "[quoteId]/imports/route.ts", "[quoteId]/imports/[importId]/route.ts", "[quoteId]/customer-quote/route.ts", "[quoteId]/pdf/route.ts", "[quoteId]/select-bid/route.ts", "tender-bid/route.ts"].map((f) => code(`src/app/api/projects/[id]/quote-engine/${f}`));
  ok(routes.every((r) => r.includes("requireQuoteAccess(")), "QE-07a: 13 条路由（Phase 1 7 + Phase 2 6）全部经 requireQuoteAccess（租户 + 成员 + 细粒度权限）");
  const access = code("src/lib/quote-engine/access.ts");
  ok(access.includes("quoteEngineDisabledResponse") && access.includes("PROJECT_COST_READ") && access.includes("PROJECT_COST_WRITE") && access.includes("PROJECT_COST_REVIEW"), "QE-07b: flag 门 + cost:read/write/review 三级映射");
  const status = code("src/app/api/projects/[id]/quote-engine/[quoteId]/status/route.ts");
  ok(/to === "approved" \|\| to === "superseded" \|\| to === "awarded" \? "approve"/.test(status), "QE-07c: 批准/作废/award 需 approve 级");
  const svc = code("src/lib/quote-engine/service.ts");
  ok(svc.includes("assertFiniteDeep(summary)") && svc.includes("QUOTE_FROZEN") && svc.includes("sourceQuoteId: q.id") && !/\beval\(|new Function\(/.test(svc + code("src/lib/quote-engine/calc.ts")), "QE-07d: 快照禁 NaN/Infinity；冻结态拒改；修订链 sourceQuoteId；无 eval/new Function");
  const cv = code("src/app/api/projects/[id]/quote-engine/[quoteId]/customer-view/route.ts");
  ok(cv.includes("customerViewLeaks(view)") && cv.includes("status: 500"), "QE-07e: 客户视图端点服务端泄露自检（命中拒发）");
  const list = code("src/app/api/projects/[id]/quote-engine/route.ts");
  ok(/process\.env\.NODE_ENV === "production" \? null : \(body\.demo/.test(list), "QE-07f: demo 种子在生产环境禁用");
}

// QE-08 入口：投标 tab 引擎置顶 + legacy 折叠（flag OFF 回落原样）；工作台报价与成本卡
{
  const area = readFileSync(join(process.cwd(), "src/components/quote-engine/bid-quote-area.tsx"), "utf-8");
  const bid = readFileSync(join(process.cwd(), "src/components/project-detail/tabs/bid-tab.tsx"), "utf-8");
  const wb = readFileSync(join(process.cwd(), "src/components/project-detail/tabs/workbench-tab.tsx"), "utf-8");
  ok(bid.includes("<BidQuoteArea") && !bid.includes("<ProjectQuoteSection") && area.includes('data-testid="legacy-quote-collapsed"') && area.includes("if (!data) return <ProjectQuoteSection"), "QE-08a: 投标 tab 引擎区块置顶、legacy 折叠；引擎未启用时回落为原 legacy 区块");
  ok(wb.includes("<QuoteBudgetCard") && readFileSync(join(process.cwd(), "src/components/quote-engine/quote-budget-card.tsx"), "utf-8").includes("已批准 / Awarded"), "QE-08b: 工作台「报价与成本」卡（当前/已批准/版本/Bid/成本/毛利率/状态）");
}

// QE-09（B5）：客户视图税按客户可见小计重算——售价 1000 / 公开行 900 / HST 13% → 117 / 1017，不是 130
{
  const dA = demoSupplyInstall();
  const calc = computeQuote({ quoteCurrency: "CAD", lines: [{ id: "m", sortOrder: 1, category: "MATERIAL", description: "m", quantity: null, unitCost: 1000, sourceCurrency: "CAD", fxRate: null, calculationType: "FIXED", calculationBase: null, rate: null, duration: null, included: true }], pricing: { method: "MARKUP_ON_COST", rate: 0 }, engine: { tax: { hstPct: 13 } } });
  if (calc.ok) {
    const view = buildCustomerView({ quote: { quoteNumber: null, title: "t", name: null, currency: "CAD", version: 1, status: "draft", validUntil: null, quoteType: "PROJECT_SUPPLY_INSTALL", lineItems: [{ itemName: "public", specification: null, unit: "lot", quantity: 1, unitPrice: 900, totalPrice: 900, isInternal: false, category: "product" }] }, calc, tax: { hstPct: 13 } });
    ok(calc.sellingPrice === 1000 && view.subtotal === 900 && view.tax.hst === 117 && view.total === 1017 && calc.tax.hst === 130, "QE-09: 引擎售价 1000（引擎税 130）但客户可见小计 900 → 客户税 117 / 合计 1017（不复用引擎税额）");
  } else ok(false, "QE-09: calc 失败", calc.errors);
  void dA;
}
// QE-10（B2/B3 结构守卫）：award 原子事务 + 显式双路径 + 阻断审计；修订谱系根 FOR UPDATE
{
  const svc = code("src/lib/quote-engine/service.ts");
  ok(/await createBudget\(\{ tx,/.test(svc) && /tx\.projectQuote\.updateMany\(\{ where: \{ id: q\.id, status: "approved" \}, data: \{ status: "awarded"/.test(svc), "QE-10a（B2）: 预算版本创建与 quote→awarded 在同一事务（updateMany 条件 status=approved 防并发双 award）");
  ok(svc.includes('QUOTE_AWARD_BLOCKED: "quote_award_blocked"') && /mode === "without_budget"/.test(svc) && /BUDGET_CREATION_FAILED/.test(svc) && /AWARD_BLOCKED/.test(svc) && !/createBudget: boolean/.test(svc), "QE-10b（B2）: 未启用/失败 → 抛错 + quote_award_blocked 审计；without_budget 为独立显式路径；createBudget=true 重载语义已移除");
  ok(/FOR UPDATE/.test(svc) && /collectLineage\(lineageRoot, input\.projectId, tx\)/.test(svc) && /tx\.projectQuote\.aggregate\(\{ where: \{ id: \{ in: lineageIds \} \}, _max: \{ version: true \} \}\)/.test(svc), "QE-10c（B3）: 修订在事务内对谱系根 FOR UPDATE 加锁后重算 max version");
  const route = code("src/app/api/projects/[id]/quote-engine/[quoteId]/award/route.ts");
  ok(/mode === "without_budget" \? "without_budget" : "with_budget"/.test(route), "QE-10d: award 路由显式 mode（默认 with_budget）");
  const cv = code("src/lib/quote-engine/customer-view.ts");
  ok(cv.includes("computeTax(taxableSubtotal, input.tax ?? null)") && !cv.includes("input.calc.tax.hst"), "QE-10e（B5 反例守卫）: 客户视图不再复用引擎税额");
  const so = code("src/lib/quote-engine/standing-offer.ts");
  ok(/SO_FX_REQUIRED/.test(so) && /input\.unit\.exact\.landedPerPiece/.test(so) && !/so\.fxRate \?\? 1/.test(so), "QE-10f（B1/B6 反例守卫）: 无 `fxRate ?? 1` 默认；分级用 exact 单件成本");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
