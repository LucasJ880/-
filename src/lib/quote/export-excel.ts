/**
 * 报价单 Excel 导出 — 客户端生成
 *
 * 使用 xlsx (SheetJS)。输出 .xlsx 文件包含两个 sheet：
 * 1. 报价信息（表头字段）
 * 2. 行项目明细
 *
 * FIX-26：按导出的人能不能看成本分两种（内容由同文件的纯函数 buildQuoteExcelContent 生成，下载仍由 exportQuoteExcel 做）：
 * - 能看（有财务查看权）→ 内部成本表：首行写明含成本和利润率、不要发给客户；含「内部成本」「利润率」两行与「成本价（内部）」一列
 * - 不能看 → 首行「报价单信息」，没有这三样；其余单元格两者相同
 */

import * as XLSX from "xlsx";
import type { QuoteHeaderData, QuoteLineItemData } from "./types";
import type { QuoteTotals } from "./calculate";
import { LINE_CATEGORY_LABELS, TEMPLATE_LABELS } from "./types";
import { INTERNAL_COST_SHEET_TITLE_ZH } from "./finance-view";

interface ExportExcelOptions {
  header: QuoteHeaderData;
  lines: QuoteLineItemData[];
  totals: QuoteTotals;
  projectName: string;
  quoteVersion?: number;
  /** 导出的人有没有财务查看权（必填：漏传编译不过） */
  costVisible: boolean;
}

type Cell = string | number | null;

export function buildQuoteExcelContent(opts: ExportExcelOptions): { infoRows: Cell[][]; lineRows: Cell[][]; filename: string } {
  const { header, lines, totals, projectName, quoteVersion, costVisible } = opts;

  const infoRows: Cell[][] = [
    [costVisible ? INTERNAL_COST_SHEET_TITLE_ZH : "报价单信息", ""],
    ["项目名称", projectName],
    ["报价标题", header.title || ""],
    ["版本", quoteVersion ?? 1],
    ["模板类型", TEMPLATE_LABELS[header.templateType] ?? header.templateType],
    ["币种", header.currency],
    ["贸易方式", header.tradeTerms || ""],
    ["付款条款", header.paymentTerms || ""],
    ["交期（天）", header.deliveryDays ?? ""],
    ["有效期至", header.validUntil || ""],
    ["MOQ", header.moq ?? ""],
    ["原产地", header.originCountry || ""],
    [""],
    ["汇总", ""],
    ["小计", totals.subtotal],
    ["总金额", totals.totalAmount],
    ...(costVisible
      ? [
          ["内部成本", totals.internalCost],
          ["利润率", totals.profitMargin != null ? `${totals.profitMargin}%` : ""],
        ]
      : []),
    ["行项目数", totals.lineCount],
  ];

  const lineHeader: Cell[] = ["序号", "类别", "品名", "规格", "单位", "数量", "单价", "合计", "备注", ...(costVisible ? ["成本价（内部）"] : [])];
  const lineRows: Cell[][] = lines.map((line, idx) => [
    idx + 1,
    LINE_CATEGORY_LABELS[line.category] ?? line.category,
    line.itemName,
    line.specification,
    line.unit,
    line.quantity,
    line.unitPrice,
    line.totalPrice,
    line.remarks,
    ...(costVisible ? [line.costPrice] : []),
  ]);

  return { infoRows, lineRows: [lineHeader, ...lineRows], filename: `${header.title || "quote"}_v${quoteVersion ?? 1}.xlsx` };
}

export function exportQuoteExcel(opts: ExportExcelOptions) {
  const { infoRows, lineRows, filename } = buildQuoteExcelContent(opts);

  const wb = XLSX.utils.book_new();

  // Sheet 1: 报价信息
  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo["!cols"] = [{ wch: 16 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, "报价信息");

  // Sheet 2: 行项目
  const wsLines = XLSX.utils.aoa_to_sheet(lineRows);
  wsLines["!cols"] = [
    { wch: 6 },
    { wch: 10 },
    { wch: 30 },
    { wch: 20 },
    { wch: 8 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
    { wch: 20 },
    ...(opts.costVisible ? [{ wch: 12 }] : []),
  ];
  XLSX.utils.book_append_sheet(wb, wsLines, "行项目");

  XLSX.writeFile(wb, filename);
}
