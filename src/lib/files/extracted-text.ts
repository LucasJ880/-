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
 *
 * 另有 decodeTextFile：纯文本 / CSV 的解码。以前 UTF-16 的文本文件按 UTF-8 读出来满是 U+0000，
 * 写库失败（碰巧被数据库挡住）；现在 U+0000 会被换成空格，所以要在解码这一步把它们认出来，
 * 不让「隔一个字一个空格」的乱码当作正常文字进分析。
 */

const NUL = "\u0000";
const REPLACEMENT = String.fromCharCode(0xfffd); // U+FFFD（不在源码里写字面字符，免得被编辑器 / 工具改坏）
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

/** 失败原因（parseError）的长度上限 */
export const PARSE_ERROR_MAX_CHARS = 500;

/**
 * 失败原因写库前的收口：先截到 500 字，再清掉写不进库的字符。
 * 报错文字本身也可能带 U+0000（解析库把文件里的内容拼进报错），截断也可能劈开一对代理字符——
 * 那样连「记下失败原因」这一步都会失败，文件停在解析中。替换是一个换一个，结果不会超过上限。
 */
export function toStorableParseError(message: string): string {
  return toStorableText(message.slice(0, PARSE_ERROR_MAX_CHARS));
}

/**
 * 纯文本 / CSV 里「U+0000 + 无法解码的字符（U+FFFD）」占比超过这个值、且至少有一个 U+0000，
 * 就认定它不是能读的文本。UTF-16 的英文文本约一半是 U+0000；UTF-16 的中文文本按 UTF-8 读出来
 * U+0000 很少，但两成以上是 U+FFFD。
 */
export const TEXT_FILE_MAX_NUL_RATIO = 0.1;

/**
 * 判断「读不了」时只看开头这么多个字（与整份文字解析入库的上限相同）。
 * 文件尾部才有一大串 U+0000（例如程序预分配后没写完）的大文本，前面的正文照样能读：
 * 按全文算比例会把这种文件整份判失败，而改动前它能解析（存进去的那一段不含 U+0000）。
 */
export const TEXT_FILE_UNREADABLE_SAMPLE_CHARS = 200_000;

/**
 * 不是 UTF-8 文本时记下的失败原因。面板上会拼成「文件解析失败（原因：…）」，所以这里不用括号；
 * 重新上传是新建一份，旧的这份要删掉，否则它仍以失败的状态留在清单里。
 */
export const NOT_UTF8_TEXT_ERROR =
  "文本文件不是 UTF-8 编码或含二进制内容，无法读取。请用记事本或 Excel 打开，另存为时编码选 UTF-8，Excel 里选「CSV UTF-8」格式；重新上传后删掉这一份";

function looksUnreadable(text: string): boolean {
  const sampleLength = Math.min(text.length, TEXT_FILE_UNREADABLE_SAMPLE_CHARS);
  let nulCount = 0;
  let replacementCount = 0;
  for (let i = 0; i < sampleLength; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) nulCount++;
    else if (code === 0xfffd) replacementCount++;
  }
  return (
    nulCount > 0 &&
    (nulCount + replacementCount) / sampleLength > TEXT_FILE_MAX_NUL_RATIO
  );
}

/**
 * 把纯文本 / CSV 文件的字节解码成文字。
 * - 开头是 UTF-16 的字节序标记（FF FE / FE FF）→ 按 UTF-16 解码；否则按 UTF-8；
 * - 解出来的文字开头 TEXT_FILE_UNREADABLE_SAMPLE_CHARS 个字里有 U+0000，且「U+0000 + U+FFFD」超过
 *   TEXT_FILE_MAX_NUL_RATIO → 判为不可读（返回 error）。
 *   这一条对两种解码都查：UTF-32 小端的字节序标记（FF FE 00 00）也以 FF FE 开头，按 UTF-16 读出来一半是 U+0000；
 * - 零星的 U+0000 留给 toStorableText 换成空格；不含 U+0000 的其它编码（如 GBK）照旧按 UTF-8 读，本函数不识别。
 */
export function decodeTextFile(buffer: Buffer): { text: string } | { error: string } {
  let text: string;
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    text = buffer.subarray(2).toString("utf16le");
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const evenLength = (buffer.length - 2) & ~1;
    const body = Buffer.from(buffer.subarray(2, 2 + evenLength)); // 拷贝一份再换字节序，不动原 buffer
    body.swap16();
    text = body.toString("utf16le");
  } else {
    text = buffer.toString("utf-8");
  }
  if (text.length > 0 && looksUnreadable(text)) {
    return { error: NOT_UTF8_TEXT_ERROR };
  }
  return { text };
}
