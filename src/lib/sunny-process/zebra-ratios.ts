/**
 * 斑马帘「面料编码 → 布:纱」对照表（2026-10-27 拍板：做成可编辑的对照表页）。
 *
 * 零 schema：存于 Organization.settingsJson.sunnyProcess.zebraRatios（整表覆盖写，每次保存记一条 AuditLog）。
 * 组织从未保存过时用 ZEBRA_RATIO_SEED（原件《Blinds 工艺单》Sheet1 W 列备注，工厂面料编码）。
 *
 * 匹配（纯函数，确定性）：报价 SKU 与编码都转大写，空格 / 下划线 / 斜杠统一成 -；
 *   1. 完全相同；2. 编码作为完整段出现在 SKU 里（如 AQUAWIDE3 ↔ AQUAWIDE3-BEIGE-LF、Modina White ↔ MODINA-WHITE-DO、
 *   BL201 ↔ LOUIA-WHITE-LF-BL201）。多条命中取编码最长的；完全相同优先。
 * 查不到 → 调用方用默认 3:2 并提示工厂核对。
 */

import { DEFAULT_ZEBRA_RATIO } from "@/lib/blinds/deduction-rules";

export interface ZebraRatioEntry {
  /** 面料编码 / 别名 / 报价 SKU 系列（任一命中即可） */
  codes: string[];
  fabric: number;
  silk: number;
  noteZh: string;
}

export interface ZebraRatioMatch {
  entry: ZebraRatioEntry;
  code: string;
  exact: boolean;
}

export const ZEBRA_RATIO_SETTINGS_KEY = "sunnyProcess";
export const AUDIT_ACTION_ZEBRA_RATIOS = "sunny_process.zebra_ratios";
export const MAX_ZEBRA_RATIO_ENTRIES = 500;
const MAX_CODES = 12;

/** 原件 Sheet1 W2:W29 备注，逐条转录（括号里的是同一面料的国内编码 / 别名） */
export const ZEBRA_RATIO_SEED: readonly ZebraRatioEntry[] = [
  { codes: ["ZE-215-F1091", "SD-ZB-F1091"], fabric: 3 + 2 / 16, silk: 2 + 2 / 16, noteZh: "原件 W2" },
  { codes: ["ZE-245-BL201", "SB-ZB-BL201"], fabric: 3 + 2 / 16, silk: 1 + 15 / 16, noteZh: "原件 W3 / W11（新）" },
  { codes: ["ZE-295-268A15-1", "SU-ZE-004"], fabric: 3, silk: 2, noteZh: "原件 W4" },
  { codes: ["ZE-215-F1821", "SD-ZB-F1821"], fabric: 3 + 8 / 16, silk: 2 + 4 / 16, noteZh: "原件 W5" },
  { codes: ["ZE-215-F1092"], fabric: 3 + 4 / 16, silk: 2 + 3 / 16, noteZh: "原件 W6" },
  { codes: ["ZE220-20A36-A", "SU-ZE-005"], fabric: 3, silk: 2, noteZh: "原件 W7" },
  { codes: ["YJ85-221-4"], fabric: 3, silk: 2 + 2 / 16, noteZh: "原件 W8" },
  { codes: ["YJ70-D002", "SUNNY-D-002"], fabric: 3, silk: 2, noteZh: "原件 W9" },
  { codes: ["YJ85-19A38-1", "SUNNY-19A38-1"], fabric: 3, silk: 2, noteZh: "原件 W10" },
  { codes: ["ZE-215-F1094"], fabric: 3 + 6 / 16, silk: 2, noteZh: "原件 W12" },
  { codes: ["ZE163-20A19-3"], fabric: 3, silk: 1 + 15 / 16, noteZh: "原件 W13" },
  { codes: ["SA-ZD-20237-0"], fabric: 3 + 7 / 16, silk: 2 + 5 / 16, noteZh: "原件 W14" },
  { codes: ["SC-ZD-XZ78-6"], fabric: 2 + 15 / 16, silk: 1 + 15 / 16, noteZh: "原件 W15" },
  { codes: ["SG-ZD-IO"], fabric: 3 + 15 / 16, silk: 2 + 12 / 16, noteZh: "原件 W16" },
  { codes: ["SC-ZD-XZ74-1"], fabric: 3 + 9 / 16, silk: 2 + 5 / 16, noteZh: "原件 W17 = 3 9/16:2 5/16，W22 = 3 6/16:2 5/16，两处不一致，请工厂核对" },
  { codes: ["SA-ZC-A19-3"], fabric: 4 + 13 / 16, silk: 3 + 8 / 16, noteZh: "原件 W18" },
  { codes: ["SA-ZD-A162-1"], fabric: 3, silk: 1 + 15 / 16, noteZh: "原件 W19" },
  { codes: ["SA-ZD-A162-2"], fabric: 3, silk: 2 + 5 / 16, noteZh: "原件 W20" },
  { codes: ["SB-ZB-BL207"], fabric: 3 + 4 / 16, silk: 2 + 1 / 16, noteZh: "原件 W21" },
  { codes: ["SC-ZD-XZ74-3"], fabric: 3 + 9 / 16, silk: 2 + 5 / 16, noteZh: "原件 W23" },
  { codes: ["SC-ZD-XZ78-1"], fabric: 3, silk: 2, noteZh: "原件 W24" },
  { codes: ["Nova"], fabric: 2 + 14 / 16, silk: 2, noteZh: "原件 W25" },
  { codes: ["Modina White"], fabric: 2 + 14 / 16, silk: 1 + 15 / 16, noteZh: "原件 W28（本地）" },
  { codes: ["Rimini Forst", "Mohair White"], fabric: 3 + 14 / 16, silk: 2 + 5 / 16, noteZh: "原件 W29（本地）" },
];

const norm = (s: string) => s.trim().toUpperCase().replace(/[\s_/]+/g, "-").replace(/-+/g, "-");
const SEP = "-";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function lookupZebraRatio(entries: readonly ZebraRatioEntry[], sku: string): ZebraRatioMatch | null {
  const target = norm(sku);
  if (!target) return null;
  let best: ZebraRatioMatch | null = null;
  for (const entry of entries) {
    for (const raw of entry.codes) {
      const code = norm(raw);
      if (!code) continue;
      const exact = code === target;
      const inside = !exact && new RegExp(`(^|${SEP})${escapeRe(code)}($|${SEP})`).test(target);
      if (!exact && !inside) continue;
      const better = !best || (exact && !best.exact) || (exact === best.exact && code.length > norm(best.code).length);
      if (better) best = { entry, code: raw, exact };
    }
  }
  return best;
}

/** "3 2/16" / "3.125" / "3" → 数值；无效 → null */
export function parseRatioPart(text: string): number | null {
  const t = text.trim();
  const m = t.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*16)?$/);
  if (!m) return null;
  const v = Number(m[1]) + (m[2] ? Number(m[2]) / 16 : 0);
  return v > 0 && v < 20 ? v : null;
}

/** 数值 → "3 2/16"（16 分制，与原件备注同写法）；不是整 1/16 的小数原样写（避免回存时被取整成 1/16） */
export function ratioPartText(v: number): string {
  const whole = Math.floor(v + 1e-9);
  const six = Math.round((v - whole) * 16);
  if (Math.abs((v - whole) * 16 - six) > 1e-9) return String(v);
  if (six === 16) return String(whole + 1);
  return six === 0 ? String(whole) : `${whole} ${six}/16`;
}

export function sanitizeZebraRatios(raw: unknown): ZebraRatioEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ZebraRatioEntry[] = [];
  for (const x of raw.slice(0, MAX_ZEBRA_RATIO_ENTRIES)) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const codes = (Array.isArray(o.codes) ? o.codes : typeof o.codes === "string" ? o.codes.split(/[,，;；\n]/) : [])
      .map((c) => (typeof c === "string" ? c.trim().slice(0, 60) : ""))
      .filter(Boolean)
      .slice(0, MAX_CODES);
    const fabric = typeof o.fabric === "number" ? o.fabric : parseRatioPart(String(o.fabric ?? ""));
    const silk = typeof o.silk === "number" ? o.silk : parseRatioPart(String(o.silk ?? ""));
    if (codes.length === 0 || !(Number(fabric) > 0 && Number(fabric) < 20) || !(Number(silk) > 0 && Number(silk) < 20)) continue;
    out.push({ codes, fabric: Number(fabric), silk: Number(silk), noteZh: typeof o.noteZh === "string" ? o.noteZh.slice(0, 200) : "" });
  }
  return out;
}

export interface ZebraRatioTable {
  entries: ZebraRatioEntry[];
  /** true = 组织还没保存过，展示 / 使用的是原件种子 */
  seeded: boolean;
}

export function readZebraRatios(settingsJson: unknown): ZebraRatioTable {
  const sp = (settingsJson as Record<string, unknown> | null)?.[ZEBRA_RATIO_SETTINGS_KEY] as Record<string, unknown> | undefined;
  if (!sp || !Array.isArray(sp.zebraRatios)) return { entries: ZEBRA_RATIO_SEED.map((e) => ({ ...e, codes: [...e.codes] })), seeded: true };
  return { entries: sanitizeZebraRatios(sp.zebraRatios), seeded: false };
}

export function withZebraRatios(settingsJson: unknown, entries: ZebraRatioEntry[]): Record<string, unknown> {
  const base = settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson) ? { ...(settingsJson as Record<string, unknown>) } : {};
  const sp = base[ZEBRA_RATIO_SETTINGS_KEY] && typeof base[ZEBRA_RATIO_SETTINGS_KEY] === "object" ? { ...(base[ZEBRA_RATIO_SETTINGS_KEY] as Record<string, unknown>) } : {};
  sp.zebraRatios = entries;
  base[ZEBRA_RATIO_SETTINGS_KEY] = sp;
  return base;
}

/** 报价 / 退回自产时给斑马帘取布纱比：查表命中用表里的，否则默认 3:2 */
export function zebraRatioFor(entries: readonly ZebraRatioEntry[] | undefined, sku: string): { fabric: number; silk: number; match: ZebraRatioMatch | null } {
  const match = entries ? lookupZebraRatio(entries, sku) : null;
  return match ? { fabric: match.entry.fabric, silk: match.entry.silk, match } : { fabric: DEFAULT_ZEBRA_RATIO.fabric, silk: DEFAULT_ZEBRA_RATIO.silk, match: null };
}
