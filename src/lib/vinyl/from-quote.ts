/**
 * 报价单 Shutters 行 → Vinyl 工艺单行
 *
 * 设计口径（2026-08-29 与 Lucas 确认的「方案 C」）：按可推导性分三级
 *   auto    —— 报价端已有，直通
 *   default —— 报价端没有但有明确默认值，填上并标「默认值待确认」
 *   todo    —— 需要人判断，**留空**并标「待补」；绝不猜
 *
 * 为什么不猜：条/盖数量、分隔柱、框型直接决定下料长度与用料，
 * 猜错的代价是开错料整批报废，比空着让人补贵得多。
 *
 * 报价端与工艺端取值域的落差（实测自 order-shutters.tsx）：
 *   frame        报价端 L/Z/S/G/M/Casing  ←→  引擎 L/Z/T/Door   仅 L、Z 重合
 *   openDirection 报价端 L/R/LR（3 种）    ←→  引擎 20 种开启码
 *   百叶尺寸      报价端 2-1/2"/3-1/2"/4-1/2"/Arch ←→ 引擎仅 2.5/3.5
 *   外框数 / 结构 / 分隔柱：报价端**完全没有这些字段**
 */

import type { VinylItemInput } from "./calculation-engine";
import { resolvePanelSpec, type PanelCodeRule } from "./panel-codes";
import type { QuoteShutterLine } from "@/lib/work-orders/quote-form-snapshot";

/** 一条需要人处理的记录；kind 区分「必须补」和「确认默认值」 */
export interface WorkOrderNote {
  code: string;
  message: string;
  kind: "todo" | "default";
}

export interface VinylLineMapping {
  input: VinylItemInput;
  notes: WorkOrderNote[];
}

/** 整单级：百叶尺寸能否映射 */
export type LouverResolution =
  | { ok: true; louverSize: number }
  | { ok: false; reason: string };

/** 报价端百叶尺寸 → 引擎百叶尺寸 */
export function resolveLouverSize(raw: string): LouverResolution {
  const s = String(raw || "").trim();
  if (s === '2-1/2"' || s === "2.5" || s === '2 1/2"') return { ok: true, louverSize: 2.5 };
  if (s === '3-1/2"' || s === "3.5" || s === '3 1/2"') return { ok: true, louverSize: 3.5 };
  if (!s) return { ok: false, reason: "报价单未选择百叶尺寸" };
  // 4-1/2" 与 Arch：Lucas 2026-08-29 确认 Vinyl 暂不做，工艺参数也不存在
  return { ok: false, reason: `百叶尺寸「${s}」Vinyl 工艺暂不支持（仅 2-1/2" 与 3-1/2"）` };
}

/** 报价端框型 → 引擎框型；null = Vinyl 工艺不做这种框 */
export function mapFrameType(frame: string): string | null {
  const f = String(frame || "").trim().toUpperCase();
  if (f === "L") return "L";
  if (f === "Z") return "Z";
  // S / G / M / Casing：Lucas 2026-08-29 确认 Vinyl 先不做
  return null;
}

/**
 * 报价端开启方向 + 扇数 → 引擎开启码。
 * 只在能唯一确定时才给码：
 *   1 扇 + L/R          → "L" / "R"
 *   2 扇 + LR           → "LR"
 * 其余（尤其扇数 ≥3）报价端的 3 选 1 表达不了每扇朝向，一律留空待补。
 * 反例：4 扇填 LR，若当成 "LR" 会算出条/盖 3/1，而实际 LLRR 是 5/3 —— 直接错料。
 */
export function derivePanelCode(
  openDirection: string,
  panelCount: number | null,
  louverSize: number,
  overrides?: readonly PanelCodeRule[] | null,
): string | null {
  const dir = String(openDirection || "").trim().toUpperCase();
  if (!dir || !panelCount || panelCount < 1) return null;

  let candidate: string | null = null;
  if (panelCount === 1 && (dir === "L" || dir === "R")) candidate = dir;
  else if (panelCount === 2 && dir === "LR") candidate = "LR";
  if (!candidate) return null;

  // 码必须真的在编码表里（含车间自定义）才用，否则等于制造一个"待补"
  return resolvePanelSpec(candidate, louverSize, overrides) ? candidate : null;
}

/**
 * 解析报价单的分隔档自由文本。
 *   "40" / "40.5"   → 绝对英寸
 *   "50%" / "0.5"   → 比例
 *   其余非空文本     → 解析不出，留 todo
 */
export function parseMidRail(
  raw: string,
): { absolute: number | null; ratio: number | null; unparsed: boolean } {
  const s = String(raw || "").trim();
  if (!s) return { absolute: null, ratio: null, unparsed: false };

  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(s);
  if (pct) {
    const r = Number(pct[1]) / 100;
    if (r > 0 && r < 1) return { absolute: null, ratio: r, unparsed: false };
    return { absolute: null, ratio: null, unparsed: true };
  }

  const n = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (n) {
    const v = Number(n[1]);
    // 0<v<1 视为比例（销售写 0.5 表示半高），≥1 视为绝对英寸
    if (v > 0 && v < 1) return { absolute: null, ratio: v, unparsed: false };
    if (v >= 1) return { absolute: v, ratio: null, unparsed: false };
  }
  return { absolute: null, ratio: null, unparsed: true };
}

export interface MapLineOptions {
  louverSize: number;
  panelCodeOverrides?: readonly PanelCodeRule[] | null;
}

/** 报价端 I/O → 引擎 IN/OUT */
function mapInOut(mountType: string): "IN" | "OUT" | null {
  const m = String(mountType || "").trim().toUpperCase();
  if (m === "I" || m === "IN") return "IN";
  if (m === "O" || m === "OUT") return "OUT";
  return null;
}

export function mapShutterLineToVinyl(
  line: QuoteShutterLine,
  itemNumber: number,
  opts: MapLineOptions,
): VinylLineMapping {
  const notes: WorkOrderNote[] = [];
  const at = (msg: string) => `#${itemNumber} ${line.location || "(未命名)"}: ${msg}`;

  // ── auto ──
  const location = line.location;
  const width = line.widthIn;
  const height = line.heightIn;
  const panelCount = line.panelCount ?? 0;
  if (!panelCount) {
    notes.push({
      code: "MISSING_PANEL_COUNT",
      message: at("报价单未填扇数，无法计算成品窗宽"),
      kind: "todo",
    });
  }

  // ── frameType：只有 L/Z 能过来 ──
  const frameType = mapFrameType(line.frame);
  if (!frameType) {
    notes.push({
      code: "UNSUPPORTED_FRAME",
      message: at(
        line.frame
          ? `外框「${line.frame}」Vinyl 工艺暂不做（仅 L / Z），请人工确认改用哪种框`
          : "报价单未选外框类型",
      ),
      kind: "todo",
    });
  }

  // ── inOut ──
  const inOut = mapInOut(line.mountType);
  if (!inOut) {
    notes.push({
      code: "MISSING_IN_OUT",
      message: at("报价单未选内外装，暂按 IN 处理"),
      kind: "default",
    });
  }

  // ── default：报价端根本没有的两项 ──
  notes.push({
    code: "DEFAULT_FRAME_COUNT",
    message: at("外框数报价端无此字段，默认按 4 框，请确认是否 3+1"),
    kind: "default",
  });
  notes.push({
    code: "DEFAULT_STRUCTURE",
    message: at("结构报价端无此字段，默认按「有框」，请确认是否无框"),
    kind: "default",
  });

  // ── todo：分隔柱（直接影响成品窗宽 → 横档/百叶片长度）──
  notes.push({
    code: "MISSING_DIVIDER",
    message: at("分隔柱数量与柱型报价端无此字段，暂按无柱计算；有柱请补 2T / 2H"),
    kind: "todo",
  });

  // ── panelCode ──
  const panelCode = derivePanelCode(
    line.openDirection,
    line.panelCount,
    opts.louverSize,
    opts.panelCodeOverrides,
  );
  if (!panelCode) {
    notes.push({
      code: "MISSING_PANEL_CODE",
      message: at(
        `开启方式「${line.openDirection || "未填"}」+ ${panelCount} 扇无法唯一确定开启码，` +
          "条/盖数量待补（报价端只有 L/R/LR 三选一，表达不了多扇朝向）",
      ),
      kind: "todo",
    });
  }

  // ── midRail ──
  const mid = parseMidRail(line.midRail);
  if (mid.unparsed) {
    notes.push({
      code: "UNPARSED_MID_RAIL",
      message: at(`分隔档「${line.midRail}」无法解析成英寸或比例，已留空待补`),
      kind: "todo",
    });
  }

  const input: VinylItemInput = {
    itemNumber,
    location,
    width,
    height,
    panelCount,
    panelCode: panelCode ?? "",
    dividerSpec: null,
    specialMidRail: mid.absolute,
    midRailRatio: mid.ratio,
    tiltRodPosition: line.draft || null,
    frameType: frameType ?? "",
    frameCount: "4",
    inOut: inOut ?? "IN",
    structure: "有框",
    itemRemark: line.draft || null,
  };

  return { input, notes };
}
