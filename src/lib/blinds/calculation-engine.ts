/**
 * Blinds 工艺单计算引擎（卷帘 / 斑马帘 / 香格里拉）
 * 规则版本: blinds_20261027_v2
 *
 * 口径 = 原件《Blinds 工艺单_圆盒侧盖加厚标准版》工艺组装第 1 窗位模板公式。
 * 与原件逐值对照：src/lib/sunny-process/__tests__/blinds-oracle.test.ts
 * （夹具由 scripts/sunny-process-oracle/oracle.py 用 LibreOffice 重算原件生成）。
 * 有意偏离原件之处见 docs/QINGYAN_SUNNY_PROCESS_ORDER_REPORT.md §3（X-1…）。
 *
 * 输入: BlindsOrderItem 的人工录入字段
 * 输出: 所有裁切尺寸（英寸）+ 裁剪数量 + 辅料长度（米）
 */

import {
  DEDUCTION_RULES,
  OUT_TIGHT_ADDITION,
  CORD_LENGTH_TABLE,
  CORD_LENGTH_TOP_LABEL,
  CORD_MIN_METERS,
  SORT_WEIGHT_CONTROL,
  SORT_WEIGHT_HEADRAIL,
  RULE_VERSION,
  ZEBRA_CUT_BOTTOM_TRIM,
  ZEBRA_CUT_OFFSET,
  ZEBRA_CUT_TOP_TRIM,
  type ControlType,
  type HeadrailType,
  type ProductType,
} from "./deduction-rules";

export interface ItemInput {
  width: number;        // 测量宽度（英寸）
  height: number;       // 测量高度（英寸）
  productType: string;  // 卷帘 / 斑马帘 / 香格里拉
  measureType: string;  // IN / OUT / Tight
  controlType: string;  // 普通 / 电动 / 无绳
  headrailType: string; // 罩盒类型
  fabricRatio?: number | null;  // 布比
  silkRatio?: number | null;    // 纱比
  bottomBarWidth?: number | null; // 手动覆盖底杆宽
}

/** 每窗各件的裁剪数量（原件工艺组装"裁剪数量"行） */
export interface CuttingQuantities {
  headrail: number;
  tube38: number;
  bottomBar: number;
  coreRod: number;
  fabricWidth: number;
  fabricLength: number;
}

export type CutCategory = "A类" | "B类" | "C类";

export interface CuttingResults {
  cutHeadrail: number | null;
  cutTube38: number | null;
  cutRollerBar: number | null;
  cutZebraBar: number | null;
  cutCoreRod: number | null;
  cutShangrilaBar: number | null;
  cutFabricWidth: number | null;
  cutFabricLength: number | null;
  insertSize: number | null;
  cordLength: number | null;
  cordSleeveLen: number | null;
  squareFeet: number;
  sortOrder: number;
  ruleVersion: string;
  /** 斑马帘裁剪位（包边条顶边贴裁剪位），非斑马帘或布纱比缺失为 null */
  zebraCutPos: number | null;
  /** 拉绳分档 "长 & 短"，仅普通操控 */
  cordTier: string | null;
  quantities: CuttingQuantities;
  cutCategory: CutCategory;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * 获取减尺值
 * OUT/Tight 测量方式需要额外加 3/16 英寸
 */
function getDeduction(
  controlType: ControlType,
  headrailType: HeadrailType,
  component: keyof typeof DEDUCTION_RULES[ControlType][HeadrailType],
  measureType: string
): number {
  const rules = DEDUCTION_RULES[controlType]?.[headrailType];
  if (!rules) return 0;
  const base = rules[component];
  const addition = measureType !== "IN" ? OUT_TIGHT_ADDITION : 0;
  return base + addition;
}

/**
 * 计算配件裁切尺寸
 * 公式: 测量宽度 + 减尺值 (+ 3/16 若 OUT/Tight)
 */
function calcComponentCut(
  width: number,
  controlType: ControlType,
  headrailType: HeadrailType,
  component: keyof typeof DEDUCTION_RULES[ControlType][HeadrailType],
  measureType: string
): number {
  return round4(width + getDeduction(controlType, headrailType, component, measureType));
}

/**
 * 面料长度计算
 * 来自工艺组装 J 列公式:
 *   斑马帘: height × 2 + 6
 *   卷帘 / 香格里拉: height + 2
 */
function calcFabricLength(height: number, productType: string): number {
  if (productType === "斑马帘") {
    return round4(height * 2 + 6);
  }
  return round4(height + 2);
}

/**
 * 斑马帘裁剪位（纵向Ref 模板，任意布纱比）
 * 用于确定面料底端落在布段还是纱段的位置；布纱比缺失或不为正 → null
 */
export function calcZebraCuttingPosition(
  height: number,
  fabricRatio: number | null | undefined,
  silkRatio: number | null | undefined
): number | null {
  const fr = fabricRatio ?? 0;
  const sr = silkRatio ?? 0;
  if (!(fr > 0) || !(sr > 0)) return null;
  const total = fr + sr;
  const q = (height - ZEBRA_CUT_TOP_TRIM - ZEBRA_CUT_BOTTOM_TRIM) / total;
  const raw = (q - Math.floor(q)) * total + ZEBRA_CUT_OFFSET;
  return raw < fr ? round4(raw) : round4(raw - fr);
}

/**
 * 拉绳长度计算（用于布料汇总）
 * 公式: height × 2 × 3/4 × 0.0254（米）
 * 仅 普通 操控方式有拉绳（原件布料表对所有操控都计，见报告偏离 X-1）
 */
function calcCordLength(height: number, controlType: string): number | null {
  if (controlType !== "普通") return null;
  return height * 2 * 0.75 * 0.0254;
}

/**
 * 绳套长度 = 拉绳长度/2 - 0.3（米），不小于0
 */
function calcCordSleeveLength(cordLength: number | null): number | null {
  if (cordLength === null || cordLength === 0) return null;
  const v = cordLength / 2 - 0.3;
  return v > 0 ? v : 0;
}

/**
 * 拉绳分档（用于工艺标签显示）
 * 普通操控: height × 0.8 × 0.0254 → 查分档表 → "长 & 短"
 */
export function getCordLengthTier(height: number, controlType: string): string | null {
  if (controlType !== "普通") return null;
  const meters = height * 0.8 * 0.0254;
  if (meters < CORD_MIN_METERS) return null;
  for (const tier of CORD_LENGTH_TABLE) {
    if (tier.inclusive ? meters <= tier.max : meters < tier.max) return tier.label;
  }
  return CORD_LENGTH_TOP_LABEL;
}

/**
 * 插片尺寸
 * 仅 亮白插片圆盒 和 双轨半盒 有插片，尺寸等于罩盒裁切尺寸
 */
function calcInsertSize(headrailType: string, cutHeadrail: number | null): number | null {
  if (headrailType === "亮白插片圆盒" || headrailType === "双轨半盒") {
    return cutHeadrail;
  }
  return null;
}

function isDoubleTrack(headrailType: string): boolean {
  return headrailType === "双轨无盒" || headrailType === "双轨半盒";
}

/**
 * 裁剪数量（工艺组装"裁剪数量"行）
 * 原件卷帘/香格里拉下杆数量公式把"亮白插片圆盒"写成"亮白亮白插片圆盒"、
 * 把灰弧/白弧写成 GREY ARC / White ARC，导致这些组合数量为 0；系统按斑马帘行的
 * 正确写法统一为 1（双轨 2），见报告偏离 X-2。
 */
function calcQuantities(headrailType: string, hasHeadrail: boolean): CuttingQuantities {
  const n = isDoubleTrack(headrailType) ? 2 : 1;
  return {
    headrail: hasHeadrail ? 1 : 0,
    tube38: n,
    bottomBar: n,
    coreRod: n,
    fabricWidth: n,
    fabricLength: n,
  };
}

export function getCutCategory(headrailType: string): CutCategory {
  if (headrailType === "哑白方型罩盒" || headrailType === "哑灰方型罩盒") return "B类";
  if (headrailType === "双轨无盒" || headrailType === "单轨无盒") return "C类";
  return "A类";
}

/**
 * 主计算函数
 * 输入一个窗户的录入字段，输出全部计算结果
 */
export function calculateItem(input: ItemInput): CuttingResults {
  const ct = input.controlType as ControlType;
  const ht = input.headrailType as HeadrailType;
  const pt = input.productType as ProductType;
  const mt = input.measureType;
  const w = input.width;
  const h = input.height;

  // 罩盒：双轨无盒/单轨无盒 无罩盒
  const hasHeadrailCover = ht !== "双轨无盒" && ht !== "单轨无盒";
  const cutHeadrail = hasHeadrailCover
    ? calcComponentCut(w, ct, ht, "headrail", mt)
    : null;

  // 38管: 始终计算
  const cutTube38 = calcComponentCut(w, ct, ht, "tube38", mt);

  // 下杆: 根据产品类型选择
  let cutRollerBar: number | null = null;
  let cutZebraBar: number | null = null;
  let cutCoreRod: number | null = null;
  let cutShangrilaBar: number | null = null;

  if (pt === "卷帘") {
    cutRollerBar = calcComponentCut(w, ct, ht, "rollerBar", mt);
    if (input.bottomBarWidth != null) {
      cutRollerBar = input.bottomBarWidth;
    }
  } else if (pt === "斑马帘") {
    cutZebraBar = calcComponentCut(w, ct, ht, "zebraBar", mt);
    cutCoreRod = calcComponentCut(w, ct, ht, "coreRod", mt);
    if (input.bottomBarWidth != null) {
      cutZebraBar = input.bottomBarWidth;
    }
  } else if (pt === "香格里拉") {
    cutShangrilaBar = calcComponentCut(w, ct, ht, "shangrilaBar", mt);
    if (input.bottomBarWidth != null) {
      cutShangrilaBar = input.bottomBarWidth;
    }
  }

  // 面料宽度
  const cutFabricWidth = calcComponentCut(w, ct, ht, "fabricWidth", mt);

  // 面料长度
  const cutFabricLength = calcFabricLength(h, pt);

  // 插片尺寸
  const insertSize = calcInsertSize(ht, cutHeadrail);

  // 拉绳 & 绳套
  const cordLength = calcCordLength(h, input.controlType);
  const cordSleeveLen = calcCordSleeveLength(cordLength);

  // SF
  const squareFeet = (w * h) / 144;

  // 排序权重
  const sortOrder =
    (SORT_WEIGHT_CONTROL[ct] ?? 0) + (SORT_WEIGHT_HEADRAIL[ht] ?? 0);

  const quantities = calcQuantities(ht, hasHeadrailCover);
  if (pt !== "斑马帘") quantities.coreRod = 0;

  return {
    cutHeadrail,
    cutTube38,
    cutRollerBar,
    cutZebraBar,
    cutCoreRod,
    cutShangrilaBar,
    cutFabricWidth,
    cutFabricLength,
    insertSize,
    cordLength,
    cordSleeveLen,
    squareFeet,
    sortOrder,
    ruleVersion: RULE_VERSION,
    zebraCutPos: pt === "斑马帘" ? calcZebraCuttingPosition(h, input.fabricRatio, input.silkRatio) : null,
    cordTier: getCordLengthTier(h, input.controlType),
    quantities,
    cutCategory: getCutCategory(ht),
  };
}

/**
 * 批量计算整个订单的所有行项目
 */
export function calculateAllItems(items: ItemInput[]): CuttingResults[] {
  return items.map((item) => calculateItem(item));
}

/**
 * 英寸转米
 */
export function inchesToMeters(inches: number): number {
  return round4(inches * 0.0254);
}

/**
 * 计算面料面积（平方尺 → 平方米）
 * Sub SF = fabricWidth * (fabricLength + 3) / 144
 * sqm = SF * 0.092903 * 1.3（含余量系数）
 */
export function calcFabricArea(
  fabricWidth: number | null,
  fabricLength: number | null
): { subSF: number; sqm: number } | null {
  if (fabricWidth == null || fabricLength == null) return null;
  const subSF = round4((fabricWidth * (fabricLength + 3)) / 144);
  const sqm = round4(subSF * 0.092903 * 1.3);
  return { subSF, sqm };
}
