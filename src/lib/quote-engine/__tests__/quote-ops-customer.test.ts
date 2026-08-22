/**
 * Quote Operations Phase 2 · 客户报价（草稿生成 / 分组 / Optional / Allowance / Taxable / 税基 / 泄露门 / PDF 模板）
 * 运行：npx tsx src/lib/quote-engine/__tests__/quote-ops-customer.test.ts
 */
import { computeQuote } from "../calc";
import { demoSupplyInstall, demoStandingOffer } from "../templates";
import { computeTiers, computeUnitEconomics } from "../standing-offer";
import { generateCustomerDraftLines, customerHeaderSchema, customerTermsSchema, customerLineSchema, lineAmount, NEVER_CUSTOMER_VISIBLE_CATEGORIES } from "../customer-quote";
import { buildCustomerView, customerViewLeaks, customerViewUnexpectedKeys, type CustomerQuoteView } from "../customer-view";
import { buildCustomerQuotationHtml } from "../quotation-html";
import type { CostLineInput } from "../contract";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const toInputs = (seeds: Array<Record<string, unknown>>): CostLineInput[] =>
  seeds.map((s, i) => ({ id: `l${i}`, sortOrder: (s.sortOrder as number) ?? i, category: s.category as string, subcategory: (s.subcategory as string) ?? null, description: s.description as string, quantity: (s.quantity as number) ?? null, unit: (s.unit as string) ?? null, unitCost: (s.unitCost as number) ?? null, sourceCurrency: (s.sourceCurrency as string) ?? "CAD", fxRate: (s.fxRate as number) ?? null, calculationType: s.calculationType as string, calculationBase: (s.calculationBase as string) ?? null, rate: (s.rate as number) ?? null, duration: (s.duration as number) ?? null, included: (s.included as boolean) ?? true, supplierName: (s.supplierName as string) ?? null, notes: null }));

// ── 草稿生成（Supply + Install）──
const demo = demoSupplyInstall();
const calc = computeQuote({ quoteCurrency: "CAD", lines: toInputs(demo.lines as unknown as Array<Record<string, unknown>>), pricing: demo.pricing, engine: demo.engine });
ok(calc.ok, "DRAFT-00: demo A 计算成功", !calc.ok ? calc.errors : null);
if (calc.ok) {
  const draft = generateCustomerDraftLines({ calc, quoteType: "PROJECT_SUPPLY_INSTALL", productLabel: "replacement windows" });
  const sum = Math.round(draft.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  ok(sum === calc.sellingPrice, `DRAFT-01: 草稿行合计 = 卖价（${sum} vs ${calc.sellingPrice}）`);
  ok(draft.some((l) => /^Supply of/.test(l.item)) && draft.some((l) => l.item === "Installation") && draft.some((l) => l.item === "Delivery" && l.amount === 0), "DRAFT-02: 含 Supply / Installation / Delivery(Included) 行");
  const text = JSON.stringify(draft.map((l) => [l.item, l.description]));
  ok(!/commission|profit|supplier|landed|margin/i.test(text), "DRAFT-03: 客户行文字不含 Commission/Profit/Supplier/Margin");
  ok(draft.every((l) => !l.source?.categories?.some((c) => NEVER_CUSTOMER_VISIBLE_CATEGORIES.includes(c))), "DRAFT-04: 不可见类别（PM/佣金/利润…）不单列，只按比例摊入");
  ok(draft.every((l) => l.taxable && !l.optional && !l.allowance), "DRAFT-05: 草稿默认应税、非 optional、非 allowance");
  ok(draft.find((l) => /^Supply of/.test(l.item))!.amount > draft.find((l) => l.item === "Installation")!.amount, "DRAFT-06: 采购占比最大行金额最大（按成本占比摊分）");
}

// ── Standing Offer 草稿：按分级单价 ──
const so = demoStandingOffer();
const soCalc = computeQuote({ quoteCurrency: "CAD", lines: toInputs(so.lines as unknown as Array<Record<string, unknown>>), pricing: so.pricing, engine: so.engine });
ok(soCalc.ok, "DRAFT-07: demo B 计算成功", !soCalc.ok ? soCalc.errors : null);
if (soCalc.ok && so.engine.standingOffer) {
  const unit = computeUnitEconomics(so.engine.standingOffer, "CAD");
  const tiers = computeTiers({ tiers: so.tiers.map((t, i) => ({ ...t, id: `t${i}` })), unit, revenuePctTotal: soCalc.revenuePctTotal, revenueBasedProfitPct: 0, boxesPerContainer: so.engine.standingOffer.boxesPerContainer ?? 0, piecesPerBox: so.engine.standingOffer.piecesPerBox ?? 0 });
  const draft = generateCustomerDraftLines({ calc: soCalc, quoteType: "STANDING_OFFER", tiers });
  ok(draft.length === tiers.length && draft.every((l) => l.unit === "pc" && l.unitPrice != null && l.unitPrice > 0), `DRAFT-08: Standing Offer 草稿 = ${tiers.length} 个分级单价行`);
}

// ── 客户视图：分组 / Optional / Allowance / Taxable / 税基 ──
const quoteInput = {
  quoteNumber: "Q-2026-0001-TEST", title: null, name: "Strathcona Windows", currency: "CAD", version: 2, status: "approved", validUntil: new Date("2026-09-30"), quoteType: "PROJECT_SUPPLY_INSTALL",
  customerJson: { clientCompany: "City of Halifax", clientName: "Procurement Services", clientAddress: "1841 Argyle St, Halifax NS", contactName: "J. Smith", projectName: "Window Replacement", tenderNumber: "T-2026-118", preparedBy: "Lucas", quoteDate: "2026-08-21" },
  termsJson: { paymentTerms: "Net 30", delivery: "FOB site", leadTime: "10–12 weeks", warranty: "2 years", exclusions: ["Electrical work", "Asbestos abatement"], assumptions: ["Site access Mon–Fri"] },
  lineItems: [
    { itemName: "Supply of windows", specification: "Aluminum, Type A", unit: "lot", quantity: 1, unitPrice: 900, totalPrice: 900, isInternal: false, category: "product", section: "Section A — Base Work", optional: false, allowance: false, taxable: true, remarks: null, sortOrder: 10 },
    { itemName: "Electrical allowance", specification: null, unit: "lot", quantity: 1, unitPrice: 100, totalPrice: 100, isInternal: false, category: "product", section: "Section C — Allowances", optional: false, allowance: true, taxable: true, remarks: null, sortOrder: 30 },
    { itemName: "Permit fee (tax exempt)", specification: null, unit: "lot", quantity: 1, unitPrice: 50, totalPrice: 50, isInternal: false, category: "product", section: "Section A — Base Work", optional: false, allowance: false, taxable: false, remarks: null, sortOrder: 11 },
    { itemName: "Weekend installation", specification: null, unit: "lot", quantity: 1, unitPrice: 200, totalPrice: 200, isInternal: false, category: "product", section: "Section B — Optional", optional: true, allowance: false, taxable: true, remarks: null, sortOrder: 20 },
    { itemName: "INTERNAL cost memo", specification: "supplier 1400 CNY", unit: null, quantity: null, unitPrice: null, totalPrice: 999, isInternal: true, category: "internal", section: null, optional: false, allowance: false, taxable: true, remarks: null, sortOrder: 99 },
  ],
};
const view = buildCustomerView({ quote: quoteInput, calc: null, tax: { hstPct: 13 }, company: { name: "Sunny Shutter Inc", addressLines: ["680 Progress Ave, Unit 2", "Scarborough, ON M1H 3A5"], phone: "647-000-0000", email: "quotes@example.com", website: "sunnyshutter.ca", taxNumber: "123456789 RT0001" } });
ok(view.lines.length === 4 && !view.lines.some((l) => /INTERNAL/.test(l.item)), "VIEW-01: 内部行（isInternal）绝不进入客户视图");
ok(view.subtotal === 1050 && view.taxableSubtotal === 1000 && view.tax.hst === 130 && view.total === 1180, `VIEW-02: 小计 1050（含 allowance 100 + 免税 50）/ 应税小计 1000 / HST 130 / 合计 1180`, { subtotal: view.subtotal, taxable: view.taxableSubtotal, hst: view.tax.hst, total: view.total });
ok(view.optionalTotal === 200 && view.allowanceTotal === 100, "VIEW-03: Optional 200 不计入合计；Allowance 100 计入并单独汇总");
ok(view.sections.length === 3 && view.sections[0] === "Section A — Base Work", "VIEW-04: 分组按排序出现", view.sections);
ok(view.header.clientCompany === "City of Halifax" && view.header.revision === "V2" && view.terms.exclusions.length === 2 && view.company.name === "Sunny Shutter Inc" && view.validUntil === "2026-09-30", "VIEW-05: 抬头 / 条款 / 公司信息 / 有效期投影");
ok(customerViewLeaks(view).length === 0 && customerViewUnexpectedKeys(view).length === 0, "VIEW-06: 泄露门（键名模式 + 结构白名单）零命中", [customerViewLeaks(view), customerViewUnexpectedKeys(view)]);
const tainted = JSON.parse(JSON.stringify(view)) as CustomerQuoteView & Record<string, unknown>;
(tainted as Record<string, unknown>).supplierName = "Guangzhou Window Co";
(tainted.lines[0] as unknown as Record<string, unknown>).costPrice = 500;
(tainted.header as unknown as Record<string, unknown>).importId = "imp_1";
const leaks = [...customerViewLeaks(tainted), ...customerViewUnexpectedKeys(tainted)];
ok(leaks.some((l) => l.includes("supplierName")) && leaks.some((l) => l.includes("costPrice")) && leaks.some((l) => l.includes("importId")), "VIEW-07: 注入 supplierName / costPrice / importId → 泄露门命中（PDF 必须拒绝）", leaks);

// ── PDF 模板：只吃客户视图；无内部词 ──
const html = buildCustomerQuotationHtml(view, { logoDataUrl: "data:image/png;base64,AAAA", generatedAt: "2026-08-21T12:00:00.000Z" });
ok(html.includes("QUOTATION") && html.includes("Q-2026-0001-TEST") && html.includes("Sunny Shutter Inc") && html.includes("City of Halifax") && html.includes("$1,180.00") && html.includes("Optional Items") && html.includes("Electrical work"), "PDF-01: 模板含报价号 / 公司 / 客户 / 合计 / Optional / Exclusions");
const bodyOnly = html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/Business No\./g, "");
ok(!/supplier|commission|profit|margin|markup|landed|internal|cost/i.test(bodyOnly), "PDF-02: HTML 正文（剔除 CSS）不含 supplier/commission/profit/margin/markup/cost 等内部词");
ok(html.includes('<img src="data:image/png;base64,AAAA"') && html.includes("Tax exempt") && html.includes("Allowance"), "PDF-03: Logo 内联；免税 / Allowance 标签");
ok(!/<script/i.test(html) && html.includes("&lt;") === false, "PDF-04: 无脚本；无需转义的内容正常");
const xss = buildCustomerQuotationHtml({ ...view, header: { ...view.header, clientName: "<script>alert(1)</script>" } }, { logoDataUrl: null, generatedAt: "2026-08-21T12:00:00.000Z" });
ok(!xss.includes("<script>alert") && xss.includes("&lt;script&gt;"), "PDF-05: 客户字段 HTML 转义");

// ── schema 清洗 ──
ok(customerHeaderSchema.parse({ clientCompany: "  ACME  ", quoteDate: "2026-08-21" }).clientCompany === "ACME", "SCH-01: 抬头字段 trim");
ok(customerTermsSchema.parse({ exclusions: ["a", " b "] }).exclusions?.length === 2, "SCH-02: exclusions 数组");
const ln = customerLineSchema.parse({ item: "X", quantity: 2, unitPrice: 10.5 });
ok(lineAmount(ln) === 21 && ln.taxable === true && ln.optional === false, "SCH-03: 行金额 = 数量 × 单价；默认应税");
ok(lineAmount({ quantity: 2, unitPrice: 10, amount: 25 }) === 25, "SCH-04: 显式 amount 优先");

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
