/**
 * Vinyl 百叶窗汇总
 * 来源: V15 的 直柱汇总 / 横档百叶汇总 / Sheet1 (2)（隐藏的物料总表）
 *
 * 口径注意：
 *   - 横档百叶汇总 的米数 **乘了数量**（K=A*C*0.0254）
 *   - 直柱汇总 同样乘数量（Q=A*F*0.0254）
 *   两者都与 Blinds 开料表那个「不乘数量」的 SUM 不同，别照搬。
 *   - 损耗系数 1.15 只加在**按米买的型材**上；按个买的（盖头、帧、L角）不加。
 */

import { VINYL_WASTE_FACTOR, type FrameType } from "./frame-rules";
import type { VinylCuttingResults, VinylItemInput } from "./calculation-engine";

const IN_TO_M = 0.0254;

export interface VinylCalcItem {
  input: VinylItemInput;
  calc: VinylCuttingResults;
}

/** 英寸转米；只抹浮点噪声，不做工程舍入 */
function m(inches: number): number {
  return Math.round(inches * IN_TO_M * 1e10) / 1e10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 直柱汇总 一行 */
export interface StileSummaryRow {
  itemNumber: number;
  location: string;
  /** A 直柱长 */
  stileLength: number;
  /** C 孔距 */
  pitch: number;
  topLouvers: number;
  bottomLouvers: number;
  /** F 直柱数量 */
  stileQty: number;
  /** G 上控制杆长 / I 数量 */
  topRodLength: number;
  topRodQty: number;
  /** J 下控制杆长 / L 数量 */
  bottomRodLength: number;
  bottomRodQty: number;
  /** M 条 / O 盖 */
  strips: number | null;
  caps: number | null;
  /** Q 直柱(m) */
  stileMeters: number;
  /** R 控制杆(m) */
  rodMeters: number;
  /** S 条(m) */
  stripMeters: number;
  /** T 盖(m) */
  capMeters: number;
}

function pieceOf(calc: VinylCuttingResults, name: string) {
  return calc.pieces.find((p) => p.name === name && !p.informational) ?? null;
}

export function buildStileSummary(items: VinylCalcItem[]): StileSummaryRow[] {
  return items.map((it, i) => {
    const c = it.calc;
    const stile = pieceOf(c, "直柱");
    const topRod = pieceOf(c, "控制杆（上）");
    const bottomRod = pieceOf(c, "控制杆（下）");

    const stileLength = stile?.lengthIn ?? 0;
    const stileQty = stile?.qty ?? 0;
    const topRodLength = topRod?.lengthIn ?? 0;
    const topRodQty = topRod?.qty ?? 0;
    const bottomRodLength = bottomRod?.lengthIn ?? 0;
    const bottomRodQty = bottomRod?.qty ?? 0;
    const strips = c.panelSpec?.strips ?? null;
    const caps = c.panelSpec?.caps ?? null;

    return {
      itemNumber: i + 1,
      location: it.input.location ?? "",
      stileLength,
      pitch: c.louverPitch,
      topLouvers: c.topLouvers,
      bottomLouvers: c.bottomLouvers,
      stileQty,
      topRodLength,
      topRodQty,
      bottomRodLength,
      bottomRodQty,
      strips,
      caps,
      stileMeters: m(stileLength * stileQty),
      rodMeters: m(topRodLength * topRodQty + bottomRodLength * bottomRodQty),
      stripMeters: m(stileLength * (strips ?? 0)),
      capMeters: m(stileLength * (caps ?? 0)),
    };
  });
}

/** 横档百叶汇总 一行 */
export interface RailSummaryRow {
  itemNumber: number;
  location: string;
  railLength: number;
  railQty: number;
  dividerLength: number;
  dividerQty: number;
  louverLength: number;
  louverQty: number;
  railMeters: number;
  dividerMeters: number;
  louverMeters: number;
  /** N 百叶盖头 = 百叶数量 × 2 */
  louverEndCaps: number;
  /** O 百叶帧 = 百叶数量 */
  louverConnectors: number;
}

export function buildRailSummary(items: VinylCalcItem[]): RailSummaryRow[] {
  return items.map((it, i) => {
    const c = it.calc;
    const rail = pieceOf(c, "上下横档");
    const divider = pieceOf(c, "中间分隔档");
    const louver = c.pieces.find((p) => p.name.startsWith("百叶片") && !p.informational) ?? null;

    const railLength = rail?.lengthIn ?? 0;
    const railQty = rail?.qty ?? 0;
    const dividerLength = divider?.lengthIn ?? 0;
    const dividerQty = divider?.qty ?? 0;
    const louverLength = louver?.lengthIn ?? 0;
    const louverQty = louver?.qty ?? 0;

    return {
      itemNumber: i + 1,
      location: it.input.location ?? "",
      railLength,
      railQty,
      dividerLength,
      dividerQty,
      louverLength,
      louverQty,
      railMeters: m(railLength * railQty),
      dividerMeters: m(dividerLength * dividerQty),
      louverMeters: m(louverLength * louverQty),
      louverEndCaps: louverQty * 2,
      louverConnectors: louverQty,
    };
  });
}

/** Sheet1 (2) 物料总表 —— 一项物料 */
export interface BomLine {
  /** 物料名（照抄 Sheet1 (2) 表头） */
  name: string;
  qty: number;
  unit: "m" | "个";
  /** 是否已乘 1.15 损耗 */
  wasted: boolean;
}

export interface VinylBom {
  lines: BomLine[];
  /** 有效窗数（订单总表 SF 非零的行） */
  windowCount: number;
  wasteFactor: number;
}

export function buildBom(items: VinylCalcItem[]): VinylBom {
  const stiles = buildStileSummary(items);
  const rails = buildRailSummary(items);

  const sum = <T>(rows: T[], pick: (r: T) => number) =>
    rows.reduce((s, r) => s + pick(r), 0);

  const stileMeters = sum(stiles, (r) => r.stileMeters);
  const rodMeters = sum(stiles, (r) => r.rodMeters);
  // 条(m)/盖(m) 只在 直柱汇总 的合计行出现；Sheet1 (2) 物料表并不引用它们
  // （LIGHT BLOCK 盖条另按「直柱/2」算），所以这里不参与 BOM。
  const stileQtyTotal = sum(stiles, (r) => r.stileQty);
  const topRodQtyTotal = sum(stiles, (r) => r.topRodQty);
  const bottomRodQtyTotal = sum(stiles, (r) => r.bottomRodQty);

  const railMeters = sum(rails, (r) => r.railMeters);
  const dividerMeters = sum(rails, (r) => r.dividerMeters);
  const louverMeters = sum(rails, (r) => r.louverMeters);
  const louverEndCaps = sum(rails, (r) => r.louverEndCaps);
  const louverConnectors = sum(rails, (r) => r.louverConnectors);

  // 框材按框型分开统计：Σ(型框宽 × 数量 + 型框高 × 数量)，只取主料（不含备用料长）
  const frameMeters: Record<FrameType, number> = { L: 0, Z: 0, T: 0, Door: 0 };
  let postMeters = 0;
  for (const it of items) {
    const ftRaw = String(it.input.frameType || "").trim().toUpperCase();
    const ft: FrameType =
      ftRaw === "DOOR" ? "Door" : ftRaw === "Z" ? "Z" : ftRaw === "T" ? "T" : "L";
    let inches = 0;
    for (const p of it.calc.pieces) {
      if (p.informational) continue;
      if (p.name.endsWith("型框-宽") || p.name.endsWith("型框-高")) {
        inches += p.lengthIn * p.qty;
      }
      if (p.name === "分隔柱" || p.name === "挂柱") {
        postMeters += m(p.lengthIn * p.qty);
      }
    }
    if (inches > 0) frameMeters[ft] += m(inches);
  }

  const windowCount = items.filter((it) => it.calc.squareFeet > 0).length;
  const W = VINYL_WASTE_FACTOR;

  const lines: BomLine[] = [
    { name: "直柱 Stile", qty: round2(stileMeters * W), unit: "m", wasted: true },
    { name: "控制杆 Tilt Rod", qty: round2(rodMeters * W), unit: "m", wasted: true },
    { name: "弹簧盖 Spring Cap", qty: stileQtyTotal, unit: "个", wasted: false },
    { name: "上下横档 3 3/4 Rail", qty: round2(railMeters * W), unit: "m", wasted: true },
    { name: "中分档 2 1/2 Divider Rail", qty: round2(dividerMeters * W), unit: "m", wasted: true },
    { name: "百叶 Louver", qty: round2(louverMeters * W), unit: "m", wasted: true },
    { name: "百叶盖头 Louver End Cap", qty: louverEndCaps, unit: "个", wasted: false },
    { name: "百叶帧 Louver Connector", qty: louverConnectors, unit: "个", wasted: false },
    { name: "Flat Cap 直柱盖", qty: stileQtyTotal, unit: "个", wasted: false },
    { name: "L FRAME", qty: round2(frameMeters.L * W), unit: "m", wasted: true },
    { name: "Z FRAME", qty: round2(frameMeters.Z * W), unit: "m", wasted: true },
    { name: "T FRAME", qty: round2(frameMeters.T * W), unit: "m", wasted: true },
    { name: "Door Frame", qty: round2(frameMeters.Door * W), unit: "m", wasted: true },
    { name: "T柱", qty: round2(postMeters * W), unit: "m", wasted: true },
    { name: "LIGHT BLOCK 盖条", qty: round2((stileMeters * W) / 2), unit: "m", wasted: true },
    { name: "Stile Support Block 直柱支撑块", qty: stileQtyTotal * 2, unit: "个", wasted: false },
    { name: "Corner Key L角", qty: windowCount * 4, unit: "个", wasted: false },
    { name: "Insert 2017 平条", qty: round2(stileMeters * W * 0.8), unit: "m", wasted: true },
    { name: "控制杆盖头", qty: (topRodQtyTotal + bottomRodQtyTotal) * 2, unit: "个", wasted: false },
  ];

  return { lines, windowCount, wasteFactor: W };
}

/** 直柱汇总 / 横档百叶汇总 的合计行 */
export interface VinylTotals {
  stileMeters: number;
  rodMeters: number;
  stripMeters: number;
  capMeters: number;
  stileQty: number;
  railMeters: number;
  dividerMeters: number;
  louverMeters: number;
  louverEndCaps: number;
  louverConnectors: number;
}

export function buildTotals(items: VinylCalcItem[]): VinylTotals {
  const stiles = buildStileSummary(items);
  const rails = buildRailSummary(items);
  const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);
  return {
    stileMeters: round2(sum(stiles, (r) => r.stileMeters)),
    rodMeters: round2(sum(stiles, (r) => r.rodMeters)),
    stripMeters: round2(sum(stiles, (r) => r.stripMeters)),
    capMeters: round2(sum(stiles, (r) => r.capMeters)),
    stileQty: sum(stiles, (r) => r.stileQty),
    railMeters: round2(sum(rails, (r) => r.railMeters)),
    dividerMeters: round2(sum(rails, (r) => r.dividerMeters)),
    louverMeters: round2(sum(rails, (r) => r.louverMeters)),
    louverEndCaps: sum(rails, (r) => r.louverEndCaps),
    louverConnectors: sum(rails, (r) => r.louverConnectors),
  };
}
