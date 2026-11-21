/**
 * FIX-13 测试夹具：现拼一份 unpdf 会抽出 U+0000 的最小 PDF（不入库任何客户文件）。
 *
 * 复现的是生产「12-3 Indoor Canadian Flag」附录 B 的机理：PDF 里一个 Type0 / Identity-H、
 * 没有 ToUnicode、没有嵌入字体的字符，被 unpdf 抽成 U+0000。
 */

export const LINE_A = "Conflict of interest: if none, check the box.";
export const LINE_B = "The Bidder declares that no conflict exists.";

/**
 * 手写最小 PDF（PDF 1.3）。/F1 = Helvetica；/F2 = Type0 / SymbolMT / Identity-H，
 * 后代字体 CIDFontType2 只有 FontDescriptor——没有嵌入字体、没有 ToUnicode，
 * 所以 unpdf 把 <0000> 抽成 U+0000（与附录 B 的勾选框同一机理）。
 */
export function buildPdf(pageStreams: string[]): Buffer {
  const objs: string[] = [];
  const kids = pageStreams.map((_, i) => `${7 + 2 * i} 0 R`).join(" ");
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageStreams.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type0 /BaseFont /SymbolMT /Encoding /Identity-H /DescendantFonts [5 0 R] >>";
  objs[5] = "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SymbolMT /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /DW 1000 >>";
  objs[6] = "<< /Type /FontDescriptor /FontName /SymbolMT /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>";
  pageStreams.forEach((s, i) => {
    objs[7 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${8 + 2 * i} 0 R >>`;
    objs[8 + 2 * i] = `<< /Length ${Buffer.byteLength(s, "latin1")} >>\nstream\n${s}\nendstream`;
  });
  let out = "%PDF-1.3\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** 第 1 页：整页只有 U+0000；第 2 页：勾选框式（「…check the box.\n\u0000 The Bidder…」，与附录 B 第 2 页同形） */
export function buildCheckboxPdf(): Buffer {
  return buildPdf([
    "BT /F2 12 Tf 72 720 Td <00000000000000000000> Tj ET",
    `BT /F1 12 Tf 72 720 Td (${LINE_A}) Tj ET\nBT /F2 12 Tf 72 700 Td <0000> Tj ET\nBT /F1 12 Tf 84 700 Td ( ${LINE_B}) Tj ET`,
  ]);
}
