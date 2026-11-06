/**
 * Tender RFQ（P1-6G）— 比价解读数字校验（纯函数，零 IO、零 AI）
 *
 * /compare/analysis 的 LLM 只拿矩阵写"解读"，提示词要求"不得计算、换算或给出矩阵里没有的任何数字"。
 * 提示词约束不了模型，这里在返回前用代码复核：解读里出现的每个金额 / 数量 / 百分比 / 日期，
 * 都必须能在交给 LLM 的那份输入（buildInterpretationPayload）里找到；找不到的就地标注
 * 「［矩阵中无此数］」并列出来，界面据此提示"以矩阵为准"。矩阵、结论与推荐仍只来自代码。
 *
 * 匹配规则：
 * - 普通数字：按写法的精度比较（写 12,346 视为整数，允许与 12,345.67 相差 0.5；写 1.2万 允许相差 500）；
 *   支持千分位逗号、"万" "千" "k/K" 单位。
 * - 百分比：只与输入里写成百分比的数比较（不把 0.085 当作 8.5%）。
 * - 日期：YYYY-MM-DD / YYYY/MM/DD / YYYY年M月D日 必须与输入里某个日期完全一致；"M月D日" 与某个日期的月日一致。
 * - 中文数字（"三家"）不检查——这是已知的局限，不影响矩阵本身。
 */

export type NumberKind = "number" | "percent" | "date" | "monthDay";

export type NumberToken = {
  raw: string;
  kind: NumberKind;
  /** number / percent：数值（单位已换算）；date：YYYYMMDD；monthDay：MMDD */
  value: number;
  /** 允许误差：写法精度的一半（日期为 0） */
  tolerance: number;
  index: number;
};

const DATE_RE = String.raw`(\d{4})\s*(?:-|/|年)\s*(\d{1,2})\s*(?:-|/|月)\s*(\d{1,2})\s*日?`;
const MONTH_DAY_RE = String.raw`(\d{1,2})\s*月\s*(\d{1,2})\s*日`;
const NUMBER_RE = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(万|千|[kK](?![A-Za-z])|%)?`;
const TOKEN_RE = new RegExp(`(?<![A-Za-z0-9_.])(?:${DATE_RE}|${MONTH_DAY_RE}|${NUMBER_RE})`, "g");

const UNIT_MULTIPLIER: Record<string, number> = { 万: 10_000, 千: 1_000, k: 1_000, K: 1_000 };

/** 从一段文字里取出数字、百分比与日期（按出现顺序） */
export function extractNumberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0].trimEnd();
    const index = m.index ?? 0;
    if (m[1] !== undefined) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      out.push({ raw, kind: "date", value: y * 10_000 + mo * 100 + d, tolerance: 0, index });
      continue;
    }
    if (m[4] !== undefined) {
      const mo = Number(m[4]);
      const d = Number(m[5]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      out.push({ raw, kind: "monthDay", value: mo * 100 + d, tolerance: 0, index });
      continue;
    }
    const digits = m[6].replace(/,/g, "");
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    const unit = m[7];
    if (unit === "%") {
      out.push({ raw, kind: "percent", value: Number(digits), tolerance: 0.5 * 10 ** -decimals, index });
      continue;
    }
    const mult = unit ? UNIT_MULTIPLIER[unit] : 1;
    out.push({ raw, kind: "number", value: Number(digits) * mult, tolerance: 0.5 * 10 ** -decimals * mult, index });
  }
  return out;
}

export type AllowedNumbers = {
  numbers: number[];
  percents: number[];
  dates: Set<number>;
  monthDays: Set<number>;
};

/** 把交给 LLM 的输入里出现的所有数字收集起来：数值字段直接收，字符串字段按同一规则抽取 */
export function collectAllowedNumbers(payload: unknown): AllowedNumbers {
  const allowed: AllowedNumbers = { numbers: [], percents: [], dates: new Set(), monthDays: new Set() };
  const addToken = (t: NumberToken) => {
    if (t.kind === "number") allowed.numbers.push(t.value);
    else if (t.kind === "percent") allowed.percents.push(t.value);
    else if (t.kind === "date") {
      allowed.dates.add(t.value);
      allowed.monthDays.add(t.value % 10_000);
    } else allowed.monthDays.add(t.value);
  };
  const walk = (v: unknown) => {
    if (v === null || v === undefined || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (Number.isFinite(v)) allowed.numbers.push(v);
      return;
    }
    if (typeof v === "string") {
      for (const t of extractNumberTokens(v)) addToken(t);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walk(x);
  };
  walk(payload);
  return allowed;
}

function isVerified(t: NumberToken, allowed: AllowedNumbers): boolean {
  const eps = 1e-9;
  switch (t.kind) {
    case "date":
      return allowed.dates.has(t.value);
    case "monthDay":
      return allowed.monthDays.has(t.value);
    case "percent":
      return allowed.percents.some((a) => Math.abs(a - t.value) <= t.tolerance + eps);
    default:
      return allowed.numbers.some((a) => Math.abs(a - t.value) <= t.tolerance + eps);
  }
}

export const UNVERIFIED_MARK = "［矩阵中无此数］";

export type InterpretationCheck<K extends string> = {
  ok: boolean;
  /** 找不到出处的数字（按字段、出现顺序） */
  unverified: Array<{ field: K; token: string }>;
  /** 原文 + 在每个找不到出处的数字后面加 UNVERIFIED_MARK */
  annotated: Record<K, string>;
};

/** 逐字段复核 LLM 解读里的数字；不改动有出处的内容，只在可疑数字后加标注 */
export function checkInterpretationNumbers<K extends string>(fields: Record<K, string>, allowed: AllowedNumbers): InterpretationCheck<K> {
  const unverified: Array<{ field: K; token: string }> = [];
  const annotated = {} as Record<K, string>;
  for (const field of Object.keys(fields) as K[]) {
    const text = fields[field] ?? "";
    const bad = extractNumberTokens(text).filter((t) => !isVerified(t, allowed));
    let next = text;
    for (const t of [...bad].reverse()) {
      const end = t.index + t.raw.length;
      next = `${next.slice(0, end)}${UNVERIFIED_MARK}${next.slice(end)}`;
    }
    for (const t of bad) unverified.push({ field, token: t.raw });
    annotated[field] = next;
  }
  return { ok: unverified.length === 0, unverified, annotated };
}
