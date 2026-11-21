/**
 * FIX-13 解析出的文字带 U+0000 / 落单代理字符也能入库——真实 DB（隔离库）经真实的两条解析路径
 *
 * 复现的是生产「12-3 Indoor Canadian Flag」附录 B 的机理：PDF 里一个 Type0 / Identity-H、
 * 没有 ToUnicode、没有嵌入字体的字符，被 unpdf 抽成 U+0000；PostgreSQL 的 text 不收这个字符
 * （22021），整份文件写库失败、被标成「failed」。
 *
 * PDF 在测试里现拼（不入库任何客户文件）；文件经本地文件存储读取；
 * 两条路径都走真实函数：parseDocumentPagesAndStore（招标分析用的逐页文字）与
 * parseAndStoreContent（项目文件列表用的整份文字）。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 文件）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-13 解析 U+0000 入库 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-13 page-parse NUL DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

const NUL = "\u0000";
const FFFD = String.fromCharCode(0xfffd);
/** 落单的 UTF-16 代理字符（高位后面不是低位，或低位前面不是高位） */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const LINE_A = "Conflict of interest: if none, check the box.";
const LINE_B = "The Bidder declares that no conflict exists.";

/**
 * 手写最小 PDF（PDF 1.3）。/F1 = Helvetica；/F2 = Type0 / SymbolMT / Identity-H，
 * 后代字体 CIDFontType2 只有 FontDescriptor——没有嵌入字体、没有 ToUnicode，
 * 所以 unpdf 把 <0000> 抽成 U+0000（与附录 B 的勾选框同一机理）。
 */
function buildPdf(pageStreams: string[]): Buffer {
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
function buildCheckboxPdf(): Buffer {
  return buildPdf([
    "BT /F2 12 Tf 72 720 Td <00000000000000000000> Tj ET",
    `BT /F1 12 Tf 72 720 Td (${LINE_A}) Tj ET\nBT /F2 12 Tf 72 700 Td <0000> Tj ET\nBT /F1 12 Tf 84 700 Td ( ${LINE_B}) Tj ET`,
  ]);
}

/**
 * 纯文本夹具（三行）：
 *   第 1 行是一个标题，第 60 / 61 个字符是一个表情符号——单元标签取标题前 60 个字，正好把这对代理字符劈开；
 *   第 2 行带一个 U+0000，末尾垫 pad 个字符（用来挪动截断点的奇偶）；
 *   第 3 行是「a + 十万多个表情符号」——按 6000 字切单元、按 20 万字截断整份文字都可能劈开一对。
 */
const HEADING = `SECTION ${"x".repeat(51)}😀😀 heading`;
function buildTxtString(pad: number): string {
  return `${HEADING}\nFixture line with a NUL: A${NUL}BC${"y".repeat(pad)}\na${"😀".repeat(100_001)}`;
}
const endsWithLoneHigh = (t: string) => /[\uD800-\uDBFF]$/.test(t);

/** 手拼 UTF-16 文本：BOM（可选）+ 每个字符两个字节 */
function utf16(text: string, opts: { bom: boolean; bigEndian?: boolean }): Buffer {
  const body = Buffer.from(text, "utf16le");
  if (opts.bigEndian) body.swap16();
  const bom = opts.bigEndian ? Buffer.from([0xfe, 0xff]) : Buffer.from([0xff, 0xfe]);
  return opts.bom ? Buffer.concat([bom, body]) : body;
}

async function main() {
  const { db } = await import("@/lib/db");
  const { parseDocumentPagesAndStore, MAX_CONTENT_TEXT_CHARS } = await import("../page-parse");
  const { parseAndStoreContent } = await import("@/lib/files/parse-content");
  const { buildBlockUnits } = await import("../document-units");
  const { NOT_UTF8_TEXT_ERROR, toStorableText } = await import("@/lib/files/extracted-text");
  const XLSX = await import("xlsx");
  const { extractText } = await import("unpdf");

  console.log("FIX-13 page-parse NUL — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `nulowner_${stamp}`, ORG = `nulorg_${stamp}`, PROJECT = `nulproj_${stamp}`;

  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fix13-blobs-"));
  process.env.PRODUCT_CONTENT_LOCAL_STORE = "1";
  process.env.PRODUCT_CONTENT_LOCAL_STORE_DIR = storeDir;

  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Fixture Owner", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `nul-${stamp}`, ownerId: OWNER } });
  await db.project.create({ data: { id: PROJECT, name: `Fixture Tender ${stamp}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched" } });

  let seq = 0;
  async function mkDoc(filename: string, fileType: string, body: Buffer, extra?: { parseStatus?: string; parseError?: string }) {
    seq += 1;
    const pathname = `projects/${PROJECT}/${seq}-${filename}`;
    const abs = path.join(storeDir, pathname);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    const blobUrl = `/api/files/${pathname}`;
    const doc = await db.projectDocument.create({
      data: { projectId: PROJECT, title: filename, url: blobUrl, blobUrl, fileType, fileSize: body.length, source: "upload", uploadedById: OWNER, ...extra },
    });
    return doc.id;
  }
  const docOf = (id: string) => db.projectDocument.findUniqueOrThrow({ where: { id }, select: { parseStatus: true, parseError: true, contentText: true, pageCount: true } });
  const pagesOf = (id: string) => db.projectDocumentPage.findMany({ where: { documentId: id }, orderBy: { pageNumber: "asc" }, select: { pageNumber: true, contentText: true, charCount: true, parseStatus: true, unitLabel: true } });

  try {
    // —— 0. 前提：这份 PDF 真的会被 unpdf 抽出 U+0000（否则后面的断言没有意义） ——
    const pdf = buildCheckboxPdf();
    const raw = await extractText(new Uint8Array(pdf), { mergePages: false });
    const rawPages = Array.isArray(raw.text) ? raw.text : [String(raw.text ?? "")];
    ok(raw.totalPages === 2 && rawPages[1] === `${LINE_A}\n${NUL} ${LINE_B}`, "前提：unpdf 把第 2 页的勾选框抽成 U+0000，夹在「check the box.」与「The Bidder declares」之间", rawPages[1]);
    ok(rawPages[0] === NUL.repeat(5), "前提：第 1 页抽出的文字只由 U+0000 组成", rawPages[0]);

    // —— 1. 页级解析（招标分析用）：PDF ——
    const pdfDocA = await mkDoc("Fixture-Appendix-B-e(PDF).pdf", "pdf", pdf);
    const resA = await parseDocumentPagesAndStore(pdfDocA);
    const dA = await docOf(pdfDocA);
    const pA = await pagesOf(pdfDocA);
    ok(resA.ok === true && dA.parseStatus === "done" && dA.parseError === null, "页级解析：带 U+0000 的 PDF 解析状态为 done，没有失败原因", { res: resA, parseStatus: dA.parseStatus, parseError: dA.parseError });
    ok(pA.length === 2 && dA.pageCount === 2, "页级解析：两页都入库", { pages: pA.length, pageCount: dA.pageCount });
    ok(pA[1]?.pageNumber === 2 && pA[1]?.contentText === `${LINE_A}\n  ${LINE_B}` && pA[1]?.parseStatus === "done", "页级解析：第 2 页的 U+0000 入库为一个空格（与后面原有的空格连成两个），其余文字逐字不变", pA[1]);
    ok(pA[0]?.pageNumber === 1 && pA[0]?.parseStatus === "OCR_REQUIRED" && pA[0]?.contentText === "" && pA[0]?.charCount === 0, "页级解析：整页都是 U+0000 的第 1 页按近乎空白处理（需要 OCR），文件不因此失败", pA[0]);
    ok(pA.every((p) => !p.contentText.includes(NUL)) && dA.contentText !== null && !dA.contentText.includes(NUL), "页级解析：库里逐页文字与整份文字都不含 U+0000");
    ok(dA.contentText === `${LINE_A}\n  ${LINE_B}`, "页级解析：整份文字 = 有字的那一页", dA.contentText);

    // —— 2. 旧的整份文字解析（项目文件列表用）：PDF ——
    const pdfDocB = await mkDoc("Fixture-Appendix-B-f(PDF).pdf", "pdf", pdf);
    await parseAndStoreContent(pdfDocB);
    const dB = await docOf(pdfDocB);
    ok(dB.parseStatus === "done" && dB.parseError === null, "整份文字解析：带 U+0000 的 PDF 解析状态为 done，没有失败原因", { parseStatus: dB.parseStatus, parseError: dB.parseError });
    ok(dB.contentText === `${LINE_A}\n  ${LINE_B}`, "整份文字解析：入库的文字不含 U+0000，两句正文逐字都在；整页 U+0000 的那一页不留下一串空格", dB.contentText?.slice(0, 200));

    // —— 3. 纯文本：U+0000 + 切单元 / 取标签 / 截断劈开代理对 ——
    // 两条路径的截断点奇偶相反，各挑一份「截断处正好劈开一对代理字符」的文本（前提用纯函数算出来）
    const pagePathText = (pad: number) => buildBlockUnits(toStorableText(buildTxtString(pad)).trim()).map((u) => toStorableText(u.contentText)).join("\n\n");
    const padForPages = [0, 1].find((pad) => endsWithLoneHigh(pagePathText(pad).slice(0, MAX_CONTENT_TEXT_CHARS)));
    const padForLegacy = [0, 1].find((pad) => endsWithLoneHigh(toStorableText(buildTxtString(pad)).trim().slice(0, MAX_CONTENT_TEXT_CHARS)));
    ok(padForPages !== undefined && padForLegacy !== undefined && padForPages !== padForLegacy, "前提：两条路径各有一份文本，整份文字在 20 万字处的截断正好劈开一对代理字符", { padForPages, padForLegacy });

    const txtDocA = await mkDoc("fixture-notes.txt", "txt", Buffer.from(buildTxtString(padForPages ?? 0), "utf-8"));
    const resT = await parseDocumentPagesAndStore(txtDocA);
    const dTA = await docOf(txtDocA);
    const pTA = await pagesOf(txtDocA);
    ok(resT.ok === true && dTA.parseStatus === "done" && dTA.parseError === null, "页级解析：带 U+0000 与被劈开的代理对的纯文本解析状态为 done", { res: resT, parseError: dTA.parseError });
    ok(pTA.length > 1 && pTA.every((p) => !p.contentText.includes(NUL) && !LONE_SURROGATE.test(p.contentText)), "页级解析：每个文本块单元都不含 U+0000 与落单代理字符", { units: pTA.length });
    ok(pTA.some((p) => p.contentText.includes(FFFD)) && pTA[0]?.contentText.includes("Fixture line with a NUL: A BC"), "页级解析：被劈开的代理字符入库为 U+FFFD，U+0000 入库为空格", pTA[0]?.contentText.slice(0, 120));
    ok(pTA.every((p) => p.unitLabel !== null && !LONE_SURROGATE.test(p.unitLabel)) && pTA[0]?.unitLabel === `§ SECTION ${"x".repeat(51)}${FFFD} · 第 1 段`, "页级解析：单元标签取标题前 60 个字时劈开的代理字符入库为 U+FFFD", pTA[0]?.unitLabel);
    ok(dTA.contentText !== null && dTA.contentText.length === MAX_CONTENT_TEXT_CHARS && !dTA.contentText.includes(NUL) && !LONE_SURROGATE.test(dTA.contentText) && dTA.contentText.endsWith(FFFD), "页级解析：整份文字截断正好劈开一对代理字符 → 末尾入库为 U+FFFD，全文不含 U+0000 与落单代理字符", { length: dTA.contentText?.length, tail: dTA.contentText?.slice(-3) });

    const txtDocB = await mkDoc("fixture-notes-legacy.txt", "txt", Buffer.from(buildTxtString(padForLegacy ?? 1), "utf-8"));
    await parseAndStoreContent(txtDocB);
    const dTB = await docOf(txtDocB);
    ok(dTB.parseStatus === "done" && dTB.parseError === null, "整份文字解析：同一类纯文本解析状态为 done", { parseStatus: dTB.parseStatus, parseError: dTB.parseError });
    ok(dTB.contentText !== null && dTB.contentText.length === MAX_CONTENT_TEXT_CHARS && !dTB.contentText.includes(NUL) && !LONE_SURROGATE.test(dTB.contentText) && dTB.contentText.endsWith(FFFD), "整份文字解析：截断正好劈开一对代理字符 → 末尾入库为 U+FFFD，全文不含 U+0000 与落单代理字符", { length: dTB.contentText?.length, tail: dTB.contentText?.slice(-3) });

    // —— 4. 上一次失败的文件重新解析：变为 done，原因清空（上线后对已失败文件的操作） ——
    const OLD_ERROR = "Invalid `prisma.projectDocumentPage.createMany()` invocation: … 22021 invalid byte sequence for encoding \"UTF8\": 0x00";
    const failedA = await mkDoc("Fixture-failed-page.pdf", "pdf", pdf, { parseStatus: "failed", parseError: OLD_ERROR });
    const failedB = await mkDoc("Fixture-failed-legacy.pdf", "pdf", pdf, { parseStatus: "failed", parseError: OLD_ERROR });
    await parseDocumentPagesAndStore(failedA);
    await parseAndStoreContent(failedB);
    const dFA = await docOf(failedA);
    const dFB = await docOf(failedB);
    ok(dFA.parseStatus === "done" && dFA.parseError === null && dFB.parseStatus === "done" && dFB.parseError === null, "以前解析失败的文件重新解析（两条路径）：都变为 done，上一次的失败原因清空", { page: dFA, legacy: { parseStatus: dFB.parseStatus, parseError: dFB.parseError } });

    // —— 5. 同一份文件再解析一次：结果相同，不留重复的页 ——
    const resA2 = await parseDocumentPagesAndStore(pdfDocA);
    const pA2 = await pagesOf(pdfDocA);
    ok(resA2.ok === true && pA2.length === 2 && pA2[1]?.contentText === pA[1]?.contentText, "页级解析：同一份文件再解析一次，仍是 2 页、文字相同");

    // —— 6. 表格：Excel 单元格里的 U+0000、CSV 里的 U+0000 ——
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Item", "Unit price"], [`Flag${NUL}indoor`, "12.50"], ["Pole", "8.00"]]), "Pricing");
    const xlsx = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    const csv = Buffer.from(`Item,Unit price\nFlag${NUL}indoor,12.50\nPole,8.00`, "utf-8");
    for (const [label, name, type, body] of [["Excel", "fixture-pricing.xlsx", "xlsx", xlsx], ["CSV", "fixture-pricing.csv", "csv", csv]] as const) {
      const idPages = await mkDoc(name, type, body);
      const idLegacy = await mkDoc(`legacy-${name}`, type, body);
      const resS = await parseDocumentPagesAndStore(idPages);
      await parseAndStoreContent(idLegacy);
      const dS = await docOf(idPages);
      const uS = await pagesOf(idPages);
      const dL = await docOf(idLegacy);
      ok(resS.ok === true && dS.parseStatus === "done" && uS.length === 1 && uS[0]!.contentText.includes("Flag indoor,12.50") && !uS[0]!.contentText.includes(NUL), `页级解析：${label} 里带 U+0000 的单元格入库为空格，表格单元照常入库`, { res: resS, unit: uS[0]?.contentText });
      ok(dL.parseStatus === "done" && dL.parseError === null && dL.contentText !== null && dL.contentText.includes("Flag indoor,12.50") && !dL.contentText.includes(NUL), `整份文字解析：${label} 里带 U+0000 的单元格入库为空格`, { parseStatus: dL.parseStatus, parseError: dL.parseError, text: dL.contentText?.slice(0, 80) });
    }

    // —— 7. UTF-16 的纯文本：带字节序标记的正常读出来，不带的判为失败并写明原因 ——
    const SENTENCE = "投标须知 Mandatory: bid bond 10% of the total price.";
    for (const [label, body] of [["UTF-16LE", utf16(SENTENCE, { bom: true })], ["UTF-16BE", utf16(SENTENCE, { bom: true, bigEndian: true })]] as const) {
      const idPages = await mkDoc(`fixture-${label}.txt`, "txt", body);
      const idLegacy = await mkDoc(`fixture-${label}-legacy.txt`, "txt", body);
      await parseDocumentPagesAndStore(idPages);
      await parseAndStoreContent(idLegacy);
      const uU = await pagesOf(idPages);
      const dU = await docOf(idPages);
      const dUL = await docOf(idLegacy);
      ok(dU.parseStatus === "done" && uU.length === 1 && uU[0]!.contentText === SENTENCE && dUL.parseStatus === "done" && dUL.contentText === SENTENCE, `带字节序标记的 ${label} 纯文本（两条路径）：按 UTF-16 读出来，文字逐字正确，不是「隔一个字一个空格」`, { pages: uU[0]?.contentText, legacy: dUL.contentText });
    }
    const noBom = utf16("Item,Qty,Unit price\nFlag,10,12.50", { bom: false });
    const badPages = await mkDoc("fixture-utf16-no-bom.csv", "csv", noBom, { parseStatus: "failed", parseError: OLD_ERROR });
    const badLegacy = await mkDoc("fixture-utf16-no-bom-legacy.csv", "csv", noBom, { parseStatus: "failed", parseError: OLD_ERROR });
    const resBad = await parseDocumentPagesAndStore(badPages);
    await parseAndStoreContent(badLegacy);
    const dBadP = await docOf(badPages);
    const dBadL = await docOf(badLegacy);
    ok(resBad.ok === false && dBadP.parseStatus === "failed" && dBadP.parseError === NOT_UTF8_TEXT_ERROR && (await pagesOf(badPages)).length === 0, "页级解析：不带字节序标记的 UTF-16 文本（读出来满是 U+0000）→ 解析失败并写明原因，不把乱码当正文入库", { res: resBad, parseError: dBadP.parseError });
    ok(dBadL.parseStatus === "failed" && dBadL.parseError === NOT_UTF8_TEXT_ERROR && dBadL.contentText === null, "整份文字解析：同一份文件 → 解析失败并写明原因", { parseStatus: dBadL.parseStatus, parseError: dBadL.parseError });
    ok([dBadP.parseError, dBadL.parseError].every((e) => typeof e === "string" && e.length > 0 && e.length <= 500 && e !== OLD_ERROR), "解析失败有原因：非空、不超过 500 字，是这一次的原因而不是上一次留下的");

    // —— 8. 整份文字解析：没有解析器的文件类型 → done，上一次留下的失败原因清掉 ——
    const png = await mkDoc("fixture-photo.png", "png", Buffer.from([0x89, 0x50, 0x4e, 0x47]), { parseStatus: "failed", parseError: OLD_ERROR });
    await parseAndStoreContent(png);
    const dPng = await docOf(png);
    ok(dPng.parseStatus === "done" && dPng.parseError === null && dPng.contentText === null, "整份文字解析：不支持提取文字的类型（图片）标为 done，上一次留下的失败原因清掉", { parseStatus: dPng.parseStatus, parseError: dPng.parseError });
  } finally {
    // 每一步各自收尾：一步失败不拦住后面的清理
    const cleanup = [
      () => db.projectDocument.deleteMany({ where: { projectId: PROJECT } }), // 逐页文字随文件级联删除
      () => db.project.deleteMany({ where: { id: PROJECT } }),
      () => db.organization.deleteMany({ where: { id: ORG } }),
      () => db.user.deleteMany({ where: { id: OWNER } }),
      () => db.$disconnect(),
    ];
    for (const step of cleanup) await step().catch((e) => console.error("cleanup failed:", e instanceof Error ? e.message : e));
    fs.rmSync(storeDir, { recursive: true, force: true });
  }

  console.log(`\nFIX-13 page-parse NUL DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
