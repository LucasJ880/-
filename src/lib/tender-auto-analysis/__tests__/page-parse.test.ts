/**
 * 页级 PDF 解析单元测试（合成 PDF，不提交真实 RFP）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/page-parse.test.ts
 */

import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  EXTRACTION_METHOD_UNPDF,
  NEAR_EMPTY_PAGE_CHARS,
  extractNonPdfUnits,
  extractPdfPagesFromBuffer,
} from "../page-parse";
import { NOT_UTF8_TEXT_ERROR } from "@/lib/files/extracted-text";
import { LINE_A, LINE_B, buildCheckboxPdf } from "./fixtures/nul-pdf";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

async function buildSyntheticPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const p1 = doc.addPage([612, 792]);
  p1.drawText("Synthetic tender page one: Royal Canadian Mounted Police", {
    x: 50,
    y: 700,
    size: 12,
    font,
  });

  // 近空页（仅极少字符）→ OCR_REQUIRED
  const p2 = doc.addPage([612, 792]);
  p2.drawText("x", { x: 50, y: 700, size: 12, font });

  // 空白页
  doc.addPage([612, 792]);

  const p4 = doc.addPage([612, 792]);
  p4.drawText("Closing date and quantity ambiguity notes for page four.", {
    x: 50,
    y: 700,
    size: 12,
    font,
  });

  return Buffer.from(await doc.save());
}

async function main() {
  console.log("tender-auto-analysis page-parse");

  const buffer = await buildSyntheticPdf();
  ok(buffer.length > 100, "合成 PDF buffer 非空");

  const result = await extractPdfPagesFromBuffer(buffer);
  ok(result.totalPages === 4, `totalPages=4 (got ${result.totalPages})`);
  ok(result.pages.length === 4, `pages.length=4 (got ${result.pages.length})`);

  ok(result.pages[0]!.pageNumber === 1, "第一页 pageNumber=1");
  ok(
    result.pages.every((p) => p.extractionMethod === EXTRACTION_METHOD_UNPDF),
    "extractionMethod=unpdf",
  );

  const page1 = result.pages[0]!;
  ok(page1.parseStatus === "done", "有文本页 parseStatus=done");
  ok(
    page1.contentText.toLowerCase().includes("royal canadian"),
    "第1页包含合成文本",
  );
  ok(page1.charCount >= NEAR_EMPTY_PAGE_CHARS, "第1页 charCount 超过近空阈值");

  const page2 = result.pages[1]!;
  ok(
    page2.parseStatus === "OCR_REQUIRED",
    `近空页 OCR_REQUIRED (got ${page2.parseStatus})`,
  );

  const page3 = result.pages[2]!;
  ok(
    page3.parseStatus === "OCR_REQUIRED",
    `空白页 OCR_REQUIRED (got ${page3.parseStatus})`,
  );
  ok(page3.charCount === 0, "空白页 charCount=0");

  const page4 = result.pages[3]!;
  ok(page4.pageNumber === 4, "末页 pageNumber=4");
  ok(page4.parseStatus === "done", "末页有文本 done");
  ok(
    page4.contentText.toLowerCase().includes("closing date"),
    "末页包含合成文本",
  );


  // —— FIX-13：unpdf 抽出 U+0000 的页面（不用数据库；CI 也跑这一段） ——
  {
    const nul = "\u0000";
    const extracted = await extractPdfPagesFromBuffer(buildCheckboxPdf());
    ok(extracted.totalPages === 2 && extracted.pages.length === 2, "FIX-13：现拼的两页 PDF 读出 2 页");
    ok(
      extracted.pages[1]?.contentText === `${LINE_A}\n  ${LINE_B}` && extracted.pages[1]?.parseStatus === "done",
      "FIX-13：勾选框那一页的 U+0000 换成空格，两句正文都在",
    );
    ok(
      extracted.pages[0]?.parseStatus === "OCR_REQUIRED" && extracted.pages[0]?.contentText === "" && extracted.pages[0]?.charCount === 0,
      "FIX-13：整页都是 U+0000 的那一页按近乎空白处理（需要 OCR）",
    );
    ok(extracted.pages.every((p) => !p.contentText.includes(nul)), "FIX-13：页面文字里没有 U+0000");

    const csv = await extractNonPdfUnits(Buffer.from(`Item,Unit price\nFlag${nul}indoor,12.50`, "utf-8"), "csv");
    ok(
      "units" in csv && csv.units.length === 1 && csv.units[0]!.contentText.includes("Flag indoor,12.50") && !csv.units[0]!.contentText.includes(nul),
      "FIX-13：CSV 单元格里的 U+0000 换成空格",
    );
    const utf16NoBom = await extractNonPdfUnits(Buffer.from("Item,Qty,Unit price\nFlag,10,12.50", "utf16le"), "csv");
    ok(
      "error" in utf16NoBom && utf16NoBom.error === NOT_UTF8_TEXT_ERROR,
      "FIX-13：没有字节序标记的 UTF-16 CSV → 返回「不是 UTF-8 文本」的原因，不产出单元",
    );
    const utf16Bom = await extractNonPdfUnits(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("投标须知 Mandatory: bid bond 10% of the total price.", "utf16le")]),
      "txt",
    );
    ok(
      "units" in utf16Bom && utf16Bom.units.length === 1 && utf16Bom.units[0]!.contentText === "投标须知 Mandatory: bid bond 10% of the total price.",
      "FIX-13：带字节序标记的 UTF-16 纯文本按 UTF-16 读出，文字逐字正确",
    );
  }

  console.log(`\npage-parse: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
