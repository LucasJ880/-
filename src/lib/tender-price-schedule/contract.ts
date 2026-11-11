/**
 * TI-1 招标价格表行项 — 契约、结构校验、数量汇总（纯函数，零 DB / 网络 / 模型）
 *
 * 行项是招标事实：行号、数量、单位由发标方给定，本模块只校验与汇总，
 * 不修正、不补全、不重排。换算见 unit-conversion.ts。
 */
import { Prisma } from "@prisma/client";
import { dec, ZERO, type DecimalInput } from "@/lib/project-finance/money";

/** 单位目录（封闭）：不在目录内的单位校验失败，不猜。新增单位 = 加一项 + 加一条测试。 */
export const PRICE_SCHEDULE_UOMS = [
  "Each", "Pack", "Box", "Roll", "Pair", "Set", "Case", "Bag", "kg", "m", "ft", "sqft",
] as const;
export type PriceScheduleUom = (typeof PRICE_SCHEDULE_UOMS)[number];

/** 成组单位：供应商按件报价时必须有包装数才能换算。 */
export const GROUPED_UOMS: readonly PriceScheduleUom[] = ["Pack", "Box", "Roll", "Set", "Case", "Bag"];

export function isPriceScheduleUom(v: unknown): v is PriceScheduleUom {
  return typeof v === "string" && (PRICE_SCHEDULE_UOMS as readonly string[]).includes(v);
}
export function isGroupedUom(uom: string): boolean {
  return (GROUPED_UOMS as readonly string[]).includes(uom);
}

/** 行项出处：页 / 表 / 行，指回原始招标文件。 */
export type PriceScheduleLineSource = {
  documentId?: string | null;
  page?: number | null;
  sheet?: string | null;
  row?: number | null;
};

export type PriceScheduleLine = {
  lineNo: number;
  description: string;
  quantity: DecimalInput;
  /** 招标单位原文；校验时须属于 PRICE_SCHEDULE_UOMS */
  uom: string;
  /** 每个招标单位含多少件（每包 2 / 每盒 12 / 每卷 25）；非成组单位可省略 */
  packCount?: number | null;
  /** 招标尺寸原文，如 "39 x 77.5 x 9-15"（定值或区间） */
  dimensions?: string | null;
  /** 招标最小尺寸原文，如 "37.5 x 23 x 23"（各维不得小于） */
  minimumDimensions?: string | null;
  requirement?: string | null;
  /** 强制认证闸的说明；有值 = 该行须有已核验的认证才可投标（判定在 TI-3） */
  certificationGate?: string | null;
  source?: PriceScheduleLineSource | null;
};

export type ScheduleIssueCode =
  | "EMPTY_SCHEDULE"
  | "LINE_NO_INVALID"
  | "LINE_NO_DUPLICATE"
  | "LINE_NO_NOT_CONSECUTIVE"
  | "DESCRIPTION_MISSING"
  | "QUANTITY_INVALID"
  | "UOM_UNKNOWN"
  | "PACK_COUNT_INVALID";

export type ScheduleIssue = { lineNo: number | null; code: ScheduleIssueCode; messageZh: string };
export type ScheduleValidation = { valid: boolean; issues: ScheduleIssue[] };

/** 安全转定点：无法解析返回 null（不抛）。 */
export function toDecimalOrNull(v: unknown): Prisma.Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "number" && typeof v !== "string" && !(v instanceof Prisma.Decimal)) return null;
  try {
    const d = dec(v as DecimalInput);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * 结构校验：返回全部问题，不修正输入。
 * 行号须从 1 起、按出现顺序连续且不重复——顺序本身是招标事实，不重排。
 */
export function validatePriceSchedule(lines: readonly PriceScheduleLine[]): ScheduleValidation {
  const issues: ScheduleIssue[] = [];
  if (lines.length === 0) {
    return { valid: false, issues: [{ lineNo: null, code: "EMPTY_SCHEDULE", messageZh: "价格表没有任何行项" }] };
  }
  const seen = new Set<number>();
  let reportedGap = false;
  lines.forEach((line, i) => {
    const n = line.lineNo;
    if (!Number.isInteger(n) || n <= 0) {
      issues.push({ lineNo: null, code: "LINE_NO_INVALID", messageZh: `第 ${i + 1} 个行项的行号不是正整数` });
    } else {
      if (seen.has(n)) issues.push({ lineNo: n, code: "LINE_NO_DUPLICATE", messageZh: `行号 ${n} 重复` });
      seen.add(n);
      if (n !== i + 1 && !reportedGap) {
        reportedGap = true;
        issues.push({ lineNo: n, code: "LINE_NO_NOT_CONSECUTIVE", messageZh: `行号不连续：第 ${i + 1} 个行项的行号是 ${n}，应为 ${i + 1}` });
      }
    }
    const label = Number.isInteger(n) && n > 0 ? n : null;
    if (!line.description || !line.description.trim()) {
      issues.push({ lineNo: label, code: "DESCRIPTION_MISSING", messageZh: `第 ${label ?? i + 1} 行缺少说明` });
    }
    const q = toDecimalOrNull(line.quantity);
    if (!q || q.lte(ZERO)) {
      issues.push({ lineNo: label, code: "QUANTITY_INVALID", messageZh: `第 ${label ?? i + 1} 行数量必须是正数` });
    }
    if (!isPriceScheduleUom(line.uom)) {
      issues.push({ lineNo: label, code: "UOM_UNKNOWN", messageZh: `第 ${label ?? i + 1} 行单位「${String(line.uom)}」无法识别` });
    }
    if (line.packCount !== null && line.packCount !== undefined && (!Number.isInteger(line.packCount) || line.packCount <= 0)) {
      issues.push({ lineNo: label, code: "PACK_COUNT_INVALID", messageZh: `第 ${label ?? i + 1} 行包装数必须是正整数` });
    }
  });
  return { valid: issues.length === 0, issues };
}

export type QuantitySum =
  | { ok: true; total: Prisma.Decimal; uom: string; lineNos: number[] }
  | { ok: false; code: "NO_LINES" | "LINE_NOT_FOUND" | "MIXED_UOM" | "QUANTITY_INVALID"; messageZh: string };

/** 按行号集合求数量合计；只相加同一单位的行（包与件不能相加）。 */
export function sumQuantity(lines: readonly PriceScheduleLine[], lineNos: readonly number[]): QuantitySum {
  if (lineNos.length === 0) return { ok: false, code: "NO_LINES", messageZh: "没有指定要汇总的行号" };
  const picked: PriceScheduleLine[] = [];
  for (const n of lineNos) {
    const line = lines.find((l) => l.lineNo === n);
    if (!line) return { ok: false, code: "LINE_NOT_FOUND", messageZh: `价格表里没有第 ${n} 行` };
    picked.push(line);
  }
  const uoms = [...new Set(picked.map((l) => l.uom))];
  if (uoms.length > 1) {
    return { ok: false, code: "MIXED_UOM", messageZh: `单位不同不能相加：${uoms.join("、")}` };
  }
  let total = ZERO;
  for (const l of picked) {
    const q = toDecimalOrNull(l.quantity);
    if (!q) return { ok: false, code: "QUANTITY_INVALID", messageZh: `第 ${l.lineNo} 行数量无法解析` };
    total = total.plus(q);
  }
  return { ok: true, total, uom: uoms[0], lineNos: [...lineNos] };
}

/** 行号范围辅助：range(1, 9) → [1..9] */
export function lineRange(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n += 1) out.push(n);
  return out;
}
