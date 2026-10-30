/**
 * 复刻 Excel 原件用到的取整 / 文本格式语义。
 *
 * 原件公式里的 ROUNDUP / ROUNDDOWN / ROUND / TEXT(x,"# ??/16") / ISODD 与 JS 自带的
 * Math.ceil / Math.round 语义不同（远离零、趋零、四舍五入远离零），这里统一实现，
 * 引擎只调用这里的函数。
 */

/** 消除 0.1+0.2 一类二进制误差后再取整，避免 2.0000000001 被 ROUNDUP 成 3 */
function clean(x: number): number {
  return Number.parseFloat(x.toPrecision(15));
}

/** Excel ROUNDUP(x, digits)：远离零取整 */
export function roundUp(x: number, digits = 0): number {
  const f = 10 ** digits;
  const v = clean(Math.abs(x) * f);
  return (Math.sign(x) * Math.ceil(v)) / f;
}

/** Excel ROUNDDOWN(x, digits)：趋零取整 */
export function roundDown(x: number, digits = 0): number {
  const f = 10 ** digits;
  const v = clean(Math.abs(x) * f);
  return (Math.sign(x) * Math.floor(v)) / f;
}

/** Excel ROUND(x, digits)：四舍五入，.5 远离零 */
export function excelRound(x: number, digits = 0): number {
  const f = 10 ** digits;
  const v = clean(Math.abs(x) * f);
  return (Math.sign(x) * Math.floor(v + 0.5)) / f;
}

/** Excel INT：向下取整（负数更小） */
export function excelInt(x: number): number {
  return Math.floor(clean(x));
}

/** Excel ISODD / ISEVEN：先截断小数 */
export function isOdd(x: number): boolean {
  return Math.abs(Math.trunc(x)) % 2 === 1;
}

/** 四舍五入到 1/16（原件 ROUND(x*16,0)/16） */
export function roundTo16th(x: number): number {
  return excelRound(x * 16) / 16;
}

/**
 * TRIM(TEXT(x, "# ??/16"))：16 分制文本，不约分。
 *   36.5 → "36 8/16"；60 → "60"；0.25 → "4/16"；0 → "0"
 */
export function sixteenthsText(x: number): string {
  const n = excelRound(x * 16);
  if (n === 0) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 16);
  const frac = abs % 16;
  if (frac === 0) return `${sign}${whole}`;
  if (whole === 0) return sign ? `${sign} ${frac}/16` : `${frac}/16`;
  return `${sign}${whole} ${frac}/16`;
}

/** 浮点比较容差（夹具对照用） */
export const EPS = 1e-6;

export function nearlyEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}
