/**
 * Vinyl 百叶窗裁切计算引擎
 * 来源: Vinyl百叶窗统一工艺单_V15.xlsx → 工艺单（每扇窗 30 行一块）
 *
 * 与 Blinds 引擎完全独立：那边是罩盒+管+下杆+面料，这边是型框+直柱+横档+百叶片。
 * 两者不共享任何字段，别混用。
 */

import {
  resolveFrameConfig,
  getLouverSpec,
  POST_WIDTH_ALLOWANCE,
  VINYL_RULE_VERSION,
  type FrameType,
  type PostType,
} from "./frame-rules";
import { resolvePanelSpec, type PanelCodeRule, type PanelSpec } from "./panel-codes";

/**
 * 只抹掉浮点噪声，**不做工程舍入**。
 *
 * Vinyl 的尺寸不落在 16 分位上：百叶间距形如 46.875/16 = 2.9296875（7 位小数），
 * 而控制杆长 = 间距×(片数-1)+1.5 直接依赖它。舍到 4 位会让 48.375 变成 48.375008。
 * Excel 本身对这些中间值一律不舍入，这里保持一致；显示/导出时再格式化。
 */
function exact(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}

/** Excel ROUNDUP(x, 0) —— 远离零取整，不是 Math.ceil（负数行为不同） */
function roundUp0(n: number): number {
  return n >= 0 ? Math.ceil(n - 1e-9) : -Math.ceil(-n - 1e-9);
}

export interface VinylItemInput {
  /** 订单总表 A：行号 */
  itemNumber?: number;
  /** 订单总表 B：位置 */
  location?: string;
  /** C：测量宽 */
  width: number;
  /** D：测量高 */
  height: number;
  /** E：共几扇 */
  panelCount: number;
  /** F：开启方向码，如 "LLRR" */
  panelCode: string;
  /** G：分隔柱数量，如 "2T"（分隔柱）/ "2H"（挂柱）；空表示没有 */
  dividerSpec?: string | null;
  /** H：特殊分隔档（绝对英寸），填了就优先于 midRailRatio */
  specialMidRail?: number | null;
  /** I：Mid-Rail 分隔档比例（× 测量高） */
  midRailRatio?: number | null;
  /** J：控制杆位置 */
  tiltRodPosition?: string | null;
  /** K：外框 Frame（L / Z / T / Door） */
  frameType: string;
  /** L：外框数（"4" / "3+1"） */
  frameCount: string;
  /** M：IN / OUT */
  inOut: string;
  /** O：结构（有框 / 无框） */
  structure: string;
  /** 行备注 */
  itemRemark?: string | null;
}

export interface VinylOrderContext {
  /** 订单总表 E4：百叶尺寸，全单一个值（2.5 / 3.5） */
  louverSize: number;
  /** 组织自定义的开启状态码 */
  panelCodeOverrides?: readonly PanelCodeRule[] | null;
}

/** 一条下料记录 */
export interface CutPiece {
  /** 品名（工艺单 A11:A20 那一列） */
  name: string;
  lengthIn: number;
  qty: number;
  /** 切角，null 表示该行不标角度 */
  angleA: number | null;
  angleB: number | null;
  /** 孔距（仅直柱/分隔柱标） */
  pitchIn?: number | null;
  /**
   * 只作参考、不进物料汇总的行。
   * 对应 D11/D12 —— Sheet1 (2) 的框材统计只取 C11/C12，不含 D 列。
   */
  informational?: boolean;
}

export type VinylWarningCode =
  | "UNKNOWN_FRAME_COMBO"
  | "UNKNOWN_LOUVER_SIZE"
  | "UNKNOWN_PANEL_CODE"
  | "INVALID_DIVIDER_SPEC"
  | "FRAMELESS_WITH_FRAME"
  | "NON_POSITIVE_CAVITY";

export interface VinylWarning {
  code: VinylWarningCode;
  message: string;
}

export interface VinylCuttingResults {
  ruleVersion: string;
  /** J10 */
  frameSignature: number;
  /** 命中的框型组合标签，未命中为 null */
  frameLabel: string | null;

  /** H2 内空宽 */
  cavityWidth: number;
  /** I2 内空高 */
  cavityHeight: number;
  /** B8 成品窗-宽（每扇） */
  panelWidth: number;
  /** D8 成品窗-高 */
  panelHeight: number;
  /** C5 分隔档位置（修正后） */
  midRail: number;
  /** D5 分隔档位置（从下往上） */
  midRailFromBottom: number;

  /** F9 上百叶数 */
  topLouvers: number;
  /** G9 下百叶数 */
  bottomLouvers: number;
  /** E9 每扇百叶总数 */
  louversPerPanel: number;
  /** G15 百叶间距（孔距） */
  louverPitch: number;

  /** 柱数量与类型（拆自 dividerSpec） */
  postCount: number;
  postType: PostType | null;
  /** E5/A14 —— 挂柱 或 分隔柱 */
  postLabel: string | null;

  /** G3 条/盖 */
  panelSpec: PanelSpec | null;

  /** N 列 SF = ROUNDUP(ROUNDUP(W)*ROUNDUP(H)/144) */
  squareFeet: number;

  /** 下料清单（工艺单 11~20 行） */
  pieces: CutPiece[];

  warnings: VinylWarning[];
}

/** 拆 "2T" / "2H" → { count: 2, type: "T" } */
export function parseDividerSpec(
  spec: string | null | undefined,
): { count: number; type: PostType } | null {
  const s = String(spec ?? "").trim().toUpperCase();
  if (!s) return null;
  const m = /^(\d+)\s*([TH])$/.exec(s);
  if (!m) return null;
  const count = Number(m[1]);
  if (!Number.isFinite(count) || count < 0) return null;
  return { count, type: m[2] as PostType };
}

/** N 列：ROUNDUP(ROUNDUP(W,0)*ROUNDUP(H,0)/144, 0) */
export function calcSquareFeet(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0;
  return roundUp0((roundUp0(width) * roundUp0(height)) / 144);
}

export function calculateVinylItem(
  input: VinylItemInput,
  ctx: VinylOrderContext,
): VinylCuttingResults {
  const warnings: VinylWarning[] = [];
  const w = Number(input.width) || 0;
  const h = Number(input.height) || 0;
  const panelCount = Number(input.panelCount) || 0;
  const frameless = String(input.structure || "").trim() === "无框";

  const { signature, config } = resolveFrameConfig(input);
  if (!config) {
    warnings.push({
      code: "UNKNOWN_FRAME_COMBO",
      message: `外框组合无对应减尺规则（${input.frameType || "?"} / ${input.frameCount || "?"} / ${input.inOut || "?"}，J10=${signature}）`,
    });
  }
  if (frameless && config) {
    // 表里 H2 用「无框」走原始尺寸，但 C11/C12 的框料**照样按 J10 出长度**。
    // 这多半不是本意，但我们按表如实算，只把矛盾报出来。
    warnings.push({
      code: "FRAMELESS_WITH_FRAME",
      message: `结构填「无框」但外框字段仍构成 ${config.label}：内空按无框取原始尺寸，型框料仍按该组合出长度（与原表一致，请人工确认）`,
    });
  }

  const louver = getLouverSpec(ctx.louverSize);
  if (!louver) {
    warnings.push({
      code: "UNKNOWN_LOUVER_SIZE",
      message: `百叶尺寸 ${ctx.louverSize} 无对应参数（仅 2.5 / 3.5）`,
    });
  }

  // ── H2 / I2 内空 ──
  const cavityWidth = exact(
    frameless ? w : config ? config.cavityWidth(w) : 0,
  );
  const cavityHeight = exact(
    frameless ? h : config ? config.cavityHeight(h) : 0,
  );

  // ── 柱 ──
  const divider = parseDividerSpec(input.dividerSpec);
  if (input.dividerSpec && !divider) {
    warnings.push({
      code: "INVALID_DIVIDER_SPEC",
      message: `分隔柱数量「${input.dividerSpec}」格式不对，应形如 2T（分隔柱）或 2H（挂柱）`,
    });
  }
  const postCount = divider?.count ?? 0;
  const postType = divider?.type ?? null;
  const postLabel = postType ? (postType === "H" ? "挂柱" : "分隔柱") : null;

  // ── B8 成品窗-宽（每扇） ──
  // (内空宽 - (扇数*1.5 + 2*柱数 + 2)/16 - 柱数*柱占宽)/扇数 - 1/16
  let panelWidth = 0;
  if (cavityWidth > 0 && panelCount > 0) {
    const allowance = postType ? POST_WIDTH_ALLOWANCE[postType] : POST_WIDTH_ALLOWANCE.T;
    panelWidth = exact(
      (cavityWidth - (panelCount * 1.5 + 2 * postCount + 2) / 16 - postCount * allowance) /
        panelCount -
        1 / 16,
    );
  }

  // ── D8 成品窗-高 ──
  const panelHeight = exact(cavityHeight > 0 ? cavityHeight - 4 / 16 : 0);
  if (cavityWidth <= 0 || cavityHeight <= 0) {
    warnings.push({
      code: "NON_POSITIVE_CAVITY",
      message: "内空尺寸非正数，本行下料无法计算（检查测量尺寸与外框组合）",
    });
  }

  // ── H4 → C5 分隔档 ──
  // 特殊分隔档（绝对值）优先，否则 比例 × 测量高
  const rawMidRail =
    input.specialMidRail != null && input.specialMidRail > 0
      ? input.specialMidRail
      : input.midRailRatio != null && input.midRailRatio > 0
        ? input.midRailRatio * h
        : 0;
  const midRail = exact(
    rawMidRail > 0 ? (frameless ? rawMidRail : config ? config.midRail(rawMidRail) : 0) : 0,
  );
  const hasMidRail = midRail > 0;

  // ── F9 / G9 / E9 百叶片数，G15 间距 ──
  let topLouvers = 0;
  let bottomLouvers = 0;
  // 间距的**未舍入**值：下游的控制杆长 = 间距×(片数-1)+1.5 会把误差放大 (片数-1) 倍，
  // 先 snap 再相乘会把精确的 32.125 变成 32.1250000001。全程用原值，只在输出时 snap。
  let pitchRaw = 0;
  if (louver && panelHeight > 0) {
    const { midRailDeduct, plainDeduct, step } = louver;
    if (hasMidRail) {
      topLouvers = roundUp0((panelHeight - midRail - midRailDeduct) / step) + 1;
      bottomLouvers = roundUp0((midRail - midRailDeduct) / step) + 1;
      // 原表: ((D8-C5-K)+(D8-(D8-C5)-K))/(F9+G9-2) —— 化简即 (D8-2K)/(F9+G9-2)
      const denom = topLouvers + bottomLouvers - 2;
      pitchRaw = denom !== 0 ? (panelHeight - 2 * midRailDeduct) / denom : 0;
    } else {
      const n = roundUp0((panelHeight - plainDeduct) / step);
      bottomLouvers = n + 1;
      pitchRaw = n !== 0 ? (panelHeight - plainDeduct) / n : 0;
    }
  }
  const louverPitch = exact(pitchRaw);
  const louversPerPanel = topLouvers + bottomLouvers;

  // ── D5 分隔档位置（从下往上） ──
  const midRailFromBottom =
    hasMidRail && louver
      ? exact((bottomLouvers - 1) * pitchRaw + louver.midRailOffsetA + louver.midRailOffsetB)
      : 0;

  // ── G3 条/盖 ──
  const panelSpec = resolvePanelSpec(input.panelCode, ctx.louverSize, ctx.panelCodeOverrides);
  if (!panelSpec) {
    warnings.push({
      code: "UNKNOWN_PANEL_CODE",
      message: `开启状态「${input.panelCode || "(空)"}」不在编码表内（${ctx.louverSize}"），条/盖数量待补`,
    });
  }

  // ── 下料清单（工艺单 11~20 行） ──
  const pieces: CutPiece[] = [];
  const ft = String(input.frameType || "").trim().toUpperCase();
  const frameTypeNorm: FrameType =
    ft === "DOOR" ? "Door" : ft === "Z" ? "Z" : ft === "T" ? "T" : "L";

  if (config) {
    const fw = exact(config.frameWidthCut(w));
    const fh = exact(config.frameHeightCut(h));
    // G12: 型框-宽数量=2 → 45°，=1（3+1 组合）→ 90°
    const heightAngleB = config.frameWidthQty === 2 ? 45 : 90;

    if (fw > 0) {
      pieces.push({
        name: `${frameTypeNorm} 型框-宽`,
        lengthIn: fw,
        qty: config.frameWidthQty,
        angleA: 45,
        angleB: 45,
      });
    }
    if (fh > 0) {
      pieces.push({
        name: `${frameTypeNorm} 型框-高`,
        lengthIn: fh,
        qty: config.frameHeightQty,
        angleA: 45,
        angleB: heightAngleB,
      });
    }
    // D11 / D12：参考料长，不进物料汇总
    if (config.secondFrameWidth) {
      const d11 = exact(config.secondFrameWidth(w, frameTypeNorm, fw));
      if (d11 > 0) {
        pieces.push({
          name: `${frameTypeNorm} 型框-宽（备用料长）`,
          lengthIn: d11,
          qty: config.frameWidthQty,
          angleA: 45,
          angleB: 45,
          informational: true,
        });
      }
    }
    if (config.secondFrameHeight) {
      const d12 = exact(config.secondFrameHeight(h, frameTypeNorm, fh));
      if (d12 > 0) {
        pieces.push({
          name: `${frameTypeNorm} 型框-高（备用料长）`,
          lengthIn: d12,
          qty: config.frameHeightQty,
          angleA: 45,
          angleB: heightAngleB,
          informational: true,
        });
      }
    }
    if (config.bottomFrameCut) {
      const bf = exact(config.bottomFrameCut(w));
      if (bf > 0) {
        pieces.push({ name: "底框（Z切边）", lengthIn: bf, qty: 1, angleA: 90, angleB: 90 });
      }
    }
  }

  // 分隔柱 / 挂柱（C14）：分隔柱取内空高，挂柱取成品高 - 3/16
  if (postCount > 0 && postType) {
    const postLen = exact(postType === "T" ? cavityHeight : panelHeight - 3 / 16);
    if (postLen > 0) {
      pieces.push({
        name: postLabel!,
        lengthIn: postLen,
        qty: postCount,
        angleA: null,
        angleB: null,
        pitchIn: louverPitch || null,
      });
    }
  }

  // 直柱（C15）
  const stileLen = exact(panelHeight - 3 / 16);
  if (stileLen > 0 && panelCount > 0) {
    pieces.push({
      name: "直柱",
      lengthIn: stileLen,
      qty: panelCount * 2,
      angleA: null,
      angleB: null,
      pitchIn: louverPitch || null,
    });
  }

  // 上下横档（C16）
  const railLen = exact(panelWidth - 3.5);
  if (railLen > 0 && panelCount > 0) {
    pieces.push({ name: "上下横档", lengthIn: railLen, qty: panelCount * 2, angleA: null, angleB: null });
  }

  // 中间分隔档（C17）
  if (hasMidRail && railLen > 0 && panelCount > 0) {
    pieces.push({ name: "中间分隔档", lengthIn: railLen, qty: panelCount, angleA: null, angleB: null });
  }

  // 百叶片（C18）
  const louverLen = exact(railLen - 2 / 16);
  if (railLen > 0 && louverLen > 0 && panelCount > 0) {
    pieces.push({
      name: `百叶片 ${ctx.louverSize}"`,
      lengthIn: louverLen,
      qty: louversPerPanel * panelCount,
      angleA: null,
      angleB: null,
    });
  }

  // 上控制杆（C19）/ 下控制杆（C20）
  const topRod = topLouvers > 0 ? exact(pitchRaw * (topLouvers - 1) + 1.5) : 0;
  if (topRod > 0 && panelCount > 0) {
    pieces.push({ name: "控制杆（上）", lengthIn: topRod, qty: panelCount, angleA: null, angleB: null });
  }
  const bottomRod = pitchRaw > 0 ? exact(pitchRaw * (bottomLouvers - 1) + 1.5) : 0;
  if (bottomRod > 0 && panelCount > 0) {
    pieces.push({ name: "控制杆（下）", lengthIn: bottomRod, qty: panelCount, angleA: null, angleB: null });
  }

  return {
    ruleVersion: VINYL_RULE_VERSION,
    frameSignature: signature,
    frameLabel: config?.label ?? null,
    cavityWidth,
    cavityHeight,
    panelWidth,
    panelHeight,
    midRail,
    midRailFromBottom,
    topLouvers,
    bottomLouvers,
    louversPerPanel,
    louverPitch,
    postCount,
    postType,
    postLabel,
    panelSpec,
    squareFeet: calcSquareFeet(w, h),
    pieces,
    warnings,
  };
}
