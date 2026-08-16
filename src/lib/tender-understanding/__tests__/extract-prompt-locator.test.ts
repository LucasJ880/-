/**
 * 抽取 prompt 的定位契约（LOC-01..07）
 * 运行：npx tsx src/lib/tender-understanding/__tests__/extract-prompt-locator.test.ts
 *
 * 背景：生产实测（run cmsvqyzq…）多单元窗口下模型 100% 引错单元号——它把整窗的
 * 候选都归到同一个单元。prompt@4 用「块标记行 + 强制 LOCATION RULE」把归属说死，
 * 同批窗口重跑后引错率 100% → 0%。本套件锁住这些措辞不被无意改回去。
 */

import assert from "node:assert";
import { buildExtractUserPrompt, PROMPT_EXTRACT } from "../prompts";

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

const base = {
  documentId: "d1",
  documentName: "Appendix C - Pricing.xlsx",
  sourceRole: "FORM",
  headings: [] as string[],
};

const pdfPrompt = buildExtractUserPrompt({
  ...base,
  documentName: "RFP.pdf",
  pages: [
    { pageNumber: 3, contentText: "Closing date is 2099-01-01." },
    { pageNumber: 4, contentText: "Warranty is ten (10) years." },
  ],
});

const sheetPrompt = buildExtractUserPrompt({
  ...base,
  pages: [
    {
      pageNumber: 1,
      contentText: "Sheet: Category A\nItem,Qty\n1,120",
      unitKind: "sheet",
      unitLabel: "Sheet「Category A」",
    },
    {
      pageNumber: 2,
      contentText: "Sheet: Category B\nItem,Qty\n2,240",
      unitKind: "sheet",
      unitLabel: "Sheet「Category B」· 行 2–40",
    },
  ],
});

ok(
  PROMPT_EXTRACT.version === "tender-understanding-v2-extract@4",
  "LOC-01 prompt 版本已随定位规则升版（版本进入检查点指纹）",
);

ok(
  pdfPrompt.includes("=== documentId d1 PAGE 3 ===") &&
    pdfPrompt.includes("=== documentId d1 PAGE 4 ==="),
  "LOC-02 PDF 仍用 PAGE 标记（既有行为不变）",
);
// 规则段本身会同时解释 PAGE/UNIT 两种标记形态，因此只断言"正文块"不用 UNIT
ok(
  !pdfPrompt.split("LOCATION RULE")[0]!.includes("UNIT"),
  "LOC-02 PDF 正文块不出现 UNIT 措辞",
);

ok(
  sheetPrompt.includes("=== documentId d1 UNIT 1 (sheet: Sheet「Category A」) ==="),
  "LOC-03 非 PDF 用 UNIT + 真实标签标记",
);
ok(
  sheetPrompt.includes("UNIT 2 (sheet: Sheet「Category B」· 行 2–40)"),
  "LOC-03 行区间标签完整进入标记行",
);
ok(
  !/PAGE \d/.test(sheetPrompt.split("LOCATION RULE")[0]!),
  "LOC-04 表格单元的正文块绝不被称作 PAGE（模型不该以为有页码）",
);

for (const [name, p] of [
  ["PDF", pdfPrompt],
  ["非 PDF", sheetPrompt],
] as const) {
  ok(
    p.includes("LOCATION RULE"),
    `LOC-05 ${name} prompt 含 LOCATION RULE 段`,
  );
  ok(
    p.includes("copied verbatim from ONE single block") ||
      p.includes("Never merge lines from"),
    `LOC-06 ${name} 明确禁止跨块拼接引文`,
  );
  ok(
    p.includes("pageNumber MUST be the <n> of the block"),
    `LOC-07 ${name} 明确 pageNumber 必须取自引文所在块的标记行`,
  );
}

// 回归护栏：块之间必须由标记行分隔，否则模型无从判断边界
{
  // 只数真实标记行（LOCATION RULE 里的示例含占位符 <id>，不计入）
  const blocks = sheetPrompt.split("=== documentId d1 ").length - 1;
  assert.equal(blocks, 2, "两个单元应产生两个标记块");
  ok(true, "LOC-07 单元之间以标记行硬分隔");
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
