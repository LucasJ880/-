/**
 * TREE-1 读公开网页：网上读到的 PDF 抽文字的上限（预扫描、页数、时间、字数），用真实的 unpdf。
 * PDF 都是测试里现拼的（不入库任何客户文件）。
 *
 * 运行：npx tsx src/lib/web-reader/__tests__/web-reader-pdf.test.ts
 */
import zlib from "node:zlib";
import { PDF_LIMITS, extractPdfTextGuarded, prescanPdf } from "../pdf";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : "");
  }
}

type Stream = { dict: string; data: Buffer };

/** 手拼最小 PDF：每页一个内容流（可选 Flate 压缩），可附加别的流对象与 trailer 额外字段 */
function buildPdf(pages: Array<{ text: string; flate?: boolean } | Stream>, opts: { extra?: Stream[]; trailerExtra?: string } = {}): Buffer {
  const objs: Array<Buffer> = [];
  const put = (i: number, s: string | Buffer) => (objs[i] = Buffer.isBuffer(s) ? s : Buffer.from(s, "latin1"));
  const pageIds = pages.map((_, i) => 4 + 2 * i);
  put(1, "<< /Type /Catalog /Pages 2 0 R >>");
  put(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  put(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const streamObj = (dict: string, data: Buffer) =>
    Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);
  pages.forEach((p, i) => {
    put(pageIds[i], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`);
    if ("data" in p) put(pageIds[i] + 1, streamObj(p.dict, p.data));
    else {
      const content = Buffer.from(`BT /F1 12 Tf 72 720 Td (${p.text}) Tj ET`, "latin1");
      put(pageIds[i] + 1, p.flate ? streamObj("/Filter /FlateDecode", zlib.deflateSync(content)) : streamObj("", content));
    }
  });
  let next = 4 + 2 * pages.length;
  for (const e of opts.extra ?? []) put(next++, streamObj(e.dict, e.data));
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [];
  let len = parts[0].length;
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = len;
    const chunk = Buffer.concat([Buffer.from(`${i} 0 obj\n`, "latin1"), objs[i] ?? Buffer.from("null", "latin1"), Buffer.from("\nendobj\n", "latin1")]);
    parts.push(chunk);
    len += chunk.length;
  }
  let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length} /Root 1 0 R ${opts.trailerExtra ?? ""} >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

async function main() {
  console.log("预扫描");
  {
    const normal = buildPdf([{ text: "Contract value 230,000", flate: true }]);
    ok("正常 PDF：ok", prescanPdf(normal) === "ok");
    const bomb = buildPdf([{ dict: "/Filter /FlateDecode", data: zlib.deflateSync(Buffer.alloc(20 * 1024 * 1024, 0x20)) }]);
    ok("内容流解压后 20 MB：过大", prescanPdf(bomb) === "over", bomb.length);
    const t0 = Date.now();
    prescanPdf(bomb);
    ok("预扫描很快（< 1 秒）", Date.now() - t0 < 1000, Date.now() - t0);
    const image = buildPdf([{ text: "x" }], { extra: [{ dict: "/Type /XObject /Subtype /Image /Filter /FlateDecode", data: zlib.deflateSync(Buffer.alloc(20 * 1024 * 1024)) }] });
    ok("大图片流不计入（抽文字不解码图片）", prescanPdf(image) === "ok");
    const lzw = buildPdf([{ dict: "/Filter /LZWDecode", data: Buffer.from("xx") }]);
    ok("LZW 压缩：不读", prescanPdf(lzw) === "over");
    const enc = buildPdf([{ text: "x" }], { trailerExtra: "/Encrypt 99 0 R" });
    ok("加密 PDF：标为 encrypted（预扫描做不了）", prescanPdf(enc) === "encrypted");
    const many = buildPdf(Array.from({ length: 3 }, () => ({ dict: "/Filter /FlateDecode", data: zlib.deflateSync(Buffer.alloc(6 * 1024 * 1024, 0x20)) })));
    ok("多个流合计超过 16 MB：过大", prescanPdf(many) === "over");
  }

  console.log("用真实 unpdf 抽文字");
  {
    const two = buildPdf([{ text: "Contract value 230,000", flate: true }, { text: "Awarded to ACME Ltd" }]);
    const r = await extractPdfTextGuarded(two, { maxChars: 2 * 1024 * 1024, deadlineAt: null });
    ok("两页都抽到", r.ok && r.text.includes("230,000") && r.text.includes("ACME") && r.pagesRead === 2 && !r.truncated, r);
    const pages = buildPdf(Array.from({ length: 35 }, (_, i) => ({ text: `Page ${i + 1}` })));
    const p = await extractPdfTextGuarded(pages, { maxChars: 2 * 1024 * 1024, deadlineAt: null });
    ok(`超过 ${PDF_LIMITS.MAX_PAGES} 页：只抽前 ${PDF_LIMITS.MAX_PAGES} 页、标截断`, p.ok && p.pagesRead === PDF_LIMITS.MAX_PAGES && p.truncated && p.totalPages === 35 && !p.text.includes("Page 31"), p.ok ? [p.pagesRead, p.totalPages] : p);
    const c = await extractPdfTextGuarded(two, { maxChars: 10, deadlineAt: null });
    ok("到字数上限：截断", c.ok && c.text.length <= 10 && c.truncated, c);
    let clock = 0;
    const slow = await extractPdfTextGuarded(pages, { maxChars: 2 * 1024 * 1024, deadlineAt: null, now: () => (clock += 3000) });
    ok("累计超过 8 秒：停、标截断", slow.ok && slow.truncated && slow.pagesRead < 5, slow.ok ? slow.pagesRead : slow);
    const near = await extractPdfTextGuarded(pages, { maxChars: 2 * 1024 * 1024, deadlineAt: 1000, now: () => 0 });
    ok("离截止不到 2 秒：一页都不抽、标截断", near.ok && near.pagesRead === 0 && near.truncated, near);
    const bomb = buildPdf([{ dict: "/Filter /FlateDecode", data: zlib.deflateSync(Buffer.alloc(20 * 1024 * 1024, 0x20)) }]);
    const t0 = Date.now();
    const b = await extractPdfTextGuarded(bomb, { maxChars: 2 * 1024 * 1024, deadlineAt: null });
    ok("压缩炸弹：不读、很快返回", !b.ok && b.reason === "pdf_too_complex" && Date.now() - t0 < 2000, [b, Date.now() - t0]);
    const junk = await extractPdfTextGuarded(new TextEncoder().encode("not a pdf at all"), { maxChars: 100, deadlineAt: null });
    ok("不是 PDF：抽不出", !junk.ok && junk.reason === "pdf_unreadable", junk);
    const half = two.subarray(0, Math.floor(two.length / 2));
    const h = await extractPdfTextGuarded(half, { maxChars: 100, deadlineAt: null });
    ok("截断的 PDF：不抛错（抽不出或只抽到一部分）", h.ok || h.reason === "pdf_unreadable", h);
  }

  console.log(`\nweb-reader-pdf: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
