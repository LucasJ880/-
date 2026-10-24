/**
 * Blinds 工艺单计算引擎
 *
 * 规则按版本冻结：calculateItem 第二参传 BlindsOrder.ruleVersion，
 * 已开料的单重算/导出时必须重现当时的尺寸。不传则用当前版本（新单）。
 *
 * 输入: BlindsOrderItem 的人工录入字段
 * 输出: 所有裁切尺寸（英寸）+ 辅料长度（米）
 */

import {
  getDeductionRules,
  resolveRuleVersion,
  OUT_TIGHT_ADDITION,
  getCordTable,
  hasShortCordRule,
  SHORT_CORD_MAX_INCH,
  SHORT_CORD_TIER,
  SORT_WEIGHT_CONTROL,
  SORT_WEIGHT_HEADRAIL,
  RULE_VERSION,
  getComponentQuantities,
  getCutClass,
  hasHeadrailCover,
  type ComponentQuantities,
  type CutClass,
  type ControlType,
  type HeadrailType,
  type ProductType,
  type RuleVersion,
} from "./deduction-rules";
import { lookupFabricRatio } from "./fabric-ratio-catalog";

export interface ItemInput {
  width: number;        // 测量宽度（英寸）
  height: number;       // 测量高度（英寸）
  productType: string;  // 卷帘 / 斑马帘 / 香格里拉
  measureType: string;  // IN / OUT / Tight
  controlType: string;  // 普通 / 电机 / 无绳
  headrailType: string; // 罩盒类型
  fabricRatio?: number | null;  // 布比（留空时按 fabricSku 查目录）
  silkRatio?: number | null;    // 纱比（留空时按 fabricSku 查目录）
  bottomBarWidth?: number | null; // 手动覆盖底杆宽
  fabricSku?: string | null;    // 面料货号，用于自动解析布纱比
}

/** 布纱比来源，便于界面区分"人工填的"和"目录查出来的" */
export type RatioSource = "manual" | "catalog" | "missing" | "conflict";

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
  ruleVersion: RuleVersion;
  /** 各部件裁剪数量（工艺组装 第 8 行） */
  quantities: ComponentQuantities;
  /** 切割分类 A/B/C（开料表 O 列，车间按它分组） */
  cutClass: CutClass;
  /** 本次实际使用的布/纱比及其来源 */
  fabricRatioUsed: number | null;
  silkRatioUsed: number | null;
  ratioSource: RatioSource;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * 获取减尺值
 * OUT/Tight 测量方式需要额外加 3/16 英寸
 */
type ComponentKey =
  | "headrail"
  | "tube38"
  | "rollerBar"
  | "zebraBar"
  | "coreRod"
  | "shangrilaBar"
  | "fabricWidth";

function getDeduction(
  controlType: ControlType,
  headrailType: HeadrailType,
  component: ComponentKey,
  measureType: string,
  version: RuleVersion
): number {
  const rules = getDeductionRules(version)[controlType]?.[headrailType];
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
  component: ComponentKey,
  measureType: string,
  version: RuleVersion
): number {
  return round4(
    width + getDeduction(controlType, headrailType, component, measureType, version)
  );
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
 * 斑马帘裁剪位计算（纵向Ref!C28/D28）
 * 用于确定面料底端落在布段还是纱段的位置。
 *
 * 公式对**任意**布/纱比都成立 —— 表里读的就是每扇窗自己的 L/M 两列，
 * 没有任何 3:2 限制。旧实现锁死 3:2，而真实 SKU 绝大多数不是 3:2
 * （见 fabric-ratio-catalog），导致这项在生产上静默失效。
 *
 * fail-closed：布纱比未知时返回 null，不再假设 3:2 —— 猜错的裁剪位
 * 会让整幅面料报废，宁可空着让人补。
 */
export function calcZebraCuttingPosition(
  height: number,
  fabricRatio: number | null | undefined,
  silkRatio: number | null | undefined
): number | null {
  if (fabricRatio == null || silkRatio == null) return null;
  const fr = fabricRatio;
  const sr = silkRatio;
  if (!(fr > 0) || !(sr > 0)) return null;

  const total = fr + sr;
  const raw = ((height - 0.1 - 0.1) / total - Math.floor((height - 0.1 - 0.1) / total)) * total + 0.5;
  const result = raw < fr ? round4(raw) : round4(raw - fr);
  return result;
}

/**
 * 解析本行实际使用的布/纱比：人工填的优先，其次查 SKU 目录。
 * 目录里冲突或查不到都不猜，交给人工补录。
 */
export function resolveFabricRatio(input: ItemInput): {
  fabric: number | null;
  silk: number | null;
  source: RatioSource;
} {
  if (input.fabricRatio != null && input.silkRatio != null) {
    return { fabric: input.fabricRatio, silk: input.silkRatio, source: "manual" };
  }
  const hit = lookupFabricRatio(input.fabricSku);
  if (hit.status === "ok") {
    return { fabric: hit.fabric, silk: hit.silk, source: "catalog" };
  }
  return {
    fabric: null,
    silk: null,
    source: hit.status === "conflict" ? "conflict" : "missing",
  };
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
/** 车间标签口径：保留一位小数，与表里 "2.0 & 1.7" 一致 */
function formatTier(tier: { long: number; short: number }): string {
  return `${tier.long.toFixed(1)} & ${tier.short.toFixed(1)}`;
}

export function getCordLengthTier(
  height: number,
  controlType: string,
  ruleVersion?: string | null
): string | null {
  if (controlType !== "普通") return null;
  const version = resolveRuleVersion(ruleVersion ?? RULE_VERSION);

  // 工艺组装!K5 第一分支：短窗走固定短绳，不进米制分档
  if (hasShortCordRule(version) && height <= SHORT_CORD_MAX_INCH) {
    return SHORT_CORD_TIER;
  }

  const table = getCordTable(version);
  const meters = height * 0.8 * 0.0254;
  for (const tier of table) {
    const hit = tier.exclusive ? meters < tier.maxMeters : meters <= tier.maxMeters;
    if (hit) {
      if (tier.long === 0) return null;
      return formatTier(tier);
    }
  }
  return formatTier(table[table.length - 1]);
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
export function calculateItem(
  input: ItemInput,
  ruleVersion?: string | null
): CuttingResults {
  const version = resolveRuleVersion(ruleVersion ?? RULE_VERSION);
  const ct = input.controlType as ControlType;
  const ht = input.headrailType as HeadrailType;
  const pt = input.productType as ProductType;
  const mt = input.measureType;
  const w = input.width;
  const h = input.height;

  // 罩盒：双轨无盒/单轨无盒 无罩盒
  const cutHeadrail = hasHeadrailCover(ht)
    ? calcComponentCut(w, ct, ht, "headrail", mt, version)
    : null;

  // 38管: 始终计算
  const cutTube38 = calcComponentCut(w, ct, ht, "tube38", mt, version);

  // 下杆: 根据产品类型选择
  let cutRollerBar: number | null = null;
  let cutZebraBar: number | null = null;
  let cutCoreRod: number | null = null;
  let cutShangrilaBar: number | null = null;

  if (pt === "卷帘") {
    cutRollerBar = calcComponentCut(w, ct, ht, "rollerBar", mt, version);
    if (input.bottomBarWidth != null) {
      cutRollerBar = input.bottomBarWidth;
    }
  } else if (pt === "斑马帘") {
    cutZebraBar = calcComponentCut(w, ct, ht, "zebraBar", mt, version);
    cutCoreRod = calcComponentCut(w, ct, ht, "coreRod", mt, version);
    if (input.bottomBarWidth != null) {
      cutZebraBar = input.bottomBarWidth;
    }
  } else if (pt === "香格里拉") {
    cutShangrilaBar = calcComponentCut(w, ct, ht, "shangrilaBar", mt, version);
    if (input.bottomBarWidth != null) {
      cutShangrilaBar = input.bottomBarWidth;
    }
  }

  // 面料宽度
  const cutFabricWidth = calcComponentCut(w, ct, ht, "fabricWidth", mt, version);

  // 面料长度
  const cutFabricLength = calcFabricLength(h, pt);

  // 插片尺寸
  const insertSize = calcInsertSize(ht, cutHeadrail);

  // 布纱比（人工优先 → SKU 目录）
  const ratio = resolveFabricRatio(input);

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
    ruleVersion: version,
    quantities: getComponentQuantities(pt, ht),
    cutClass: getCutClass(ht),
    fabricRatioUsed: ratio.fabric,
    silkRatioUsed: ratio.silk,
    ratioSource: ratio.source,
  };
}

/**
 * 批量计算整个订单的所有行项目
 */
export function calculateAllItems(
  items: ItemInput[],
  ruleVersion?: string | null
): CuttingResults[] {
  return items.map((item) => calculateItem(item, ruleVersion));
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
