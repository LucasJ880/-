/**
 * TI-1 尺寸对照（纯函数）
 *
 * 招标尺寸逐维解析为定值或区间；与供应商产品尺寸**按位置**比较，不换位、不设容差：
 * 招标没写容差时系统无权替发标方放宽。无法解析、缺失、维数不同 → UNKNOWN，
 * UNKNOWN 永不当作相符。
 */
import { Prisma } from "@prisma/client";
import { toDecimalOrNull } from "./contract";

export type DimensionSpec =
  | { kind: "exact"; value: Prisma.Decimal }
  | { kind: "range"; min: Prisma.Decimal; max: Prisma.Decimal };

export const DIMENSION_VERDICTS = ["MATCH", "MISMATCH", "UNKNOWN"] as const;
export type DimensionVerdict = (typeof DIMENSION_VERDICTS)[number];

export type DimensionDetail = { index: number; required: string; offered: string; ok: boolean };
export type DimensionMatch = { verdict: DimensionVerdict; details: DimensionDetail[]; reasonZh: string };

const UNIT_SUFFIX = /\s*(?:"|''|in\.?|inch(?:es)?|cm|mm)\s*$/i;

function parsePart(raw: string): DimensionSpec | null {
  const t = raw.trim().replace(UNIT_SUFFIX, "").trim();
  if (!t) return null;
  const range = t.match(/^(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)$/);
  if (range) {
    const min = toDecimalOrNull(range[1]);
    const max = toDecimalOrNull(range[2]);
    if (!min || !max || min.gt(max)) return null;
    return { kind: "range", min, max };
  }
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  const value = toDecimalOrNull(t);
  return value ? { kind: "exact", value } : null;
}

/** "39 x 77.5 x 9-15" → [39, 77.5, 9–15]；任一维无法解析 → null。 */
export function parseDimensions(text: string | null | undefined): DimensionSpec[] | null {
  if (!text || !text.trim()) return null;
  const parts = text.split(/\s*[x×*]\s*/i);
  const out: DimensionSpec[] = [];
  for (const p of parts) {
    const spec = parsePart(p);
    if (!spec) return null;
    out.push(spec);
  }
  return out.length ? out : null;
}

function show(s: DimensionSpec): string {
  return s.kind === "exact" ? s.value.toString() : `${s.min.toString()}–${s.max.toString()}`;
}

const unknown = (reasonZh: string): DimensionMatch => ({ verdict: "UNKNOWN", details: [], reasonZh });

/**
 * mode = "exact"：招标给的是规格（定值须相等，区间须落入）；
 * mode = "minimum"：招标给的是最小尺寸（产品各维不得小于）。
 */
export function matchDimensions(input: {
  required: string | null | undefined;
  offered: string | null | undefined;
  mode?: "exact" | "minimum";
}): DimensionMatch {
  const mode = input.mode ?? "exact";
  const required = parseDimensions(input.required);
  if (!required) return unknown("招标尺寸缺失或无法解析");
  const offered = parseDimensions(input.offered);
  if (!offered) return unknown("产品尺寸缺失或无法解析");
  if (offered.some((o) => o.kind !== "exact")) return unknown("产品尺寸须为确定值，不能是区间");
  if (required.length !== offered.length) {
    return unknown(`维数不同：招标 ${required.length} 维，产品 ${offered.length} 维`);
  }
  if (mode === "minimum" && required.some((r) => r.kind !== "exact")) return unknown("最小尺寸须为确定值");

  const details: DimensionDetail[] = required.map((r, i) => {
    const o = offered[i] as Extract<DimensionSpec, { kind: "exact" }>;
    let ok: boolean;
    if (mode === "minimum") ok = o.value.gte((r as Extract<DimensionSpec, { kind: "exact" }>).value);
    else if (r.kind === "exact") ok = o.value.eq(r.value);
    else ok = o.value.gte(r.min) && o.value.lte(r.max);
    return { index: i + 1, required: show(r), offered: show(o), ok };
  });
  const bad = details.filter((d) => !d.ok);
  if (bad.length === 0) return { verdict: "MATCH", details, reasonZh: "各维相符" };
  const op = mode === "minimum" ? "<" : "≠";
  return {
    verdict: "MISMATCH",
    details,
    reasonZh: bad.map((d) => `第 ${d.index} 维 ${d.offered} ${op} ${d.required}`).join("；"),
  };
}
