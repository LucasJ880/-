/**
 * Vinyl 百叶窗工艺单 Excel 导出
 * 对齐 Vinyl百叶窗统一工艺单_V15.xlsx 的五张表：
 *   订单总表 / 工艺单 / 直柱汇总 / 横档百叶汇总 / 物料总表(Sheet1 (2))
 *
 * 与 Blinds 导出同纪律：导出时按录入数据**重新计算**，不信库里存的计算值。
 *
 * 布局说明：原表的「工艺单」是每扇窗 30 行的打印块。这里沿用 Blinds 导出
 * 已在产的做法 —— 每扇窗一个信息行 + 若干下料行，信息不减，但可滚动、可筛选。
 */

import ExcelJS from "exceljs";
import {
  calculateVinylItem,
  type VinylItemInput,
  type VinylOrderContext,
} from "./calculation-engine";
import {
  buildStileSummary,
  buildRailSummary,
  buildBom,
  buildTotals,
  type VinylCalcItem,
} from "./aggregation";
import { VINYL_RULE_VERSION } from "./frame-rules";
import type { PanelCodeRule } from "./panel-codes";

export interface VinylOrderData {
  code: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  installDate: string | null;
  remarks: string | null;
  /** 全单一个值：2.5 / 3.5 */
  louverSize: number;
  color: string | null;
  ruleVersion: string;
  items: VinylItemInput[];
  panelCodeOverrides?: readonly PanelCodeRule[] | null;
}

// ─── Styles（与 Blinds 导出保持一致的观感） ───────────────────

const FONT_DEFAULT: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10 };
const FONT_HEADER: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10, bold: true };
const FONT_TITLE: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 14, bold: true };
const FONT_SUBTITLE: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10, color: { argb: "FF666666" } };
const FONT_MONO: Partial<ExcelJS.Font> = { name: "Consolas", size: 10 };
const FONT_WARN: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10, color: { argb: "FFA63D3D" } };

const FILL_HEADER: ExcelJS.Fill = {
  type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" },
};
const FILL_GROUP: ExcelJS.Fill = {
  type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2F0" },
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

/** 英寸：最多 4 位有效小数显示；实际值不舍入（见 calculation-engine 的 exact()） */
const NUM_FMT_INCH = "0.####";
const NUM_FMT_2 = "0.00";

function headerRow(ws: ExcelJS.Worksheet, rowIdx: number, headers: string[], rightFrom = 99) {
  const row = ws.getRow(rowIdx);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.font = FONT_HEADER;
    cell.fill = FILL_HEADER;
    cell.border = BORDER_THIN;
    cell.alignment = i >= rightFrom ? ALIGN_RIGHT : ALIGN_CENTER;
  });
  row.height = 22;
  return row;
}

function titleBlock(
  ws: ExcelJS.Worksheet,
  lastCol: string,
  title: string,
  subtitle: string,
) {
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell("A1");
  t.value = title;
  t.font = FONT_TITLE;
  t.alignment = ALIGN_LEFT;
  ws.getRow(1).height = 28;

  ws.mergeCells(`A2:${lastCol}2`);
  const s = ws.getCell("A2");
  s.value = subtitle;
  s.font = FONT_SUBTITLE;
  ws.getRow(3).height = 6;
}

export async function generateVinylExcel(order: VinylOrderData): Promise<Buffer> {
  const ctx: VinylOrderContext = {
    louverSize: order.louverSize,
    panelCodeOverrides: order.panelCodeOverrides,
  };

  const items: VinylCalcItem[] = order.items.map((input) => ({
    input,
    calc: calculateVinylItem(input, ctx),
  }));

  const wb = new ExcelJS.Workbook();
  wb.creator = "青砚";
  wb.created = new Date();

  buildOrderSummarySheet(wb, order, items);
  buildCuttingSheet(wb, order, items);
  buildStileSheet(wb, order, items);
  buildRailSheet(wb, order, items);
  buildBomSheet(wb, order, items);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── Sheet 1: 订单总表 ────────────────────────────────────────

function buildOrderSummarySheet(
  wb: ExcelJS.Workbook,
  order: VinylOrderData,
  items: VinylCalcItem[],
) {
  const ws = wb.addWorksheet("订单总表", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [
    { width: 5 },  { width: 16 }, { width: 10 }, { width: 10 }, { width: 8 },
    { width: 10 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 },
    { width: 10 }, { width: 9 },  { width: 8 },  { width: 8 },  { width: 8 },
  ];

  titleBlock(
    ws, "O",
    `Sunny — Vinyl 工艺单 ${order.code}`,
    `客户: ${order.customerName}  |  电话: ${order.phone || "-"}  |  地址: ${order.address || "-"}  |  ` +
      `安装: ${order.installDate || "-"}  |  百叶尺寸: ${order.louverSize}"  |  颜色: ${order.color || "-"}  |  规则: ${order.ruleVersion}`,
  );

  headerRow(ws, 4, [
    "#", "位置", "宽度", "高度", "扇数", "开启状态", "分隔柱", "特殊分隔档",
    "Mid-Rail", "控制杆位置", "外框", "外框数", "IN/OUT", "结构", "SF",
  ], 2);

  let r = 5;
  let totalSf = 0;
  let totalPanels = 0;
  let totalPosts = 0;
  for (const it of items) {
    const row = ws.getRow(r++);
    const values: (string | number | null)[] = [
      it.input.itemNumber ?? r - 5,
      it.input.location ?? "",
      it.input.width,
      it.input.height,
      it.input.panelCount,
      it.input.panelCode,
      it.input.dividerSpec ?? "",
      it.input.specialMidRail ?? "",
      it.input.midRailRatio ?? "",
      it.input.tiltRodPosition ?? "",
      it.input.frameType,
      it.input.frameCount,
      it.input.inOut,
      it.input.structure,
      it.calc.squareFeet,
    ];
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v as ExcelJS.CellValue;
      cell.border = BORDER_THIN;
      const numeric = i === 2 || i === 3 || i === 7 || i === 8;
      cell.font = numeric ? FONT_MONO : FONT_DEFAULT;
      if (numeric) cell.numFmt = NUM_FMT_INCH;
      cell.alignment = numeric || i === 0 || i === 4 || i === 14 ? ALIGN_RIGHT : ALIGN_LEFT;
    });
    row.height = 18;
    totalSf += it.calc.squareFeet;
    totalPanels += Number(it.input.panelCount) || 0;
    totalPosts += it.calc.postCount;
  }

  const total = ws.getRow(r++);
  ws.mergeCells(total.number, 1, total.number, 14);
  total.getCell(1).value =
    `合计 ${items.length} 扇窗  |  百叶总扇数 ${totalPanels}  |  柱总数 ${totalPosts}`;
  total.getCell(1).font = FONT_HEADER;
  total.getCell(1).alignment = ALIGN_RIGHT;
  total.getCell(1).border = BORDER_THIN;
  total.getCell(15).value = totalSf;
  total.getCell(15).font = FONT_HEADER;
  total.getCell(15).alignment = ALIGN_RIGHT;
  total.getCell(15).border = BORDER_THIN;

  writeWarnings(ws, items, r + 1, 15);
}

/** 把各行的告警集中列在表尾——不要让「待补」在导出里消失 */
function writeWarnings(
  ws: ExcelJS.Worksheet,
  items: VinylCalcItem[],
  startRow: number,
  lastCol: number,
) {
  const all = items.flatMap((it, i) =>
    it.calc.warnings.map((w) => `#${it.input.itemNumber ?? i + 1} ${it.input.location ?? ""}: ${w.message}`),
  );
  if (all.length === 0) return;

  let r = startRow;
  const head = ws.getRow(r++);
  ws.mergeCells(head.number, 1, head.number, lastCol);
  head.getCell(1).value = `⚠ 待人工确认 ${all.length} 项`;
  head.getCell(1).font = { ...FONT_HEADER, color: { argb: "FFA63D3D" } };

  for (const msg of all) {
    const row = ws.getRow(r++);
    ws.mergeCells(row.number, 1, row.number, lastCol);
    row.getCell(1).value = msg;
    row.getCell(1).font = FONT_WARN;
    row.getCell(1).alignment = ALIGN_LEFT;
  }
}

// ─── Sheet 2: 工艺单（每扇窗信息行 + 下料行） ─────────────────

function buildCuttingSheet(
  wb: ExcelJS.Workbook,
  order: VinylOrderData,
  items: VinylCalcItem[],
) {
  const ws = wb.addWorksheet("工艺单", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [
    { width: 5 }, { width: 22 }, { width: 14 }, { width: 10 },
    { width: 9 }, { width: 9 }, { width: 10 }, { width: 24 },
  ];

  titleBlock(
    ws, "H",
    `Vinyl 百叶窗下料尺寸、工艺表 — ${order.code}`,
    `客户: ${order.customerName}  |  百叶尺寸: ${order.louverSize}"  |  规则: ${order.ruleVersion}`,
  );

  headerRow(ws, 4, ["#", "品名", "长度(in)", "数量", "角度A", "角度B", "孔距(in)", "备注"], 2);

  let r = 5;
  for (const it of items) {
    const c = it.calc;
    const n = it.input.itemNumber ?? items.indexOf(it) + 1;

    // 窗户信息行（把 30 行块里的关键中间量都摊在这一行）
    const info = ws.getRow(r++);
    ws.mergeCells(info.number, 1, info.number, 8);
    const spec = c.panelSpec ? `${c.panelSpec.strips}/${c.panelSpec.caps}` : "条盖待补";
    info.getCell(1).value =
      `#${n} ${it.input.location ?? ""}  ·  测量 ${it.input.width}″×${it.input.height}″  ·  ` +
      `${c.frameLabel ?? `外框组合待确认(J10=${c.frameSignature})`}  ·  ${it.input.structure}  ·  ` +
      `${it.input.panelCount}扇 ${it.input.panelCode}(${spec})  ·  ` +
      `内空 ${fmt(c.cavityWidth)}×${fmt(c.cavityHeight)}  ·  成品 ${fmt(c.panelWidth)}×${fmt(c.panelHeight)}  ·  ` +
      `百叶 上${c.topLouvers}/下${c.bottomLouvers} 间距 ${fmt(c.louverPitch)}` +
      (c.midRail > 0 ? `  ·  分隔档 ${fmt(c.midRail)}（从下往上 ${fmt(c.midRailFromBottom)}）` : "") +
      (c.postCount > 0 ? `  ·  ${c.postLabel}×${c.postCount}` : "");
    info.getCell(1).font = FONT_HEADER;
    info.getCell(1).fill = FILL_GROUP;
    info.getCell(1).alignment = ALIGN_LEFT;
    info.height = 20;
    for (let i = 1; i <= 8; i++) info.getCell(i).border = BORDER_THIN;

    for (const p of c.pieces) {
      const row = ws.getRow(r++);
      const values: (string | number | null)[] = [
        n,
        p.name,
        p.lengthIn,
        p.qty,
        p.angleA,
        p.angleB,
        p.pitchIn ?? null,
        p.informational ? "参考料长，不计入物料汇总" : (it.input.itemRemark ?? ""),
      ];
      values.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v as ExcelJS.CellValue;
        cell.border = BORDER_THIN;
        const numeric = i === 2 || i === 6;
        cell.font = numeric ? FONT_MONO : FONT_DEFAULT;
        if (numeric) cell.numFmt = NUM_FMT_INCH;
        cell.alignment =
          numeric ? ALIGN_RIGHT : i === 0 || i === 3 || i === 4 || i === 5 ? ALIGN_CENTER : ALIGN_LEFT;
      });
      if (p.informational) {
        for (let i = 1; i <= 8; i++) row.getCell(i).font = { ...FONT_SUBTITLE };
        row.getCell(3).font = { ...FONT_MONO, color: { argb: "FF666666" } };
      }
      row.height = 18;
    }
  }
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return String(Math.round(v * 10000) / 10000);
}

// ─── Sheet 3: 直柱汇总 ────────────────────────────────────────

function buildStileSheet(
  wb: ExcelJS.Workbook,
  order: VinylOrderData,
  items: VinylCalcItem[],
) {
  const ws = wb.addWorksheet("直柱汇总", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [
    { width: 5 }, { width: 16 }, { width: 12 }, { width: 11 }, { width: 9 },
    { width: 9 }, { width: 8 },  { width: 12 }, { width: 8 },  { width: 12 },
    { width: 8 }, { width: 7 },  { width: 7 },  { width: 11 }, { width: 11 },
    { width: 10 }, { width: 10 },
  ];

  titleBlock(ws, "Q", `直柱汇总下料明细 — ${order.code}`,
    `客户: ${order.customerName}  |  百叶尺寸: ${order.louverSize}"`);

  headerRow(ws, 4, [
    "#", "位置", "直柱长(in)", "孔距(in)", "上百叶", "下百叶", "数量",
    "上控制杆(in)", "数量", "下控制杆(in)", "数量", "条", "盖",
    "直柱(m)", "控制杆(m)", "条(m)", "盖(m)",
  ], 2);

  const rows = buildStileSummary(items);
  let r = 5;
  for (const s of rows) {
    const row = ws.getRow(r++);
    const values: (string | number | null)[] = [
      s.itemNumber, s.location, s.stileLength, s.pitch, s.topLouvers, s.bottomLouvers,
      s.stileQty, s.topRodLength, s.topRodQty, s.bottomRodLength, s.bottomRodQty,
      s.strips, s.caps, s.stileMeters, s.rodMeters, s.stripMeters, s.capMeters,
    ];
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v as ExcelJS.CellValue;
      cell.border = BORDER_THIN;
      const inch = i === 2 || i === 3 || i === 7 || i === 9;
      const meter = i >= 13;
      cell.font = inch || meter ? FONT_MONO : FONT_DEFAULT;
      if (inch) cell.numFmt = NUM_FMT_INCH;
      if (meter) cell.numFmt = NUM_FMT_2;
      cell.alignment = i === 1 ? ALIGN_LEFT : inch || meter ? ALIGN_RIGHT : ALIGN_CENTER;
    });
    row.height = 18;
  }

  const t = buildTotals(items);
  const total = ws.getRow(r);
  ws.mergeCells(total.number, 1, total.number, 13);
  total.getCell(1).value = `Total (m) · 直柱共 ${t.stileQty} 根`;
  total.getCell(1).font = FONT_HEADER;
  total.getCell(1).alignment = ALIGN_RIGHT;
  total.getCell(1).border = BORDER_THIN;
  [t.stileMeters, t.rodMeters, t.stripMeters, t.capMeters].forEach((v, i) => {
    const cell = total.getCell(14 + i);
    cell.value = v;
    cell.numFmt = NUM_FMT_2;
    cell.font = FONT_HEADER;
    cell.alignment = ALIGN_RIGHT;
    cell.border = BORDER_THIN;
  });
}

// ─── Sheet 4: 横档百叶汇总 ────────────────────────────────────

function buildRailSheet(
  wb: ExcelJS.Workbook,
  order: VinylOrderData,
  items: VinylCalcItem[],
) {
  const ws = wb.addWorksheet("横档百叶汇总", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [
    { width: 5 }, { width: 16 }, { width: 14 }, { width: 8 }, { width: 13 },
    { width: 8 }, { width: 12 }, { width: 8 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 11 }, { width: 10 },
  ];

  titleBlock(ws, "M", `上下横档、中分档、百叶片汇总下料明细 — ${order.code}`,
    `客户: ${order.customerName}  |  百叶尺寸: ${order.louverSize}"`);

  headerRow(ws, 4, [
    "#", "位置", "上下横档(in)", "数量", "中分档(in)", "数量", "百叶(in)", "数量",
    "上下横档(m)", "中分档(m)", "百叶(m)", "百叶盖头", "百叶帧",
  ], 2);

  const rows = buildRailSummary(items);
  let r = 5;
  for (const s of rows) {
    const row = ws.getRow(r++);
    const values: (string | number | null)[] = [
      s.itemNumber, s.location, s.railLength, s.railQty, s.dividerLength, s.dividerQty,
      s.louverLength, s.louverQty, s.railMeters, s.dividerMeters, s.louverMeters,
      s.louverEndCaps, s.louverConnectors,
    ];
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v as ExcelJS.CellValue;
      cell.border = BORDER_THIN;
      const inch = i === 2 || i === 4 || i === 6;
      const meter = i >= 8 && i <= 10;
      cell.font = inch || meter ? FONT_MONO : FONT_DEFAULT;
      if (inch) cell.numFmt = NUM_FMT_INCH;
      if (meter) cell.numFmt = NUM_FMT_2;
      cell.alignment = i === 1 ? ALIGN_LEFT : inch || meter ? ALIGN_RIGHT : ALIGN_CENTER;
    });
    row.height = 18;
  }

  const t = buildTotals(items);
  const total = ws.getRow(r);
  ws.mergeCells(total.number, 1, total.number, 8);
  total.getCell(1).value = "Total (m)";
  total.getCell(1).font = FONT_HEADER;
  total.getCell(1).alignment = ALIGN_RIGHT;
  total.getCell(1).border = BORDER_THIN;
  const totals = [t.railMeters, t.dividerMeters, t.louverMeters, t.louverEndCaps, t.louverConnectors];
  totals.forEach((v, i) => {
    const cell = total.getCell(9 + i);
    cell.value = v;
    cell.numFmt = i <= 2 ? NUM_FMT_2 : "0";
    cell.font = FONT_HEADER;
    cell.alignment = ALIGN_RIGHT;
    cell.border = BORDER_THIN;
  });
}

// ─── Sheet 5: 物料总表 ────────────────────────────────────────

function buildBomSheet(
  wb: ExcelJS.Workbook,
  order: VinylOrderData,
  items: VinylCalcItem[],
) {
  const ws = wb.addWorksheet("物料总表", {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [{ width: 32 }, { width: 14 }, { width: 8 }, { width: 16 }];

  const bom = buildBom(items);
  titleBlock(
    ws, "D",
    `物料总表 — ${order.code}`,
    `客户: ${order.customerName}  |  窗数 ${bom.windowCount}  |  ` +
      `型材损耗系数 ×${bom.wasteFactor}（按个计的配件不加损耗）  |  规则: ${order.ruleVersion}`,
  );

  headerRow(ws, 4, ["物料", "用量", "单位", "备注"], 1);

  let r = 5;
  for (const line of bom.lines) {
    const row = ws.getRow(r++);
    const values: (string | number)[] = [
      line.name,
      line.qty,
      line.unit,
      line.wasted ? `含 ×${bom.wasteFactor} 损耗` : "按实数",
    ];
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v as ExcelJS.CellValue;
      cell.border = BORDER_THIN;
      cell.font = i === 1 ? FONT_MONO : FONT_DEFAULT;
      if (i === 1) cell.numFmt = line.unit === "m" ? NUM_FMT_2 : "0";
      cell.alignment = i === 0 ? ALIGN_LEFT : i === 1 ? ALIGN_RIGHT : ALIGN_CENTER;
    });
    row.height = 18;
  }

  writeWarnings(ws, items, r + 1, 4);
}

export { VINYL_RULE_VERSION };
