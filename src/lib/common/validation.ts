// ============================================================
// 通用校验工具
// ============================================================

/** 非空字符串检查 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Email 格式校验 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** code 格式校验：小写字母/数字/连字符，2–48 位，不以连字符开头或结尾 */
export function isValidCodeFormat(code: string): boolean {
  if (code.length < 2 || code.length > 48) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(code);
}

/** 安全解析正整数，返回 null 表示无效 */
export function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return null;
}

/** 规范化分页参数 */
export function normalizePagination(
  page?: number | string | null,
  pageSize?: number | string | null,
  maxPageSize = 100
): { page: number; pageSize: number; skip: number } {
  const p = parsePositiveInt(page) ?? 1;
  let ps = parsePositiveInt(pageSize) ?? 20;
  if (ps > maxPageSize) ps = maxPageSize;
  return { page: p, pageSize: ps, skip: (p - 1) * ps };
}

/** 规范化 code：小写化 + 替换非法字符 */
export function slugifyCode(input: string, maxLen = 48): string {
  const trimmed = input.trim().toLowerCase();
  const ascii = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  if (ascii.length >= 2) return ascii;
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
