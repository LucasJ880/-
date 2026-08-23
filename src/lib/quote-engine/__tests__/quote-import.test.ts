/**
 * Quote Operations Phase 2 · 成本导入纯逻辑测试（XLSX / CSV / PDF 抽取 + 分类 + 确认校验）
 * 运行：npx tsx src/lib/quote-engine/__tests__/quote-import.test.ts
 */
import * as XLSX from "xlsx";
import { classifyDescription, looksLikeTotalLine } from "../import/classify";
import { validateRowsForConfirm, importRowSchema } from "../import/contract";
import type { CellObject } from "xlsx";
import { extractRowsFromPdfPages } from "../import/parse-pdf";
import { detectHeader, extractRowsFromWorkbook, parseNumberCell } from "../import/parse-xlsx";
import { rowToCostLinePayload } from "../import/import-service";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

function workbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const main = XLSX.utils.aoa_to_sheet([
    ["Sunny Shutter Inc — Supply & Install Cost Summary"],
    ["Supplier: Guangzhou Window Co., Ltd.", null, "Date: 2026-08-15"],
    [],
    ["Item", "Description", "Qty", "Unit", "Unit Cost (CAD)", "Total"],
    ["1", "Window Type A - aluminum", 250, "unit", 235.02, 58755],
    ["2", "Ocean Freight (3 x 40HC)", 1, "lot", 20000, 20000],
    ["3", "Installation", 250, "unit", 289.84, 72460],
    ["4", "Caulking", 250, "unit", 14.67, 3667.5],
    ["5", "Lift rental", 18, "day", 350, 6300],
    ["6", "Project Manager", 5, "month", 5000, 25000],
    ["7", "Permit", null, null, null, 5000],
    ["8", "Bond 1.5%", null, null, null, 8000],
    ["9", "Commission 6%", null, null, null, 21564],
    ["10", "Profit", null, null, null, 50317],
    ["11", "Weekend premium", 1, "lot", null, null],
    ["12", "Misc charges", null, null, null, "$1,200.00"],
    ["", "Subtotal", null, null, null, 270000],
    ["", "HST 13%", null, null, null, 35100],
    ["", "Total", null, null, null, 305100],
  ]);
  XLSX.utils.book_append_sheet(wb, main, "Supply+Install");
  const cny = XLSX.utils.aoa_to_sheet([
    ["品名", "数量", "单位", "单价", "金额", "币种"],
    ["铝合金窗 Type A", 250, "樘", 1400, 350000, "CNY"],
    ["合计", null, null, null, 350000, "CNY"],
  ]);
  XLSX.utils.book_append_sheet(wb, cny, "CNY purchase");
  const freight = XLSX.utils.aoa_to_sheet([
    ["Ocean freight Shanghai→Toronto", 20000],
    ["Inland trucking", 3500],
    ["Total", 23500],
  ]);
  XLSX.utils.book_append_sheet(wb, freight, "Freight quote");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ── 数字解析 ──
ok(parseNumberCell("$20,000.00").value === 20000, "NUM-01: \"$20,000.00\" → 20000");
ok(parseNumberCell("(500)").value === -500, "NUM-02: \"(500)\" → -500");
ok(parseNumberCell("1.5%").isPercent && parseNumberCell("1.5%").value === null, "NUM-03: 百分比不当金额");
ok(parseNumberCell("abc").unparsed, "NUM-04: 非数字标 unparsed");
ok(parseNumberCell("CAD 1,200").value === 1200, "NUM-05: 带币种前缀");

// ── 分类 ──
ok(classifyDescription("Ocean Freight (3 x 40HC)").category === "FREIGHT", "CLS-01: Ocean Freight → FREIGHT");
ok(classifyDescription("Installation").category === "LABOUR", "CLS-02: Installation → LABOUR");
ok(classifyDescription("Lift rental").category === "EQUIPMENT", "CLS-03: Lift rental → EQUIPMENT");
ok(classifyDescription("Project Manager").category === "PROJECT_MANAGEMENT", "CLS-04: Project Manager → PROJECT_MANAGEMENT");
ok(classifyDescription("铝合金窗 Type A").category === "PROCUREMENT", "CLS-05: 中文「窗」→ PROCUREMENT");
ok(classifyDescription("Misc charges").category === null && classifyDescription("Misc charges").ambiguous, "CLS-06: 无关键词 → null + ambiguous");
ok(classifyDescription("Window Type A - aluminum").category === "PROCUREMENT", "CLS-07: Window → PROCUREMENT");
ok(looksLikeTotalLine("Subtotal") && looksLikeTotalLine("HST 13%") && looksLikeTotalLine("合计") && !looksLikeTotalLine("Total station rental"), "CLS-08: 合计/税行识别（Total station 不误判）");

// ── XLSX 抽取 ──
const buf = workbook();
const wbX = XLSX.read(buf, { type: "buffer" });
const grid = XLSX.utils.sheet_to_json(wbX.Sheets["Supply+Install"]!, { header: 1, raw: true, defval: null, blankrows: true }) as (string | number | null)[][];
const hdr = detectHeader(grid);
ok(!!hdr && hdr.rowIndex === 3 && [...hdr.columns.values()].includes("description") && [...hdr.columns.values()].includes("amount"), "XLS-01: 表头在第 4 行被识别（不假设固定列位置）", hdr && [...hdr.columns.entries()]);
const ex = extractRowsFromWorkbook(buf);
ok(ex.sheets.length === 3 && ex.detectedCurrency === "CAD", "XLS-02: 3 个工作表；币种从表头 (CAD) 识别", { sheets: ex.sheets, ccy: ex.detectedCurrency });
const byDesc = (s: string) => ex.rows.find((r) => r.sourceDescription.startsWith(s));
const win = byDesc("Window Type A");
ok(!!win && win.suggestedCategory === "PROCUREMENT" && win.suggestedCalculationType === "PER_UNIT" && win.quantity === 250 && win.unitCost === 235.02 && win.sourceAmount === 58755 && win.sourceCurrency === "CAD" && win.unit === "unit", "XLS-03: Window 行 PER_UNIT 250 × 235.02 = 58,755 CAD", win);
ok(byDesc("Ocean Freight")?.suggestedCategory === "FREIGHT" && byDesc("Installation")?.suggestedCategory === "LABOUR" && byDesc("Caulking")?.suggestedCategory === "LABOUR" && byDesc("Lift")?.suggestedCategory === "EQUIPMENT" && byDesc("Project Manager")?.suggestedCategory === "PROJECT_MANAGEMENT", "XLS-04: Freight/Installation/Caulking/Lift/PM 建议类别正确");
const permit = byDesc("Permit");
ok(!!permit && permit.suggestedCalculationType === "FIXED" && permit.unitCost === 5000 && permit.quantity === null && permit.suggestedCategory === "PERMIT", "XLS-05: 只有金额的行 → FIXED 5000");
ok(byDesc("Bond")?.suggestedCategory === "BOND" && byDesc("Bond")?.suggestedRate === 1.5 && byDesc("Commission")?.suggestedRate === 6 && byDesc("Profit")?.suggestedCategory === "PROFIT", "XLS-06: Bond/Commission/Profit 识别且比例仅作提示");
ok(!ex.rows.some((r) => /^(subtotal|total|hst)/i.test(r.sourceDescription)), "XLS-07: Subtotal / HST / Total 行不进入导入行");
const weekend = byDesc("Weekend premium");
ok(!!weekend && weekend.include === false && weekend.warnings.includes("MISSING_AMOUNT"), "XLS-08: 缺金额 → MISSING_AMOUNT 且默认不勾选");
const misc = byDesc("Misc charges");
ok(!!misc && misc.sourceAmount === 1200 && misc.suggestedCategory === null && misc.warnings.includes("AMBIGUOUS_CATEGORY") && misc.warnings.includes("LOW_CONFIDENCE"), "XLS-09: 模糊类别 → AMBIGUOUS_CATEGORY + LOW_CONFIDENCE（不悄悄猜）", misc?.warnings);
const cnyRow = ex.rows.find((r) => r.evidence.sheet === "CNY purchase" && r.sourceDescription.includes("铝合金窗"));
ok(!!cnyRow && cnyRow.sourceCurrency === "CNY" && cnyRow.suggestedCalculationType === "PER_UNIT" && cnyRow.quantity === 250 && cnyRow.unitCost === 1400 && cnyRow.sourceAmount === 350000, "XLS-10: 中文表头 + 币种列 → CNY PER_UNIT 250 × 1400");
const freightRows = ex.rows.filter((r) => r.evidence.sheet === "Freight quote");
ok(freightRows.length === 2 && freightRows.every((r) => r.suggestedCategory === "FREIGHT" && r.suggestedCalculationType === "FIXED") && ex.notes.some((n) => n.includes("未识别表头")), "XLS-11: 无表头工作表回退「描述 + 最后一个数字」，Total 跳过", { n: freightRows.length, notes: ex.notes });
ok(ex.supplierNameGuess?.includes("Guangzhou") === true && ex.quoteDateGuess === "2026-08-15", "XLS-12: 供应商名 / 报价日期猜测", { s: ex.supplierNameGuess, d: ex.quoteDateGuess });
ok(ex.rows.every((r) => r.evidence.sheet && r.evidence.row && r.evidence.snippet.length > 0 && importRowSchema.safeParse(r).success), "XLS-13: 每行带 sheet/行号/原文片段 provenance 且通过 schema");
ok(win!.evidence.row === 5 && win!.evidence.cell === "F5", "XLS-14: provenance 指向 Excel 第 5 行 F5 单元格", win?.evidence);

// 无币种：去掉表头 (CAD) 且不给默认 → MISSING_CURRENCY
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([["Description", "Amount"], ["Ocean Freight", 20000]]), "S");
const ex2 = extractRowsFromWorkbook(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }) as Buffer);
ok(ex2.rows[0]?.sourceCurrency === null && ex2.rows[0]?.warnings.includes("MISSING_CURRENCY"), "XLS-15: 无任何币种信号 → MISSING_CURRENCY");
const ex3 = extractRowsFromWorkbook(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }) as Buffer, { confirmedCurrency: "CNY" });
ok(ex3.rows[0]?.sourceCurrency === "CNY" && !ex3.rows[0]?.warnings.includes("MISSING_CURRENCY"), "XLS-16: 人工显式确认的供应商币种只在无文档信号时生效");

// ── B3 回归：报价 CAD + 未标币种的供应商表 350000 → 绝不自动成为 CAD 350000 ──
const wbCn = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbCn, XLSX.utils.aoa_to_sheet([["品名", "数量", "单价", "金额"], ["铝合金窗 Type A", 250, 1400, 350000]]), "采购");
const cnBuf = XLSX.write(wbCn, { type: "buffer", bookType: "xlsx" }) as Buffer;
const exCn = extractRowsFromWorkbook(cnBuf);
ok(exCn.rows.length === 1 && exCn.rows[0]!.sourceAmount === 350000 && exCn.rows[0]!.sourceCurrency === null && exCn.rows[0]!.warnings.includes("MISSING_CURRENCY") && exCn.detectedCurrency === null, "B3-01: 无币种信号 → sourceCurrency=null + MISSING_CURRENCY（不是 CAD 350000）", exCn.rows[0]);
ok(validateRowsForConfirm(exCn.rows).some((i) => i.code === "MISSING_CURRENCY"), "B3-02: 未解析币种 → Confirm 被挡");
let thrown = "";
try { rowToCostLinePayload(exCn.rows[0]!, { importId: "imp", sortOrder: 10, supplierName: null, quoteCurrency: "CAD" }); } catch (e) { thrown = (e as { code?: string }).code ?? ""; }
ok(thrown === "IMPORT_ROWS_INVALID", "B3-03: 行→成本行映射拒绝未解析币种（绝不用报价币种 CAD 兜底）");
const exCn2 = extractRowsFromWorkbook(cnBuf, { confirmedCurrency: "CNY" });
ok(exCn2.rows[0]!.sourceCurrency === "CNY" && !exCn2.rows[0]!.warnings.includes("MISSING_CURRENCY"), "B3-04: 人工显式选择 CNY 后 → CNY 350000");
const pCn = rowToCostLinePayload(exCn2.rows[0]!, { importId: "imp", sortOrder: 10, supplierName: null, quoteCurrency: "CAD" });
ok(pCn.sourceCurrency === "CNY" && pCn.fxRate === null, "B3-05: CNY 行 fxRate 留空 → 引擎 FX_REQUIRED fail-closed（Phase 1 B1 规则延续）");
const wbHdr = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbHdr, XLSX.utils.aoa_to_sheet([["Description", "Amount (USD)"], ["Hardware", 1200]]), "S");
const exHdr = extractRowsFromWorkbook(XLSX.write(wbHdr, { type: "buffer", bookType: "xlsx" }) as Buffer, { confirmedCurrency: "CNY" });
ok(exHdr.rows[0]!.sourceCurrency === "USD", "B3-06: 优先级：表头 (USD) 信号 > 人工确认 CNY");
const pdfCn = extractRowsFromPdfPages([{ pageNumber: 1, contentText: "铝合金窗 Type A 250 x 1400.00 350,000.00\nTotal 350,000.00" }]);
ok(pdfCn.rows[0]?.sourceCurrency === null && pdfCn.rows[0]?.warnings.includes("MISSING_CURRENCY"), "B3-07: PDF 无币种信号同样 UNRESOLVED");
ok(extractRowsFromPdfPages([{ pageNumber: 1, contentText: "Hardware 1,200.00" }], { confirmedCurrency: "CNY" }).rows[0]?.sourceCurrency === "CNY", "B3-08: PDF 人工确认币种仅在无信号时生效");

// CSV
const csv = Buffer.from("Description,Qty,Unit Price,Total,Currency\nWindow Type B,100,300.5,30050,CAD\nTotal,,,30050,\n", "utf-8");
const exCsv = extractRowsFromWorkbook(csv, { sourceType: "CSV" });
ok(exCsv.rows.length === 1 && exCsv.rows[0]!.quantity === 100 && exCsv.rows[0]!.unitCost === 300.5 && exCsv.rows[0]!.sourceCurrency === "CAD", "CSV-01: CSV 同一抽取器");

// ── PDF 抽取 ──
const pages = [{ pageNumber: 1, contentText: "ACME Windows Ltd.\nQuotation No. Q-1001 Date: 2026-08-10\nAll prices in CAD\nWindow Type A 250 x $235.02 $58,755.00\nOcean Freight $20,000.00\nInstallation 250 @ 289.84 72,460.00\nSubtotal $151,215.00\nHST 13% $19,657.95\nTotal $170,872.95" }];
const pdf = extractRowsFromPdfPages(pages);
ok(pdf.rows.length === 3, "PDF-01: 3 行（Subtotal/HST/Total 跳过）", pdf.rows.map((r) => r.sourceDescription));
const pw = pdf.rows.find((r) => r.sourceDescription.startsWith("Window"));
ok(!!pw && pw.suggestedCalculationType === "PER_UNIT" && pw.quantity === 250 && pw.unitCost === 235.02 && pw.sourceAmount === 58755 && pw.sourceCurrency === "CAD" && pw.evidence.pageNumber === 1, "PDF-02: 250 x $235.02 = $58,755 → PER_UNIT，页码=1", pw);
const pf = pdf.rows.find((r) => r.sourceDescription.startsWith("Ocean"));
ok(!!pf && pf.suggestedCalculationType === "FIXED" && pf.sourceAmount === 20000 && pf.suggestedCategory === "FREIGHT" && pf.warnings.includes("LOW_CONFIDENCE"), "PDF-03: 行式抽取 FIXED 行置信度 ≤0.55 → LOW_CONFIDENCE 提示", pf?.warnings);
ok(pdf.supplierNameGuess === "ACME Windows Ltd." && pdf.quoteDateGuess === "2026-08-10" && pdf.rows.every((r) => r.rawAmountText && r.evidence.snippet), "PDF-04: 供应商/日期/原始金额文本保留", { s: pdf.supplierNameGuess, d: pdf.quoteDateGuess });
const pdfNoCcy = extractRowsFromPdfPages([{ pageNumber: 2, contentText: "Installation labour 12,000.00\nTotal 12,000.00" }]);
ok(pdfNoCcy.rows.length === 1 && pdfNoCcy.rows[0]!.warnings.includes("MISSING_CURRENCY") && pdfNoCcy.rows[0]!.evidence.pageNumber === 2, "PDF-05: 无币种 → MISSING_CURRENCY；页码保留");
const pdfEmpty = extractRowsFromPdfPages([{ pageNumber: 1, contentText: "" }]);
ok(pdfEmpty.rows.length === 0 && pdfEmpty.notes.some((n) => n.includes("OCR")), "PDF-06: 扫描件无文本 → 0 行 + OCR 说明（不静默）");

// ── Confirm 校验 ──
const issues = validateRowsForConfirm([
  { ...misc!, include: true },
  { ...weekend!, include: true },
  { ...win!, sourceCurrency: null, include: true },
  { ...permit!, include: true },
]);
ok(issues.some((i) => i.code === "MISSING_CATEGORY" && i.rowId === misc!.rowId) && issues.some((i) => i.code === "MISSING_AMOUNT" && i.rowId === weekend!.rowId) && issues.some((i) => i.code === "MISSING_CURRENCY" && i.rowId === win!.rowId) && !issues.some((i) => i.rowId === permit!.rowId), "CFM-01: 缺类别 / 缺金额 / 缺币种 逐行报错，合格行不报", issues);
ok(validateRowsForConfirm([{ ...misc!, include: false }]).length === 0, "CFM-02: 未勾选行不参与校验");

// ── 行 → 成本行 payload ──
const p1 = rowToCostLinePayload(win!, { importId: "imp1", sortOrder: 10, supplierName: "ACME", quoteCurrency: "CAD" });
ok(p1.calculationType === "PER_UNIT" && p1.quantity === 250 && p1.unitCost === 235.02 && p1.sourceCurrency === "CAD" && p1.source === "import:imp1" && p1.supplierName === "ACME" && p1.category === "PROCUREMENT", "MAP-01: PER_UNIT 行映射");
const p2 = rowToCostLinePayload(cnyRow!, { importId: "imp1", sortOrder: 20, supplierName: null, quoteCurrency: "CAD" });
ok(p2.sourceCurrency === "CNY" && p2.fxRate === null, "MAP-02: 外币行 fxRate 留空 → 引擎 FX_REQUIRED fail-closed（不默认 1:1）");
const p3 = rowToCostLinePayload(byDesc("Bond")!, { importId: "imp1", sortOrder: 30, supplierName: null, quoteCurrency: "CAD" });
ok(p3.calculationType === "FIXED" && p3.unitCost === 8000 && /1\.5%/.test(p3.notes ?? ""), "MAP-03: Bond 按金额 FIXED 导入，比例写入备注提示");

/* ═══════════════ Phase 2.1 · 真实模版适配（结构等价合成夹具；不提交原始工作簿） ═══════════════ */
import { reconcileTotals, reconciliationTolerance } from "../import/reconcile";

/** 真实 Sunny Supply+Install 工作簿的结构等价夹具：`项目|价格` 表头 + 无表头备注列（含裸数字与 % 格式单元）+ 空行 + 末尾纯数字校验行 */
function realLayoutWorkbook(opts: { corrupt?: boolean } = {}): { buf: Buffer; sumB: number; checkTotal: number } {
  const wb = XLSX.utils.book_new();
  const rows: Array<[string, number, string | number | null]> = [
    ["窗户供货", opts.corrupt ? 244080.96 : 58755.68, 244080.96],
    ["现有窗拆除及新窗安装人工", 72460, null],
    ["打胶", 3667.5, "14.67/each"],
    ["油漆恢复", 5160, "20/EACH （含油漆）"],
    ["Lift、现场保护、垃圾及物流", 15169.32, "$8,169.32(2个lift/2个月），$5000( fancing),$2000(垃圾）"],
    ["Permit、工程师、Shop Drawing及测试", 5500, null],
    ["1个PM 的工资", 25000, "5个月工资"],
    ["Bond及项目保险", 5000, null],
    ["样品、测试、出口包装及备件", 6000, null],
    ["运费+关税", 49535.86, "3900关税+4W 4个40 尺高柜"],
    ["测量费用", 2000, null],
    ["资金使用", 9274.94, 0.08],
    ["公司利润", 50316.7, 0.14],
    ["售后", 10000, null],
    ["销售现场费用", 9000, "3次（3000/each)"],
    ["Admin Fee", 11000, 0.03],
    ["佣金提成", 21564.3, null],
  ];
  const sumB = Math.round(rows.reduce((s, r) => s + r[1], 0) * 100) / 100;
  const checkTotal = 359404.12; // 真实工作簿硬编码的校验总计（与 Σ B 差 0.18）
  const aoa: (string | number | null)[][] = [["项目", "价格"], ...rows.map((r) => [r[0], r[1], r[2]]), [], [null, checkTotal]];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const addr of ["C13", "C14", "C17"]) { const c = ws[addr] as CellObject; c.t = "n"; c.z = "0%"; }
  for (const addr of ["B2", "B4", "B6", "B11", "B13", "B18"]) { const c = ws[addr] as CellObject; if (c) c.z = "#,##0.00"; }
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return { buf: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer, sumB, checkTotal };
}

const real = realLayoutWorkbook();
const rx = extractRowsFromWorkbook(real.buf);
const rwb = XLSX.read(real.buf, { type: "buffer" });
const rgrid = XLSX.utils.sheet_to_json(rwb.Sheets["Sheet1"]!, { header: 1, raw: true, defval: null, blankrows: true }) as (string | number | null)[][];
const rhdr = detectHeader(rgrid);
const rrow = (d: string) => rx.rows.find((r) => r.sourceDescription === d);
ok(!!rhdr && rhdr.rowIndex === 0 && rhdr.amountMode === "price_as_amount" && rhdr.columns.get(1) === "amount" && rhdr.columns.get(0) === "description" && !rx.notes.some((n) => n.includes("未识别表头")), "REAL-01: 「项目|价格」表头被识别（价格 在无数量/单价/总价时 = 金额；B 列 = 金额列）", rhdr && [...rhdr.columns.entries(), rhdr.amountMode]);
const rWin = rrow("窗户供货");
ok(!!rWin && rWin.sourceAmount === 58755.68 && rWin.unitCost === 58755.68 && rWin.evidence.cell === "B2" && /244080\.96/.test(rWin.notes ?? ""), "REAL-02: 窗户供货 金额取 B2 = 58,755.68（C2 244,080.96 只进备注参考，绝不当金额）", { a: rWin?.sourceAmount, cell: rWin?.evidence.cell, notes: rWin?.notes });
ok(rrow("资金使用")?.sourceAmount === 9274.94 && rrow("公司利润")?.sourceAmount === 50316.7 && rrow("Admin Fee")?.sourceAmount === 11000, "REAL-03: 百分比格式单元永不替代 B 列金额（9,274.94 / 50,316.70 / 11,000，而非 0.08 / 0.14 / 0.03）", [rrow("资金使用")?.sourceAmount, rrow("公司利润")?.sourceAmount, rrow("Admin Fee")?.sourceAmount]);
ok(rrow("资金使用")?.suggestedRate === 8 && rrow("公司利润")?.suggestedRate === 14 && rrow("Admin Fee")?.suggestedRate === 3 && [rrow("资金使用"), rrow("公司利润"), rrow("Admin Fee")].every((r) => r?.suggestedCalculationType === "FIXED"), "REAL-04: 百分比保留为 suggestedRate（8/14/3）提示；算法仍为 FIXED（不自动 PERCENT_OF_*）");
ok(rx.rows.length === 17 && !rx.rows.some((r) => r.sourceAmount === real.checkTotal) && rx.reconciliation.sheets[0]?.referenceSource === "numeric_only_row" && rx.reconciliation.sheets[0]?.referenceRow === 20 && rx.reconciliation.referenceTotal === real.checkTotal, "REAL-05: 末尾纯数字校验行（B20）不导入，识别为参考总计 359,404.12", rx.reconciliation);
const corrupt = extractRowsFromWorkbook(realLayoutWorkbook({ corrupt: true }).buf);
const buggy = reconcileTotals({ referenceTotal: 359404.12, extractedTotal: 474138.19 });
ok(corrupt.reconciliation.status === "MISMATCH" && corrupt.notes.some((n) => n.startsWith("RECONCILIATION_MISMATCH")) && buggy.status === "MISMATCH" && buggy.difference === 114734.07, "REAL-06: 故意损坏夹具（B2 被 244,080.96 顶替）→ RECONCILIATION_MISMATCH；原缺陷抽取 474,138.19 vs 359,404.12 → MISMATCH", { corrupt: corrupt.reconciliation.status, buggy });
ok(rx.reconciliation.status === "OK" && rx.reconciliation.extractedTotal === 359404.3 && rx.reconciliation.difference === 0.18 && rx.reconciliation.tolerance === reconciliationTolerance(359404.12) && reconciliationTolerance(359404.12) > 359, "REAL-07: 修正抽取 359,404.30 vs 359,404.12 → 容差内（max(1, 0.1%)）", rx.reconciliation);
const rProfit = rrow("公司利润")!;
ok(rProfit.include === false && rProfit.warnings.includes("PROFIT_PRICING_RULE_RECOMMENDED") && rrow("佣金提成")?.include === true && rrow("Admin Fee")?.include === true && rrow("资金使用")?.include === true, "REAL-08: PROFIT 行默认 include=false（PROFIT_PRICING_RULE_RECOMMENDED）；佣金/Admin/资金 不受影响");
ok(rProfit.sourceAmount === 50316.7 && rProfit.evidence.row === 14 && rProfit.evidence.cell === "B14" && /50316\.7/.test(rProfit.evidence.snippet) && /14%/.test(rProfit.evidence.snippet) && importRowSchema.safeParse(rProfit).success, "REAL-09: 利润行 provenance 完整（行 14 / B14 / 原文片段含 50316.7 与 14%）", rProfit.evidence);
ok(rx.rows.every((r) => r.sourceCurrency === null && r.warnings.includes("MISSING_CURRENCY")) && validateRowsForConfirm(rx.rows).some((i) => i.code === "MISSING_CURRENCY") && validateRowsForConfirm(rx.rows.map((r) => ({ ...r, sourceCurrency: "CAD", warnings: r.warnings.filter((w) => w !== "MISSING_CURRENCY") }))).length === 0, "REAL-10: 币种 UNRESOLVED 仍挡 Confirm；人工确认 CAD 后放行；PROFIT 提示不挡 Confirm");
ok(real.sumB === 359404.3 && rx.reconciliation.extractedTotal === real.sumB, "REAL-11: Σ B2:B18 = 359,404.30 = 抽取合计（含默认排除的利润行）");
ok(!rx.rows.some((r) => looksLikeTotalLine(r.sourceDescription)) && rx.reconciliation.extractedTotal < 2 * real.checkTotal && rx.rows.filter((r) => r.include).reduce((s, r) => s + (r.sourceAmount ?? 0), 0) === Math.round((real.sumB - 50316.7) * 100) / 100, "REAL-12: 无小计/校验行重复计入；勾选行合计 = 359,404.30 − 利润 50,316.70 = 309,087.60");

/* ── P0-A 上下文表头 ── */
const mk = (aoa: (string | number | null)[][]) => { const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet(aoa), "S"); return XLSX.write(w, { type: "buffer", bookType: "xlsx" }) as Buffer; };
const c1 = extractRowsFromWorkbook(mk([["项目", "价格"], ["窗户供货", 58755.68], ["安装", 72460]]), { confirmedCurrency: "CAD" });
ok(c1.rows.length === 2 && c1.rows[0]!.sourceAmount === 58755.68 && c1.rows[0]!.suggestedCalculationType === "FIXED" && !c1.rows[0]!.warnings.includes("AMBIGUOUS_AMOUNT_COLUMN"), "CASE-1: 项目|价格（无数量/单价/总价）→ 价格 = 金额（确定）");
const c2 = extractRowsFromWorkbook(mk([["项目", "数量", "价格"], ["窗户 Type A", 250, 235.02], ["安装", 1, 72460]]), { confirmedCurrency: "CAD" });
ok(c2.rows.length === 2 && c2.rows.every((r) => r.sourceAmount === null && r.unitCost === null && r.warnings.includes("AMBIGUOUS_AMOUNT_COLUMN")) && c2.rows[0]!.quantity === null && /235\.02/.test(c2.rows[0]!.notes ?? "") && c2.notes.some((n) => n.includes("AMBIGUOUS_AMOUNT_COLUMN")), "CASE-2: 项目|数量|价格（无总价/单价）→ 不猜单价/总价：AMBIGUOUS_AMOUNT_COLUMN，金额留空，价格值入备注", c2.rows[0]);
ok(validateRowsForConfirm(c2.rows).some((i) => i.code === "AMBIGUOUS_AMOUNT") && validateRowsForConfirm([{ ...c2.rows[0]!, quantity: 250, unitCost: 235.02, suggestedCalculationType: "PER_UNIT", suggestedCategory: "PROCUREMENT", warnings: c2.rows[0]!.warnings.filter((w) => w !== "AMBIGUOUS_AMOUNT_COLUMN" && w !== "LOW_CONFIDENCE" && w !== "AMBIGUOUS_CATEGORY") }]).length === 0, "CASE-2b: AMBIGUOUS_AMOUNT 挡 Confirm；人工填写金额（清标记）后放行");
const c3 = extractRowsFromWorkbook(mk([["项目", "数量", "单价", "总价"], ["窗户 Type A", 250, 235.02, 58755]]), { confirmedCurrency: "CAD" });
ok(c3.rows[0]!.quantity === 250 && c3.rows[0]!.unitCost === 235.02 && c3.rows[0]!.sourceAmount === 58755 && c3.rows[0]!.suggestedCalculationType === "PER_UNIT" && !c3.rows[0]!.warnings.includes("AMBIGUOUS_AMOUNT_COLUMN"), "CASE-3: 项目|数量|单价|总价 → 单价=unitCost，总价=amount（PER_UNIT）");
const c3b = extractRowsFromWorkbook(mk([["项目", "数量", "单价", "价格"], ["窗户 Type A", 250, 235.02, 58755]]), { confirmedCurrency: "CAD" });
ok(c3b.rows[0]!.unitCost === 235.02 && c3b.rows[0]!.sourceAmount === 58755 && !c3b.rows[0]!.warnings.includes("AMBIGUOUS_AMOUNT_COLUMN"), "CASE-3b: 显式 单价 压过「价格」→ 价格 = 总价");
const c4 = extractRowsFromWorkbook(mk([["项目", "价格", "总价"], ["窗户 Type A", 235.02, 58755]]), { confirmedCurrency: "CAD" });
ok(c4.rows[0]!.sourceAmount === 58755 && /235\.02/.test(c4.rows[0]!.notes ?? ""), "CASE-4: 显式 总价 存在 → 价格列忽略（只作参考）");
const c5 = extractRowsFromWorkbook(mk([["Description", "Qty", "Price"], ["Window Type A", 250, 235.02]]), { confirmedCurrency: "CAD" });
ok(c5.rows[0]!.warnings.includes("AMBIGUOUS_AMOUNT_COLUMN") && c5.rows[0]!.sourceAmount === null, "CASE-5: 英文 Description|Qty|Price 同样不猜（AMBIGUOUS）");

/* ── P0-B 无表头回退 fail-closed ── */
const f1 = extractRowsFromWorkbook(mk([["Window Type A", 250, 235.02, 58755], ["Installation", 250, 289.84, 72460], ["Caulking", 250, 14.67, 3667.5], ["Total", null, null, 134882.5]]), { confirmedCurrency: "CAD" });
ok(f1.rows.length === 3 && f1.rows[0]!.quantity === 250 && f1.rows[0]!.unitCost === 235.02 && f1.rows[0]!.sourceAmount === 58755 && f1.rows[0]!.suggestedCalculationType === "PER_UNIT" && f1.reconciliation.status === "OK", "FB-01: 无表头 描述|数量|单价|总价 → 列一致性 + 数量×单价≈总价 → 正确选列（不取最后一个数字的盲目规则）", f1.notes);
const f2 = extractRowsFromWorkbook(mk([["窗户供货", 58755.68, 244080.96], ["安装人工", 72460, null], ["打胶", 3667.5, "14.67/each"], ["资金使用", 9274.94, null], [null, 144158.12]]), { confirmedCurrency: "CAD" });
ok(f2.rows.length === 4 && f2.rows[0]!.sourceAmount === 58755.68 && /244080\.96/.test(f2.rows[0]!.notes ?? "") && f2.rows.every((r) => !r.warnings.includes("AMBIGUOUS_AMOUNT_COLUMN")) && f2.reconciliation.status === "OK", "FB-02: 无表头但 B 列结构一致（C 列稀疏）→ B 为金额列；C2 裸数字只作参考；末尾校验行对账 OK", { a: f2.rows[0]?.sourceAmount, rec: f2.reconciliation.status });
const f3 = extractRowsFromWorkbook(mk([["Item A", 250, 58755], ["Item B", 100, 72460], ["Item C", 10, 3667.5]]), { confirmedCurrency: "CAD" });
ok(f3.rows.length === 3 && f3.rows.every((r) => r.warnings.includes("AMBIGUOUS_AMOUNT_COLUMN") && r.sourceAmount === null) && f3.notes.some((n) => n.includes("金额列无法确定")) && validateRowsForConfirm(f3.rows).some((i) => i.code === "AMBIGUOUS_AMOUNT"), "FB-03: 无表头、两列都一致且无乘积关系 → 不选值：AMBIGUOUS_AMOUNT_COLUMN + Confirm 被挡", f3.notes);
const f4buf = (() => { const w = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet([["Bond", 0.08], ["Insurance", 5000]]); (ws["B1"] as CellObject).z = "0%"; XLSX.utils.book_append_sheet(w, ws, "S"); return XLSX.write(w, { type: "buffer", bookType: "xlsx" }) as Buffer; })();
const f4 = extractRowsFromWorkbook(f4buf, { confirmedCurrency: "CAD" });
ok(f4.rows.find((r) => r.sourceDescription === "Bond")?.sourceAmount === null && f4.rows.find((r) => r.sourceDescription === "Bond")?.warnings.includes("MISSING_AMOUNT") && f4.rows.find((r) => r.sourceDescription === "Bond")?.suggestedRate === 8 && f4.rows.find((r) => r.sourceDescription === "Insurance")?.sourceAmount === 5000, "FB-04 / P0-C: 行内只有百分比单元 → MISSING_AMOUNT（不是 0.08）+ suggestedRate 8；其它行正常");
const pcBuf = (() => { const w = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet([["项目", "价格"], ["Margin", 0.14], ["Bond", 5000]]); (ws["B2"] as CellObject).z = "0%"; XLSX.utils.book_append_sheet(w, ws, "S"); return XLSX.write(w, { type: "buffer", bookType: "xlsx" }) as Buffer; })();
const pc = extractRowsFromWorkbook(pcBuf, { confirmedCurrency: "CAD" });
ok(pc.rows[0]!.sourceAmount === null && pc.rows[0]!.warnings.includes("MISSING_AMOUNT") && pc.rows[0]!.suggestedRate === 14 && pc.rows[1]!.sourceAmount === 5000, "P0-C: 表头模式下金额列里的百分比格式单元 → 不是金额（MISSING_AMOUNT）+ rate 14");
ok(parseNumberCell(0.08, true).isPercent && parseNumberCell(0.08, true).value === null && parseNumberCell(0.08, true).raw === "8%", "P0-C-b: parseNumberCell(0.08, pct) → isPercent，raw \"8%\"，value null");

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
