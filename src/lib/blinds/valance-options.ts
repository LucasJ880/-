/**
 * Valance（罩/帘头）选项与定价键映射（2026-08-26 Lucas 口径）
 *
 *  - Roller：None / Cassette / Fascia 三选一（价差由引擎 fabric 键承载：
 *    None → "(Open Roll)"；Cassette/Fascia → "w Cassette"/"w Fascia"，均触发 cassette 加价 25/50）
 *  - Fascia 暂与 Cassette 同价（ROLLER_FABRICS 中 fascia 键 cassette:true）
 *  - Zebra：不允许无罩（结构必带）——只有 Cassette / Fascia，默认 Cassette
 *  - 其余产品维持原行为（Cassette/Fascia 可选可清空，不进定价）
 *  - 老数据兼容：已存的完整 fabric 键（含 "(Open Roll)"/"w Cassette"）原样定价；parse 供 UI 反显
 */

import type { ProductName } from "./pricing-types";

export const VALANCE_NONE = "None" as const;
export const ROLLER_VALANCE_OPTIONS = [VALANCE_NONE, "Cassette", "Fascia"] as const;
export const ZEBRA_VALANCE_OPTIONS = ["Cassette", "Fascia"] as const;
export const ROLLER_BASE_FABRICS = ["Light Filtering", "Blackout"] as const;

export type RollerValance = (typeof ROLLER_VALANCE_OPTIONS)[number];

export function valanceOptionsFor(product: ProductName | ""): readonly string[] {
  if (product === "Roller") return ROLLER_VALANCE_OPTIONS;
  if (product === "Zebra") return ZEBRA_VALANCE_OPTIONS;
  return ["Cassette", "Fascia"];
}

/** Roller/Zebra 必选（不许空值暧昧）；其余可空 */
export function valanceRequiredFor(product: ProductName | ""): boolean {
  return product === "Roller" || product === "Zebra";
}

export function defaultValanceFor(product: ProductName | ""): string {
  if (product === "Roller") return VALANCE_NONE;
  if (product === "Zebra") return "Cassette";
  return "";
}

/** Roller：基础面料 + valance → 引擎定价键 */
export function rollerEngineFabricKey(base: string, valance: string): string {
  const b = base.trim();
  if (!b) return "";
  if (valance === "Cassette") return `${b} w Cassette`;
  if (valance === "Fascia") return `${b} w Fascia`;
  return `${b} (Open Roll)`;
}

/** Roller：引擎键/老数据 → {base, valance}（认不出则原样当 base，valance 空） */
export function parseRollerFabric(key: string): { base: string; valance: string } {
  const k = key.trim();
  let m = k.match(/^(.*)\s+w Cassette$/i);
  if (m) return { base: m[1]!.trim(), valance: "Cassette" };
  m = k.match(/^(.*)\s+w Fascia$/i);
  if (m) return { base: m[1]!.trim(), valance: "Fascia" };
  m = k.match(/^(.*)\s+\(Open Roll\)$/i);
  if (m) return { base: m[1]!.trim(), valance: VALANCE_NONE };
  return { base: k, valance: "" };
}
