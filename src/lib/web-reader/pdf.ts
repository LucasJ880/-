/**
 * 读公开网页（TREE-1）：从网上读到的 PDF 抽文字，带上限。
 *
 * 2 MB 只限住了下载的字节数，限不住解析的成本：一个高压缩比的内容流被很多页共用，几十 KB 的 PDF
 * 就能让 unpdf 解压出上 GB 的数据、跑几十秒。所以分三层：
 *   1. 预扫描（没加密的 PDF）：把所有非图片的 FlateDecode 流用 zlib 的输出上限解压一遍计数，
 *      合计超过 16 MB 就不读（pdf_too_complex）；用了 LZW / RunLength 这类老压缩的也不读。
 *   2. 只抽前 30 页（逐页取文字，取完就释放）。
 *   3. 累计 8 秒或离截止时间不到 2 秒就停；正文到上限字数就停。停了都标「已截断」。
 * 加密的 PDF 流是密文，预扫描做不了，只靠第 2、3 层（残余风险见 design D7 与交接）。
 * 不放进 worker 线程：unpdf 是打包进服务端代码的，要放进 worker 得改 next.config.ts，会影响既有的上传解析。
 */

import zlib from "node:zlib";

export const PDF_LIMITS = Object.freeze({
  MAX_INFLATED_BYTES: 16 * 1024 * 1024,
  MAX_PAGES: 30,
  TIME_BUDGET_MS: 8_000,
  DEADLINE_MARGIN_MS: 2_000,
});

export type PdfExtractResult =
  | { ok: true; text: string; truncated: boolean; pagesRead: number; totalPages: number }
  | { ok: false; reason: "pdf_unreadable" | "pdf_too_complex" };

export type PdfPrescan = "ok" | "over" | "encrypted";

/** 预扫描：非图片的 FlateDecode 流解压后合计是否不超过上限 */
export function prescanPdf(bytes: Uint8Array, maxInflated: number = PDF_LIMITS.MAX_INFLATED_BYTES): PdfPrescan {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const s = buf.toString("latin1");
  if (/\/Encrypt\b/.test(s)) return "encrypted";
  const re = /(?<!end)stream\r?\n/g;
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const dataStart = m.index + m[0].length;
    const dictFrom = Math.max(0, m.index - 4000);
    const objAt = s.lastIndexOf(" obj", m.index);
    const dict = s.slice(Math.max(dictFrom, objAt), m.index);
    const end = s.indexOf("endstream", dataStart);
    const dataEnd = end < 0 ? s.length : end;
    re.lastIndex = dataEnd;
    if (/\/Subtype\s*\/Image\b/.test(dict)) continue; // 抽文字不解码图片
    if (/\/(LZWDecode|LZW|RunLengthDecode|RL)\b/.test(dict)) return "over";
    if (!/\/(FlateDecode|Fl)\b/.test(dict)) continue;
    try {
      const out = zlib.inflateSync(buf.subarray(dataStart, dataEnd), { maxOutputLength: maxInflated - total + 1 });
      total += out.length;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ERR_BUFFER_TOO_LARGE" || e instanceof RangeError) return "over";
      // 流本身坏了或被截断：交给解析器去判断
    }
    if (total > maxInflated) return "over";
  }
  return "ok";
}

type PageProxy = {
  getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
  cleanup?: () => unknown;
};
type DocProxy = { numPages: number; getPage(n: number): Promise<PageProxy>; destroy?: () => unknown };

/** 按 unpdf 的做法拼一页的文字（与 extractText 的 getPageText 相同） */
function pageText(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  return items
    .filter((it) => it.str != null)
    .map((it) => String(it.str) + (it.hasEOL ? "\n" : ""))
    .join("");
}

export async function extractPdfTextGuarded(
  bytes: Uint8Array,
  opts: { maxChars: number; deadlineAt: number | null; now?: () => number; loadDocument?: (b: Uint8Array) => Promise<DocProxy> },
): Promise<PdfExtractResult> {
  const now = opts.now ?? (() => Date.now());
  if (prescanPdf(bytes) === "over") return { ok: false, reason: "pdf_too_complex" };
  const load =
    opts.loadDocument ??
    (async (b: Uint8Array) => {
      const { getDocumentProxy } = await import("unpdf");
      return (await getDocumentProxy(new Uint8Array(b))) as unknown as DocProxy;
    });
  let doc: DocProxy;
  try {
    doc = await load(bytes);
  } catch {
    return { ok: false, reason: "pdf_unreadable" };
  }
  const started = now();
  const totalPages = doc.numPages;
  const limit = Math.min(totalPages, PDF_LIMITS.MAX_PAGES);
  let truncated = totalPages > limit;
  const parts: string[] = [];
  let chars = 0;
  let pagesRead = 0;
  try {
    for (let i = 1; i <= limit; i++) {
      const t = now();
      if (t - started > PDF_LIMITS.TIME_BUDGET_MS) {
        truncated = true;
        break;
      }
      if (opts.deadlineAt != null && opts.deadlineAt - t < PDF_LIMITS.DEADLINE_MARGIN_MS) {
        truncated = true;
        break;
      }
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      page.cleanup?.();
      let text = pageText(content.items).trim();
      pagesRead += 1;
      if (chars + text.length > opts.maxChars) {
        text = text.slice(0, Math.max(0, opts.maxChars - chars));
        truncated = true;
      }
      if (text) parts.push(text);
      chars += text.length;
      if (chars >= opts.maxChars) {
        truncated = truncated || i < totalPages;
        break;
      }
    }
  } catch {
    if (parts.length === 0) return { ok: false, reason: "pdf_unreadable" };
    truncated = true;
  } finally {
    try {
      await doc.destroy?.();
    } catch {
      // 释放失败不影响结果
    }
  }
  return { ok: true, text: parts.join("\n\n"), truncated, pagesRead, totalPages };
}
