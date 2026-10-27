/**
 * 窗帘（Drapes / Sheer）工艺单 —— 6cm / 7cm 两版蛇形帘 + 韩褶
 *
 * 口径 = 原件《6cm 窗帘工艺单》《7cm 窗帘工艺单》（Drapes and Sheer）工艺单 + Sheet1 物料表。
 * 两版唯一差别：蛇形帘颗数按 10.7（6cm）或 12.5（7cm）求，走珠扣类型 6cm / 7cm；
 * 成品宽两版都按（颗数取奇）× 10.7。
 * 与原件逐值对照：src/lib/sunny-process/__tests__/drapes-oracle.test.ts
 */

import { excelRound, isOdd, roundDown, roundUp } from "./excel-fns";

export const DRAPE_VERSIONS = ["6cm", "7cm"] as const;
export type DrapeVersion = (typeof DRAPE_VERSIONS)[number];
export const DEFAULT_DRAPE_VERSION: DrapeVersion = "6cm";

export const DRAPE_CRAFTS = ["韩褶P", "蛇型R"] as const;
export const DRAPE_LAYERS = ["布", "纱"] as const;
export const DRAPE_LINERS = ["是", "否"] as const;
export const DRAPE_MOUNTS = ["顶装C", "墙装W"] as const;
export const DRAPE_RODS = ["方单轨", "圆单轨", "方双轨", "圆双轨"] as const;
export const DRAPE_ROD_COLORS = ["黑", "白", "银", "金", "灰"] as const;

/** 原件工艺单底部固定说明（打印在导出表里） */
export const DRAPE_NOTES_ZH = [
  "1.尺寸是成品窗帘尺寸，我们已经算好了折皱率，不需要减尺",
  "2.包边侧边3公分，底边8公分。韩褶布带宽度为10公分，为可上升工艺缝制",
  "3.各种绑带要求：所有同款加厚绑带，需要加厚, 增加立体感, 需要带免钉扣(纽扣式绑带)",
  "4.全部窗帘包括布和纱都需要高温定型",
  "5.高度的误差只能在1厘米以内，超过1厘米误差不要寄过来！如高度是280厘米的，收到后的尺寸必须是279-281的范围",
];

/** 蛇形帘求颗数的间距（cm） */
const BEAD_SPACING: Record<DrapeVersion, number> = { "6cm": 10.7, "7cm": 12.5 };
/** 成品宽用的走珠间距（两版相同） */
const FINISHED_PITCH = 10.7;

export interface DrapeRowInput {
  widthIn: number;
  heightIn: number;
  /** 面料色号 */
  sku: string;
  /** 数量（扇）S=1 / D=2 */
  qty: number;
  /** 工艺：韩褶P / 蛇型R；空 = 未定 */
  craft: string;
  /** 布 / 纱 */
  layer: string;
  /** 遮光底布：是 / 否 */
  liner: string;
  /** 褶皱倍数（1.8 / 2.3 …） */
  fullness: number;
  /** 安装方式：顶装C / 墙装W */
  mount: string;
  /** 杆子类型 */
  rod: string;
  rodColor: string;
}

export interface DrapeRowResult {
  /** 测量宽 cm（向上取整） */
  widthCm: number;
  /** 成品高 cm（按安装/杆型扣减后向下取整） */
  heightCm: number;
  /** 韩褶上端褶后宽 cm / 扇 */
  pleatTopCm: number;
  /** 成品帘子宽 cm / 扇 */
  finishedWidthCm: number;
  /** 成品帘子高 cm */
  finishedHeightCm: number;
  /** 蛇形帘颗数（6cm 按 10.7 / 7cm 按 12.5） */
  beadCount: number;
  /** 走珠布袋颗数 / 扇 */
  beadBagCount: number;
  /** 走珠扣类型 "8cm" / "6cm" / "7cm"；非蛇形为 null */
  beadClip: string | null;
  materials: DrapeRowMaterials;
}

export interface DrapeRowMaterials {
  /** 杆子(米) */
  rodM: number;
  /** 布料(平方米) */
  fabricSqm: number;
  /** 走珠布袋(米) */
  beadBagM: number;
  /** 安装码(个) */
  hooks: number;
  /** 韩褶走珠(个) */
  pleatBeads: number;
}

function heightDeductionIn(mount: string, rod: string): number {
  if (mount === "顶装C") return 2.375;
  if (rod === "方单轨") return 3.15625;
  if (rod === "方双轨") return 2.375;
  if (rod === "圆单轨" || rod === "圆双轨") return 3.5625;
  return 0;
}

export function computeDrapeRow(r: DrapeRowInput, version: DrapeVersion): DrapeRowResult {
  const qty = r.qty || 0;
  const widthCm = roundUp(r.widthIn * 2.54, 0);
  const heightCm = r.heightIn > 0 ? roundDown((r.heightIn - heightDeductionIn(r.mount, r.rod)) * 2.54, 0) : 0;
  const ripple = r.craft === "蛇型R";
  const pleatTopCm = r.craft === "韩褶P" && qty > 0 ? roundUp((r.widthIn * 2.54) / qty, 0) : 0;
  const perPanel = qty > 0 ? (widthCm / qty) * r.fullness : 0;
  const beadCount = ripple ? roundUp(perPanel / BEAD_SPACING[version], 0) : 0;
  let finishedWidthCm: number;
  if (ripple) {
    finishedWidthCm = roundUp((isOdd(beadCount) ? beadCount : beadCount + 1) * FINISHED_PITCH, 0);
  } else if (r.craft === "") {
    finishedWidthCm = 0;
  } else {
    finishedWidthCm = roundUp(perPanel, 0);
  }
  const finishedHeightCm = heightCm > 0 ? heightCm : 0;
  const beadBagCount = beadCount === 0 ? 0 : isOdd(beadCount) ? beadCount + 1 : beadCount + 2;
  const beadClip = ripple ? (r.fullness <= 1.5 ? "8cm" : version) : null;
  const rodM = widthCm / 100;
  return {
    widthCm,
    heightCm,
    pleatTopCm,
    finishedWidthCm,
    finishedHeightCm,
    beadCount,
    beadBagCount,
    beadClip,
    materials: {
      rodM,
      fabricSqm: (finishedWidthCm / 100) * (finishedHeightCm / 100) * qty,
      beadBagM: (beadBagCount * 10.7) / 100,
      hooks: excelRound(rodM / 0.5, 0),
      pleatBeads: roundUp(finishedWidthCm !== 0 ? finishedWidthCm / 20 + 1 : 0, 0),
    },
  };
}

/** 物料汇总（Sheet1 第 18 行）：杆子 ×1.2、布料 ×1.3 余量 */
export function totalDrapeMaterials(rows: DrapeRowResult[]): DrapeRowMaterials {
  const sum = (k: keyof DrapeRowMaterials) => rows.reduce((s, r) => s + r.materials[k], 0);
  return {
    rodM: sum("rodM") * 1.2,
    fabricSqm: sum("fabricSqm") * 1.3,
    beadBagM: sum("beadBagM"),
    hooks: sum("hooks"),
    pleatBeads: sum("pleatBeads"),
  };
}
