/**
 * Vinyl 百叶窗框型规则
 * 来源: Vinyl百叶窗统一工艺单_V15.xlsx → 工艺单（每扇窗 30 行一块）
 *
 * ── 表里的「框型编码」是怎么回事 ──────────────────────────────
 * 原表用 J3:J9 七个互不相干的权重求和成 J10，再用 J10 去分支所有减尺公式：
 *   J3 外框=L      1.537      J7 位置=OUT    5.989
 *   J4 位置=IN     2.126      J8 外框=Z 或 T 6.666
 *   J5 外框数=4    3.279      J9 外框=Door   7.625
 *   J6 外框数=3+1  4.111
 * 六种合法组合（其余组合 J10 落不到任何分支，所有减尺返回 0）：
 *   6.942  = L    / 4   / IN
 *   10.805 = L    / 4   / OUT
 *   12.071 = Z·T  / 4   / IN
 *   12.903 = Z·T  / 3+1 / IN
 *   16.893 = Door / 4   / OUT
 *   17.725 = Door / 3+1 / OUT
 *
 * 这里**照抄这套求和**而不是直接写 (框型,框数,IN/OUT) 三元组查表 —— 这样
 * 车间在 Excel 里新增一种组合时，改动能一比一对应过来，也便于逐格对照验算。
 */

export const VINYL_RULE_VERSION = "vinyl_v15" as const;

export const FRAME_TYPES = ["L", "Z", "T", "Door"] as const;
export type FrameType = (typeof FRAME_TYPES)[number];

/** 外框数：表里 E7 拿去和数字 4 / 字符串 "3+1" 比 */
export const FRAME_COUNTS = ["4", "3+1"] as const;
export type FrameCount = (typeof FRAME_COUNTS)[number];

export const IN_OUT = ["IN", "OUT"] as const;
export type InOut = (typeof IN_OUT)[number];

export const STRUCTURES = ["有框", "无框"] as const;
export type Structure = (typeof STRUCTURES)[number];

/** 百叶尺寸（订单总表!E4），全单一个值 */
export const LOUVER_SIZES = [2.5, 3.5] as const;
export type LouverSize = (typeof LOUVER_SIZES)[number];

/** 分隔柱类型：T=分隔柱，H=挂柱（订单总表!G 列填 "2T"/"2H"） */
export const POST_TYPES = ["T", "H"] as const;
export type PostType = (typeof POST_TYPES)[number];

// ── J3:J9 权重（照抄 K3:K9） ──────────────────────────────────

export const FRAME_WEIGHTS = {
  frameL: 1.537,
  inSide: 2.126,
  count4: 3.279,
  count3plus1: 4.111,
  outSide: 5.989,
  frameZT: 6.666,
  frameDoor: 7.625,
} as const;

/** 按 J3:J9 的口径求和，得到 J10 */
export function computeFrameSignature(input: {
  frameType: string;
  frameCount: string;
  inOut: string;
}): number {
  const ft = String(input.frameType || "").trim().toUpperCase();
  const fc = String(input.frameCount || "").trim();
  const io = String(input.inOut || "").trim().toUpperCase();

  let sum = 0;
  if (ft === "L") sum += FRAME_WEIGHTS.frameL;             // J3
  if (io === "IN") sum += FRAME_WEIGHTS.inSide;            // J4
  if (fc === "4") sum += FRAME_WEIGHTS.count4;             // J5
  if (fc === "3+1") sum += FRAME_WEIGHTS.count3plus1;      // J6
  if (io === "OUT") sum += FRAME_WEIGHTS.outSide;          // J7
  if (ft === "Z" || ft === "T") sum += FRAME_WEIGHTS.frameZT; // J8（原表 I8="z"，Excel 比较不分大小写）
  if (ft === "DOOR") sum += FRAME_WEIGHTS.frameDoor;       // J9

  return Math.round(sum * 1000) / 1000;
}

const I = (sixteenths: number) => sixteenths / 16;

/**
 * 一种框型组合的全部减尺。
 * 每个字段都标了它来自哪个单元格，改表时按格对照。
 */
export interface FrameConfig {
  signature: number;
  label: string;
  /** H2 内空宽 */
  cavityWidth: (w: number) => number;
  /** I2 内空高 */
  cavityHeight: (h: number) => number;
  /** C5 分隔档位置（对 H4 的修正） */
  midRail: (m: number) => number;
  /** C11 型框-宽 */
  frameWidthCut: (w: number) => number;
  /** E11 型框-宽数量 */
  frameWidthQty: number;
  /** C12 型框-高 */
  frameHeightCut: (h: number) => number;
  /** E12 型框-高数量（表里恒为 2） */
  frameHeightQty: number;
  /** C13 底框（Z切边），0 表示这种组合没有底框 */
  bottomFrameCut: ((w: number) => number) | null;
  /**
   * D11 第二型框-宽：仅 Z·T 的两种组合有。
   * 注意：Sheet1 (2) 的框材统计只用 C11/C12，**不含 D 列** ——
   * 它是给车间看的备用料长，不进物料汇总。这里保持一致。
   */
  secondFrameWidth: ((w: number, frameType: FrameType, frameWidthCut: number) => number) | null;
  /** D12 第二型框-高：仅 12.071 有 */
  secondFrameHeight: ((h: number, frameType: FrameType, frameHeightCut: number) => number) | null;
}

/**
 * 六种组合。数字全部按 Excel 里的 `-26/16` 这种写法保留 16 分制，
 * 便于和单元格逐字对照，不预先约分成小数。
 */
export const FRAME_CONFIGS: readonly FrameConfig[] = [
  {
    signature: 6.942,
    label: "L / 4 / IN",
    cavityWidth: (w) => w - I(26),
    cavityHeight: (h) => h - I(26),
    midRail: (m) => m - I(14),
    frameWidthCut: (w) => w - I(2),
    frameWidthQty: 2,
    frameHeightCut: (h) => h - I(2),
    frameHeightQty: 2,
    bottomFrameCut: null,
    secondFrameWidth: null,
    secondFrameHeight: null,
  },
  {
    signature: 10.805,
    label: "L / 4 / OUT",
    cavityWidth: (w) => w + I(20) - 2.625,
    cavityHeight: (h) => h + I(20) - 2.625,
    midRail: (m) => m + I(9) - 1.3125,
    frameWidthCut: (w) => w + I(44) - 2.625,
    frameWidthQty: 2,
    frameHeightCut: (h) => h + I(44) - 2.625,
    frameHeightQty: 2,
    bottomFrameCut: null,
    secondFrameWidth: null,
    secondFrameHeight: null,
  },
  {
    signature: 12.071,
    label: "Z·T / 4 / IN",
    cavityWidth: (w) => w - I(18),
    cavityHeight: (h) => h - I(18),
    midRail: (m) => m - I(10),
    frameWidthCut: (w) => w - I(2),
    frameWidthQty: 2,
    frameHeightCut: (h) => h - I(2),
    frameHeightQty: 2,
    bottomFrameCut: null,
    // D11: T 框用主长 +2.75，Z 框另走一条
    secondFrameWidth: (w, ft, main) => (ft === "T" ? main + 2.75 : w - I(2) - I(15)),
    secondFrameHeight: (h, ft, main) => (ft === "T" ? main + 2.75 : h - I(2) - I(15)),
  },
  {
    signature: 12.903,
    label: "Z·T / 3+1 / IN",
    cavityWidth: (w) => w - I(18),
    cavityHeight: (h) => h - I(20), // 注意：宽减 18/16、高减 20/16，表里就是不对称的
    midRail: (m) => m - I(9),
    frameWidthCut: (w) => w - I(2),
    frameWidthQty: 1,
    frameHeightCut: (h) => h - I(2),
    frameHeightQty: 2,
    bottomFrameCut: (w) => w - I(18),
    secondFrameWidth: (w, ft, main) => (ft === "T" ? main + 2.75 : w - I(2) - I(15)),
    secondFrameHeight: null, // D12 只在 12.071 有
  },
  {
    signature: 16.893,
    label: "Door / 4 / OUT",
    cavityWidth: (w) => w + I(20) - 5.25,
    cavityHeight: (h) => h + I(20) - 5.25,
    midRail: (m) => m + I(9) - 2.625,
    frameWidthCut: (w) => w + I(86) - 5.25,
    frameWidthQty: 2,
    frameHeightCut: (h) => h + I(86) - 5.25,
    frameHeightQty: 2,
    bottomFrameCut: null,
    secondFrameWidth: null,
    secondFrameHeight: null,
  },
  {
    signature: 17.725,
    label: "Door / 3+1 / OUT",
    cavityWidth: (w) => w + I(20) - 5.25,
    cavityHeight: (h) => h + I(2) - 2.625, // 同样不对称
    midRail: (m) => m - I(9),
    frameWidthCut: (w) => w + I(86) - 5.25,
    frameWidthQty: 1,
    frameHeightCut: (h) => h + I(44) - 2.625,
    frameHeightQty: 2,
    bottomFrameCut: (w) => w + I(20) - 5.25,
    secondFrameWidth: null,
    secondFrameHeight: null,
  },
];

const BY_SIGNATURE = new Map(FRAME_CONFIGS.map((c) => [c.signature, c]));

/** 查框型配置；不认识的组合返回 null（表里等价于所有减尺落 0） */
export function getFrameConfig(signature: number): FrameConfig | null {
  return BY_SIGNATURE.get(Math.round(signature * 1000) / 1000) ?? null;
}

export function resolveFrameConfig(input: {
  frameType: string;
  frameCount: string;
  inOut: string;
}): { signature: number; config: FrameConfig | null } {
  const signature = computeFrameSignature(input);
  return { signature, config: getFrameConfig(signature) };
}

// ── 百叶尺寸相关常数（工艺单 F9/G9/G15/D5） ──────────────────

export interface LouverSpec {
  /** 有分隔档时的扣除量（123/16 或 139/16） */
  midRailDeduct: number;
  /** 无分隔档时的扣除量（164/16 或 180/16） */
  plainDeduct: number;
  /** 片距步长 */
  step: number;
  /** D5 分隔档位置的两个加项 */
  midRailOffsetA: number;
  midRailOffsetB: number;
}

export const LOUVER_SPECS: Record<string, LouverSpec> = {
  "2.5": {
    midRailDeduct: I(123),
    plainDeduct: I(164),
    step: 2,
    midRailOffsetA: 2.5625,
    midRailOffsetB: 5.1875,
  },
  "3.5": {
    midRailDeduct: I(139),
    plainDeduct: I(180),
    step: 3,
    midRailOffsetA: 3.0625,
    midRailOffsetB: 5.625,
  },
};

export function getLouverSpec(louverSize: number): LouverSpec | null {
  return LOUVER_SPECS[String(louverSize)] ?? null;
}

/** 挂柱(H) 与分隔柱(T) 在成品窗宽公式里占的宽度不同（B8） */
export const POST_WIDTH_ALLOWANCE: Record<PostType, number> = {
  T: 1,
  H: I(28),
};

/** 物料损耗系数（Sheet1 (2)!W2）。注意 Blinds 侧是 1.2，不要混用。 */
export const VINYL_WASTE_FACTOR = 1.15;
