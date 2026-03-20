/**
 * Blinds 工艺单计算引擎
 * 规则版本: blinds_20251024_v1
 *
 * 输入: BlindsOrderItem 的人工录入字段
 * 输出: 所有裁切尺寸（英寸）+ 辅料长度（米）
 */

import {
  DEDUCTION_RULES,
  OUT_TIGHT_ADDITION,
  CORD_LENGTH_TABLE,
  SORT_WEIGHT_CONTROL,
  SORT_WEIGHT_HEADRAIL,
  RULE_VERSION,
  type ControlType,
  type HeadrailType,
  type ProductType,
} from "./deduction-rules";

export interface ItemInput {
  width: number;        // 测量宽度（英寸）
  height: number;       // 测量高度（英寸）
  productType: string;  // 卷帘 / 斑马帘 / 香格里拉
  measureType: string;  // IN / OUT / Tight
  controlType: string;  // 普通 / 电机 / 无绳
  headrailType: string; // 罩盒类型
  fabricRatio?: number | null;  // 布比
  silkRatio?: number | null;    // 纱比
  bottomBarWidth?: number | null; // 手动覆盖底杆宽
}

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
 * 斑马帘裁剪位计算（纵向Ref 逻辑）
 * 仅支持 3:2 布纱比
 * 用于确定面料底端落在布段还是纱段的位置
 */
export function calcZebraCuttingPosition(
  height: number,
  fabricRatio: number | null | undefined,
  silkRatio: number | null | undefined
): number | null {
  const fr = fabricRatio ?? 3;
  const sr = silkRatio ?? 2;
  const key = `${fr}:${sr}`;
  if (key !== "3:2") return null;

  const total = fr + sr; // 5
  const raw = ((height - 0.1 - 0.1) / total - Math.floor((height - 0.1 - 0.1) / total)) * total + 0.5;
  const result = raw < fr ? round4(raw) : round4(raw - fr);
  return result;
}

/**
 * 拉绳长度计算（用于布料汇总）
 * 公式: height × 2 × 3/4 × 0.0254（米）
 * 仅 普通 操控方式有拉绳
 */
function calcCordLength(height: number, controlType: string): number | null {
  if (controlType !== "普通") return null;
  return round4(height * 2 * 0.75 * 0.0254);
}

/**
 * 绳套长度 = 拉绳长度/2 - 0.3（米），不小于0
 */
function calcCordSleeveLength(cordLength: number | null): number | null {
  if (cordLength === null || cordLength === 0) return null;
  const v = cordLength / 2 - 0.3;
  return v > 0 ? round4(v) : 0;
}

/**
 * 拉绳分档（用于工艺标签显示）
 * 普通操控: height × 0.8 × 0.0254 → 查分档表 → "长 & 短"
 */
export function getCordLengthTier(height: number, controlType: string): string | null {
  if (controlType !== "普通") return null;
  const meters = height * 0.8 * 0.0254;
  for (const tier of CORD_LENGTH_TABLE) {
    if (meters <= tier.maxMeters) {
      if (tier.long === 0) return null;
      return `${tier.long} & ${tier.short}`;
    }
  }
  const last = CORD_LENGTH_TABLE[CORD_LENGTH_TABLE.length - 1];
  return `${last.long} & ${last.short}`;
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
  const squareFeet = round4((w * h) / 144);

  // 排序权重
  const sortOrder =
    (SORT_WEIGHT_CONTROL[ct] ?? 0) + (SORT_WEIGHT_HEADRAIL[ht] ?? 0);

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
