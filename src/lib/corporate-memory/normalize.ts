// ============================================================
// Buyer canonical identity — 确定性 normalization（T3）
//
// 只做确定性规则：unicode fold / 大小写 / 标点 / 冠词 / "X, City of" 倒装。
// 禁止模糊相似度（fuzzy similarity）参与身份判定；禁止 LLM 参与合并。
// ============================================================

/// "Toronto, City of" → "city of toronto" 这类倒装的机构词。
const INVERTED_ENTITY_WORDS = [
  "city",
  "town",
  "township",
  "village",
  "county",
  "district",
  "region",
  "municipality",
  "regional municipality",
  "borough",
] as const;

const INVERTED_PATTERN = new RegExp(
  `^(.+),\\s*(${INVERTED_ENTITY_WORDS.join("|")})\\s+of$`,
  "i",
);

/**
 * 确定性 buyer 名称归一：
 * 1. NFKC fold + 小写 + trim
 * 2. "&" → " and "；其余标点 → 空格
 * 3. 空白折叠
 * 4. "toronto, city of" → "city of toronto"（倒装复位）
 * 5. 去掉前导冠词 "the "
 *
 * 例："The City of Toronto" / "City of Toronto" / "Toronto, City of" → "city of toronto"；
 * "Toronto District School Board" 与 "Toronto Catholic District School Board" 归一后仍不同（不会被合并）。
 */
export function normalizeBuyerName(input: string): string {
  let s = input.normalize("NFKC").toLowerCase().trim();
  s = s.replace(/&/g, " and ");
  // 先去掉除逗号外的标点（保留逗号供倒装检测），再折叠空白
  s = s.replace(/[^\p{L}\p{N}\s,]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  const inverted = s.match(INVERTED_PATTERN);
  if (inverted) {
    s = `${inverted[2]} of ${inverted[1]}`;
  }
  // 移除残留逗号并再次折叠
  s = s.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (s.startsWith("the ")) s = s.slice(4);
  return s.replace(/\s+/g, " ").trim();
}

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * 确定性域名归一：去 scheme/path/query/port、去前导 "www."、小写。
 * 非法输入返回 null（调用方自行决定是否报错）。
 */
export function normalizeWebsiteDomain(input: string | null | undefined): string | null {
  if (!input || typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/, 1)[0] ?? "";
  s = s.replace(/^www\./, "");
  s = s.split("@").pop() ?? "";
  s = s.split(":", 1)[0] ?? "";
  if (!s || !HOSTNAME_PATTERN.test(s)) return null;
  return s;
}
