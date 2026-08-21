/**
 * Quote Operations Phase 2 · 成本导入纯逻辑测试（XLSX / CSV / PDF 抽取 + 分类 + 确认校验）
 * 运行：npx tsx src/lib/quote-engine/__tests__/quote-import.test.ts
 */
import * as XLSX from "xlsx";
import { classifyDescription, looksLikeTotalLine } from "../import/classify";
import { validateRowsForConfirm, importRowSchema } from "../import/contract";
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
const ex3 = extractRowsFromWorkbook(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }) as Buffer, { defaultCurrency: "CAD" });
ok(ex3.rows[0]?.sourceCurrency === "CAD" && !ex3.rows[0]?.warnings.includes("MISSING_CURRENCY"), "XLS-16: 报价币种作为默认币种兜底");

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

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
