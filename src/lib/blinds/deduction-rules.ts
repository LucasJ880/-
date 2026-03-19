/**
 * Blinds 工艺单减尺规则
 * 规则版本: blinds_20251024_v1
 * 来源: Blinds 工艺单_圆盒侧盖加厚标准版20251024.xlsx → 盖盒Ref sheet
 *
 * 结构: DEDUCTION_RULES[操控方式][罩盒类型][配件类型] = 减尺值（英寸）
 * 减尺值为负数或零，表示从测量宽度上减去的量
 */

export const RULE_VERSION = "blinds_20251024_v1";

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
export const MOUNT_TYPES = ["顶装", "侧装"] as const;

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
 * 纵向Ref 参数 — 用于面料长度计算（斑马帘专用）
 * 第一版仅支持 3:2 布纱比
 */
export const VERTICAL_REF = {
  "3:2": {
    fabricLength: 3,
    silkLength: 2,
    total: 5,
    cuttingEdge: 0.8,
    tubeDiameter: 1.5,
    tubeCycle: 1.5 * Math.PI, // ≈ 4.7124
    belowRodLength: 1,
    cassetteAdjustment: 0.49,
    downDropAdjustment: 1.31,
  },
} as const;

export const SUPPORTED_FABRIC_RATIOS = ["3:2"] as const;

/**
 * 拉绳长度分档表（操控方式 = 普通）
 * 输入: 测量高度 × 0.8 × 0.0254（转米）
 * 输出: "长绳 & 短绳" 格式
 */
export const CORD_LENGTH_TABLE = [
  { maxMeters: 0.1, long: 0, short: 0 },
  { maxMeters: 0.7, long: 0.6, short: 0.3 },
  { maxMeters: 0.8, long: 0.8, short: 0.5 },
  { maxMeters: 1.0, long: 1.0, short: 0.7 },
  { maxMeters: 1.3, long: 1.2, short: 0.9 },
  { maxMeters: 1.6, long: 1.4, short: 1.1 },
  { maxMeters: 1.8, long: 1.7, short: 1.4 },
  { maxMeters: 2.0, long: 2.0, short: 1.7 },
  { maxMeters: 2.2, long: 2.0, short: 1.7 },
  { maxMeters: Infinity, long: 2.4, short: 2.1 },
] as const;

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
