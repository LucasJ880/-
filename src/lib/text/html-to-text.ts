/**
 * HTML → 纯文本（公共实现，TREE-1 从 `src/lib/trade/email-forward-parse.ts` 挪来）
 *
 * 邮件转发询盘解析与情报调研读网页（`src/lib/web-reader/`）共用这一份；不要再复制。
 * 块级标签换行，表格单元格之间用制表符（「Name\tValue」可按标签解析）；script / style / head / title
 * 的内容去掉；还原常见命名实体与数字实体。单趟线性扫描（不用正则回溯）：任意长度的标签（如内联
 * data: URI 图片）整段去掉；未闭合的注释 / 标签 / script 不会让后续每个「<」都扫到串尾。
 *
 * 输入上限是参数：邮件解析传 200 000 字符（与挪动前相同），读网页传 2 MB 对应的字符数。
 * 纯函数：无 DB / 网络。
 */

export type HtmlToTextOptions = {
  /** 只处理前这么多个字符（输入与归一化之后的输出都按它截） */
  maxInputChars: number;
};

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ensp: " ", emsp: " ", thinsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: "©", reg: "®",
};

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, body: string) => {
    const key = body.toLowerCase();
    if (!key.startsWith("#")) return NAMED_ENTITIES[key] ?? m;
    const cp = key[1] === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

const BLOCK_TAGS = new Set(["p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "section", "article", "ul", "ol", "pre"]);
const SKIP_CONTENT_TAGS = new Set(["script", "style", "head", "title"]);

/**
 * HTML → 纯文本：块级标签换行，表格单元格之间用制表符（「Name\tValue」可按标签解析）。
 * 单趟线性扫描（不用正则回溯）：任意长度的标签（如内联 data: URI 图片）整段去掉；未闭合的注释 / 标签 /
 * script 不会让后续每个「<」都扫到串尾。
 */
export function htmlToText(html: string, opts: HtmlToTextOptions): string {
  const max = opts.maxInputChars;
  const s = html.slice(0, max);
  const lower = s.toLowerCase();
  const out: string[] = [];
  const unclosed = new Set<string>();
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      out.push(s.slice(i));
      break;
    }
    if (lt > i) out.push(s.slice(i, lt));
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      out.push(" ");
      if (end < 0) break; // 未闭合注释：其后都是注释（与浏览器一致）
      i = end + 3;
      continue;
    }
    const next = lower.charCodeAt(lt + 1);
    const tagStart = (next >= 97 && next <= 122) || next === 47 /* / */ || next === 33 /* ! */ || next === 63; /* ? */
    if (!tagStart) {
      out.push("<"); // 「a < b」这类正文
      i = lt + 1;
      continue;
    }
    const gt = s.indexOf(">", lt + 1);
    if (gt < 0) {
      out.push(s.slice(lt)); // 之后再没有「>」：其余都是正文
      break;
    }
    const m = /^(\/?)([a-z][a-z0-9]{0,15})/.exec(lower.slice(lt + 1, Math.min(gt, lt + 20)));
    const closing = m?.[1] === "/";
    const name = m?.[2] ?? "";
    i = gt + 1;
    if (!closing && SKIP_CONTENT_TAGS.has(name) && !unclosed.has(name)) {
      const close = lower.indexOf(`</${name}`, i);
      out.push(" ");
      if (close < 0) {
        unclosed.add(name); // 之后不会再有闭合标签：内容按正文保留，不再重复查找
        continue;
      }
      const closeGt = s.indexOf(">", close);
      i = closeGt < 0 ? s.length : closeGt + 1;
      continue;
    }
    if (name === "br" || name === "hr" || BLOCK_TAGS.has(name)) out.push("\n");
    else if (closing && (name === "td" || name === "th")) out.push("\t");
  }
  return normalizePlainText(decodeHtmlEntities(out.join("")), max);
}

/** 纯文本归一：统一换行、去零宽字符、不换行空格变空格、行内空白压缩、三个以上空行压成一个 */
export function normalizePlainText(s: string, maxChars: number): string {
  return s
    .slice(0, maxChars)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \f\v]+/g, " ").replace(/\t[\t ]*/g, "\t").replace(/^[ \t]+|[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
