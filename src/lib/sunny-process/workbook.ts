/**
 * 工艺单导出：国内下单 / 窗帘 / Vinyl / 外采购单 / 标签 / 待核对 工作表（Blinds 三表在 src/lib/blinds/excel-export.ts）。
 * 导出时从最新工艺参数重新计算，不读任何存储的计算值；不输出任何价格 / 成本 / 定金。
 */

import type ExcelJS from "exceljs";
import { buildDomesticLabels, computeDomesticRow } from "./domestic-calc";
import { DRAPE_NOTES_ZH, computeDrapeRow, totalDrapeMaterials } from "./drapes-calc";
import { SECTION_LABEL_ZH, cuttableVinylLines, vinylHeaderOf, type ProcessIssue } from "./issues";
import type { ProcessSpec } from "./process-spec";
import { buildVinylCutList, buildVinylLabels, computeVinylWindow } from "./vinyl-calc";
import { sixteenthsText } from "./excel-fns";

export const FONT_DEFAULT: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10 };
export const FONT_HEADER: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10, bold: true };
export const FONT_TITLE: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 14, bold: true };
export const FONT_SUBTITLE: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10, color: { argb: "FF666666" } };
export const FONT_WARN: Partial<ExcelJS.Font> = { name: "微软雅黑", size: 10, bold: true, color: { argb: "FFB91C1C" } };
export const FILL_HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
export const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};

export interface ExportOrderHeader {
  code: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  installDate: string | null;
}

type Cell = string | number | null;

const finite = (x: number | null | undefined): Cell => (typeof x === "number" && Number.isFinite(x) ? x : x === null || x === undefined ? null : "错误");

/** 标题 + 副标题 + 表头 + 数据行；返回下一空行号 */
function table(ws: ExcelJS.Worksheet, title: string, subtitle: string, headers: string[], rows: Cell[][], widths: number[]): number {
  ws.columns = widths.map((width) => ({ width }));
  ws.mergeCells(1, 1, 1, headers.length);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = FONT_TITLE;
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, headers.length);
  ws.getCell(2, 1).value = subtitle;
  ws.getCell(2, 1).font = FONT_SUBTITLE;
  const hr = ws.getRow(4);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = FONT_HEADER;
    c.fill = FILL_HEADER;
    c.border = BORDER_THIN;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  hr.height = 30;
  rows.forEach((vals, r) => {
    const row = ws.getRow(5 + r);
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.font = FONT_DEFAULT;
      c.border = BORDER_THIN;
      if (typeof v === "number") c.numFmt = Number.isInteger(v) ? "0" : "0.####";
    });
  });
  return 5 + rows.length;
}

function labelsSheet(wb: ExcelJS.Workbook, name: string, labels: (string | null)[][]) {
  const ws = wb.addWorksheet(name, { pageSetup: { orientation: "portrait" } });
  ws.columns = [{ width: 6 }, { width: 46 }];
  let r = 1;
  labels.forEach((lines, i) => {
    lines.forEach((line, j) => {
      const row = ws.getRow(r + j);
      if (j === 0) row.getCell(1).value = i + 1;
      row.getCell(2).value = line ?? "（原件此行为错误值：扇数与开合编码不符）";
      row.getCell(2).font = j === 0 ? FONT_HEADER : line === null ? FONT_WARN : FONT_DEFAULT;
    });
    r += lines.length;
  });
}

export function addDomesticSheets(wb: ExcelJS.Workbook, order: ExportOrderHeader, spec: ProcessSpec) {
  if (spec.domestic.length === 0) return;
  const ws = wb.addWorksheet("国内下单表", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
  const rows = spec.domestic.map((d, i) => {
    const r = computeDomesticRow(d);
    return [i + 1, d.code, d.widthIn, d.heightIn, r.widthCm, r.heightCm, d.productType, d.sku, d.measure, d.control, d.side, d.headrail, d.mount, d.remark, r.sqm] as Cell[];
  });
  table(ws, `Sunny - Blinds 国内下单表 — ${order.code}`, `客户: ${order.customerName}  |  口径: 原件《Blinds 国内下单表》`,
    ["序号", "编号", "宽(in)", "高(in)", "宽(cm)", "高(cm)", "产品类型", "货号", "测量方式", "操控方式", "拉杆位置", "罩盒类型", "安装方式", "备注", "平方(㎡)"],
    rows, [5, 14, 9, 9, 9, 9, 10, 16, 9, 9, 9, 14, 9, 22, 9]);
  labelsSheet(wb, "国内下单标签", buildDomesticLabels(order.code, spec.domestic));
}

export function addDrapeSheets(wb: ExcelJS.Workbook, order: ExportOrderHeader, spec: ProcessSpec) {
  if (spec.drapes.length === 0) return;
  const version = spec.settings.drapeVersion;
  const results = spec.drapes.map((d) => computeDrapeRow(d, version));
  const ws = wb.addWorksheet("窗帘工艺单", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
  const rows = spec.drapes.map((d, i) => {
    const r = results[i]!;
    return [i + 1, d.location, d.widthIn, d.heightIn, r.widthCm, r.heightCm, r.pleatTopCm, r.finishedWidthCm, r.finishedHeightCm,
      d.sku, d.qty, d.craft, d.layer, d.liner, r.beadBagCount, r.beadClip ?? "", d.fullness, d.mount, d.rod, d.rodColor] as Cell[];
  });
  const next = table(ws, `SUNNY SHUTTER INC - 采购订单明细(Drapes and Sheer) — ${order.code}`, `客户: ${order.customerName}  |  版本: ${version} 蛇形帘  |  口径: 原件《${version} 窗帘工艺单》`,
    ["序号", "位置", "测量宽(in)", "测量高(in)", "测量宽(cm)", "成品高(cm)", "韩褶上端褶后宽(cm)/扇", "成品帘子宽(cm)/扇", "成品帘子高(cm)", "面料色号", "数量", "工艺", "布/纱", "遮光底布", "走珠布袋颗数/扇", "走珠扣类型", "褶皱倍数", "安装方式", "杆子类型", "杆子颜色"],
    rows, [5, 14, 9, 9, 9, 9, 11, 11, 10, 12, 6, 8, 6, 8, 10, 9, 8, 9, 9, 8]);
  DRAPE_NOTES_ZH.forEach((t, i) => {
    ws.getCell(next + 1 + i, 1).value = t;
    ws.getCell(next + 1 + i, 1).font = FONT_DEFAULT;
  });

  const wm = wb.addWorksheet("窗帘物料");
  const mrows = spec.drapes.map((d, i) => {
    const m = results[i]!.materials;
    return [i + 1, d.location, m.rodM, m.fabricSqm, m.beadBagM, m.hooks, m.pleatBeads] as Cell[];
  });
  const tot = totalDrapeMaterials(results);
  mrows.push(["合计", "杆子×1.2 / 布料×1.3", tot.rodM, tot.fabricSqm, tot.beadBagM, tot.hooks, tot.pleatBeads]);
  table(wm, `窗帘物料汇总 — ${order.code}`, "口径: 原件 Sheet1（杆子含 20% 余量、布料含 30% 余量）",
    ["序号", "位置", "杆子(米)", "布料(平方米)", "走珠布袋(米)", "安装码(个)", "韩褶走珠(个)"], mrows, [6, 18, 10, 12, 12, 10, 12]);
}

export function addVinylSheets(wb: ExcelJS.Workbook, order: ExportOrderHeader, spec: ProcessSpec, issues: ProcessIssue[]) {
  if (spec.vinyl.length === 0) return;
  const header = vinylHeaderOf(spec, order.code);
  const computed = spec.vinyl.map((w, k) => ({ input: w, result: computeVinylWindow(w, header), windowNo: k + 1 }));

  const ws = wb.addWorksheet("Vinyl 工艺单", { pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1 } });
  ws.columns = [{ width: 14 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }];
  ws.mergeCells(1, 1, 1, 7);
  ws.getCell(1, 1).value = `Vinyl百叶窗下料尺寸、工艺表 — ${order.code}`;
  ws.getCell(1, 1).font = FONT_TITLE;
  ws.getCell(2, 1).value = `客户: ${order.customerName}  |  颜色: ${header.color}  |  百叶尺寸: ${header.louver}"  |  默认控制杆: ${header.defaultRod || "-"}  |  口径: 原件《Vinyl shutters 工艺单 AIV1》`;
  ws.getCell(2, 1).font = FONT_SUBTITLE;
  let r = 4;
  const put = (vals: Cell[], font = FONT_DEFAULT) => {
    const row = ws.getRow(r++);
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.font = font;
      if (typeof v === "number") c.numFmt = "0.###";
    });
  };
  for (const { input: w, result: x, windowNo } of computed) {
    const blocked = issues.filter((i) => i.section === "vinyl" && i.line === windowNo && i.level === "block");
    put([`#${windowNo} ${w.location}`, `${w.width} × ${w.height} in`, `${w.panels} 扇 ${w.openCode}`, `${w.structure} ${w.frame} ${w.inOut} ${w.frameCount}`, `柱 ${w.posts || "-"}`, `切分 ${x.splitKey}`], FONT_HEADER);
    if (blocked.length > 0) {
      blocked.forEach((b) => put([`⚠ 阻断：${b.messageZh}`], FONT_WARN));
      r++;
      continue;
    }
    put(["内空宽", finite(x.innerWidth), "内空高", finite(x.innerHeight), "开启代码", x.openKey === 0 ? "-" : x.openKey]);
    put(["成品扇宽", finite(x.panelWidth), "成品扇高", finite(x.panelHeight), "孔距", finite(x.pitch)]);
    put(["第一档(换算)", finite(x.rail1), "第一档(实际)", finite(x.rail1Actual), "控制杆位置", x.rodPosition || "-"]);
    if (w.rail2In) put(["第二档(换算)", finite(x.rail2), "第二档(实际)", finite(x.rail2Actual), "中段百叶", finite(x.louverMiddle)]);
    put(["百叶片 上", finite(x.louverUpper), "下", finite(x.louverLower), "每扇合计", finite(x.louverTotal)]);
    put(["品名", "长度(in)", "16分", "数量", "角度A", "角度B", "第二长度"], FONT_HEADER);
    const piece = (name: string, len: number, qty: number, a: Cell = null, b: Cell = null, second: number | null = null) => {
      if (!(Number.isFinite(len) && len > 0 && Number.isFinite(qty) && qty > 0)) return;
      put([name, len, sixteenthsText(len), qty, a, b, second && second > 0 ? second : null]);
    };
    if (w.structure !== "无框") {
      piece(`框-宽 ${w.frame}`, x.frameW, x.frameWQty, x.frameWAngleA, x.frameWAngleB, x.frameW2);
      piece(`框-高 ${w.frame}`, x.frameH, x.frameHQty, x.frameHAngleA, x.frameHAngleB, x.frameH2);
      piece("底框（Z切边）", x.zSill, x.zSillQty, x.zSillAngleA, x.zSillAngleB);
    }
    piece(x.postName, x.postLen, x.postQty);
    piece("直柱", x.stileLen, x.stileQty);
    piece("上下横档", x.railLen, x.railQty);
    piece("中间分隔档", x.midRailLen, x.midRailQty);
    piece(`百叶片 ${header.louver}"`, x.louverLen, x.louverQty);
    piece("控制杆（上）", x.rodUpper, x.rodUpperQty, null, null, x.rodUpper2);
    piece("控制杆（中段）", x.rodMiddle, x.rodMiddleQty);
    piece("控制杆（下）", x.rodLower, x.rodLowerQty, null, null, x.rodLower2);
    if (x.message) put([x.message]);
    r++;
  }

  // 有阻断的窗不进下料总表与标签
  const ok = cuttableVinylLines(spec, issues);
  const cuttable = computed.filter((c) => ok.has(c.windowNo));
  const excluded = computed.length - cuttable.length;
  const cut = buildVinylCutList(cuttable, header, { includePosts: true });
  const wc = wb.addWorksheet("Vinyl 下料总表", { pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1 } });
  const total = cut.reduce((s, c) => s + c.qty, 0);
  table(wc, "生产下料总表", `订单：${order.code}   窗：${cuttable.filter((c) => c.input.panels > 0).length}${excluded > 0 ? `（另有 ${excluded} 窗有阻断，未计入）` : ""}   下料总数量：${total}   同料型先长后短；相同1/16长度及端头合并数量（含 T柱 / 挂柱，见报告偏离 X-4）`,
    ["顺序", "料型", "规格", "长度(in)", "16分", "数量", "端头角度", "对应窗号×数量", "完成"],
    cut.map((c) => [c.seq, c.type, c.spec, c.length, sixteenthsText(c.length), c.qty, c.ends, c.windows, ""] as Cell[]),
    [6, 10, 10, 10, 10, 7, 10, 40, 6]);

  labelsSheet(wb, "Vinyl 标签", buildVinylLabels(cuttable, header).map((l) => l.lines));
}

/** 外采购单：按销售在报价 Order Form 上写的原样列出，不做工艺计算 */
export function addPurchaseSheet(wb: ExcelJS.Workbook, order: ExportOrderHeader, spec: ProcessSpec) {
  if (spec.purchase.length === 0) return;
  const ws = wb.addWorksheet("外采购单", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
  const rows = spec.purchase.map((p, i) => [
    i + 1, p.categoryZh, p.location, p.widthIn, p.heightIn, p.qty,
    p.fields.map((f) => `${f.label}: ${f.value}`).join("；"), p.reasonZh, p.remark,
  ] as Cell[]);
  table(ws, `外采购单 — ${order.code}`, `客户: ${order.customerName}  |  按销售在报价单上填写的内容原样生成，未做工艺计算，请外采购按供应商要求下单`,
    ["序号", "品类", "位置", "宽(in)", "高(in)", "数量", "销售填写（报价 Order Form 原值）", "外采购原因", "备注"],
    rows, [5, 16, 14, 9, 9, 6, 70, 26, 22]);
  rows.forEach((_, i) => { ws.getRow(5 + i).getCell(7).alignment = { wrapText: true, vertical: "top" }; });
}

export function addIssuesSheet(wb: ExcelJS.Workbook, order: ExportOrderHeader, issues: ProcessIssue[]) {
  const ws = wb.addWorksheet("待核对");
  const rows = issues.map((i) => [i.level === "block" ? "阻断" : "提示", SECTION_LABEL_ZH[i.section], i.line || "-", i.messageZh] as Cell[]);
  if (rows.length === 0) rows.push(["-", "-", "-", "无待核对项"]);
  table(ws, `待核对清单 — ${order.code}`, "阻断项清零后工艺单才能确认；提示项为报价单默认推导，请核对", ["级别", "产品段", "行号", "说明"], rows, [8, 14, 8, 90]);
  rows.forEach((row, i) => {
    if (row[0] === "阻断") ws.getRow(5 + i).getCell(1).font = FONT_WARN;
  });
}
