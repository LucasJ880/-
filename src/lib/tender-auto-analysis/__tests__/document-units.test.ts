/**
 * 非 PDF 可引用单元切分
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/document-units.test.ts
 *
 * 核心不变量（V2 证据纪律在非 PDF 上同样成立）：
 *   UNIT-01..05 表格：一表一单元；超长按行切且**每块重复表头**；标签含行区间
 *   UNIT-06..10 文档：段落聚块；标题处断开；标签带最近标题；超长段自成块
 *   UNIT-11..13 边界：空输入、单元数上限、近空单元标记
 *   UNIT-14    引用可核验性：每个单元的文本都能在原始输入里逐字找到
 */

import * as XLSX from "xlsx";

import { extractNonPdfUnits } from "../page-parse";
import {
  buildBlockUnits,
  buildSheetUnits,
  looksLikeHeading,
  summarizeUnits,
  MAX_UNITS_PER_DOCUMENT,
  MAX_CHARS_PER_UNIT,
} from "../document-units";

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

/* ------------------------------ 表格 ------------------------------ */

const PRICING_HEADER = "Item,Description,Qty,Unit,Unit Price,Extended";
function pricingCsv(rows: number): string {
  const body = Array.from(
    { length: rows },
    (_, i) => `${i + 1},Bedroom desk model ${i + 1},${(i + 1) * 3},EA,,`,
  );
  return [PRICING_HEADER, ...body].join("\n");
}

{
  const units = buildSheetUnits([
    { name: "Category A", csv: pricingCsv(3) },
    { name: "Notes", csv: "Note\nDelivery to campus only" },
  ]);
  ok(units.length === 2, "UNIT-01 每个工作表一个单元");
  ok(units[0]!.unitKind === "sheet", "UNIT-01 unitKind=sheet");
  ok(units[0]!.unitLabel === "Sheet「Category A」", "UNIT-02 标签用工作表名");
  ok(units[0]!.unitNumber === 1 && units[1]!.unitNumber === 2, "UNIT-02 单元序号 1-based 连续");
  ok(
    units[0]!.contentText.includes(PRICING_HEADER) &&
      units[0]!.contentText.includes("Bedroom desk model 3"),
    "UNIT-03 单元内容含表头与数据行",
  );
  ok(units.every((u) => u.parseStatus === "done"), "UNIT-03 有内容的单元标记 done");
}

{
  // 超长表：必须按行切块，且每块重复表头（报价表被单独引用时列义不丢）
  const big = pricingCsv(600);
  ok(big.length > MAX_CHARS_PER_UNIT, "UNIT-04 前置：构造的表确实超过单元上限");
  const units = buildSheetUnits([{ name: "Category B", csv: big }]);
  ok(units.length > 1, `UNIT-04 超长表被切成多个单元（${units.length}）`);
  ok(
    units.every((u) => u.contentText.includes(PRICING_HEADER)),
    "UNIT-04 每个切块都重复表头（自解释）",
  );
  ok(
    units.every((u) => u.contentText.length <= MAX_CHARS_PER_UNIT + PRICING_HEADER.length + 80),
    "UNIT-05 每个切块不超过字符上限",
  );
  ok(
    units.every((u) => /Sheet「Category B」· 行 \d+–\d+/.test(u.unitLabel)),
    "UNIT-05 切块标签带真实行区间",
  );
  // 行区间必须连续无空洞
  const ranges = units.map((u) => u.unitLabel.match(/行 (\d+)–(\d+)/)!.slice(1).map(Number));
  const contiguous = ranges.every(
    (r, i) => i === 0 || r[0] === ranges[i - 1]![1]! + 1,
  );
  ok(contiguous, "UNIT-05 行区间连续无空洞（不漏行）");
}

/* ------------------------------ 文档 ------------------------------ */

const AGREEMENT = [
  "MASTER AGREEMENT",
  "This agreement is made between the Buyer and the Supplier.",
  "1. DEFINITIONS",
  "In this agreement, Goods means the furniture described in Appendix A.",
  "Supplier means the party awarded a Master Agreement.",
  "2. PAYMENT TERMS",
  "The Buyer shall pay undisputed invoices within thirty (30) days of receipt.",
  "Late payment interest shall not exceed the rate prescribed by law.",
  "3. WARRANTY",
  "The Supplier warrants all Goods for a period of ten (10) years.",
].join("\n");

{
  const units = buildBlockUnits(AGREEMENT);
  ok(units.length >= 1, `UNIT-06 文档切成 ${units.length} 个段落块`);
  ok(units.every((u) => u.unitKind === "block"), "UNIT-06 unitKind=block");
  ok(
    units.every((u) => /第 \d+ 段/.test(u.unitLabel)),
    "UNIT-07 每块标签含段序号",
  );
  const joined = units.map((u) => u.contentText).join("\n");
  ok(
    joined.includes("within thirty (30) days of receipt") &&
      joined.includes("ten (10) years"),
    "UNIT-08 关键条款文本无丢失",
  );
  ok(
    looksLikeHeading("2. PAYMENT TERMS") && looksLikeHeading("MASTER AGREEMENT"),
    "UNIT-09 标题启发式识别编号标题与全大写标题",
  );
  ok(!looksLikeHeading("The Buyer shall pay undisputed invoices."), "UNIT-09 正文不被误判为标题");
}

{
  // 超长单段：自成块并按硬上限切
  const long = "X".repeat(MAX_CHARS_PER_UNIT * 2 + 500);
  const units = buildBlockUnits(`前言\n${long}\n结尾`);
  ok(units.length >= 3, `UNIT-10 超长段落被切开（${units.length} 块）`);
  ok(
    units.every((u) => u.contentText.length <= MAX_CHARS_PER_UNIT),
    "UNIT-10 切块不超过字符上限",
  );
}

/* ------------------------------ 边界 ------------------------------ */

ok(buildBlockUnits("").length === 0, "UNIT-11 空文本 → 零单元（不造空单元）");
ok(buildBlockUnits("   \n  \n").length === 0, "UNIT-11 全空白 → 零单元");
ok(buildSheetUnits([]).length === 0, "UNIT-11 无工作表 → 零单元");
ok(buildSheetUnits([{ name: "Empty", csv: "  " }]).length === 0, "UNIT-11 空表被跳过");

{
  const many = Array.from({ length: MAX_UNITS_PER_DOCUMENT + 40 }, (_, i) => ({
    name: `S${i}`,
    csv: `H\nrow ${i}`,
  }));
  const units = buildSheetUnits(many);
  ok(
    units.length === MAX_UNITS_PER_DOCUMENT,
    `UNIT-12 单文档单元数被上限截断（${units.length}）`,
  );
  ok(
    units[units.length - 1]!.unitNumber === MAX_UNITS_PER_DOCUMENT,
    "UNIT-12 截断后序号仍连续",
  );
}

{
  const units = buildBlockUnits("ab");
  ok(units.length === 1 && units[0]!.parseStatus === "empty", "UNIT-13 近空单元标记 empty");
  const s = summarizeUnits(units);
  ok(s.total === 1 && s.usable === 0, "UNIT-13 统计区分 total/usable");
}

/* ------------------------------ 可核验性 ------------------------------ */

{
  // 单元文本里的每一行（除我们加的定位头）都必须能在原文里逐字找到，
  // 否则 V2 的「逐字引文校验」会把这些内容全部拒收。
  const csv = pricingCsv(400);
  const sheetUnits = buildSheetUnits([{ name: "Cat A", csv }]);
  const sheetOk = sheetUnits.every((u) =>
    u.contentText
      .split("\n")
      .filter((l) => !l.startsWith("Sheet:"))
      .every((l) => csv.includes(l)),
  );
  ok(sheetOk, "UNIT-14 表格单元的每行都逐字来自原表（可被证据校验接受）");

  const blockUnits = buildBlockUnits(AGREEMENT);
  const blockOk = blockUnits.every((u) =>
    u.contentText.split("\n").every((l) => AGREEMENT.includes(l)),
  );
  ok(blockOk, "UNIT-14 段落块的每行都逐字来自原文");
}

/* ------------------------------ 真实文件解码（xlsx / csv / txt） ------------------------------ */


async function decodeChecks(): Promise<void> {
  // 真实 xlsx buffer（不是 mock）：两个工作表，其中一个超长
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Item", "Description", "Qty"],
      [1, "Bedroom desk", 120],
      [2, "Study chair", 240],
    ]),
    "Category A",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Question", "Answer"],
      ...Array.from({ length: 400 }, (_, i) => [
        `Q${i + 1}: describe compliance item ${i + 1} in detail`,
        "",
      ]),
    ]),
    "Questionnaire",
  );
  const buf = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

  const xlsxRes = await extractNonPdfUnits(buf, "xlsx");
  ok(!("error" in xlsxRes), "DECODE-01 真实 xlsx 解码成功");
  if (!("error" in xlsxRes)) {
    const units = xlsxRes.units;
    ok(units.length >= 2, `DECODE-01 至少每表一单元（${units.length}）`);
    ok(
      units.some((u) => u.unitLabel === "Sheet「Category A」"),
      "DECODE-02 报价表单元标签用真实工作表名",
    );
    ok(
      units.some((u) => u.contentText.includes("Bedroom desk")),
      "DECODE-02 报价行内容进入单元（数量/描述可被引用）",
    );
    ok(
      units.filter((u) => u.unitLabel.startsWith("Sheet「Questionnaire」")).length > 1,
      "DECODE-03 超长问卷表被切成多个带行区间的单元",
    );
    ok(units.every((u) => u.unitKind === "sheet"), "DECODE-03 xlsx 单元 kind=sheet");
  }

  const csvRes = await extractNonPdfUnits(
    Buffer.from("Item,Qty\nDesk,10\nChair,20", "utf-8"),
    "csv",
  );
  ok(
    !("error" in csvRes) && csvRes.units[0]!.unitKind === "sheet",
    "DECODE-04 csv 走表格单元",
  );

  const txtRes = await extractNonPdfUnits(
    Buffer.from("1. SCOPE\nSupply and install furniture for student housing.", "utf-8"),
    "txt",
  );
  ok(
    !("error" in txtRes) && txtRes.units[0]!.unitKind === "block",
    "DECODE-05 txt 走段落块单元",
  );

  const docRes = await extractNonPdfUnits(Buffer.from("legacy", "utf-8"), "doc");
  ok("error" in docRes, "DECODE-06 旧二进制 .doc 明确不支持（不产出不可核验内容）");

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

void decodeChecks();
