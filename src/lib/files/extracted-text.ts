/**
 * 解析出的文字 → 能写进 PostgreSQL 的文字（纯函数，FIX-13）
 *
 * unpdf / mammoth / xlsx 抽出的文字里有两类字符会让写库整份失败：
 *   - U+0000：PostgreSQL 的 text 不收（22021 invalid byte sequence for encoding "UTF8": 0x00）。
 *     来源举例：PDF 里没有 ToUnicode 的 Identity-H 字体字形（勾选框）被抽成 U+0000。
 *   - 落单的 UTF-16 代理字符：Prisma 序列化时报 unexpected end of hex escape。
 *     来源举例：按字符数截断（slice）把一对代理字符劈开。
 *
 * 规则：U+0000 → 空格（不删，免得把左右两个词粘在一起）；落单代理字符 → U+FFFD
 * （Unicode 的标准替换，与 String.prototype.toWellFormed 结果相同）；其余字符原样保留，
 * 成对的代理字符（表情符号、扩展区汉字）不动。
 *
 * 用在写库边界：截断之后要再清理一遍——截断可能产生新的落单代理字符。
 */

const NUL = "\u0000";
const REPLACEMENT = "�";
/** 先吃掉成对的代理字符，剩下匹配到的单个代理字符就是落单的 */
const SURROGATE_PAIR_OR_LONE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
    }
    return true;
  }
  return false;
}

/** 文字里有没有写不进库的字符（U+0000 或落单代理字符）。 */
export function hasUnstorableChars(text: string): boolean {
  return text.includes(NUL) || hasLoneSurrogate(text);
}

/** 把写不进库的字符换掉；没有这类字符时原样返回同一个字符串。 */
export function toStorableText(text: string): string {
  if (!hasUnstorableChars(text)) return text;
  return text
    .split(NUL)
    .join(" ")
    .replace(SURROGATE_PAIR_OR_LONE, (m) => (m.length === 2 ? m : REPLACEMENT));
}
