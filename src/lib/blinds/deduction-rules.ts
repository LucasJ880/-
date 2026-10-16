/**
 * Blinds 工艺单减尺规则
 * 来源: Blinds 工艺单_圆盒侧盖加厚标准版20251024.xlsx → 盖盒Ref sheet
 *
 * 结构: DEDUCTION_RULES[操控方式][罩盒类型][配件类型] = 减尺值（英寸）
 * 减尺值为负数或零，表示从测量宽度上减去的量
 *
 * ── 版本纪律 ────────────────────────────────────────────────
 * 已经开过料的工单必须能原样重现当时的裁切尺寸，所以规则表**按版本冻结**：
 *   - BlindsOrder.ruleVersion 记录该单成单时用的版本
 *   - 导出/重算一律走 getDeductionRules(order.ruleVersion)，而不是"当前版本"
 *   - 只有新建/显式重算的单才用 RULE_VERSION（当前版本）
 * 加新版本时：追加一份 patch 列表，不要就地改老表。
 */

export const RULE_VERSIONS = [
  "blinds_20251024_v1",
  "blinds_20251024_v2",
] as const;

export type RuleVersion = (typeof RULE_VERSIONS)[number];

/** 当前版本——新建/重算工单默认用它 */
export const RULE_VERSION: RuleVersion = "blinds_20251024_v2";

/** 历史数据 ruleVersion 缺失/无法识别时的兜底（schema default 即 v1） */
export const LEGACY_RULE_VERSION: RuleVersion = "blinds_20251024_v1";

export function isRuleVersion(v: string): v is RuleVersion {
  return (RULE_VERSIONS as readonly string[]).includes(v);
}

/** 把任意字符串收敛为已知版本；不认识的一律按 v1（历史默认），绝不静默用新规则 */
export function resolveRuleVersion(v: string | null | undefined): RuleVersion {
  if (v && isRuleVersion(v)) return v;
  return LEGACY_RULE_VERSION;
}

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

/**
 * v1 减尺表（冻结，勿改）
 * 誊录自 2025-10 版盖盒Ref。已按此版本开料的工单靠它重现历史尺寸。
 */
const DEDUCTION_RULES_V1: Record<
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
 * v1 → v2 的逐格修正（2026-08-29）
 *
 * 依据：对 盖盒Ref 三张表 168 格逐格求值后与 v1 比对，仅此一格不一致。
 * 表里 H3 的公式是 `-1.125+1/16-1/16-1/16-1/16-2/16+2/16`，末尾 `-2/16+2/16`
 * 相互抵消 —— 对应批注「2024/09/10 圆盒端盖换厚，所有-2/16；2024/09/17 修改面料宽度只-1/16」。
 * v1 停在 09/10 那一版，少吃了 09/17 的回调，导致面料被多裁窄 2/16。
 *
 * 影响面：亮白插片圆盒 + 拉绳（普通）—— 最常见的配置。
 * 已按 v1 开过料的单保持 v1 不变；新单走 v2。
 */
interface DeductionPatch {
  control: ControlType;
  headrail: HeadrailType;
  component: keyof ComponentDeductions;
  from: number;
  to: number;
  note: string;
}

export const V2_PATCHES: readonly DeductionPatch[] = [
  {
    control: "普通",
    headrail: "亮白插片圆盒",
    component: "fabricWidth",
    from: -1.375,
    to: -1.25,
    note: "盖盒Ref!H3 末尾 -2/16+2/16 抵消；v1 漏了 2024/09/17 的回调",
  },
];

function applyPatches(
  base: Record<ControlType, Record<HeadrailType, ComponentDeductions>>,
  patches: readonly DeductionPatch[],
): Record<ControlType, Record<HeadrailType, ComponentDeductions>> {
  // 深拷贝后打补丁；from 不匹配直接抛，防止基表变动后补丁静默失效
  const next = JSON.parse(JSON.stringify(base)) as typeof base;
  for (const p of patches) {
    const cur = next[p.control][p.headrail][p.component];
    if (Math.abs(cur - p.from) > 1e-9) {
      throw new Error(
        `[deduction-rules] patch 基线不符: ${p.control}/${p.headrail}/${p.component} 期望 ${p.from} 实为 ${cur}`,
      );
    }
    next[p.control][p.headrail][p.component] = p.to;
  }
  return next;
}

const DEDUCTION_RULES_V2 = applyPatches(DEDUCTION_RULES_V1, V2_PATCHES);

const RULES_BY_VERSION: Record<
  RuleVersion,
  Record<ControlType, Record<HeadrailType, ComponentDeductions>>
> = {
  blinds_20251024_v1: DEDUCTION_RULES_V1,
  blinds_20251024_v2: DEDUCTION_RULES_V2,
};

/** 按版本取减尺表；不认识的版本按 v1（见 resolveRuleVersion） */
export function getDeductionRules(
  version: string | null | undefined,
): Record<ControlType, Record<HeadrailType, ComponentDeductions>> {
  return RULES_BY_VERSION[resolveRuleVersion(version)];
}

/** 当前版本的减尺表（等价于 getDeductionRules(RULE_VERSION)） */
export const DEDUCTION_RULES = RULES_BY_VERSION[RULE_VERSION];

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

/**
 * @deprecated 布纱比不再锁死 3:2。
 * 纵向Ref!C28/D28 的公式对任意布/纱比都成立，真实 SKU 绝大多数不是 3:2；
 * 权威比例见 fabric-ratio-catalog.ts（誊录自 Sheet1!W）。
 * 保留常量仅为兼容旧引用，勿在新代码里用它做校验。
 */
export const SUPPORTED_FABRIC_RATIOS = ["3:2"] as const;

/**
 * 拉绳长度分档表（操控方式 = 普通）
 * 输入: 测量高度 × 0.8 × 0.0254（转米）
 * 输出: "长绳 & 短绳" 格式
 *
 * `exclusive` = 该档用严格小于（<）而不是小于等于（<=）比较，
 * 对齐 工艺组装!K5 里 1.6 那一档写的是 `<1.6`。
 */
export interface CordTier {
  maxMeters: number;
  long: number;
  short: number;
  exclusive?: boolean;
}

/** v1 分档（冻结）——历史工单靠它重现 */
export const CORD_LENGTH_TABLE_V1: readonly CordTier[] = [
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
];

/** v2 分档：1.6 那档改回严格小于，与 工艺组装!K5 一致 */
export const CORD_LENGTH_TABLE_V2: readonly CordTier[] = CORD_LENGTH_TABLE_V1.map(
  (t) => (t.maxMeters === 1.6 ? { ...t, exclusive: true } : t),
);

/** 兼容旧引用：默认指向当前版本 */
export const CORD_LENGTH_TABLE = CORD_LENGTH_TABLE_V2;

/**
 * 短窗特例（v2 新增）——工艺组装!K5 的第一分支：
 *   测量高 ≤ 27 英寸 → 固定 "0.45 & 0.15"，不走米制分档。
 * v1 没有这条，会给成 "0.6 & 0.3"（偏长）。
 */
export const SHORT_CORD_MAX_INCH = 27;
export const SHORT_CORD_TIER = "0.45 & 0.15";

export function getCordTable(version: string | null | undefined): readonly CordTier[] {
  return resolveRuleVersion(version) === "blinds_20251024_v1"
    ? CORD_LENGTH_TABLE_V1
    : CORD_LENGTH_TABLE_V2;
}

/** v1 没有 ≤27" 短绳特例 */
export function hasShortCordRule(version: string | null | undefined): boolean {
  return resolveRuleVersion(version) !== "blinds_20251024_v1";
}

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

// ─────────────────────────────────────────────────────────────
// 裁剪数量 & 切割分类
// 来源: 工艺组装 第 8 行（B8/C8/D8/E8/F8/G8/H8/I8/J8）与 K8
// ─────────────────────────────────────────────────────────────

/** 双轨罩盒：所有部件都要裁两根 */
function isDoubleTrack(headrailType: HeadrailType): boolean {
  return headrailType === "双轨无盒" || headrailType === "双轨半盒";
}

/** 无罩盒：不裁罩盒本身（工艺组装!B7 在这两种下直接给 "*N/A"） */
export function hasHeadrailCover(headrailType: HeadrailType): boolean {
  return headrailType !== "双轨无盒" && headrailType !== "单轨无盒";
}

export interface ComponentQuantities {
  /** 罩盒；无罩盒型号为 null（不是 0，表示"这项不存在"） */
  headrail: number | null;
  tube38: number;
  /** 该产品对应的下杆（卷帘下杆 / 斑马帘下杆 / 香格里拉下杆） */
  bottomBar: number;
  /** 圆芯杆，仅斑马帘有；其余为 null */
  coreRod: number | null;
  fabricWidth: number;
  fabricLength: number;
}

/**
 * 按罩盒类型算各部件裁剪数量。
 *
 * 原表 E8（卷帘下杆）/H8（香格里拉下杆）拿罩盒名去比 "GREY ARC"/"White ARC"，
 * 而实际填的是中文「灰弧」「白弧」，比不上 → 数量落到 0，弧形盒的卷帘/香格里拉
 * 会漏裁下杆。F8（斑马帘）用的是中文，所以只有这两列中招。
 * 已确认是表的 bug（2026-08-29），此处按中文统一处理。
 *
 * 归纳后其实只有一条规则：双轨（无盒/半盒）= 2，其余 = 1。
 */
export function getComponentQuantities(
  productType: string,
  headrailType: HeadrailType,
): ComponentQuantities {
  const n = isDoubleTrack(headrailType) ? 2 : 1;
  return {
    headrail: hasHeadrailCover(headrailType) ? 1 : null,
    tube38: n,
    bottomBar: n,
    coreRod: productType === "斑马帘" ? n : null,
    fabricWidth: n,
    fabricLength: n,
  };
}

export const CUT_CLASSES = ["A类", "B类", "C类"] as const;
export type CutClass = (typeof CUT_CLASSES)[number];

/**
 * 切割分类（工艺组装!K8 → 开料表!O 列）——车间按它分组开料。
 *   方型罩盒（哑白/哑灰） → B类
 *   双轨无盒 / 单轨无盒   → C类
 *   其余                  → A类
 */
export function getCutClass(headrailType: HeadrailType): CutClass {
  if (headrailType === "哑白方型罩盒" || headrailType === "哑灰方型罩盒") {
    return "B类";
  }
  if (headrailType === "双轨无盒" || headrailType === "单轨无盒") {
    return "C类";
  }
  return "A类";
}

/**
 * 开料表「总计(米)」用的损耗系数 —— 开料表!B55 等：SUM(...)*0.0254*1.2
 */
export const CUTTING_WASTE_FACTOR = 1.2;

/**
 * 车间口径的操控方式写法。
 * 我们库里的枚举是「电动」，而车间表（工艺组装!I3）写的是「电机」，
 * 导出时按车间口径显示，避免两边对不上账。
 */
export const CONTROL_TYPE_SHOP_LABEL: Record<ControlType, string> = {
  "普通": "普通",
  "无绳": "无绳",
  "电动": "电机",
};
