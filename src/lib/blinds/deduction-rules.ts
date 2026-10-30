/**
 * Blinds 工艺单减尺规则
 * 规则版本: blinds_20261027_v2
 * 来源: Blinds 工艺单_圆盒侧盖加厚标准版（20241007 新）→ 盖盒Ref sheet
 *       SHA-256 85d45d6277624e35091b5e433e828cdde4d58c103bbc2319f29c6a4d56871e0c
 * 与原件逐值对照：src/lib/sunny-process/__tests__/blinds-oracle.test.ts
 *
 * 结构: DEDUCTION_RULES[操控方式][罩盒类型][配件类型] = 减尺值（英寸）
 * 减尺值为负数或零，表示从测量宽度上减去的量
 */

export const RULE_VERSION = "blinds_20261027_v2";

export type ControlType = "普通" | "无绳" | "电动";
export type HeadrailType =
  | "亮白插片圆盒"
  | "哑灰方型罩盒"
  | "哑白方型罩盒"
  | "灰弧"
  | "白弧"
  | "双轨无盒"
  | "双轨半盒"
  | "单轨无盒";

export type ComponentType =
  | "headrail"
  | "tube38"
  | "rollerBar"
  | "zebraBar"
  | "coreRod"
  | "shangrilaBar"
  | "fabricWidth";

export const HEADRAIL_TYPES: HeadrailType[] = [
  "亮白插片圆盒",
  "哑灰方型罩盒",
  "哑白方型罩盒",
  "灰弧",
  "白弧",
  "双轨无盒",
  "双轨半盒",
  "单轨无盒",
];

export const CONTROL_TYPES: ControlType[] = ["普通", "无绳", "电动"];

export const PRODUCT_TYPES = ["卷帘", "斑马帘", "香格里拉"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const MEASURE_TYPES = ["IN", "OUT", "Tight"] as const;
export const CONTROL_SIDES = ["L", "R", "M"] as const;
// 墙装：报价 Order Form 的 Bracket W；侧装为历史手录值，保留
export const MOUNT_TYPES = ["顶装", "墙装", "侧装"] as const;

// OUT/Tight 测量方式额外加值: 3/16 英寸
export const OUT_TIGHT_ADDITION = 3 / 16; // 0.1875

interface ComponentDeductions {
  headrail: number;
  tube38: number;
  rollerBar: number;
  zebraBar: number;
  coreRod: number;
  shangrilaBar: number;
  fabricWidth: number;
}

export const DEDUCTION_RULES: Record<
  ControlType,
  Record<HeadrailType, ComponentDeductions>
> = {
  "普通": {
    "亮白插片圆盒": { headrail: -0.5, tube38: -1.125, rollerBar: -1.125, zebraBar: -1.125, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.375 },
    "哑灰方型罩盒": { headrail: -0.4375, tube38: -1.25, rollerBar: -1.375, zebraBar: -1.1875, coreRod: -1.375, shangrilaBar: -1.375, fabricWidth: -1.4375 },
    "哑白方型罩盒": { headrail: -0.4375, tube38: -1.25, rollerBar: -1.375, zebraBar: -1.1875, coreRod: -1.375, shangrilaBar: -1.375, fabricWidth: -1.4375 },
    "灰弧": { headrail: -0.5, tube38: -1.125, rollerBar: -1.1875, zebraBar: -1.0625, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.3125 },
    "白弧": { headrail: -0.5, tube38: -1.125, rollerBar: -1.1875, zebraBar: -1.0625, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.3125 },
    "双轨无盒": { headrail: 0, tube38: -1.4375, rollerBar: -1.1875, zebraBar: 0, coreRod: 0, shangrilaBar: -1.1875, fabricWidth: -1.625 },
    "双轨半盒": { headrail: -0.375, tube38: -1, rollerBar: -1.1875, zebraBar: -1, coreRod: -1.1875, shangrilaBar: -0.75, fabricWidth: -1.25 },
    "单轨无盒": { headrail: 0, tube38: -1.625, rollerBar: -1.25, zebraBar: 0, coreRod: 0, shangrilaBar: -1.25, fabricWidth: -1.8125 },
  },
  "无绳": {
    "亮白插片圆盒": { headrail: -0.5, tube38: -0.9375, rollerBar: -0.625, zebraBar: -0.8125, coreRod: -1, shangrilaBar: -0.625, fabricWidth: -1.0625 },
    "哑灰方型罩盒": { headrail: -0.5, tube38: -1, rollerBar: -1.0625, zebraBar: -1.25, coreRod: -1.4375, shangrilaBar: -1.0625, fabricWidth: -1.4375 },
    "哑白方型罩盒": { headrail: -0.5, tube38: -1, rollerBar: -1.0625, zebraBar: -1.25, coreRod: -1.4375, shangrilaBar: -1.0625, fabricWidth: -1.4375 },
    "灰弧": { headrail: -0.25, tube38: -0.5, rollerBar: -0.5625, zebraBar: -0.75, coreRod: -0.9375, shangrilaBar: -0.5625, fabricWidth: -0.9375 },
    "白弧": { headrail: -0.25, tube38: -0.5, rollerBar: -0.5625, zebraBar: -0.75, coreRod: -0.9375, shangrilaBar: -0.5625, fabricWidth: -0.9375 },
    "双轨无盒": { headrail: 0, tube38: 0, rollerBar: 0, zebraBar: 0, coreRod: 0, shangrilaBar: 0, fabricWidth: 0 },
    "双轨半盒": { headrail: -0.375, tube38: -0.6875, rollerBar: -0.5, zebraBar: -0.6875, coreRod: -0.875, shangrilaBar: -0.5, fabricWidth: -0.875 },
    "单轨无盒": { headrail: 0, tube38: 0, rollerBar: 0, zebraBar: 0, coreRod: 0, shangrilaBar: 0, fabricWidth: 0 },
  },
  "电动": {
    "亮白插片圆盒": { headrail: -0.5, tube38: -1.125, rollerBar: -1.3125, zebraBar: -1.125, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.25 },
    "哑灰方型罩盒": { headrail: -0.4375, tube38: -1.1875, rollerBar: -1.375, zebraBar: -1.1875, coreRod: -1.375, shangrilaBar: -1.375, fabricWidth: -1.375 },
    "哑白方型罩盒": { headrail: -0.4375, tube38: -1.1875, rollerBar: -1.375, zebraBar: -1.1875, coreRod: -1.375, shangrilaBar: -1.375, fabricWidth: -1.375 },
    "灰弧": { headrail: -0.5, tube38: -1.0625, rollerBar: -1.1875, zebraBar: -1.0625, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.25 },
    "白弧": { headrail: -0.5, tube38: -1.0625, rollerBar: -1.1875, zebraBar: -1.0625, coreRod: -1.25, shangrilaBar: -0.875, fabricWidth: -1.25 },
    "双轨无盒": { headrail: 0, tube38: 0, rollerBar: 0, zebraBar: 0, coreRod: 0, shangrilaBar: 0, fabricWidth: 0 },
    "双轨半盒": { headrail: -0.375, tube38: -0.9375, rollerBar: -1.1875, zebraBar: -0.9375, coreRod: -1.1875, shangrilaBar: -0.75, fabricWidth: -1.1875 },
    "单轨无盒": { headrail: 0, tube38: 0, rollerBar: 0, zebraBar: 0, coreRod: 0, shangrilaBar: 0, fabricWidth: 0 },
  },
};

/**
 * 斑马帘裁剪位（纵向Ref 第 28 行模板）
 *   c = frac((高 − 0.1 − 0.1) / (布+纱)) × (布+纱) + 0.5
 *   c < 布 → round(c, 4)；否则 round(c − 布, 4)
 * 原件对任意布纱比生效（布纱比取自工艺单 L/M 列，含 3 2/16 : 2 2/16 这类分数比）。
 */
export const ZEBRA_CUT_TOP_TRIM = 0.1;
export const ZEBRA_CUT_BOTTOM_TRIM = 0.1;
export const ZEBRA_CUT_OFFSET = 0.5;

/** 布纱比未知时的默认值（原件 3:2 为最常见比；默认值会进待核对） */
export const DEFAULT_ZEBRA_RATIO = { fabric: 3, silk: 2 } as const;

/**
 * 拉绳分档表（操控方式 = 普通）——工艺组装第 1 窗位模板 K5 公式
 * 输入: 测量高度 × 0.8 × 0.0254（米）
 *   < 0.1 → 无；≤0.6；≤0.8；≤1.0；≤1.2；<1.5（注意是严格小于）；≤1.8；≤2.0；≤2.2；其余
 * 输出文本与原件逐字一致（"1.0 & 0.7"，保留一位小数）
 */
export const CORD_MIN_METERS = 0.1;
export const CORD_LENGTH_TABLE: ReadonlyArray<{ max: number; inclusive: boolean; label: string }> = [
  { max: 0.6, inclusive: true, label: "0.6 & 0.3" },
  { max: 0.8, inclusive: true, label: "0.8 & 0.5" },
  { max: 1.0, inclusive: true, label: "1.0 & 0.7" },
  { max: 1.2, inclusive: true, label: "1.2 & 0.9" },
  { max: 1.5, inclusive: false, label: "1.4 & 1.1" },
  { max: 1.8, inclusive: true, label: "1.7 & 1.4" },
  { max: 2.0, inclusive: true, label: "2.0 & 1.7" },
  { max: 2.2, inclusive: true, label: "2.0 & 1.7" },
];
export const CORD_LENGTH_TOP_LABEL = "2.4 & 2.1";

/**
 * 排序权重编码
 * 操控方式: 普通=10, 无绳=30, 电机=10（原始Excel逻辑）
 * 罩盒类型: 亮白插片圆盒=5, 方型罩盒=6, 弧形=7, 双轨无盒=8, 双轨半盒=9, 单轨无盒=10
 */
export const SORT_WEIGHT_CONTROL: Record<ControlType, number> = {
  "普通": 20,
  "电动": 10,
  "无绳": 30,
};

export const SORT_WEIGHT_HEADRAIL: Record<HeadrailType, number> = {
  "亮白插片圆盒": 5,
  "哑灰方型罩盒": 6,
  "哑白方型罩盒": 6,
  "灰弧": 7,
  "白弧": 7,
  "双轨无盒": 8,
  "双轨半盒": 9,
  "单轨无盒": 10,
};
