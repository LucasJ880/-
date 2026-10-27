/**
 * Vinyl 百叶窗工艺单 —— 单窗工艺 / 下料总表 / 标签
 *
 * 口径 = 原件《Vinyl shutters 工艺单 AIV1（整合版）》：
 *   订单总表（输入）→ 工艺单（每窗 30 行块，模板 = 第 1 窗位）→ 下料总表 → Label / LABEL PRINT
 * 与原件逐值对照：src/lib/sunny-process/__tests__/vinyl-oracle.test.ts
 *
 * Excel 语义复刻约定：
 *   - 原件里的 #N/A / #DIV/0! 一律用 NaN 表示，算术自然传播；IF/AND/OR 遇到 NaN 条件返回 NaN（与 Excel 一致）
 *   - Excel 文本比较不区分大小写（C7="z" 命中 "Z"），这里统一转大写比较
 *   - 外框组合码 J10 是 7 个常数的和，按三位小数匹配 6 个受支持的码
 */

import { excelRound, roundTo16th, roundUp, sixteenthsText } from "./excel-fns";

export const VINYL_LOUVER_SIZES = [2.5, 3.5] as const;
export const VINYL_FRAMES = ["L", "Z", "T", "Door"] as const;
export const VINYL_FRAME_COUNTS = ["4", "3+1"] as const;
export const VINYL_IN_OUT = ["IN", "OUT"] as const;
export const VINYL_STRUCTURES = ["有框", "无框"] as const;
export const VINYL_POSTS = ["1T", "2T", "3T", "4T", "1H", "2H", "3H", "4H"] as const;
export const VINYL_RODS = ["后面-旁边", "前面-中间", "后面-中间", "前面-旁边", "隐形拉杆"] as const;
export const VINYL_SPLITS = [
  "不切分", "整体1/3", "整体1/2", "整体2/3", "上1/3", "上1/2", "上2/3", "下1/3", "下1/2", "下2/3",
  "上1/3+下1/3", "上1/3+下1/2", "上1/3+下2/3", "上1/2+下1/3", "上1/2+下1/2", "上1/2+下2/3",
  "上2/3+下1/3", "上2/3+下1/2", "上2/3+下2/3",
] as const;

export const SPLIT_ERROR_ZH = "切分不能做：每段至少3片；整体限无档，上/下限有档";

export interface VinylHeader {
  orderNo: string;
  /** 百叶尺寸 2.5 / 3.5（英寸） */
  louver: number;
  color: string;
  /** 订单级默认控制杆位置（订单总表 J4） */
  defaultRod: string;
}

export interface VinylWindowInput {
  location: string;
  width: number;
  height: number;
  /** 扇数 */
  panels: number;
  /** 开合编码（如 LLRR / LTLRTR） */
  openCode: string;
  /** 分隔柱：1T…4T / 1H…4H，空 = 无 */
  posts: string;
  /** 第一档底部（英寸）；与比例二选一，英寸优先 */
  rail1In: number | null;
  /** 第一档比例（× 高度） */
  rail1Ratio: number | null;
  /** 控制杆位置 / 例外；空 = 用订单默认 */
  rod: string;
  /** 切分（从下往上） */
  split: string;
  /** 外框 L / Z / T / Door */
  frame: string;
  /** 外框数 4 / "3+1" */
  frameCount: number | string;
  inOut: string;
  /** 有框 / 无框 */
  structure: string;
  /** 第二档底部（英寸） */
  rail2In: number | null;
}

/** 单窗工艺（工艺单块），字段名与夹具一致；NaN = 原件 #N/A/#DIV/0! */
export interface VinylWindowResult {
  innerWidth: number; innerHeight: number; openKey: string | 0; frameKey: number;
  rail1Raw: number; rail1: number; rail1Actual: number; postKind: "分隔柱" | "挂柱"; postCount: number;
  rodPosition: string; panelWidth: number; panelHeight: number;
  louverTotal: number; louverUpper: number; louverLower: number;
  splitKey: string; splitWhole: number; splitUpper: number; splitLower: number; splitOn: boolean; splitError: boolean | null;
  splitWholeUpper: number; splitWholeLower: number; splitUpperUpper: number; splitUpperLower: number;
  splitLowerUpper: number; splitLowerLower: number; louverLowerRaw: number;
  frameW: number; frameW2: number; frameWQty: number; frameWAngleA: number; frameWAngleB: number;
  frameH: number; frameH2: number; frameHQty: number; frameHAngleA: number; frameHAngleB: number;
  zSill: number; zSillQty: number; zSillAngleA: number; zSillAngleB: number;
  postName: "分隔柱" | "挂柱"; postLen: number; postQty: number;
  stileLen: number; stileQty: number; pitch: number;
  railLen: number; railQty: number; midRailLen: number; midRailQty: number;
  louverLen: number; louverQty: number;
  rodUpper: number; rodUpper2: number | null; rodUpperQty: number;
  rodLower: number; rodLower2: number | null; rodLowerQty: number;
  rail2: number; rail2Actual: number; louverMiddle: number; rodMiddle: number; rodMiddleQty: number;
  /** 原件 A23 提示行；NaN 表示原件该格为错误值 */
  message: string | null;
  sf: number;
  /** 外框组合是否为原件支持的 6 种（或无框） */
  frameSupported: boolean;
}

const E = Number.NaN;
const isErr = (x: number) => Number.isNaN(x);
const anyErr = (...xs: number[]) => xs.some(isErr);

/** Excel IF：条件为错误 → 错误；truthy = 非零 */
function IF(cond: number | boolean, a: () => number, b: () => number): number {
  if (typeof cond === "number") {
    if (isErr(cond)) return E;
    return cond !== 0 ? a() : b();
  }
  return cond ? a() : b();
}
/** 比较结果：任一侧错误 → NaN（作为"错误布尔"），否则 1/0 */
function cmp(a: number, b: number, op: ">" | "<" | "<=" | ">=" | "="): number {
  if (anyErr(a, b)) return E;
  switch (op) {
    case ">": return a > b ? 1 : 0;
    case "<": return a < b ? 1 : 0;
    case "<=": return a <= b ? 1 : 0;
    case ">=": return a >= b ? 1 : 0;
    default: return a === b ? 1 : 0;
  }
}
function OR(...xs: number[]): number {
  if (anyErr(...xs)) return E;
  return xs.some((x) => x !== 0) ? 1 : 0;
}
function AND(...xs: number[]): number {
  if (anyErr(...xs)) return E;
  return xs.every((x) => x !== 0) ? 1 : 0;
}
const b2n = (b: boolean) => (b ? 1 : 0);
const div = (a: number, b: number) => (b === 0 || anyErr(a, b) ? E : a / b);
const up = (x: number) => (isErr(x) ? E : roundUp(x, 0));

/** 外框组合码：J3..J9 常数之和 */
const FRAME_KEYS = [6.942, 10.805, 12.071, 12.903, 16.893, 17.725] as const;
type FrameKey = (typeof FRAME_KEYS)[number] | 0;

function frameKeyOf(frame: string, inOut: string, frameCount: number | string): number {
  const f = frame.trim().toUpperCase();
  const io = inOut.trim().toUpperCase();
  let sum = 0;
  if (f === "L") sum += 1.537;
  if (io === "IN") sum += 2.126;
  if (frameCount === 4) sum += 3.279;
  if (typeof frameCount === "string" && frameCount.trim() === "3+1") sum += 4.111;
  if (io === "OUT") sum += 5.989;
  if (f === "Z" || f === "T") sum += 6.666;
  if (f === "DOOR") sum += 7.625;
  return Math.round(sum * 1000) / 1000;
}

function matchKey(k: number): FrameKey {
  return (FRAME_KEYS as readonly number[]).includes(k) ? (k as FrameKey) : 0;
}

/** 按组合码取值（原件多层 IF(J10=...)），不支持的码取 fallback */
function byKey(k: FrameKey, m: Partial<Record<Exclude<FrameKey, 0>, number>>, fallback = 0): number {
  if (k === 0) return fallback;
  return m[k] ?? fallback;
}

const OPEN_KEYS_COMMON: [string[], string][] = [
  [["LR", "TLRT"], "3/1"],
  [["LTLTR"], "3/3"],
  [["LLRR", "LTLRTR"], "5/3"],
  [["LRTLR"], "6/2"],
];

/** 开启代码（工艺单 G3）。2.5" 分支取第 1 窗位与其余窗位写法的并集（偏离 X-5） */
export function openKeyOf(code: string, louver: number): string | 0 {
  const c = code.trim().toUpperCase();
  if (louver === 2.5) {
    if (["L", "R", "TL", "TR", "TRT", "RT"].includes(c)) return "1/1";
    if (["LRTR", "LLR", "LIR", "LTLR"].includes(c)) return "4/2";
    if (c === "LTLTRTR") return "4/4";
  } else {
    if (["L", "R", "TL", "TR", "TRT", "RT", "LT"].includes(c)) return "1/1";
    if (["LRTR", "LLR", "LIR", "LTLR"].includes(c)) return "4/2";
    if (["LTLTRTR", "LTRTRTR"].includes(c)) return "4/4";
    if (c === "LRTLRTLR") return "9/3";
  }
  for (const [codes, key] of OPEN_KEYS_COMMON) if (codes.includes(c)) return key;
  return 0;
}

function splitParts(split: string) {
  const key = split.trim() === "" ? "不切分" : split.trim();
  const whole = key === "1/3" || key === "整体1/3" ? 1 / 3 : key === "1/2" || key === "整体1/2" ? 1 / 2 : key === "2/3" || key === "整体2/3" ? 2 / 3 : 0;
  const upper = key.includes("上1/3") ? 1 / 3 : key.includes("上1/2") ? 1 / 2 : key.includes("上2/3") ? 2 / 3 : 0;
  const lower = key.includes("下1/3") ? 1 / 3 : key.includes("下1/2") ? 1 / 2 : key.includes("下2/3") ? 2 / 3 : 0;
  return { key, whole, upper, lower };
}

/** 数字拼进文本（Excel & 运算）：整数不带小数点 */
function numText(x: number): string {
  if (Number.isInteger(x)) return String(x);
  return String(Number.parseFloat(x.toPrecision(15)));
}

export function computeVinylWindow(w: VinylWindowInput, header: VinylHeader): VinylWindowResult {
  const C4 = w.width || 0;
  const F4 = w.height || 0;
  const C6 = w.panels || 0;
  const noFrame = w.structure.trim() === "无框";
  const louver25 = header.louver === 2.5;
  const off = louver25 ? 123 / 16 : 139 / 16;
  const offNoRail = louver25 ? 164 / 16 : 180 / 16;
  const step = louver25 ? 2 : 3;
  const railGap = 2 * off - offNoRail;

  const rawKey = frameKeyOf(w.frame, w.inOut, w.frameCount);
  const K = matchKey(rawKey);
  const frameUpper = w.frame.trim().toUpperCase();

  // 分隔柱：H5 = 订单总表 G；空 → 0 → LEFT/RIGHT 得 "0"
  const posts = w.posts.trim() === "" ? "0" : w.posts.trim();
  const postSuffix = posts.slice(-1).toUpperCase();
  const F5 = Number.parseFloat(posts.slice(0, 1)) || 0;
  const postKind: "分隔柱" | "挂柱" = postSuffix === "H" ? "挂柱" : "分隔柱";

  const H2 = noFrame ? C4 : byKey(K, { 6.942: C4 - 26 / 16, 10.805: C4 + 20 / 16 - 2.625, 12.071: C4 - 18 / 16, 12.903: C4 - 18 / 16, 16.893: C4 + 20 / 16 - 5.25, 17.725: C4 + 20 / 16 - 5.25 });
  const I2 = noFrame ? F4 : byKey(K, { 6.942: F4 - 26 / 16, 10.805: F4 + 20 / 16 - 2.625, 12.071: F4 - 18 / 16, 12.903: F4 - 20 / 16, 16.893: F4 + 20 / 16 - 5.25, 17.725: F4 + 2 / 16 - 2.625 });

  const H4 = w.rail1In ? w.rail1In : (w.rail1Ratio ?? 0) * F4;
  const railAdj = (x: number) => byKey(K, { 6.942: x - 14 / 16, 10.805: x + 9 / 16 - 1.3125, 12.071: x - 10 / 16, 12.903: x - 9 / 16, 16.893: x + 9 / 16 - 2.625, 17.725: x - 9 / 16 });
  const C5 = noFrame ? H4 : H4 ? railAdj(H4) : 0;

  const rodPosition = w.rod.trim() !== "" ? w.rod.trim() : header.defaultRod.trim() !== "" ? header.defaultRod.trim() : "";

  // 成品扇宽高
  const B8 = H2 ? ((H2 - (C6 * 1.5 + 2 * F5 + 2) / 16 - F5 * (postSuffix === "H" ? 28 / 16 : 1)) / C6 - 1 / 16) : 0;
  const panelWidth = H2 && C6 === 0 ? E : B8;
  const D8 = I2 - 4 / 16;

  // 第二档
  const Q = w.rail2In;
  const hasQ = Q !== null && Q !== undefined && Q !== 0;
  let C21 = 0;
  if (hasQ) {
    const q = Q as number;
    if (q > H4 && H4 > 0 && q < F4) {
      C21 = noFrame ? q : q ? railAdj(q) : 0;
    } else {
      C21 = E;
    }
  }
  const G21 = hasQ ? IF(cmp(C21 - C5 - railGap, 0, ">"), () => up((C21 - C5 - railGap) / step) + 1, () => E) : 0;

  // 切分
  const sp = splitParts(w.split);
  const AB9 = sp.whole;
  const AC9 = sp.upper;
  const AD9 = sp.lower;
  const AE9 = AB9 > 0 || AC9 > 0 || AD9 > 0;

  const AO9 = hasQ
    ? IF(cmp(C5 - off, 0, ">"), () => up((C5 - off) / step) + 1, () => E)
    : C5 ? up((C5 - off) / step) + 1 : up((D8 - offNoRail) / step) + 1;
  const AG9 = AB9 > 0 ? AO9 - up(AO9 * AB9) : 0;
  const AH9 = AB9 > 0 ? up(AO9 * AB9) : 0;

  const F9 = AB9 > 0 ? AG9 : hasQ
    ? IF(cmp(D8 - C21 - off, 0, ">"), () => up((D8 - C21 - off) / step) + 1, () => E)
    : C5 ? up((D8 - C5 - off) / step) + 1 : 0;
  const G9 = AB9 > 0 ? AH9 : AO9;
  const E9 = hasQ ? F9 + G9 + G21 : F9 + G9;

  const AI9 = AC9 > 0 ? F9 - up(F9 * AC9) : F9;
  const AJ9 = AC9 > 0 ? up(F9 * AC9) : 0;
  const AK9 = AD9 > 0 ? G9 - up(G9 * AD9) : G9;
  const AL9 = AD9 > 0 ? up(G9 * AD9) : 0;

  const AF9 = OR(
    b2n(sp.key !== "不切分" && !AE9),
    AND(b2n(AB9 > 0), OR(cmp(C5, 0, ">"), cmp(C21, 0, ">"), b2n(AC9 > 0), b2n(AD9 > 0), cmp(AG9, 3, "<"), cmp(AH9, 3, "<"))),
    AND(b2n(AC9 > 0), OR(cmp(C5, 0, "<="), cmp(AI9, 3, "<"), cmp(AJ9, 3, "<"))),
    AND(b2n(AD9 > 0), OR(cmp(C5, 0, "<="), cmp(AK9, 3, "<"), cmp(AL9, 3, "<"))),
  );

  // 孔距
  const G15 = hasQ
    ? div((D8 - C21 - off) + (C5 - off) + (C21 - C5 - railGap), F9 + G9 + G21 - 3)
    : C5
      ? div((D8 - C5 - off) + (D8 - (D8 - C5) - off), F9 + G9 - 2)
      : D8 > 0 ? div(D8 - offNoRail, up((D8 - offNoRail) / step)) : 0;

  const D5 = C5 > 0 ? (G9 - 1) * G15 + (louver25 ? 2.5625 + 5.1875 : 3.0625 + 5.625) : 0;

  // 外框
  const C11 = byKey(K, { 6.942: C4 - 2 / 16, 10.805: C4 + 44 / 16 - 2.625, 12.071: C4 - 2 / 16, 12.903: C4 - 2 / 16, 16.893: C4 + 86 / 16 - 5.25, 17.725: C4 + 86 / 16 - 5.25 });
  const D11 = K === 12.071 || K === 12.903 ? (frameUpper === "T" ? C11 + 2.75 : C4 - 2 / 16 - 15 / 16) : 0;
  const E11 = byKey(K, { 6.942: 2, 10.805: 2, 12.071: 2, 12.903: 1, 16.893: 2, 17.725: 1 });
  const C12 = byKey(K, { 6.942: F4 - 2 / 16, 10.805: F4 + 44 / 16 - 2.625, 12.071: F4 - 2 / 16, 12.903: F4 - 2 / 16, 16.893: F4 + 86 / 16 - 5.25, 17.725: F4 + 44 / 16 - 2.625 });
  const D12 = K === 12.071 ? (frameUpper === "T" ? C12 + 2.75 : F4 - 2 / 16 - 15 / 16) : 0;
  const E12 = K === 0 ? 0 : 2;
  const C13 = K === 12.903 ? C4 - 18 / 16 : K === 17.725 ? C4 + 20 / 16 - 5.25 : 0;
  const E13 = C13 > 0 ? 1 : 0;

  // 柱
  const C14 = postSuffix === "T" ? I2 : postSuffix === "H" ? D8 - 3 / 16 : 0;

  const C15 = D8 - 3 / 16;
  const C16 = panelWidth - 3.5;
  const C17 = C5 ? C16 : 0;
  const E17 = hasQ ? IF(cmp(C21, 0, ">"), () => C6 * 2, () => E) : C17 ? C6 : 0;
  const C18 = C16 - 2 / 16;

  const C19 = IF(AF9, () => E, () => (AB9 > 0 ? G15 * (AG9 - 1) + 1 : AC9 > 0 ? G15 * (AI9 - 1) + 1 : IF(F9, () => G15 * (F9 - 1) + 1.5, () => 0)));
  const D19 = AC9 > 0 ? IF(AF9, () => E, () => G15 * (AJ9 - 1) + 1) : null;
  const C20 = IF(AF9, () => E, () => (AB9 > 0 ? G15 * (AH9 - 1) + 1 : AD9 > 0 ? G15 * (AK9 - 1) + 1 : IF(G15, () => G15 * (G9 - 1) + 1.5, () => 0)));
  const D20 = AD9 > 0 ? IF(AF9, () => E, () => G15 * (AL9 - 1) + 1) : null;

  const D21 = hasQ ? D5 + (G21 - 1) * G15 + railGap : 0;
  const C22 = hasQ ? G15 * (G21 - 1) + 1.5 : 0;
  const E22 = hasQ ? IF(cmp(C22, 0, ">"), () => C6, () => E) : 0;

  let message: string | null;
  if (isErr(AF9)) message = null;
  else if (AF9) message = SPLIT_ERROR_ZH;
  else if (AE9) {
    const body = AB9 > 0
      ? `整体上${numText(AG9)}/下${numText(AH9)}片`
      : `${AC9 > 0 ? `上区上${numText(AI9)}/下${numText(AJ9)}片；` : ""}${AD9 > 0 ? `下区上${numText(AK9)}/下${numText(AL9)}片` : ""}`;
    message = isErr(AG9) || isErr(AH9) || (AC9 > 0 && anyErr(AI9, AJ9)) || (AD9 > 0 && anyErr(AK9, AL9)) ? null : `切分从下往上：${body}；杆端各1/2 inch`;
  } else if (hasQ) {
    message = isErr(G21) ? "双中分档输入错误：检查第一、第二档位置及各段高度" : "双档：C列为换算位置，D列为按孔距调整后的实际位置";
  } else message = "";

  return {
    innerWidth: H2, innerHeight: I2, openKey: openKeyOf(w.openCode, header.louver), frameKey: rawKey,
    rail1Raw: H4, rail1: C5, rail1Actual: D5, postKind, postCount: F5, rodPosition,
    panelWidth, panelHeight: D8,
    louverTotal: E9, louverUpper: F9, louverLower: G9,
    splitKey: sp.key, splitWhole: AB9, splitUpper: AC9, splitLower: AD9, splitOn: AE9,
    splitError: isErr(AF9) ? null : AF9 !== 0,
    splitWholeUpper: AG9, splitWholeLower: AH9, splitUpperUpper: AI9, splitUpperLower: AJ9,
    splitLowerUpper: AK9, splitLowerLower: AL9, louverLowerRaw: AO9,
    frameW: C11, frameW2: D11, frameWQty: E11, frameWAngleA: C11 > 0 ? 45 : 0, frameWAngleB: C11 > 0 ? 45 : 0,
    frameH: C12, frameH2: D12, frameHQty: E12, frameHAngleA: E12 === 2 ? 45 : 0,
    frameHAngleB: E11 === 2 ? 45 : E11 === 1 ? 90 : 0,
    zSill: C13, zSillQty: E13, zSillAngleA: E13 > 0 ? 90 : 0, zSillAngleB: E13 > 0 ? 90 : 0,
    postName: postKind, postLen: C14, postQty: F5,
    stileLen: C15, stileQty: C6 * 2, pitch: G15,
    railLen: C16, railQty: C6 * 2, midRailLen: C17, midRailQty: E17,
    louverLen: C18, louverQty: E9 * C6,
    rodUpper: C19, rodUpper2: D19, rodUpperQty: IF(cmp(C19, 0, ">"), () => C6, () => 0),
    rodLower: C20, rodLower2: D20, rodLowerQty: IF(cmp(C20, 0, ">"), () => C6, () => 0),
    rail2: C21, rail2Actual: D21, louverMiddle: G21, rodMiddle: C22, rodMiddleQty: E22,
    message,
    sf: roundUp((roundUp(C4, 0) * roundUp(F4, 0)) / 144, 0),
    frameSupported: noFrame || K !== 0,
  };
}

// ─────────────────────────── 下料总表 ───────────────────────────

export type VinylPieceType = "外框" | "T柱" | "挂柱" | "直柱" | "控制杆" | "上下横档" | "中分档" | "百叶片" | "框内横料";

/** 料型顺序（下料总表 P 列）：外框 1 → T柱 2 → 挂柱 3 → 直柱 4 → 控制杆 5 → 上下横档 6 → 中分档 7 → 百叶片 8 */
const PIECE_ORDER: Record<VinylPieceType, number> = {
  外框: 1, 框内横料: 1, T柱: 2, 挂柱: 3, 直柱: 4, 控制杆: 5, 上下横档: 6, 中分档: 7, 百叶片: 8,
};

export interface VinylCutRow {
  seq: number;
  type: VinylPieceType;
  spec: string;
  /** 1/16 取整后的长度（英寸） */
  length: number;
  qty: number;
  /** 端头角度："45°/45"、"—" … */
  ends: string;
  /** "#1×2 #3×4" */
  windows: string;
}

interface PieceLine {
  window: number;
  windowNo: number;
  type: VinylPieceType;
  spec: string;
  length: number;
  qty: number;
  ends: string;
}

function angleText(a: number, b: number): string {
  return `${excelRound(a)}°/${excelRound(b)}`;
}

/**
 * 汇总下料：同料型 + 规格 + 1/16 长度 + 端头合并；料型顺序、同料型首现顺序、长度降序排序。
 * includePosts=false 复刻原件（T柱 / 挂柱数量为文本被 SUMIFS 忽略，从不出现，偏离 X-4）。
 */
export function buildVinylCutList(
  windows: { input: VinylWindowInput; result: VinylWindowResult; windowNo: number }[],
  header: VinylHeader,
  opts: { includePosts: boolean } = { includePosts: true },
): VinylCutRow[] {
  const lines: PieceLine[] = [];
  const louverSpec = `${sixteenthsText(header.louver)} in`;
  const pos = (x: number | null) => x !== null && !Number.isNaN(x) && x > 0;
  const push = (k: number, windowNo: number, active: boolean, type: VinylPieceType, spec: string, len: number | null, qty: number, ends: string, countQty = true) => {
    if (!active || !pos(len) || !pos(qty)) {
      lines.push({ window: k, windowNo, type, spec, length: 0, qty: 0, ends });
      return;
    }
    lines.push({ window: k, windowNo, type, spec, length: roundTo16th(len as number), qty: countQty ? qty : 0, ends });
  };
  windows.forEach(({ input: w, result: r, windowNo }, k) => {
    const on = w.panels > 0;
    const framed = w.structure.trim() !== "无框";
    const frameSpec = w.frame.trim();
    const suffix = (w.posts.trim() || "0").slice(-1).toUpperCase();
    push(k, windowNo, on, "直柱", "", r.stileLen, r.stileQty, "—");
    push(k, windowNo, on, "上下横档", "", r.railLen, r.railQty, "—");
    push(k, windowNo, on, "中分档", "", r.midRailLen, r.midRailQty, "—");
    push(k, windowNo, on, "百叶片", louverSpec, r.louverLen, r.louverQty, "—");
    push(k, windowNo, on, "控制杆", "", r.rodUpper, r.rodUpperQty, "—");
    push(k, windowNo, on, "控制杆", "", r.rodMiddle, r.rodMiddleQty, "—");
    push(k, windowNo, on, "控制杆", "", r.rodLower, r.rodLowerQty, "—");
    push(k, windowNo, on && suffix === "T", "T柱", "", r.postLen, r.postQty, "—", opts.includePosts);
    push(k, windowNo, on && suffix === "H", "挂柱", "", r.postLen, r.postQty, "—", opts.includePosts);
    push(k, windowNo, on && framed, "外框", frameSpec, r.frameW, r.frameWQty, angleText(r.frameWAngleA, r.frameWAngleB));
    push(k, windowNo, on && framed, "外框", frameSpec, r.frameH, r.frameHQty, angleText(r.frameHAngleA, r.frameHAngleB));
    push(k, windowNo, on && framed, "框内横料", frameSpec, r.zSill, r.zSillQty, angleText(r.zSillAngleA, r.zSillAngleB));
  });
  // 原件第 365–424 行：每窗切分后的第二根上 / 下控制杆
  windows.forEach(({ input: w, result: r, windowNo }, k) => {
    const on = w.panels > 0;
    push(k, windowNo, on, "控制杆", "", r.rodUpper2, r.rodUpperQty, "—");
    push(k, windowNo, on, "控制杆", "", r.rodLower2, r.rodLowerQty, "—");
  });

  const typeKey = (l: PieceLine) => `${l.type}_${l.spec}`;
  const cutKey = (l: PieceLine) => `${typeKey(l)}_${excelRound(l.length * 16)}_${l.ends}`;
  const firstTypeIdx = new Map<string, number>();
  lines.forEach((l, i) => { if (!firstTypeIdx.has(typeKey(l))) firstTypeIdx.set(typeKey(l), i); });

  const groups = new Map<string, { first: number; line: PieceLine; qty: number; perWindow: Map<number, number> }>();
  lines.forEach((l, i) => {
    const key = cutKey(l);
    let g = groups.get(key);
    if (!g) {
      g = { first: i, line: l, qty: 0, perWindow: new Map() };
      groups.set(key, g);
    }
    g.qty += l.qty;
    if (l.qty > 0) g.perWindow.set(l.windowNo, (g.perWindow.get(l.windowNo) ?? 0) + l.qty);
  });

  const n = lines.length;
  const rows = [...groups.values()]
    .filter((g) => g.line.length > 0 && g.qty > 0 && g.first === lines.findIndex((l) => cutKey(l) === cutKey(g.line)))
    .map((g) => {
      const longer = lines.filter((l) => typeKey(l) === typeKey(g.line) && l.length > g.line.length).length;
      const sortKey = (20 - PIECE_ORDER[g.line.type]) * 1e6 + (n + 1 - (firstTypeIdx.get(typeKey(g.line)) ?? 0)) * 1000
        + (n + 1 - longer) / 1000 + (n + 1 - g.first) / 1e6;
      return { g, sortKey };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  return rows.map(({ g }, i) => ({
    seq: i + 1,
    type: g.line.type,
    spec: g.line.spec,
    length: g.line.length,
    qty: g.qty,
    ends: g.line.ends,
    windows: [...g.perWindow.entries()].sort((a, b) => a[0] - b[0]).map(([no, q]) => `#${no}×${q}`).join(" "),
  }));
}

// ─────────────────────────── 标签 ───────────────────────────

export interface VinylLabel {
  windowNo: number;
  kind: "PANEL" | "FRAME";
  /** 4 行文本；null = 原件该行为错误值（扇数与开合编码不符时） */
  lines: (string | null)[];
}

function letterPositions(code: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < code.length; i++) if (code[i] === "L" || code[i] === "R") out.push(i);
  return out;
}

/** 左开 / 左折叠 / 右开 / 右折叠（Label!X） */
function panelSwing(code: string, idx: number): string | null {
  const pos = letterPositions(code)[idx - 1];
  if (pos === undefined) return null;
  const ch = code[pos];
  const next = code[pos + 1] ?? "";
  const prev = pos > 0 ? code[pos - 1] : "";
  if (ch === "L") return next === "L" || prev === "L" ? "左折叠" : "左开";
  return next === "R" || prev === "R" ? "右折叠" : "右开";
}

export function buildVinylLabels(
  windows: { input: VinylWindowInput; result: VinylWindowResult; windowNo: number }[],
  header: VinylHeader,
): VinylLabel[] {
  const labels: VinylLabel[] = [];
  // 原件引用空单元格得 0：订单号 / 框型为空时标签打印 "0"（实际生成时这两项必有值）
  const order = `ORDER ${header.orderNo || "0"}`;
  for (const { input: w, result: r, windowNo } of windows) {
    const panels = Number.isFinite(w.panels) && w.panels > 0 ? w.panels : 0;
    if (panels === 0) continue;
    const framed = w.structure.trim() !== "无框";
    const code = w.openCode.toUpperCase();
    const loc = code.length > 9 ? "" : `  ${w.location.slice(0, 12)}`;
    const size = (wd: number, ht: number) => `${sixteenthsText(roundTo16th(wd))} W × ${sixteenthsText(roundTo16th(ht))} H (in)`;
    for (let i = 1; i <= panels; i++) {
      const swing = panelSwing(code, i);
      labels.push({
        windowNo,
        kind: "PANEL",
        lines: [order, `#${windowNo} ${panels}`, swing === null ? null : `P${i}/${panels} · ${swing} · ${code}${loc}`, size(r.panelWidth, r.panelHeight)],
      });
    }
    if (framed) {
      labels.push({
        windowNo,
        kind: "FRAME",
        lines: [order, `#${windowNo}`, `${w.frame || "0"} FRAME · ${code}${loc}`, size(r.frameW, r.frameH)],
      });
    }
  }
  return labels;
}
