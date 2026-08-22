/**
 * Quote Operations Phase 2 — Golden Workflow E2E（隔离实库；合成数据；无真实 LLM）
 *
 *  A. Supply + Install：Tender → 上传合成 Excel → Import（Window/Freight/Installation/PM/Bond/Commission）→ Review + Apply
 *     → 内部计算 → 设 Margin → 客户报价草稿 → 客户行保存 → Approve → PDF → 选为 Tender Our Bid → Award → 项目预算
 *     → 激活 + 冻结基线 → 合成实际成本 → Budget vs Actual 差异正确 → 人工预测 → 利润预测
 *  B. Standing Offer：供应商成本 27,167 箱/柜 × 50 件/箱，年量 3,750,000 → 导入成本 → 分级 → Approve → 客户报价 → Our Bid
 *  C. 安全：跨组织枚举（quote / import / document / pdf）= 404；PDF 泄露门 fail-closed；重复导入 409；修订后旧 PDF 不覆盖
 *  D. Final Review B1：Apply 原子 / 幂等 / 并发 / 提交前失败回滚 / 重试 exactly-once / provenance 首次提交即在
 *  E. Final Review B2：指针 + 镜像原子；强制镜像失败回滚；修订 PENDING；重批跟随；并发选择一致；同步失败可观测
 *  F. Final Review B3：报价 CAD + 未标币种供应商表 350000 → 不会自动成 CAD；人工确认 CNY 后才成 CNY
 *
 * 用法（必须指向隔离 Neon 分支，绝不指生产；Blob 用本地磁盘 store，零凭据）：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated PRODUCT_CONTENT_LOCAL_STORE=1 PRODUCT_CONTENT_LOCAL_STORE_DIR=/tmp/x \
 *     TENDER_QUOTE_ENGINE_ENABLED=true TENDER_FINANCIAL_CONTROL_ENABLED=true \
 *     npx tsx scripts/quote-ops-golden-e2e.ts
 */

import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db } from "@/lib/db";
import { createEngineQuote, getQuote, computeForQuote, transitionQuote, reviseQuote, awardQuoteToBudget, updateEngineQuote } from "@/lib/quote-engine/service";
import { applyImport, cancelImport, confirmImport, createImportFromUpload, getImport, importRows, updateImportReview } from "@/lib/quote-engine/import/import-service";
import { generateCustomerDraftLines, updateCustomerQuote } from "@/lib/quote-engine/customer-quote";
import { assertCustomerViewSafe, buildQuotationViewForQuote, generateCustomerQuotationPdf, listCustomerQuotationPdfs } from "@/lib/quote-engine/quotation-pdf";
import { resolveTenderBid, selectQuoteAsTenderBid } from "@/lib/quote-engine/tender-bid";
import { activateBudgetVersion, freezeAwardBaseline } from "@/lib/project-finance/budget-service";
import { createProjectCost } from "@/lib/project-ledger/cost-service";
import { getProjectFinancialPerformance } from "@/lib/project-finance/performance";
import { setManualCostForecast } from "@/lib/project-finance/forecast-service";
import { analyzeQuoteOperations } from "@/lib/quote-engine/analyze-operations";
import { saveTenderProfile } from "@/lib/tender-profile/store";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };
const codeOf = (e: unknown) => (e as { code?: string })?.code ?? String(e);
function assertIsolated(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL 未设置");
  if (/ep-super-field-antfibsl/.test(url)) throw new Error("拒绝在生产库上运行（fail-closed）");
  if (process.env.DATABASE_ENVIRONMENT !== "isolated") throw new Error("DATABASE_ENVIRONMENT 必须为 isolated");
  if (process.env.PRODUCT_CONTENT_LOCAL_STORE !== "1") throw new Error("PRODUCT_CONTENT_LOCAL_STORE=1 必须设置（本地磁盘 Blob，零凭据；绝不取生产 Blob token）");
}

function supplyInstallWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Supplier: Guangzhou Window Co., Ltd.", null, "Date: 2026-08-15", null, "Currency: CAD"],
    [],
    ["Item", "Description", "Qty", "Unit", "Unit Cost (CAD)", "Total"],
    ["1", "Window Type A - aluminum", 250, "unit", 235.02, 58755],
    ["2", "Ocean Freight", 1, "lot", 20000, 20000],
    ["3", "Installation", 250, "unit", 289.84, 72460],
    ["4", "Project Manager", 5, "month", 5000, 25000],
    ["5", "Bond", null, null, null, 8000],
    ["6", "Commission", null, null, null, 21564],
    ["", "Subtotal", null, null, null, 205779],
    ["", "Total", null, null, null, 205779],
  ]), "Cost Summary");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
function standingOfferWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Description", "Amount", "Currency"],
    ["SKU supplier cost per container (27,167 boxes x 50 pcs)", 40000, "CAD"],
    ["Ocean freight per container", 9000, "CAD"],
    ["Customs clearance", 900, "CAD"],
    ["Warehouse", 2000, "CAD"],
  ]), "SO");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
async function supplierPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = ["ACME Freight Ltd.", "Quotation Q-77 Date: 2026-08-12", "All prices in CAD", "Inland trucking Toronto to site 3,500.00", "Crane rental 2 x 1,200.00 2,400.00", "Subtotal 5,900.00", "Total 5,900.00"];
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 740 - i * 22, size: 12, font }));
  return Buffer.from(await doc.save());
}

async function main() {
  assertIsolated();
  process.env.TENDER_QUOTE_ENGINE_ENABLED = "true";
  process.env.TENDER_FINANCIAL_CONTROL_ENABLED = "true";
  const tag = `qops-${Date.now()}`;
  console.log(`Quote Operations Golden E2E @ ${tag}`);
  const user = await db.user.create({ data: { email: `${tag}@e2e.local`, name: "E2E User" } });
  const org = await db.organization.create({ data: { name: `E2E ${tag}`, code: tag.slice(0, 30), ownerId: user.id } });
  const project = await db.project.create({ data: { name: `E2E Tender ${tag}`, ownerId: user.id, orgId: org.id, workDomain: "tender", clientOrganization: "City of Halifax", solicitationNumber: "T-2026-118", currency: "CAD" } });
  const ctx = { projectId: project.id, orgId: org.id, userId: user.id };
  // 其它组织（跨租户枚举）
  const user2 = await db.user.create({ data: { email: `${tag}-b@e2e.local`, name: "E2E User B" } });
  const org2 = await db.organization.create({ data: { name: `E2E B ${tag}`, code: `${tag.slice(0, 25)}-b`, ownerId: user2.id } });
  const project2 = await db.project.create({ data: { name: `E2E Other ${tag}`, ownerId: user2.id, orgId: org2.id, workDomain: "tender" } });
  await saveTenderProfile(org.id, { entityName: "Sunny Shutter Inc", quoteHeader: { companyName: "Sunny Shutter Inc", addressLines: ["680 Progress Ave, Unit 2", "Scarborough, ON M1H 3A5"], phone: "647-000-0000", email: "quotes@example.com", website: "sunnyshutter.ca", taxNumber: "123456789 RT0001", preparedByDefault: "Lucas" }, quoteTerms: { paymentTerms: "Net 30", delivery: "FOB site", leadTime: "10–12 weeks", warranty: "2 years", validity: "30 days", exclusions: ["Electrical work"], assumptions: ["Site access Mon–Fri"], notes: "" } });

  /* ───────────── A. Supply + Install ───────────── */
  console.log("\n[A] Supply + Install");
  const qA = await createEngineQuote({ ...ctx, quoteType: "PROJECT_SUPPLY_INSTALL", name: "Strathcona Windows", seedTemplate: false });
  ok(qA.costLines.length === 0 && qA.status === "draft", "A-01: 空白 Supply+Install 报价（不带模板行）");
  const xlsx = supplyInstallWorkbook();
  const up = await createImportFromUpload({ ...ctx, quoteId: qA.id, file: { buffer: xlsx, filename: "sunny-cost-summary.xlsx", safeName: "sunny-cost-summary.xlsx", ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: xlsx.length }, ai: { enabled: false } });
  ok(up.record.status === "REVIEW_REQUIRED" && up.extraction!.rows.length === 6 && up.record.supplierName?.includes("Guangzhou") === true, `A-02: 上传 → 抽取 6 行 → REVIEW_REQUIRED（供应商 ${up.record.supplierName}）`, up.record.status);
  const doc = await db.projectDocument.findUnique({ where: { id: up.record.sourceDocumentId! }, select: { source: true, fileType: true, pages: { select: { unitKind: true, unitLabel: true, pageNumber: true } } } });
  ok(doc?.source === "quote_import" && doc.fileType === "xlsx" && (doc.pages.length ?? 0) >= 1 && doc.pages[0]!.unitKind === "sheet", "A-03: 复用 ProjectDocument + 可引用单元（sheet）", doc);
  const rowsA = importRows(up.record);
  ok(rowsA.every((r) => r.evidence.documentId === up.record.sourceDocumentId && r.evidence.pageNumber != null), "A-04: 每行 evidence 指向文档 + 单元序号", rowsA[0]?.evidence);
  const costBefore = (await getQuote(qA.id, project.id)).costLines.length;
  ok(costBefore === 0, "A-05: 抽取后成本行仍为 0（绝不自动写入）");
  let c = ""; try { await applyImport({ ...ctx, quoteId: qA.id, importId: up.record.id }); } catch (e) { c = codeOf(e); }
  ok(c === "IMPORT_INVALID_STATE", "A-06: 未确认不能 apply（IMPORT_INVALID_STATE）");
  // 人工 Review：Commission 行改为不导入（由引擎按比例计算），Bond 保留为 FIXED
  const reviewed = rowsA.map((r) => (r.sourceDescription === "Commission" ? { ...r, include: false } : r));
  await updateImportReview({ ...ctx, quoteId: qA.id, importId: up.record.id, patch: { rows: reviewed } });
  // 重复导入（同文件）→ 409
  let dupCode = ""; try { await createImportFromUpload({ ...ctx, quoteId: qA.id, file: { buffer: xlsx, filename: "again.xlsx", safeName: "again.xlsx", ext: "xlsx", mime: null, size: xlsx.length } }); } catch (e) { dupCode = codeOf(e); }
  ok(dupCode === "SOURCE_ALREADY_IMPORTED", "A-07: 同一文件再次导入 → SOURCE_ALREADY_IMPORTED");
  const re = await createImportFromUpload({ ...ctx, quoteId: qA.id, file: { buffer: xlsx, filename: "again.xlsx", safeName: "again.xlsx", ext: "xlsx", mime: null, size: xlsx.length }, reimport: true, ai: { enabled: false } });
  ok(re.record.status === "REVIEW_REQUIRED" && (re.record.metadataJson as { reimportOf?: string }).reimportOf === up.record.id, "A-08: 显式 reimport → 新导入记录，标注来源");
  await cancelImport({ ...ctx, quoteId: qA.id, importId: re.record.id, reason: "测试取消" });
  await confirmImport({ ...ctx, quoteId: qA.id, importId: up.record.id });
  const applied = await applyImport({ ...ctx, quoteId: qA.id, importId: up.record.id });
  ok(applied.lineIds.length === 5 && applied.record.status === "APPLIED", "A-09: Confirm → Apply 写入 5 条成本行（Commission 未勾选）");
  const qA2 = await getQuote(qA.id, project.id);
  const win = qA2.costLines.find((l) => l.description.startsWith("Window"));
  const meta = win?.metadata as Record<string, unknown> | null;
  ok(!!win && win.category === "PROCUREMENT" && win.calculationType === "PER_UNIT" && Number(win.quantity) === 250 && Number(win.unitCost) === 235.02 && win.source === `import:${up.record.id}` && meta?.sourceDocumentId === up.record.sourceDocumentId && meta?.originalAmount === 58755 && meta?.sheet === "Cost Summary", "A-10: 成本行 provenance（importId / 文档 / 工作表 / 原始金额）——能回答「$58,755 从哪来」", meta);
  // PDF 供应商报价导入（Freight）
  const pdfBuf = await supplierPdf();
  const upPdf = await createImportFromUpload({ ...ctx, quoteId: qA.id, file: { buffer: pdfBuf, filename: "acme-freight.pdf", safeName: "acme-freight.pdf", ext: "pdf", mime: "application/pdf", size: pdfBuf.length }, ai: { enabled: false } });
  const pdfRows = importRows(upPdf.record);
  ok(upPdf.record.status === "REVIEW_REQUIRED" && pdfRows.length === 2 && pdfRows.every((r) => r.evidence.pageNumber === 1 && r.sourceCurrency === "CAD") && pdfRows.some((r) => r.quantity === 2 && r.unitCost === 1200), "A-11: PDF 供应商报价 → 2 行（页码 1，CAD，2 × 1,200 识别）", pdfRows.map((r) => [r.sourceDescription, r.sourceAmount, r.warnings]));
  await updateImportReview({ ...ctx, quoteId: qA.id, importId: upPdf.record.id, patch: { rows: pdfRows.map((r) => ({ ...r, suggestedCategory: r.suggestedCategory ?? "FREIGHT" })) } });
  await confirmImport({ ...ctx, quoteId: qA.id, importId: upPdf.record.id });
  const appliedPdf = await applyImport({ ...ctx, quoteId: qA.id, importId: upPdf.record.id });
  ok(appliedPdf.lineIds.length === 2, "A-12: PDF 导入行 Confirm → Apply");
  // 加 Commission（按收入比例）+ 定价 Margin 12%
  const qA3 = await getQuote(qA.id, project.id);
  const existing = qA3.costLines.map((l) => ({ id: l.id, sortOrder: l.sortOrder, category: l.category, description: l.description, quantity: l.quantity == null ? null : Number(l.quantity), unit: l.unit, unitCost: l.unitCost == null ? null : Number(l.unitCost), sourceCurrency: l.sourceCurrency, fxRate: l.fxRate == null ? null : Number(l.fxRate), calculationType: l.calculationType as "FIXED", calculationBase: l.calculationBase, rate: l.rate == null ? null : Number(l.rate), duration: l.duration == null ? null : Number(l.duration), supplierName: l.supplierName, source: l.source, notes: l.notes, included: l.included }));
  await updateEngineQuote({ ...ctx, quoteId: qA.id, header: { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: 12, engine: { tax: { hstPct: 13 } } }, lines: [...existing, { sortOrder: 900, category: "COMMISSION", description: "Commission（% of revenue）", quantity: null, unit: null, unitCost: null, sourceCurrency: "CAD", fxRate: null, calculationType: "PERCENT_OF_REVENUE", calculationBase: null, rate: 6, duration: null, supplierName: null, source: null, notes: null, included: true }] });
  const compA = computeForQuote(await getQuote(qA.id, project.id));
  ok(compA.calc.ok && compA.calc.sellingPrice > compA.calc.estimatedCost && Math.abs(compA.calc.grossMarginPct - 12) < 0.05, `A-13: 内部计算 OK：售价 ${compA.calc.ok ? compA.calc.sellingPrice : "—"}，毛利率 ≈ 12%`, compA.calc.ok ? { s: compA.calc.sellingPrice, c: compA.calc.estimatedCost, m: compA.calc.grossMarginPct } : compA.calc);
  const sellingA = compA.calc.ok ? compA.calc.sellingPrice : 0;
  // 客户报价草稿 → 人工确认 → 保存
  const draft = generateCustomerDraftLines({ calc: compA.calc as never, quoteType: "PROJECT_SUPPLY_INSTALL", productLabel: "replacement windows" });
  ok(Math.abs(draft.reduce((s, l) => s + l.amount, 0) - sellingA) < 0.01 && !draft.some((l) => /commission|profit|supplier/i.test(l.item)), "A-14: 客户草稿合计 = 售价；无 Commission/Profit/Supplier 行");
  await updateCustomerQuote({ ...ctx, quoteId: qA.id, patch: { header: { clientCompany: "City of Halifax", clientName: "Procurement Services", contactName: "J. Smith", projectName: "Window Replacement", tenderNumber: "T-2026-118", preparedBy: "Lucas", quoteDate: "2026-08-21", validUntil: "2026-09-30" }, terms: { paymentTerms: "Net 30", exclusions: ["Electrical work"] }, lines: [...draft, { sortOrder: 500, section: "Section B — Optional", item: "Weekend installation", description: null, quantity: 1, unit: "lot", unitPrice: 4500, amount: 4500, optional: true, allowance: false, taxable: true, notes: null, source: null }] } });
  const viewA = await buildQuotationViewForQuote(qA.id, project.id, org.id);
  ok(viewA.lines.length === draft.length + 1 && Math.abs(viewA.subtotal - sellingA) < 0.01 && viewA.optionalTotal === 4500 && Math.abs(viewA.tax.hst - Math.round(sellingA * 13) / 100) < 0.02 && viewA.company.name === "Sunny Shutter Inc" && viewA.header.clientCompany === "City of Halifax", "A-15: 客户视图：小计 = 售价（optional 不计入）；HST 13% 按客户应税小计；公司/客户抬头", { sub: viewA.subtotal, hst: viewA.tax.hst, opt: viewA.optionalTotal });
  let leakCode = ""; try { assertCustomerViewSafe({ ...viewA, ...( { supplierName: "X" } as object) } as never); } catch (e) { leakCode = codeOf(e); }
  ok(leakCode === "CUSTOMER_PDF_INTERNAL_LEAK", "A-16: 注入内部键 → CUSTOMER_PDF_INTERNAL_LEAK（PDF 拒绝生成）");
  // Approve → PDF
  await transitionQuote({ ...ctx, quoteId: qA.id, to: "review" });
  await transitionQuote({ ...ctx, quoteId: qA.id, to: "approved" });
  let frozenCode = ""; try { await updateCustomerQuote({ ...ctx, quoteId: qA.id, patch: { header: { clientName: "HACK" } } }); } catch (e) { frozenCode = codeOf(e); }
  ok(frozenCode === "QUOTE_FROZEN", "A-17: approved 后客户行/抬头冻结");
  const pdf1 = await generateCustomerQuotationPdf({ ...ctx, quoteId: qA.id });
  ok(pdf1.size > 1000 && pdf1.quoteVersion === 1 && Math.abs(pdf1.total - viewA.total) < 0.01 && !!pdf1.fileUrl, `A-18: 客户 PDF 生成（${pdf1.size} bytes，绑定 V1 / total）`, pdf1);
  const gen = await db.projectGeneratedDocument.findUnique({ where: { id: pdf1.id }, select: { docType: true, metaJson: true, stale: true } });
  ok(gen?.docType === "customer_quotation" && JSON.parse(gen.metaJson ?? "{}").generatedBy === user.id && gen.stale === false, "A-19: ProjectGeneratedDocument(customer_quotation) 元数据含 generatedBy / quoteVersion");
  // Tender Our Bid：approve 后自动选中（首个 approved）
  const bid1 = await resolveTenderBid({ projectId: project.id, orgId: org.id, internal: true });
  ok(bid1.status === "AUTHORITATIVE" && bid1.quote?.id === qA.id && Math.abs((bid1.quote?.sellingPrice ?? 0) - sellingA) < 0.01 && bid1.quote?.grossMarginPct != null, "A-20: 首个 approved 自动成为 Tender Our Bid（含内部数字）", bid1);
  const proj1 = await db.project.findUnique({ where: { id: project.id }, select: { bidQuoteId: true, ourBidPrice: true, currency: true } });
  ok(proj1?.bidQuoteId === qA.id && Math.abs((proj1?.ourBidPrice ?? 0) - sellingA) < 0.01, "A-21: 写穿 Project.bidQuoteId / ourBidPrice（复盘/基准读模型一致）", proj1);
  // 修订 → 旧 approved superseded → REVISION_PENDING → 新版批准 → 跟随
  const qA_v2 = await reviseQuote({ ...ctx, quoteId: qA.id, reason: "客户要求 Type B 窗" });
  const bid2 = await resolveTenderBid({ projectId: project.id, orgId: org.id, internal: false });
  ok(bid2.status === "QUOTE_REVISION_PENDING" && bid2.pendingRevision?.id === qA_v2.id && bid2.quote?.estimatedCost === null, "A-22: 修订后旧版 superseded → QUOTE_REVISION_PENDING（非内部权限不见成本）", bid2);
  await transitionQuote({ ...ctx, quoteId: qA_v2.id, to: "review" });
  await transitionQuote({ ...ctx, quoteId: qA_v2.id, to: "approved" });
  const bid3 = await resolveTenderBid({ projectId: project.id, orgId: org.id, internal: true });
  const proj2 = await db.project.findUnique({ where: { id: project.id }, select: { bidQuoteId: true } });
  ok(bid3.status === "AUTHORITATIVE" && bid3.quote?.id === qA_v2.id && proj2?.bidQuoteId === qA_v2.id, "A-23: 新版本批准 → Our Bid 自动跟随 V2（指针同步）", bid3);
  const pdfsOld = await listCustomerQuotationPdfs({ quoteId: qA.id, projectId: project.id, orgId: org.id });
  ok(pdfsOld.length === 1 && pdfsOld[0]!.id === pdf1.id, "A-24: 修订后 V1 的 PDF 仍保留（不覆盖）");
  const pdf2 = await generateCustomerQuotationPdf({ ...ctx, quoteId: qA_v2.id });
  ok(pdf2.quoteVersion === 2 && (await listCustomerQuotationPdfs({ quoteId: qA_v2.id, projectId: project.id, orgId: org.id })).length === 1, "A-25: V2 PDF 独立存在");
  // Award → 预算（with_budget）
  const award = await awardQuoteToBudget({ ...ctx, quoteId: qA_v2.id, mode: "with_budget" });
  ok(award.budgetCreated && !!award.budgetVersionId && award.quote.status === "awarded", "A-26: Award → 项目预算版本（同事务）");
  const blines = await db.projectBudgetLine.findMany({ where: { budgetVersionId: award.budgetVersionId! }, select: { category: true, amount: true, sourceReference: true } });
  ok(blines.length > 0 && blines.every((l) => l.sourceReference === `quote:${qA_v2.id}`) && blines.some((l) => l.category === "MATERIAL") && blines.some((l) => l.category === "FREIGHT"), "A-27: 预算行 sourceReference = quote:{quoteId}（溯源）", blines.map((l) => [l.category, String(l.amount)]));
  const actor = { actorType: "user" as const, actorId: user.id };
  await activateBudgetVersion({ orgId: org.id, projectId: project.id, versionId: award.budgetVersionId!, actor, actorUserId: user.id });
  await db.project.update({ where: { id: project.id }, data: { bidPhaseStatus: "AWARDED", tenderStatus: "won" } });
  await freezeAwardBaseline({ orgId: org.id, projectId: project.id, actor, actorUserId: user.id });
  // 合成实际成本：Freight 超预算 20%，Material 用 80%
  // ACTIVE 版本 = award 版本本身（activate 不复制；freeze 另建 AWARD_BASELINE 副本）；finance 模型无 Prisma relation，按 budgetVersionId 查
  const activeVersion = await db.projectBudgetVersion.findFirst({ where: { id: award.budgetVersionId!, status: "ACTIVE" }, select: { id: true } });
  ok(!!activeVersion, "A-27b: award 版本已激活为 ACTIVE；中标基线已冻结");
  const activeLines = await db.projectBudgetLine.findMany({ where: { budgetVersionId: award.budgetVersionId! }, select: { id: true, category: true, amount: true } });
  const fLine = activeLines.find((l) => l.category === "FREIGHT")!;
  const mLine = activeLines.find((l) => l.category === "MATERIAL")!;
  const freightActual = Math.round(Number(fLine.amount) * 1.2 * 100) / 100;
  const materialActual = Math.round(Number(mLine.amount) * 0.8 * 100) / 100;
  await createProjectCost({ orgId: org.id, projectId: project.id, actor, costStatus: "ACTUAL", category: "COURIER", amount: freightActual, currency: "CAD", description: "Ocean + inland freight invoices", incurredAt: new Date(), refs: { budgetLineId: fLine.id }, createdById: user.id } as never);
  await createProjectCost({ orgId: org.id, projectId: project.id, actor, costStatus: "ACTUAL", category: "SUPPLIER", amount: materialActual, currency: "CAD", description: "Window supplier invoice", incurredAt: new Date(), refs: { budgetLineId: mLine.id }, createdById: user.id } as never);
  const perf = await getProjectFinancialPerformance(org.id, project.id);
  const fr = perf.byCategory.find((c) => c.category === "FREIGHT")!;
  const mt = perf.byCategory.find((c) => c.category === "MATERIAL")!;
  ok(perf.available && perf.budget.hasActiveBudget && perf.budget.hasBaseline && fr.overBudget && Math.abs(fr.overBudgetPct! - 20) < 0.2 && Math.abs(fr.varianceAmount - (freightActual - Number(fLine.amount))) < 0.01 && Math.abs(mt.usedPct! - 80) < 0.2 && !mt.overBudget, `A-28: Budget vs Actual：Freight 超 20%（+${fr.varianceAmount}）、Material 用 80%`, { fr, mt });
  ok(perf.warnings.some((w) => w.code === "OVER_BUDGET" && w.category === "FREIGHT" && w.severity === "HIGH") && perf.quote?.quoteId === qA_v2.id && perf.contract.source === "AWARDED_QUOTE" && perf.profit.originalExpectedProfit != null, "A-29: OVER_BUDGET(FREIGHT) HIGH；原始预期利润来自 awarded 报价", perf.warnings);
  ok(perf.traceability.every((t) => t.quoteId === qA_v2.id) && perf.traceability.length === blines.length, "A-30: 溯源：每条预算行 → Quote V2");
  ok(!perf.forecast.available && perf.forecast.reason === "NO_PROGRESS_SIGNAL" && perf.profit.costBasis === "CURRENT_BUDGET", "A-31: 无进度信号 → 投影不可用；利润按当前预算口径");
  const fc = await setManualCostForecast({ orgId: org.id, projectId: project.id, userId: user.id, expectedRemainingCostCad: 50000, note: "剩余安装 + PM" });
  const perf2 = await getProjectFinancialPerformance(org.id, project.id);
  ok(fc.seq === 1 && perf2.forecast.method === "MANUAL" && Math.abs(perf2.forecast.forecastFinalCost! - (perf2.actual.actualCost + 50000)) < 0.01 && perf2.profit.costBasis === "MANUAL_FORECAST" && perf2.profit.currentForecastProfit != null, "A-32: 人工预测 → 完工成本 = 实际 + 剩余；利润预测更新", perf2.profit);
  const an = analyzeQuoteOperations(perf2);
  ok(an.topOverruns[0]?.category === "FREIGHT" && an.summaryZh.length > 0, "A-33: analyzeQuoteOperations：FREIGHT 为最大超支（advisory）");
  const auditCount = await db.auditLog.count({ where: { projectId: project.id, action: { in: ["quote_import_created", "quote_import_confirmed", "quote_import_applied", "quote_import_cancelled", "customer_quote_updated", "customer_quote_pdf_generated", "quote_selected_as_tender_bid", "tender_bid_pointer_synced", "financial_forecast_updated", "quote_awarded", "project_budget_created"] } } });
  ok(auditCount >= 11, `A-34: 审计事件 ≥ 11（实际 ${auditCount}）`);

  /* ───────────── B. Standing Offer ───────────── */
  console.log("\n[B] Standing Offer");
  const qB = await createEngineQuote({ ...ctx, quoteType: "STANDING_OFFER", name: "SKU Standing Offer", seedTemplate: false });
  const soX = standingOfferWorkbook();
  const upB = await createImportFromUpload({ ...ctx, quoteId: qB.id, file: { buffer: soX, filename: "so-costs.xlsx", safeName: "so-costs.xlsx", ext: "xlsx", mime: null, size: soX.length }, ai: { enabled: false } });
  const rowsB = importRows(upB.record);
  ok(rowsB.length === 4 && rowsB.every((r) => r.sourceCurrency === "CAD"), "B-01: Standing Offer 成本表导入 4 行");
  await updateImportReview({ ...ctx, quoteId: qB.id, importId: upB.record.id, patch: { rows: rowsB.map((r) => ({ ...r, suggestedCategory: r.suggestedCategory ?? "PROCUREMENT" })) } });
  await confirmImport({ ...ctx, quoteId: qB.id, importId: upB.record.id });
  await applyImport({ ...ctx, quoteId: qB.id, importId: upB.record.id });
  const qB2 = await getQuote(qB.id, project.id);
  const existB = qB2.costLines.map((l) => ({ id: l.id, sortOrder: l.sortOrder, category: l.category, description: l.description, quantity: l.quantity == null ? null : Number(l.quantity), unit: l.unit, unitCost: l.unitCost == null ? null : Number(l.unitCost), sourceCurrency: l.sourceCurrency, fxRate: null, calculationType: l.calculationType as "FIXED", calculationBase: l.calculationBase, rate: null, duration: null, supplierName: l.supplierName, source: l.source, notes: l.notes, included: l.included }));
  await updateEngineQuote({ ...ctx, quoteId: qB.id, header: { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: 15, engine: { standingOffer: { supplierCostPerPiece: 0.0294, supplierCurrency: "CAD", fxRate: null, piecesPerBox: 50, boxesPerContainer: 27167, annualQuantity: 3750000, freightPerContainer: 9000, customsPerContainer: 900, warehousePerContainer: 2000, moq: null, dutyPct: null, otherPerContainer: null, inventoryCarryingPct: null } } }, lines: [...existB, { sortOrder: 900, category: "ADMIN", description: "Admin（% of revenue）", quantity: null, unit: null, unitCost: null, sourceCurrency: "CAD", fxRate: null, calculationType: "PERCENT_OF_REVENUE", calculationBase: null, rate: 5, duration: null, supplierName: null, source: null, notes: null, included: true }], tiers: [{ sortOrder: 10, tierName: "Level 1", minQuantity: 0, maxQuantity: 999999, expectedQuantity: 750000, pricingMethod: "MARGIN_ON_REVENUE", rate: 18, active: true }, { sortOrder: 20, tierName: "Level 2", minQuantity: 1000000, maxQuantity: null, expectedQuantity: 3750000, pricingMethod: "MARGIN_ON_REVENUE", rate: 15, active: true }] });
  const compB = computeForQuote(await getQuote(qB.id, project.id));
  ok(compB.calc.ok && !!compB.standingOffer?.unit && compB.standingOffer.tiers.length === 2 && compB.standingOffer.tiers[1]!.unitPrice > 0, "B-02: Standing Offer 单位经济 + 2 个分级单价", compB.standingOffer?.errors);
  const draftB = generateCustomerDraftLines({ calc: compB.calc as never, quoteType: "STANDING_OFFER", tiers: compB.standingOffer?.tiers ?? null });
  await updateCustomerQuote({ ...ctx, quoteId: qB.id, patch: { header: { clientCompany: "Province of Nova Scotia" }, lines: draftB } });
  await transitionQuote({ ...ctx, quoteId: qB.id, to: "review" });
  await transitionQuote({ ...ctx, quoteId: qB.id, to: "approved" });
  const viewB = await buildQuotationViewForQuote(qB.id, project.id, org.id);
  ok(viewB.lines.length === 2 && viewB.lines.every((l) => l.unit === "pc" && l.unitPrice! > 0) && viewB.lines[1]!.quantity === 3750000, "B-03: 客户报价 = 分级单价行（3,750,000 件级）", viewB.lines);
  // 显式选为 Our Bid（项目已有 A 的权威报价 → 不自动切换）
  const bidBefore = await resolveTenderBid({ projectId: project.id, orgId: org.id, internal: false });
  ok(bidBefore.quote?.id === qA_v2.id && bidBefore.candidates.some((c) => c.id === qB.id), "B-04: 多报价：B 批准不会抢走 A 的 Our Bid，只成为候选");
  const sel = await selectQuoteAsTenderBid({ ...ctx, quoteId: qB.id, reason: "按 Standing Offer 投标" });
  ok(sel.status === "AUTHORITATIVE" && sel.quote?.id === qB.id, "B-05: 显式选为 Our Bid → 权威切换到 Standing Offer 报价");
  let cDraft = ""; try { const qD = await createEngineQuote({ ...ctx, quoteType: "SUPPLY_ONLY", name: "draft only", seedTemplate: false }); await selectQuoteAsTenderBid({ ...ctx, quoteId: qD.id }); } catch (e) { cDraft = codeOf(e); }
  ok(cDraft === "NOT_APPROVED", "B-06: draft 报价不能成为 Our Bid（NOT_APPROVED）");

  /* ───────────── C. 安全 ───────────── */
  console.log("\n[C] Security");
  const ctx2 = { projectId: project2.id, orgId: org2.id, userId: user2.id };
  let e1 = ""; try { await getQuote(qA.id, project2.id); } catch (e) { e1 = codeOf(e); }
  let e2 = ""; try { await getImport({ importId: up.record.id, quoteId: qA.id, projectId: project2.id, orgId: org2.id }); } catch (e) { e2 = codeOf(e); }
  let e3 = ""; try { await buildQuotationViewForQuote(qA.id, project2.id, org2.id); } catch (e) { e3 = codeOf(e); }
  let e4 = ""; try { await selectQuoteAsTenderBid({ ...ctx2, quoteId: qA_v2.id }); } catch (e) { e4 = codeOf(e); }
  const pdfsOther = await listCustomerQuotationPdfs({ quoteId: qA.id, projectId: project2.id, orgId: org2.id });
  ok(e1 === "QUOTE_NOT_FOUND" && e2 === "IMPORT_NOT_FOUND" && e3 === "QUOTE_NOT_FOUND" && e4 === "QUOTE_NOT_FOUND" && pdfsOther.length === 0, "C-01: 跨组织枚举 quote / import / PDF / select-bid → not found（无泄露）", { e1, e2, e3, e4 });
  const perfOther = await getProjectFinancialPerformance(org2.id, project.id);
  ok(!perfOther.available && perfOther.reasons.includes("FINANCE_TENANT_MISMATCH"), "C-02: 跨组织读财务表现 → FINANCE_TENANT_MISMATCH");
  let eImp = ""; try { await createImportFromUpload({ ...ctx, quoteId: qA_v2.id, file: { buffer: xlsx, filename: "late.xlsx", safeName: "late.xlsx", ext: "xlsx", mime: null, size: xlsx.length } }); } catch (e) { eImp = codeOf(e); }
  ok(eImp === "QUOTE_FROZEN", "C-03: awarded 报价不能导入成本（QUOTE_FROZEN）");

  /* ───────────── D. Final Review B1 — Apply 原子 / 幂等 / 并发 ───────────── */
  console.log("\n[D] B1 atomic + idempotent Apply");
  const qD = await createEngineQuote({ ...ctx, quoteType: "PROJECT_SUPPLY_INSTALL", name: "B1 quote", seedTemplate: false });
  const upD = await createImportFromUpload({ ...ctx, quoteId: qD.id, file: { buffer: xlsx, filename: "b1.xlsx", safeName: "b1.xlsx", ext: "xlsx", mime: null, size: xlsx.length }, ai: { enabled: false } });
  const rowsD = importRows(upD.record);
  const expectedD = rowsD.filter((r) => r.include).length;
  const countD = async () => db.quoteCostLine.count({ where: { quoteId: qD.id, source: `import:${upD.record.id}` } });
  // B1-04：提交前失败 → 既无 APPLIED 也无成本行
  let c04 = ""; try { await applyImport({ ...ctx, quoteId: qD.id, importId: upD.record.id, allowConfirm: true, deps: { failBeforeCommit: () => { throw new Error("simulated crash before commit"); } } }); } catch (e) { c04 = (e as Error).message; }
  const recD04 = await getImport({ ...ctx, quoteId: qD.id, importId: upD.record.id });
  ok(/simulated crash/.test(c04) && recD04.status === "REVIEW_REQUIRED" && (await countD()) === 0 && recD04.appliedJson === null, "B1-04: 提交前失败 → 事务回滚：状态未变、零成本行、无 appliedJson", { c04, status: recD04.status });
  // B1-05 / B1-01：中断后重试 → exactly-once；B1-06：provenance 首次提交即在
  const r01 = await applyImport({ ...ctx, quoteId: qD.id, importId: upD.record.id, allowConfirm: true });
  const linesD = await db.quoteCostLine.findMany({ where: { quoteId: qD.id, source: `import:${upD.record.id}` }, select: { id: true, metadata: true } });
  ok(!r01.alreadyApplied && r01.lineIds.length === expectedD && linesD.length === expectedD && r01.record.status === "APPLIED" && r01.record.confirmedAt != null, `B1-01/05: 重试成功 → 恰好 ${expectedD} 行、APPLIED、confirm_apply 同事务写 confirmedAt`, { n: linesD.length, status: r01.record.status });
  ok(linesD.every((l) => (l.metadata as { importId?: string } | null)?.importId === upD.record.id && (l.metadata as { originalAmount?: unknown } | null)?.originalAmount != null), "B1-06: 每条成本行 provenance 与成本行同一提交（无事后补写窗口）");
  ok(r01.snapshotRefreshed === true, "B1-07: 派生快照事务外刷新并显式报告 snapshotRefreshed=true");
  // B1-02：第二次 Apply → 幂等：零重复，返回 alreadyApplied
  const r02 = await applyImport({ ...ctx, quoteId: qD.id, importId: upD.record.id });
  ok(r02.alreadyApplied === true && r02.lineIds.length === expectedD && (await countD()) === expectedD, "B1-02: APPLIED 后重试 → alreadyApplied，零重复行");
  // B1-03：并发 Apply（新导入，CONFIRMED）→ 只有一份被应用
  const upD2 = await createImportFromUpload({ ...ctx, quoteId: qD.id, file: { buffer: xlsx, filename: "b1-concurrent.xlsx", safeName: "b1-concurrent.xlsx", ext: "xlsx", mime: null, size: xlsx.length }, reimport: true, ai: { enabled: false } });
  await confirmImport({ ...ctx, quoteId: qD.id, importId: upD2.record.id });
  const [ra, rb] = await Promise.all([applyImport({ ...ctx, quoteId: qD.id, importId: upD2.record.id }), applyImport({ ...ctx, quoteId: qD.id, importId: upD2.record.id })]);
  const countD2 = await db.quoteCostLine.count({ where: { quoteId: qD.id, source: `import:${upD2.record.id}` } });
  ok(countD2 === expectedD && [ra, rb].filter((r) => r.alreadyApplied).length === 1 && [ra, rb].filter((r) => !r.alreadyApplied).length === 1, `B1-03: 两路并发 Apply → 恰好 ${expectedD} 行（一路应用，一路 alreadyApplied）`, { countD2, a: ra.alreadyApplied, b: rb.alreadyApplied });
  const otherLines = await db.quoteCostLine.count({ where: { quoteId: qD.id, source: `import:${upD.record.id}` } });
  ok(otherLines === expectedD, "B1-08: 追加式写入：既有（第一次导入）成本行原样保留，未被全量替换");

  /* ───────────── E. Final Review B2 — 指针 + 镜像一致性 ───────────── */
  console.log("\n[E] B2 canonical / mirror consistency");
  const projE = await db.project.create({ data: { name: `E2E B2 ${tag}`, ownerId: user.id, orgId: org.id, workDomain: "tender", currency: "CAD" } });
  await db.bidIntelligenceRoom.create({ data: { orgId: org.id, projectId: projE.id, summaryJson: { pricingInputs: { competitorPriceCad: 300000 } } } });
  const ctxE = { projectId: projE.id, orgId: org.id, userId: user.id };
  const mkApproved = async (name: string, rate: number) => {
    const q = await createEngineQuote({ ...ctxE, quoteType: "PROJECT_SUPPLY_INSTALL", demo: "A", name });
    await updateEngineQuote({ ...ctxE, quoteId: q.id, header: { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: rate } });
    await transitionQuote({ ...ctxE, quoteId: q.id, to: "review" });
    return transitionQuote({ ...ctxE, quoteId: q.id, to: "approved" });
  };
  const qE1 = await mkApproved("E quote 1", 12);
  const priceE1 = computeForQuote(await getQuote(qE1.id, projE.id)).calc;
  const pE1 = await db.project.findUnique({ where: { id: projE.id }, select: { bidQuoteId: true, ourBidPrice: true, currency: true } });
  const roomE1 = await db.bidIntelligenceRoom.findUnique({ where: { projectId: projE.id }, select: { summaryJson: true } });
  const piE1 = (roomE1?.summaryJson as { pricingInputs?: Record<string, unknown> })?.pricingInputs ?? {};
  ok(priceE1.ok && pE1?.bidQuoteId === qE1.id && Math.abs((pE1?.ourBidPrice ?? 0) - priceE1.sellingPrice) < 0.005 && pE1?.currency === "CAD" && piE1.ourPriceCad === priceE1.sellingPrice && piE1.ourPriceSource === `quote:${qE1.id}:v1` && piE1.competitorPriceCad === 300000, "B2-01/04: 首个 approved 自动选中 → 指针 + ourBidPrice + currency + 房间 pricingInputs 同事务一致（既有键保留）", { pE1, piE1 });
  // B2-02：强制镜像写失败 → 不得留下新指针 + 旧价格
  const qE2 = await mkApprovedNoSync(ctxE, "E quote 2", 15);
  let c22 = ""; try { await selectQuoteAsTenderBid({ ...ctxE, quoteId: qE2.id, deps: { mirror: async () => { throw new Error("mirror write failed"); } } }); } catch (e) { c22 = codeOf(e); }
  const pE2 = await db.project.findUnique({ where: { id: projE.id }, select: { bidQuoteId: true, ourBidPrice: true } });
  const failAudit = await db.auditLog.count({ where: { projectId: projE.id, action: "tender_bid_sync_failed" } });
  ok(c22 === "TENDER_BID_SYNC_FAILED" && pE2?.bidQuoteId === qE1.id && Math.abs((pE2?.ourBidPrice ?? 0) - (priceE1.ok ? priceE1.sellingPrice : -1)) < 0.005 && failAudit >= 1, "B2-02/06: 镜像失败 → 整体回滚（指针与价格仍为旧报价一致）+ tender_bid_sync_failed 审计", { c22, pE2, failAudit });
  // B2-03：修订 → REVISION_PENDING（不把旧版宣称为当前）
  const qE1v2 = await reviseQuote({ ...ctxE, quoteId: qE1.id, reason: "B2 revision" });
  const res03 = await resolveTenderBid({ ...ctxE, internal: false });
  ok(res03.status === "QUOTE_REVISION_PENDING" && res03.pendingRevision?.id === qE1v2.id && res03.selectedQuoteId === qE1.id, "B2-03: 修订后 → QUOTE_REVISION_PENDING（显式，不宣称旧版为当前）", res03.status);
  // B2-04：批准修订 → 指针 + 价格 + 房间镜像跟随 V2
  await updateEngineQuote({ ...ctxE, quoteId: qE1v2.id, header: { pricingRate: 20 } });
  await transitionQuote({ ...ctxE, quoteId: qE1v2.id, to: "review" });
  await transitionQuote({ ...ctxE, quoteId: qE1v2.id, to: "approved" });
  const priceV2 = computeForQuote(await getQuote(qE1v2.id, projE.id)).calc;
  const pE4 = await db.project.findUnique({ where: { id: projE.id }, select: { bidQuoteId: true, ourBidPrice: true } });
  const piE4 = ((await db.bidIntelligenceRoom.findUnique({ where: { projectId: projE.id }, select: { summaryJson: true } }))?.summaryJson as { pricingInputs?: Record<string, unknown> })?.pricingInputs ?? {};
  const res04 = await resolveTenderBid({ ...ctxE, internal: true });
  ok(priceV2.ok && pE4?.bidQuoteId === qE1v2.id && Math.abs((pE4?.ourBidPrice ?? 0) - priceV2.sellingPrice) < 0.005 && piE4.ourPriceSource === `quote:${qE1v2.id}:v2` && res04.status === "AUTHORITATIVE" && res04.mirrorStale === false, "B2-04: 批准修订 → 指针/价格/房间镜像全部跟随 V2；mirrorStale=false", { pE4, piE4, res04: res04.status });
  const synced = await db.auditLog.count({ where: { projectId: projE.id, action: "tender_bid_pointer_synced" } });
  ok(synced >= 1, "B2-04b: 跟随修订有 tender_bid_pointer_synced 审计");
  // B2-05：并发选择两份 approved → 最终 bidQuoteId 与 ourBidPrice 必一致
  const qE3 = await mkApprovedNoSync(ctxE, "E quote 3", 10);
  await Promise.all([selectQuoteAsTenderBid({ ...ctxE, quoteId: qE1v2.id }), selectQuoteAsTenderBid({ ...ctxE, quoteId: qE3.id })]);
  const pE5 = await db.project.findUnique({ where: { id: projE.id }, select: { bidQuoteId: true, ourBidPrice: true, currency: true } });
  const winner = await getQuote(pE5!.bidQuoteId!, projE.id);
  const winnerPrice = computeForQuote(winner).calc;
  const res05 = await resolveTenderBid({ ...ctxE, internal: true });
  ok(winnerPrice.ok && Math.abs((pE5?.ourBidPrice ?? 0) - winnerPrice.sellingPrice) < 0.005 && res05.status === "AUTHORITATIVE" && res05.mirrorStale === false, "B2-05: 并发选择 → bidQuoteId 与 ourBidPrice 一致（项目行锁串行化）", { bid: pE5?.bidQuoteId, price: pE5?.ourBidPrice });
  // B2-06b：状态迁移中同步失败 → 迁移回滚 + 审计
  const qE4 = await createEngineQuote({ ...ctxE, quoteType: "PROJECT_SUPPLY_INSTALL", demo: "A", name: "E quote 4" });
  await transitionQuote({ ...ctxE, quoteId: qE4.id, to: "review" });
  let c26 = ""; try { await transitionQuote({ ...ctxE, quoteId: qE4.id, to: "approved", deps: { bidSync: async () => { throw new (await import("@/lib/quote-engine/tender-bid")).TenderBidSyncError("forced sync failure"); } } }); } catch (e) { c26 = codeOf(e); }
  const e4After = await getQuote(qE4.id, projE.id);
  ok(c26 === "TENDER_BID_SYNC_FAILED" && e4After.status === "review" && (await db.auditLog.count({ where: { projectId: projE.id, action: "tender_bid_sync_failed" } })) >= 2, "B2-06: 迁移中同步失败 → approve 回滚（仍 review）+ 审计（不吞）", { c26, status: e4After.status });
  // cancel 路径：取消被选报价 → NONE（确定性）
  await transitionQuote({ ...ctxE, quoteId: pE5!.bidQuoteId!, to: "cancelled" });
  const res06 = await resolveTenderBid({ ...ctxE, internal: false });
  ok(res06.status === "NONE" && /取消/.test(res06.reason), "B2-07: 取消被选报价 → 解析为 NONE（显式）");

  /* ───────────── F. Final Review B3 — 供应商币种 fail-closed（服务层） ───────────── */
  console.log("\n[F] B3 supplier currency fail-closed");
  const qF = await createEngineQuote({ ...ctx, quoteType: "PROJECT_SUPPLY_INSTALL", name: "B3 quote", seedTemplate: false, currency: "CAD" });
  const cnWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(cnWb, XLSX.utils.aoa_to_sheet([["品名", "数量", "单价", "金额"], ["铝合金窗 Type A", 250, 1400, 350000]]), "采购");
  const cnBuf = XLSX.write(cnWb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const upF = await createImportFromUpload({ ...ctx, quoteId: qF.id, file: { buffer: cnBuf, filename: "cn-supplier.xlsx", safeName: "cn-supplier.xlsx", ext: "xlsx", mime: null, size: cnBuf.length }, ai: { enabled: false } });
  const rowsF = importRows(upF.record);
  const metaF = upF.record.metadataJson as Record<string, unknown>;
  ok(rowsF.length === 1 && rowsF[0]!.sourceAmount === 350000 && rowsF[0]!.sourceCurrency === null && rowsF[0]!.warnings.includes("MISSING_CURRENCY") && metaF.currencyMode === "AUTO_DETECT" && metaF.unresolvedCurrencyRows === 1, "B3-E1: 报价 CAD + 无币种信号 → 行 UNRESOLVED（不是 CAD 350000）", { row: rowsF[0], metaF });
  let cF = ""; try { await applyImport({ ...ctx, quoteId: qF.id, importId: upF.record.id, allowConfirm: true }); } catch (e) { cF = codeOf(e); }
  ok(cF === "IMPORT_ROWS_INVALID" && (await db.quoteCostLine.count({ where: { quoteId: qF.id } })) === 0, "B3-E2: 未确认币种 → Confirm/Apply 被挡，零成本行");
  await updateImportReview({ ...ctx, quoteId: qF.id, importId: upF.record.id, patch: { rows: rowsF, supplierCurrency: "CNY", applyToUnresolved: true } });
  const rF = await applyImport({ ...ctx, quoteId: qF.id, importId: upF.record.id, allowConfirm: true });
  const lineF = (await getQuote(qF.id, project.id)).costLines.find((l) => l.source === `import:${upF.record.id}`);
  ok(rF.lineIds.length === 1 && lineF?.sourceCurrency === "CNY" && Number(lineF.unitCost) === 1400 && lineF.fxRate === null, "B3-E3: 人工确认 CNY 后 → CNY 250 × 1400 成本行，fxRate 留空", { ccy: lineF?.sourceCurrency, fx: lineF?.fxRate });
  const compF = computeForQuote(await getQuote(qF.id, project.id));
  ok(!compF.calc.ok && compF.calc.errors.some((e) => e.code === "FX_REQUIRED"), "B3-E4: CNY 行无汇率 → 引擎 FX_REQUIRED（不按 1:1 定价）");

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

/** 建一份 approved 报价但不触发自动选中（项目已有指针时 approve 不会抢指针；用于并发/镜像失败测试） */
async function mkApprovedNoSync(ctxE: { projectId: string; orgId: string; userId: string }, name: string, rate: number) {
  const q = await createEngineQuote({ ...ctxE, quoteType: "PROJECT_SUPPLY_INSTALL", demo: "A", name });
  await updateEngineQuote({ ...ctxE, quoteId: q.id, header: { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: rate } });
  await transitionQuote({ ...ctxE, quoteId: q.id, to: "review" });
  return transitionQuote({ ...ctxE, quoteId: q.id, to: "approved" });
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
