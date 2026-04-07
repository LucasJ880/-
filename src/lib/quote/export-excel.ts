/**
 * 报价单 Excel 导出 — 客户端生成
 *
 * 使用 xlsx (SheetJS)。输出 .xlsx 文件包含两个 sheet：
 * 1. 报价信息（表头字段）
 * 2. 行项目明细
 */

import * as XLSX from "xlsx";
import type { QuoteHeaderData, QuoteLineItemData } from "./types";
import type { QuoteTotals } from "./calculate";
import { LINE_CATEGORY_LABELS, TEMPLATE_LABELS } from "./types";

interface ExportExcelOptions {
  header: QuoteHeaderData;
  lines: QuoteLineItemData[];
  totals: QuoteTotals;
  projectName: string;
  quoteVersion?: number;
}

export function exportQuoteExcel(opts: ExportExcelOptions) {
  const { header, lines, totals, projectName, quoteVersion } = opts;

  const wb = XLSX.utils.book_new();

  // Sheet 1: 报价信息
  const infoRows = [
    ["报价单信息", ""],
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
    ["内部成本", totals.internalCost],
    ["利润率", totals.profitMargin != null ? `${totals.profitMargin}%` : ""],
    ["行项目数", totals.lineCount],
  ];

  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo["!cols"] = [{ wch: 16 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, "报价信息");

  // Sheet 2: 行项目
  const lineHeader = ["序号", "类别", "品名", "规格", "单位", "数量", "单价", "合计", "备注", "成本价（内部）"];
  const lineRows = lines.map((line, idx) => [
    idx + 1,
    LINE_CATEGORY_LABELS[line.category] ?? line.category,
    line.itemName,
    line.specification,
    line.unit,
    line.quantity,
    line.unitPrice,
    line.totalPrice,
    line.remarks,
    line.costPrice,
  ]);

  const wsLines = XLSX.utils.aoa_to_sheet([lineHeader, ...lineRows]);
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
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsLines, "行项目");

  const filename = `${header.title || "quote"}_v${quoteVersion ?? 1}.xlsx`;
  XLSX.writeFile(wb, filename);
}
