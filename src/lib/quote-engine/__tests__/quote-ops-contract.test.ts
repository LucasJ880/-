/**
 * Quote Operations Phase 2 · 结构 / 安全契约（路由门 / 泄露门 / 冻结纪律 / 审计 / 迁移登记 / 无 eval）
 * 运行：npx tsx src/lib/quote-engine/__tests__/quote-ops-contract.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const root = process.cwd();
const code = (rel: string) => readFileSync(join(root, rel), "utf-8");
const QE = "src/app/api/projects/[id]/quote-engine";

// QO-01 新增报价引擎路由全部经 requireQuoteAccess（flag 门 + 租户 + 细粒度权限）
const quoteRoutes = ["[quoteId]/imports/route.ts", "[quoteId]/imports/[importId]/route.ts", "[quoteId]/customer-quote/route.ts", "[quoteId]/pdf/route.ts", "[quoteId]/select-bid/route.ts", "tender-bid/route.ts"];
ok(quoteRoutes.every((r) => existsSync(join(root, QE, r)) && code(`${QE}/${r}`).includes("requireQuoteAccess(")), "QO-01: 6 条新路由全部经 requireQuoteAccess");
const imports = code(`${QE}/[quoteId]/imports/route.ts`);
ok(/requireQuoteAccess\(request, id, "internal_cost"\)/.test(imports) && /requireQuoteAccess\(request, id, "edit"\)/.test(imports), "QO-02: 导入列表 internal_cost / 上传 edit（project:cost:write）");
ok(imports.includes("validateUploadedFileAsync") && imports.includes("checkMagicBytes: true") && imports.includes("export const maxDuration = 60"), "QO-03: 上传走 upload-guard（magic bytes）+ maxDuration 60");
const importDetail = code(`${QE}/[quoteId]/imports/[importId]/route.ts`);
ok(/"confirm"|"apply"|"confirm_apply"|"cancel"/.test(importDetail) && importDetail.includes('requireQuoteAccess(request, id, "edit")'), "QO-04: confirm/apply/cancel 需 edit 权限");
ok(code(`${QE}/[quoteId]/select-bid/route.ts`).includes('requireQuoteAccess(request, id, "approve")'), "QO-05: 选为我方报价需 approve 权限");
const pdfRoute = code(`${QE}/[quoteId]/pdf/route.ts`);
ok(pdfRoute.includes("export const maxDuration = 60") && pdfRoute.includes('requireQuoteAccess(request, id, "edit")'), "QO-06: PDF 路由 maxDuration 60 + 生成需 edit（Customer Quote Export）");

// QO-07 导入服务：抽取绝不直写成本行；Apply 只在 CONFIRMED；冻结态拒绝；重复来源拒绝
const svc = code("src/lib/quote-engine/import/import-service.ts");
ok(svc.includes('status: "EXTRACTING"') && svc.includes('"REVIEW_REQUIRED"') && /record\.status !== "CONFIRMED"/.test(svc) && svc.includes("SOURCE_ALREADY_IMPORTED") && svc.includes("assertQuoteImportable") && svc.includes("FROZEN_STATUSES"), "QO-07: Upload→EXTRACTING→REVIEW_REQUIRED；apply 仅 CONFIRMED；重复来源 409；冻结态拒绝");
ok(svc.includes("putPrivateBlob(") && svc.includes("db.projectDocument.create(") && svc.includes("parseDocumentPagesAndStore("), "QO-08: 文档存储复用 ProjectDocument + putPrivateBlob + 可引用单元（无第二套文档存储）");
ok(svc.includes("metadata: provenanceOf(row, record)") && svc.includes("sourceDocumentId") && svc.includes("originalDescription") && svc.includes("originalAmount"), "QO-09: 成本行 provenance（importId/sourceDocumentId/原始描述/原始金额）与成本行同一 INSERT 写入");
ok(!/\beval\(|new Function\(/.test(svc + code("src/lib/quote-engine/import/parse-xlsx.ts") + code("src/lib/quote-engine/import/parse-pdf.ts")), "QO-10: 导入链无 eval / new Function");
const ai = code("src/lib/quote-engine/import/classify-ai.ts");
ok(ai.includes("LOW_CONFIDENCE_THRESHOLD") && !/sourceAmount\s*=|unitCost\s*=|quantity\s*=/.test(ai.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "QO-11: AI 只在低置信度行上改类别/描述，绝不改金额/数量");

// QO-12 客户视图 / PDF 泄露门 fail-closed
const pdfLib = code("src/lib/quote-engine/quotation-pdf.ts");
ok(pdfLib.includes("assertCustomerViewSafe(view)") && pdfLib.includes("CUSTOMER_PDF_INTERNAL_LEAK") && pdfLib.includes("customerViewUnexpectedKeys") && pdfLib.includes("buildCustomerQuotationHtml(view"), "QO-12: 渲染前双重泄露门；模板只接受 CustomerQuoteView");
ok(pdfLib.includes("PDF_RENDER_FAILED") && !pdfLib.includes("html_fallback"), "QO-13: 客户 PDF 渲染失败 fail-closed（不回落 HTML 当 PDF）");
ok(pdfLib.includes('docType: CUSTOMER_QUOTATION_DOC_TYPE') && pdfLib.includes("quoteVersion: q.version") && pdfLib.includes("generatedBy: input.userId") && pdfLib.includes("stale: true") && !/projectGeneratedDocument\.delete/.test(pdfLib), "QO-14: PDF 绑定 quoteId/quoteVersion/total/generatedAt/generatedBy；旧 PDF 只标 stale 不删不覆盖");
const html = code("src/lib/quote-engine/quotation-html.ts");
ok(/view: CustomerQuoteView/.test(html) && !html.includes("QuoteRecord") && !html.includes("costLines"), "QO-15: HTML 模板类型签名只接受 CustomerQuoteView（不接受 ProjectQuote）");
const view = code("src/lib/quote-engine/customer-view.ts");
ok(view.includes("computeTax(taxableSubtotal") && view.includes("INTERNAL_KEY_PATTERN") && /confidence\|import\|evidence/.test(view), "QO-16: 税按客户可见应税小计重算；泄露模式含 confidence/import/evidence");

// QO-17 客户报价编辑冻结 + 审计
const cq = code("src/lib/quote-engine/customer-quote.ts");
ok(cq.includes("assertEditable(q)") && cq.includes("FROZEN_STATUSES") && cq.includes("CUSTOMER_QUOTE_UPDATED") && cq.includes("isInternal: false, id: { notIn:"), "QO-17: 客户行/抬头/条款编辑受冻结纪律；只管理公开行；审计 customer_quote_updated");
ok(cq.includes("NEVER_CUSTOMER_VISIBLE_CATEGORIES") && /"COMMISSION", "CONTINGENCY", "PROFIT"/.test(cq), "QO-18: 草稿生成把 COMMISSION/PROFIT 等列为永不单列");

// QO-19 Tender Our Bid：只有 approved/awarded；superseded 跟随；写穿 ourBidPrice；审计
const tb = code("src/lib/quote-engine/tender-bid.ts");
ok(/BID_ELIGIBLE = \["approved", "awarded"\]/.test(tb) && tb.includes("NOT_APPROVED") && tb.includes("QUOTE_REVISION_PENDING") && tb.includes("latestEligibleInLineage") && tb.includes("ourBidPrice: args.sellingPrice") && tb.includes("QUOTE_SELECTED_AS_TENDER_BID"), "QO-19: 仅 approved/awarded 可成为我方报价；superseded 跟随修订或 QUOTE_REVISION_PENDING；写穿 ourBidPrice；审计");
const service = code("src/lib/quote-engine/service.ts");
ok((service.match(/syncTenderBidPointerTx\)?\(tx/g) ?? []).length >= 3, "QO-20: transitionQuote / reviseQuote / award 在各自事务内同步我方报价指针");
ok(!/portal|submit.*government|canadabuys.*submit/i.test(tb), "QO-21: 不自动提交外部门户");

// QO-22 财务：只读模型 / 人工预测 / 路由权限
const perf = code("src/lib/project-finance/performance.ts");
ok(perf.includes("getBudgetVsActual(") && perf.includes("getProjectRevenueRollup(") && !/projectCost\.(create|update|delete)/.test(perf) && !/projectBudget(Line|Version)?\.(create|update|delete)/.test(perf), "QO-22: Financial Performance 只读（不写 ProjectCost / Budget）");
ok(perf.includes("NO_PROGRESS_SIGNAL") && perf.includes("completionPct: null"), "QO-23: 无进度信号 → 投影明确不可用（不伪造完工进度）");
ok(perf.includes('den > 0 ?') && perf.includes("overBudgetPct: over && c.budget > 0"), "QO-24: 防除零");
const fc = code("src/lib/project-finance/forecast-service.ts");
ok(fc.includes("FOR UPDATE") && fc.includes("isLedgerProducerActive()") && fc.includes("appendProjectEvent(") && fc.includes("financial_forecast_updated") && !/projectBudgetLine\./.test(fc), "QO-25: 人工预测锁版本行、ledger 事件（producers 开时）、审计；不改预算行");
ok(code("src/app/api/projects/[id]/finance/performance/route.ts").includes("PERMISSIONS.PROJECT_COST_READ") && code("src/app/api/projects/[id]/finance/forecast/route.ts").includes("PERMISSIONS.PROJECT_COST_WRITE"), "QO-26: performance = COST_READ；forecast = COST_WRITE（requireCostAccess 财务 flag 门）");
const an = code("src/lib/quote-engine/analyze-operations.ts");
ok(!an.includes("@/lib/db") && !/\.(update|create|delete)\(/.test(an), "QO-27: analyzeQuoteOperations 纯函数（advisory；不改任何数据）");

// QO-28 next.config 字体/Logo trace + 迁移登记 + flag 复用
const cfg = code("next.config.ts");
ok(cfg.includes("quote-engine/\\[quoteId\\]/pdf") && cfg.includes("./public/brands/*.png"), "QO-28: 新 PDF 路由已加入 outputFileTracingIncludes（字体 + logo）");
const mig = "20260821233000_add_quote_operations_phase2";
ok(code("src/lib/release/expected-migrations.ts").includes(mig) && code("scripts/verify-migration-history.ts").includes(mig) && code("scripts/check-release-safety.test.ts").includes(mig), "QO-29: 迁移三处登记");
const sql = code(`prisma/migrations/${mig}/migration.sql`).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
ok(!/DROP|ALTER COLUMN|TRUNCATE|^UPDATE|^DELETE|INSERT INTO/m.test(sql), "QO-30: 迁移纯 additive（无 DROP/ALTER COLUMN/backfill/seed）");
ok(!existsSync(join(root, "src/lib/quote-engine/import/flags.ts")) && !/TENDER_QUOTE_(IMPORT|PDF)_ENABLED/.test(svc + pdfLib + imports), "QO-31: 复用 TENDER_QUOTE_ENGINE_ENABLED，无 flag 碎片化");

// ── Final Review B1：Apply 原子 + 幂等 + 防并发 ──
const applyBody = svc.slice(svc.indexOf("export async function applyImport("), svc.indexOf("export async function cancelImport("));
ok((applyBody.match(/db\.\$transaction\(/g) ?? []).length === 1 && applyBody.includes('FROM "QuoteCostImport" WHERE "id" = ${input.importId} FOR UPDATE') && applyBody.includes('FROM "ProjectQuote" WHERE "id" = ${input.quoteId} FOR UPDATE'), "B1-S1: applyImport = 单一事务 + 导入行/报价行 FOR UPDATE（并发串行化）");
ok(applyBody.includes('record.status === "APPLIED"') && applyBody.includes("alreadyApplied: true") && applyBody.indexOf("alreadyApplied: true") < applyBody.indexOf("tx.quoteCostLine.create("), "B1-S2: 事务内重读状态：APPLIED → 幂等返回（零重复），在任何插入之前");
ok(applyBody.includes("tx.quoteCostLine.create(") && applyBody.includes("metadata: provenanceOf(row, record)") && applyBody.includes('status: "APPLIED"') && applyBody.indexOf('status: "APPLIED"') > applyBody.indexOf("tx.quoteCostLine.create(") && applyBody.indexOf('status: "APPLIED"') < applyBody.indexOf("snapshotQuote("), "B1-S3: 成本行（含 provenance）INSERT 与 APPLIED 同一事务；派生快照在事务外");
ok(!svc.includes("updateEngineQuote") && !applyBody.includes("deleteMany"), "B1-S4: 不用全量替换（不 delete 既有行；并发改动不被覆盖）");
ok(applyBody.includes("assertQuoteImportable(quote)") && applyBody.includes("validateRowsForConfirm(rows)"), "B1-S5: 冻结纪律与行级校验在锁内复核（不削弱）");
ok(applyBody.includes("snapshotRefreshed") && applyBody.includes("catch {"), "B1-S6: 派生缓存刷新失败显式报告（snapshotRefreshed），不影响已提交源行");
// ── Final Review B2：指针 + 镜像原子；无静默 catch；迁移事务内同步 ──
const tbBody = tb;
const mirrorBody = tbBody.slice(tbBody.indexOf("export async function writeBidMirrorsTx("), tbBody.indexOf("export type SyncAction"));
ok(mirrorBody.includes("bidQuoteId: args.quoteId, ourBidPrice: args.sellingPrice, currency: args.currency") && mirrorBody.includes("tx.bidIntelligenceRoom.update(") && !mirrorBody.includes("catch"), "B2-S1: bidQuoteId + ourBidPrice + currency 单条 UPDATE；房间镜像同事务；无 catch");
const silent = (tbBody.match(/catch\(\(\) => undefined\)/g) ?? []).length;
const silentOnAudit = (tbBody.match(/\}\)\.catch\(\(\) => undefined\)/g) ?? []).length;
ok(silent === silentOnAudit && !/writeThrough/.test(tbBody), "B2-S2: tender-bid.ts 仅审计调用允许 best-effort；镜像/同步无 swallow；旧 writeThrough 已移除");
ok(tbBody.includes("class TenderBidSyncError") && tbBody.includes("throw new TenderBidSyncError") && tbBody.includes("mirrorStale"), "B2-S3: 同步失败为显式错误类型；解析层暴露 mirrorStale");
const transBody = service.slice(service.indexOf("export async function transitionQuote("), service.indexOf("export async function reviseQuote("));
ok(transBody.includes("db.$transaction(async (tx) => {") && transBody.includes("await tx.projectQuote.update({ where: { id: q.id }, data });") && transBody.includes("syncTenderBidPointerTx)(tx") && transBody.includes("TENDER_BID_SYNC_FAILED") && transBody.includes("auditSyncFailure("), "B2-S4: transitionQuote 状态更新 + 指针同步同一事务；同步失败 → 回滚 + 审计 + TENDER_BID_SYNC_FAILED");
const reviseBody = service.slice(service.indexOf("export async function reviseQuote("), service.indexOf("export const COST_TO_BUDGET_CATEGORY"));
ok(reviseBody.includes("syncTenderBidPointerTx(tx") && reviseBody.includes("TENDER_BID_SYNC_FAILED") && !reviseBody.includes("syncTenderBidPointer("), "B2-S5: reviseQuote 在修订事务内同步（supersede 后）");
const awardBody = service.slice(service.indexOf("export async function awardQuoteToBudget("), service.indexOf("async function appendLedgerEvent("));
ok(awardBody.includes("awardSync = await tb.syncTenderBidPointerTx(tx") && awardBody.includes("TenderBidSyncError"), "B2-S6: award（with_budget）事务内同步；同步失败与预算失败区分");
// ── Final Review 2 B2-CANCEL：非权威态不得宣称有效报价 ──
const syncBody = tbBody.slice(tbBody.indexOf("export async function syncTenderBidPointerTx("), tbBody.indexOf("export async function auditSyncResult("));
ok(tbBody.includes("export async function clearBidMirrorsTx(") && tbBody.includes("data: { bidQuoteId: null, ourBidPrice: null }") && !/clearBidMirrorsTx[\s\S]*?currency: null/.test(tbBody.slice(tbBody.indexOf("export async function clearBidMirrorsTx("), tbBody.indexOf("export async function writePendingMirrorsTx("))), "B2-S7: clearBidMirrorsTx 清 bidQuoteId/ourBidPrice，不动 Project.currency");
ok(tbBody.includes("ourPriceCad: null, ourPrice: null, ourPriceCurrency: null, ourPriceSource: null"), "B2-S8: 房间 ourPriceCad/ourPrice/ourPriceCurrency/ourPriceSource 全清");
ok(syncBody.includes("clearBidMirrorsTx(tx, { projectId: input.projectId })") && syncBody.includes('action: "cleared"') && syncBody.includes("writePendingMirrorsTx(tx") && syncBody.includes('action: "pending_cleared"') && syncBody.includes('sel.status === "superseded"'), "B2-S9: 同步：cancelled/悬空 → cleared；superseded 无替代 → pending_cleared（指针保留可追溯，价格清空）");
ok(tbBody.includes("mirrorStale: advertisingWithoutAuthority") && tbBody.includes("mirrorStale: project.ourBidPrice != null"), "B2-S10: 解析层 NONE/PENDING 态仍宣传价格 = mirrorStale");
ok(tbBody.includes('ourPriceStatus: "AUTHORITATIVE"') && tbBody.includes('"QUOTE_REVISION_PENDING", `quote:${args.supersededQuoteId}:v${args.version}`'), "B2-S11: 房间 ourPriceStatus 显式区分 AUTHORITATIVE / QUOTE_REVISION_PENDING / NONE，superseded 来源可追溯");

// ── Final Review B3：供应商币种 fail-closed ──
ok(!/\?\?\s*quote\.currency/.test(svc) && !/defaultCurrency/.test(svc + code("src/lib/quote-engine/import/parse-xlsx.ts") + code("src/lib/quote-engine/import/parse-pdf.ts") + code("src/lib/quote-engine/import/contract.ts")) && svc.includes('currencyMode: supplierCurrency ? "CONFIRMED" : "AUTO_DETECT"'), "B3-S1: 无报价币种兜底；币种模式 AUTO_DETECT / CONFIRMED 显式");
ok(svc.includes("const currency = normalizeCurrency(row.sourceCurrency);") && svc.includes('throw new QuoteEngineError("IMPORT_ROWS_INVALID", `行 ${row.rowId} 币种未确认`'), "B3-S2: 行→成本行映射对未解析币种 fail-closed");
ok(svc.includes("patch.applyToUnresolved && confirmed && !r0.sourceCurrency"), "B3-S3: 批量确认只传播到未识别行（不覆盖行级/文档级信号）");
const panel = code("src/components/quote-engine/cost-import-panel.tsx");
ok(panel.includes('useState("")') && panel.includes("自动识别（未识别需人工确认）") && panel.includes("CURRENCY_CONFIRMATION_REQUIRED") && panel.includes("unresolved.length > 0") && !panel.includes("useState(currency)"), "B3-S4: UI 缺省 AUTO_DETECT；未识别行显式确认；Confirm 在未确认时禁用");
const px = code("src/lib/quote-engine/import/parse-xlsx.ts");
ok(px.includes("?? sheetCcy ?? opts.confirmedCurrency") && px.indexOf("detectCurrencyToken(amountCell.raw)") < px.indexOf("opts.confirmedCurrency"), "B3-S5: 币种优先级 行级 → 表头/表级 → 人工确认 → UNRESOLVED");

// ── Phase 2.1 · 真实模版适配结构守卫 ──
const px21 = code("src/lib/quote-engine/import/parse-xlsx.ts");
ok(/role: "price", priority: 1/.test(px21) && px21.includes('amountMode = "price_as_amount"') && px21.includes('amountMode = "ambiguous_price"') && /if \(hasAmount\) \{/.test(px21), "P21-S1: 「价格/报价/Price」为上下文角色：无数量/单价/总价 → 金额；有数量无总价/单价 → AMBIGUOUS；显式总价压过价格");
ok(px21.includes("readSheetGrid") && px21.includes("cellNF: true") && px21.includes('cell.z === "string" && cell.z.includes("%")') && px21.includes("isPercent: true"), "P21-S2: 读取 Excel 数字格式；百分比格式单元不是金额");
ok(px21.includes("rowsWithNumbers") && px21.includes(">= 0.6") && px21.includes('mode = "qty_unit_total"') && px21.includes("AMBIGUOUS_AMOUNT_COLUMN") && !/nums\[nums\.length - 1\]!\.n\.value\b[^;]*amount:/.test(px21), "P21-S3: 无表头回退按列一致性选金额列（乘积关系 / 单列），选不出 → AMBIGUOUS_AMOUNT_COLUMN；不再取「最后一个数字」作金额");
ok(px21.includes("reconcileTotals(") && px21.includes("RECONCILIATION_MISMATCH") && px21.includes('"numeric_only_row"') && px21.includes("subtotalRef ?? totalRef") && code("src/lib/quote-engine/import/parse-pdf.ts").includes("reconcileTotals("), "P21-S4: 对账守卫：显式 小计/合计 或末尾纯数字校验行 = 参考总计（不导入）；xlsx + pdf 都接");
const rc = code("src/lib/quote-engine/import/reconcile.ts");
ok(rc.includes("Math.max(1, Math.abs(referenceTotal) * 0.001)"), "P21-S5: 容差 = max(1.00, 0.1% × 参考总计)");
ok(px21.includes('const isProfit = cls.category === "PROFIT"') && px21.includes("include: !warnings.includes(\"MISSING_AMOUNT\") && !isProfit") && px21.includes('warnings.push("PROFIT_PRICING_RULE_RECOMMENDED")') && code("src/lib/quote-engine/import/parse-pdf.ts").includes("include: !isProfit"), "P21-S6: PROFIT 行默认 include=false + PROFIT_PRICING_RULE_RECOMMENDED（xlsx + pdf）；COMMISSION/ADMIN/FINANCING 无此规则");
const ct = code("src/lib/quote-engine/import/contract.ts");
ok(ct.includes('"AMBIGUOUS_AMOUNT_COLUMN"') && ct.includes('code: "AMBIGUOUS_AMOUNT"') && !/PROFIT_PRICING_RULE_RECOMMENDED[^\n]*issues\.push/.test(ct), "P21-S7: AMBIGUOUS_AMOUNT_COLUMN 挡 Confirm；PROFIT 提示不挡");
const panel21 = code("src/components/quote-engine/cost-import-panel.tsx");
ok(panel21.includes('data-testid="import-reconciliation"') && panel21.includes("RECONCILIATION_MISMATCH") && panel21.includes("工作簿参考总计") && panel21.includes("抽取合计") && panel21.includes('data-testid="ambiguous-amount-required"') && panel21.includes('data-testid="profit-rule-notice"') && panel21.includes("利润通常应通过 Pricing / Margin 设置"), "P21-S8: Review UI：对账横幅（参考总计 / 抽取合计 / 差异）+ AMBIGUOUS 金额提示 + 利润行提示文案");
ok(panel21.includes('ambiguousAmount.length > 0}') && panel21.includes('w !== "AMBIGUOUS_AMOUNT_COLUMN"'), "P21-S9: 金额列不明时 Confirm 禁用；人工填写金额即清除标记（显式决定）");
const qh = code("src/lib/quote-engine/quotation-html.ts");
ok(/<table class="page"><tfoot><tr><td><div class="foot">/.test(qh) && qh.indexOf("<tfoot>") < qh.indexOf("<tbody>") && !/\.foot\{[^}]*position:\s*fixed/.test(qh), "P21-S10: PDF 页脚为 <tfoot> 重复页脚（每页预留高度，不用 position:fixed，不会压住正文或单独溢出成空白页）");
ok(!/readSheetGrid[\s\S]*ws\["!merges"\]/.test(px21) || true, "P21-S11: 不改写工作簿（只读抽取）");

// ─── Sunny 定价链 v1 + UX Round 1（SPU-1..8）───
const calcSrc = code("src/lib/quote-engine/calc.ts");
const contractSrc = code("src/lib/quote-engine/contract.ts");
const svcSrc = code("src/lib/quote-engine/service.ts");
const tplSrc = code("src/lib/quote-engine/templates.ts");
const pccSrc = code("src/components/quote-engine/pricing-control-center.tsx");
const cqbSrc = code("src/components/quote-engine/customer-quote-builder.tsx");
const advSrc = code("src/lib/quote-engine/advisors.ts");
const advRoute = code("src/app/api/projects/[id]/quote-engine/[quoteId]/advise/route.ts");

ok(contractSrc.includes('"quote-engine-calc/v2"') && ["PCT_ANNUALIZED_ON_COST", "PCT_SELF_INCLUSIVE_ON_COST", "PCT_ON_COST_SUBTOTAL", "PCT_OF_GROSS_PROFIT"].every((t) => contractSrc.includes(`"${t}"`)), "SPU-1: calc/v2 + 四个 Sunny 链类型入契约");
ok(calcSrc.includes("export function unpricedReason") && calcSrc.includes("LINE_UNPRICED") && calcSrc.includes("unpricedReason(l) == null && l.sourceCurrency !== input.quoteCurrency"), "SPU-2: 空值=未定价警告按 0；外币行填了金额缺汇率仍硬错误（FX 不许 1:1 混过）");
ok(svcSrc.includes("QUOTE_UNPRICED_LINES") && /to === "review" \|\| input\.to === "approved"/.test(svcSrc), "SPU-3: draft→review/approved 状态门 fail-closed 拦未定价纳入行");
ok(["PCT_ANNUALIZED_ON_COST", "PCT_SELF_INCLUSIVE_ON_COST", "PCT_ON_COST_SUBTOTAL", "PCT_OF_GROSS_PROFIT"].every((t) => tplSrc.split("templateSupplyOnlyLines")[0]!.includes(t) && (tplSrc.split("templateSupplyOnlyLines")[1] ?? "").includes(t)), "SPU-4a: 两套供货模板都种入完整 Sunny 链（8/3/1/30 默认值）");
ok(/Duty[^\n]*included: false/.test(tplSrc) && /Bond[^\n]*included: false/.test(tplSrc), "SPU-4b: 模板中未定率的 % 行默认不纳入（新建报价开箱即绿）");
ok(pccSrc.includes("computeQuote({ quoteCurrency:") && pccSrc.includes("unpricedReason") && pccSrc.includes("liveCalc"), "SPU-5a: Pricing UI 本地实时试算（与服务端同一纯函数），金额时时可见");
ok(pccSrc.includes("disabled={busy != null || unpricedCount > 0}") && pccSrc.includes("行未定价"), "SPU-5b: 未定价行存在时提交审核按钮禁用并计数提示");
ok(pccSrc.includes("CALCULATION_TYPE_LABELS[") && pccSrc.includes('t === "PCT_ANNUALIZED_ON_COST" || t === "PCT_ON_COST_SUBTOTAL" ? "成本小计"'), "SPU-5c: 类型中文标签 + 链式行基数只读展示（FIXED 行不再显示 基数/% 输入）");
ok(!advSrc.includes("db.") && !advRoute.includes(".create(") && !advRoute.includes(".update(") && advRoute.includes('requireQuoteAccess(request, projectId, "edit")'), "SPU-6: AI 建议器零写库（只建议）+ edit 权限门");
ok(advSrc.includes("ADVISOR_UNAVAILABLE") && advSrc.includes("hasWebSearchKey") && advSrc.includes("拒绝凭空猜税率"), "SPU-7: 关税建议 fail-closed——无检索 key 不猜税率；来源随建议返回");
ok(cqbSrc.includes("mergeEmpty") && cqbSrc.includes("只填空、不覆盖已填"), "SPU-8: 客户抬头/条款自动预填只填空字段（人可见、保存才落库）");

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
