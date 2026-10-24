/**
 * Blinds 工艺单 Excel 导出
 *
 * 导出时基于录入数据重新执行计算，不依赖已存储的计算值。
 * 重算一律用 **该工单自己的 ruleVersion**，不是当前版本 ——
 * 已经开过料的单再导一次必须拿到一模一样的尺寸。
 */

import ExcelJS from "exceljs";
import {
  calculateItem,
  getCordLengthTier,
  calcZebraCuttingPosition,
  type CuttingResults,
} from "./calculation-engine";
import {
  resolveRuleVersion,
  CUTTING_WASTE_FACTOR,
  CONTROL_TYPE_SHOP_LABEL,
  type ControlType,
} from "./deduction-rules";

interface OrderData {
  code: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  installDate: string | null;
  remarks: string | null;
  ruleVersion: string;
  createdAt: Date | string;
  items: ItemData[];
}

interface ItemData {
  itemNumber: number;
  location: string;
  width: number;
  height: number;
  fabricSku: string;
  productType: string;
  measureType: string;
  controlType: string;
  controlSide: string;
  headrailType: string;
  mountType: string;
  fabricRatio: number | null;
  silkRatio: number | null;
  bottomBarWidth: number | null;
  itemRemark: string | null;
}

interface CalcItem extends ItemData {
  calc: CuttingResults;
}

// ─── Styles ────────────────────────────────────────────────────

const FONT_DEFAULT: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10 };
const FONT_HEADER: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10, bold: true };
const FONT_TITLE: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 14, bold: true };
const FONT_SUBTITLE: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10, color: { argb: "FF666666" } };
const FONT_MONO: Partial<ExcelJS.Font> = { name: "Consolas", size: 10 };

const FILL_HEADER: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" },
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};

const ALIGN_CENTER: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" };
const ALIGN_RIGHT: Partial<ExcelJS.Alignment> = { horizontal: "right", vertical: "middle" };
const ALIGN_LEFT: Partial<ExcelJS.Alignment> = { horizontal: "left", vertical: "middle" };

// ─── Helpers ───────────────────────────────────────────────────

/** 英寸值格式化：去掉尾零，保留实际精度 */
function fmtInch(v: number | null): string | number {
  if (v == null) return "";
  return v;
}

/** 小数数字格式（Excel numFmt）: 保留到实际精度，最多4位 */
const NUM_FMT_INCH = "0.####";
const NUM_FMT_2 = "0.00";

function getBarValue(item: CalcItem): number | null {
  if (item.productType === "卷帘") return item.calc.cutRollerBar;
  if (item.productType === "斑马帘") return item.calc.cutZebraBar;
  return item.calc.cutShangrilaBar;
}

// ─── Main Export ───────────────────────────────────────────────

export async function generateBlindsExcel(order: OrderData): Promise<Buffer> {
  // 用工单自己的规则版本重算（历史单必须重现历史尺寸）
  const version = resolveRuleVersion(order.ruleVersion);
  const calcItems: CalcItem[] = order.items.map((item) => ({
    ...item,
    calc: calculateItem(
      {
        width: item.width,
        height: item.height,
        productType: item.productType,
        measureType: item.measureType,
        controlType: item.controlType,
        headrailType: item.headrailType,
        fabricRatio: item.fabricRatio,
        silkRatio: item.silkRatio,
        bottomBarWidth: item.bottomBarWidth,
        fabricSku: item.fabricSku,
      },
      version
    ),
  }));

  const wb = new ExcelJS.Workbook();
  wb.creator = "青砚";
  wb.created = new Date();

  buildPartsCuttingSheet(wb, order, calcItems, version);
  buildOrderSheet(wb, order, calcItems, version);
  buildFabricCuttingSheet(wb, order, calcItems, version);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── Sheet 1: 开料表 ──────────────────────────────────────────

function buildPartsCuttingSheet(
  wb: ExcelJS.Workbook,
  order: OrderData,
  items: CalcItem[],
  version: string
) {
  const ws = wb.addWorksheet("开料表", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  // Column widths matching factory layout
  ws.columns = [
    { width: 5 },   // A: #
    { width: 18 },  // B: 位置
    { width: 10 },  // C: 产品
    { width: 8 },   // D: 操控
    { width: 16 },  // E: 罩盒类型
    { width: 9 },   // F: 切割类型
    { width: 12 },  // G: 罩盒尺寸
    { width: 12 },  // H: 38管
    { width: 12 },  // I: 下杆
    { width: 12 },  // J: 圆芯杆
    { width: 12 },  // K: 面料宽
    { width: 12 },  // L: 插片
    { width: 6 },   // M: 数量
  ];

  // Row 1: Title
  ws.mergeCells("A1:M1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `开料表 — ${order.code}`;
  titleCell.font = FONT_TITLE;
  titleCell.alignment = ALIGN_LEFT;
  ws.getRow(1).height = 28;

  // Row 2: Subtitle
  ws.mergeCells("A2:M2");
  const subCell = ws.getCell("A2");
  subCell.value = `客户: ${order.customerName}  |  安装: ${order.installDate || "-"}  |  规则: ${version}`;
  subCell.font = FONT_SUBTITLE;

  // Row 3: blank
  ws.getRow(3).height = 6;

  // Row 4: Header
  // 切割类型对齐 开料表!O 列（车间按 A/B/C 分组开料）
  const headers = ["#", "位置", "产品", "操控", "罩盒类型", "切割类型", "罩盒尺寸", "38管", "下杆", "圆芯杆", "面料宽", "插片", "数量"];
  const NUM_FIRST = 6; // F 列起是尺寸数字
  const NUM_LAST = 11; // K/L 列止（插片）
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = FONT_HEADER;
    cell.fill = FILL_HEADER;
    cell.border = BORDER_THIN;
    cell.alignment = i >= NUM_FIRST ? ALIGN_RIGHT : ALIGN_CENTER;
  });
  headerRow.height = 22;

  // Data rows — sorted by sortOrder
  const sorted = [...items].sort((a, b) => a.calc.sortOrder - b.calc.sortOrder);

  sorted.forEach((item, idx) => {
    const row = ws.getRow(5 + idx);
    const c = item.calc;

    const barVal = getBarValue(item);

    const values: (string | number | null)[] = [
      idx + 1,
      item.location,
      item.productType,
      CONTROL_TYPE_SHOP_LABEL[item.controlType as ControlType] ?? item.controlType,
      item.headrailType,
      c.cutClass,
      fmtInch(c.cutHeadrail),
      fmtInch(c.cutTube38),
      fmtInch(barVal),
      fmtInch(c.cutCoreRod),
      fmtInch(c.cutFabricWidth),
      fmtInch(c.insertSize),
      c.quantities.tube38,
    ];

    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v as ExcelJS.CellValue;
      cell.font = i >= NUM_FIRST && i <= NUM_LAST ? FONT_MONO : FONT_DEFAULT;
      cell.border = BORDER_THIN;
      cell.alignment =
        i >= NUM_FIRST
          ? ALIGN_RIGHT
          : (i === 0 || i === 5 ? ALIGN_CENTER : ALIGN_LEFT);
      if (typeof v === "number" && i >= NUM_FIRST && i <= NUM_LAST) {
        cell.numFmt = NUM_FMT_INCH;
      }
    });
    row.getCell(13).alignment = ALIGN_CENTER;
    row.height = 18;
  });

  // 合计行 ①：扇数
  const countRow = ws.getRow(5 + sorted.length);
  ws.mergeCells(countRow.number, 1, countRow.number, 12);
  countRow.getCell(1).value = `合计 ${sorted.length} 扇`;
  countRow.getCell(1).font = FONT_HEADER;
  countRow.getCell(1).alignment = ALIGN_RIGHT;
  countRow.getCell(1).border = BORDER_THIN;
  countRow.getCell(13).value = sorted.length;
  countRow.getCell(13).font = FONT_HEADER;
  countRow.getCell(13).alignment = ALIGN_CENTER;
  countRow.getCell(13).border = BORDER_THIN;

  // 合计行 ②：各部件用料米数 —— 对齐 开料表!B55 的口径
  //   SUM(长度) × 0.0254 × 1.2
  // 注意：原表这个 SUM **不乘裁剪数量**，双轨单会少算一半，1.2 是他们的余量系数。
  // 这里保持与车间现行口径一致，不擅自改动采购数字；要改需业务确认后单独提。
  const meterRow = ws.getRow(6 + sorted.length);
  ws.mergeCells(meterRow.number, 1, meterRow.number, 5);
  meterRow.getCell(1).value = `总计(米) ×${CUTTING_WASTE_FACTOR} 损耗`;
  meterRow.getCell(1).font = FONT_HEADER;
  meterRow.getCell(1).alignment = ALIGN_RIGHT;
  meterRow.getCell(1).border = BORDER_THIN;
  meterRow.getCell(6).border = BORDER_THIN;

  const meterCols: [number, (c: CuttingResults, it: CalcItem) => number | null][] = [
    [7, (c) => c.cutHeadrail],
    [8, (c) => c.cutTube38],
    [9, (_c, it) => getBarValue(it)],
    [10, (c) => c.cutCoreRod],
    [11, (c) => c.cutFabricWidth],
    [12, (c) => c.insertSize],
  ];
  for (const [col, pick] of meterCols) {
    const inches = sorted.reduce((sum, it) => sum + (pick(it.calc, it) ?? 0), 0);
    const cell = meterRow.getCell(col);
    cell.value = inches > 0
      ? Math.round(inches * 0.0254 * CUTTING_WASTE_FACTOR * 100) / 100
      : "";
    cell.numFmt = NUM_FMT_2;
    cell.font = FONT_HEADER;
    cell.alignment = ALIGN_RIGHT;
    cell.border = BORDER_THIN;
  }
  meterRow.getCell(13).border = BORDER_THIN;
}

// ─── Sheet 2: 工艺单 ──────────────────────────────────────────

function buildOrderSheet(
  wb: ExcelJS.Workbook,
  order: OrderData,
  items: CalcItem[],
  version: string
) {
  const ws = wb.addWorksheet("工艺单", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  ws.columns = [
    { width: 5 },   // A: #
    { width: 18 },  // B: 位置
    { width: 11 },  // C: 宽度
    { width: 11 },  // D: 高度
    { width: 13 },  // E: 面料号
    { width: 10 },  // F: 产品
    { width: 7 },   // G: 测量
    { width: 7 },   // H: 操控
    { width: 5 },   // I: 侧
    { width: 16 },  // J: 罩盒类型
    { width: 7 },   // K: 安装
    { width: 9 },   // L: SF
    { width: 14 },  // M: 备注
  ];

  // Row 1: Title
  ws.mergeCells("A1:M1");
  const title = ws.getCell("A1");
  title.value = `Blinds 工艺单 — ${order.code}`;
  title.font = FONT_TITLE;
  ws.getRow(1).height = 28;

  // Row 2-3: Order info
  const infoRows: [string, string][] = [
    ["客户", order.customerName],
    ["电话", order.phone || "-"],
    ["地址", order.address || "-"],
    ["安装时间", order.installDate || "-"],
    ["备注", order.remarks || "-"],
  ];

  let r = 2;
  for (let i = 0; i < infoRows.length; i += 3) {
    const row = ws.getRow(r);
    for (let j = 0; j < 3 && i + j < infoRows.length; j++) {
      const colBase = j * 4 + 1;
      const labelCell = row.getCell(colBase);
      labelCell.value = infoRows[i + j][0] + ":";
      labelCell.font = { ...FONT_DEFAULT, color: { argb: "FF999999" } };
      labelCell.alignment = ALIGN_RIGHT;
      const valCell = row.getCell(colBase + 1);
      valCell.value = infoRows[i + j][1];
      valCell.font = FONT_DEFAULT;
    }
    r++;
  }
  r++; // blank row

  // Header row
  const headers = ["#", "位置", "宽度", "高度", "面料号", "产品", "测量", "操控", "侧", "罩盒类型", "安装", "SF", "备注"];
  const headerRow = ws.getRow(r);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = FONT_HEADER;
    cell.fill = FILL_HEADER;
    cell.border = BORDER_THIN;
    cell.alignment = (i === 2 || i === 3 || i === 11) ? ALIGN_RIGHT : ALIGN_CENTER;
  });
  headerRow.height = 22;
  r++;

  // Data rows
  items.forEach((item, idx) => {
    const row = ws.getRow(r + idx);
    const c = item.calc;

    const values: (string | number | null)[] = [
      idx + 1,
      item.location,
      item.width,
      item.height,
      item.fabricSku,
      item.productType,
      item.measureType,
      CONTROL_TYPE_SHOP_LABEL[item.controlType as ControlType] ?? item.controlType,
      item.controlSide,
      item.headrailType,
      item.mountType,
      c.squareFeet,
      item.itemRemark || "",
    ];

    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v as ExcelJS.CellValue;
      cell.font = (i === 2 || i === 3 || i === 11) ? FONT_MONO : FONT_DEFAULT;
      cell.border = BORDER_THIN;
      if (i === 2 || i === 3) {
        cell.numFmt = NUM_FMT_INCH;
        cell.alignment = ALIGN_RIGHT;
      } else if (i === 11) {
        cell.numFmt = NUM_FMT_2;
        cell.alignment = ALIGN_RIGHT;
      } else {
        cell.alignment = i === 0 ? ALIGN_CENTER : ALIGN_LEFT;
      }
    });
    row.height = 18;
  });

  // Total row
  const totalSF = items.reduce((s, i) => s + i.calc.squareFeet, 0);
  const totalRowIdx = r + items.length;
  const totalRow = ws.getRow(totalRowIdx);
  ws.mergeCells(totalRowIdx, 1, totalRowIdx, 11);
  totalRow.getCell(1).value = `合计 ${items.length} 扇`;
  totalRow.getCell(1).font = FONT_HEADER;
  totalRow.getCell(1).alignment = ALIGN_RIGHT;
  totalRow.getCell(1).border = BORDER_THIN;
  totalRow.getCell(12).value = Math.round(totalSF * 100) / 100;
  totalRow.getCell(12).numFmt = NUM_FMT_2;
  totalRow.getCell(12).font = FONT_HEADER;
  totalRow.getCell(12).alignment = ALIGN_RIGHT;
  totalRow.getCell(12).border = BORDER_THIN;
  totalRow.getCell(13).value = `${version}`;
  totalRow.getCell(13).font = FONT_SUBTITLE;
  totalRow.getCell(13).border = BORDER_THIN;
}

// ─── Sheet 3: 开料表（布料）─────────────────────────────────────

function buildFabricCuttingSheet(
  wb: ExcelJS.Workbook,
  order: OrderData,
  items: CalcItem[],
  version: string
) {
  const ws = wb.addWorksheet("开料表（布料）", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  ws.columns = [
    { width: 5 },   // A: #
    { width: 14 },  // B: 面料号
    { width: 12 },  // C: 面料宽
    { width: 12 },  // D: 面料长
    { width: 11 },  // E: 拉绳(m)
    { width: 11 },  // F: 绳套(m)
    { width: 13 },  // G: 拉绳分档
    { width: 13 },  // H: 布纱比
    { width: 12 },  // I: 裁剪位
    { width: 6 },   // J: 侧
    { width: 18 },  // K: 位置
  ];

  // Row 1: Title
  ws.mergeCells("A1:K1");
  ws.getCell("A1").value = `开料表（布料）— ${order.code}`;
  ws.getCell("A1").font = FONT_TITLE;
  ws.getRow(1).height = 28;

  // Row 2: Subtitle
  ws.mergeCells("A2:K2");
  ws.getCell("A2").value = `客户: ${order.customerName}  |  规则: ${version}`;
  ws.getCell("A2").font = FONT_SUBTITLE;

  ws.getRow(3).height = 6;

  // Header row
  // 布纱比 / 裁剪位：斑马帘专用（纵向Ref!C28/D28）。
  // 布纱比查不到时留 "缺" —— 猜错裁剪位整幅面料报废，宁可空着让人补。
  const headers = ["#", "面料号", "面料宽", "面料长", "拉绳(m)", "绳套(m)", "拉绳分档", "布纱比", "裁剪位", "侧", "位置"];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = FONT_HEADER;
    cell.fill = FILL_HEADER;
    cell.border = BORDER_THIN;
    cell.alignment = (i >= 2 && i <= 5) ? ALIGN_RIGHT : ALIGN_CENTER;
  });
  headerRow.height = 22;

  // Sort by fabricSku then sortOrder
  const sorted = [...items].sort((a, b) => {
    const skuCmp = a.fabricSku.localeCompare(b.fabricSku);
    if (skuCmp !== 0) return skuCmp;
    return a.calc.sortOrder - b.calc.sortOrder;
  });

  let totalCord = 0;
  let totalSleeve = 0;

  sorted.forEach((item, idx) => {
    const row = ws.getRow(5 + idx);
    const c = item.calc;
    const cordTier = getCordLengthTier(item.height, item.controlType, version);

    totalCord += c.cordLength ?? 0;
    totalSleeve += c.cordSleeveLen ?? 0;

    const isZebra = item.productType === "斑马帘";
    const ratioText = !isZebra
      ? ""
      : c.fabricRatioUsed != null && c.silkRatioUsed != null
        ? `${c.fabricRatioUsed} : ${c.silkRatioUsed}`
        : c.ratioSource === "conflict"
          ? "目录冲突"
          : "缺";
    const cutPos =
      isZebra && c.fabricRatioUsed != null && c.silkRatioUsed != null
        ? calcZebraCuttingPosition(item.height, c.fabricRatioUsed, c.silkRatioUsed)
        : null;

    const values: (string | number | null)[] = [
      idx + 1,
      item.fabricSku,
      fmtInch(c.cutFabricWidth),
      fmtInch(c.cutFabricLength),
      c.cordLength,
      c.cordSleeveLen,
      cordTier || "",
      ratioText,
      cutPos,
      item.controlSide,
      item.location,
    ];

    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v as ExcelJS.CellValue;
      cell.border = BORDER_THIN;
      if (i === 2 || i === 3 || i === 8) {
        cell.font = FONT_MONO;
        cell.numFmt = NUM_FMT_INCH;
        cell.alignment = ALIGN_RIGHT;
      } else if (i === 4 || i === 5) {
        cell.font = FONT_MONO;
        cell.numFmt = NUM_FMT_2;
        cell.alignment = ALIGN_RIGHT;
      } else if (i === 7) {
        cell.font = FONT_MONO;
        cell.alignment = ALIGN_CENTER;
      } else {
        cell.font = FONT_DEFAULT;
        cell.alignment = i === 0 ? ALIGN_CENTER : ALIGN_LEFT;
      }
    });
    row.height = 18;
  });

  // Total row
  const totalRowIdx = 5 + sorted.length;
  const totalRow = ws.getRow(totalRowIdx);
  ws.mergeCells(totalRowIdx, 1, totalRowIdx, 4);
  totalRow.getCell(1).value = "合计";
  totalRow.getCell(1).font = FONT_HEADER;
  totalRow.getCell(1).alignment = ALIGN_RIGHT;
  totalRow.getCell(1).border = BORDER_THIN;
  totalRow.getCell(5).value = Math.round(totalCord * 100) / 100;
  totalRow.getCell(5).numFmt = NUM_FMT_2;
  totalRow.getCell(5).font = FONT_HEADER;
  totalRow.getCell(5).alignment = ALIGN_RIGHT;
  totalRow.getCell(5).border = BORDER_THIN;
  totalRow.getCell(6).value = Math.round(totalSleeve * 100) / 100;
  totalRow.getCell(6).numFmt = NUM_FMT_2;
  totalRow.getCell(6).font = FONT_HEADER;
  totalRow.getCell(6).alignment = ALIGN_RIGHT;
  totalRow.getCell(6).border = BORDER_THIN;
  for (let i = 7; i <= 11; i++) {
    totalRow.getCell(i).border = BORDER_THIN;
  }
}
