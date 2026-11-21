/**
 * BLOCKER 3 — Package 覆盖率（纯汇总）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts
 */

import {
  summarizePackageCoverage,
  toAnalystCoverage,
  withoutParseErrors,
  type CoverageRow,
} from "../package-coverage";
import {
  PARSE_FAILED_NEXT_STEP_HINT,
  exclusionReasonWithParseError,
  fileListParseErrorLine,
  hasParseFailedExclusion,
  parseErrorsByFilename,
  snapshotExclusionText,
} from "../exclusion-text";

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

const row = (over: Partial<CoverageRow>): CoverageRow => ({
  documentId: Math.random().toString(),
  fileType: "pdf",
  parseStatus: "done",
  analyzed: true,
  ...over,
});

console.log("tender-auto-analysis package-coverage");

// 10 上传，7 个已分析，3 个不支持格式 → 禁止谎报「已分析 10」
{
  const rows: CoverageRow[] = [
    ...Array.from({ length: 7 }, () => row({ fileType: "pdf", analyzed: true })),
    ...Array.from({ length: 3 }, () => row({ fileType: "doc", analyzed: false })),
  ];
  const c = summarizePackageCoverage(rows);
  ok(c.uploaded === 10, "uploaded=10");
  ok(c.eligible === 7, "eligible=7");
  ok(c.analyzed === 7, "analyzed=7");
  ok(c.excluded === 3, "excluded=3");
  ok(c.excludedReasons.unsupported_format === 3, "3 个旧 .doc → unsupported_format");
  ok(c.label === "已分析 7 / 10 个文件", "label 真实覆盖：已分析 7/10（非 10）");
  ok(!!c.note && c.note.includes("未纳入"), "note 说明 3 个文件未纳入");
}

// docx / xlsx / csv / txt 现在切成可引用单元后纳入分析（旧 .doc 仍排除）
{
  const rows: CoverageRow[] = [
    row({ fileType: "pdf", analyzed: true }),
    row({ fileType: "docx", analyzed: true }),
    row({ fileType: "xlsx", analyzed: true }),
    row({ fileType: "csv", analyzed: true }),
    row({ fileType: "txt", analyzed: true }),
    row({ fileType: "doc", analyzed: false }),
  ];
  const c = summarizePackageCoverage(rows);
  ok(c.eligible === 5, "docx/xlsx/csv/txt 与 PDF 同为 eligible");
  ok(c.analyzed === 5, "全部纳入分析");
  ok(c.excluded === 1 && c.excludedReasons.unsupported_format === 1, "仅旧 .doc 被排除");
  ok(c.label === "已分析 5 / 6 个文件", "label 反映真实覆盖");
}

// 解析失败计入 parse_failed
{
  const rows: CoverageRow[] = [
    row({ fileType: "pdf", parseStatus: "done", analyzed: true }),
    row({ fileType: "pdf", parseStatus: "failed", analyzed: false }),
  ];
  const c = summarizePackageCoverage(rows);
  ok(c.eligible === 1 && c.excluded === 1, "failed PDF 不计 eligible");
  ok(c.excludedReasons.parse_failed === 1, "parse_failed 计数");
}

// 全部 PDF 且都分析 → 无 note
{
  const rows = Array.from({ length: 5 }, () => row({}));
  const c = summarizePackageCoverage(rows);
  ok(c.label === "已分析 5 / 5 个文件" && c.note === null, "全覆盖无 note");
}

// eligible 但未纳入本次 run（analyzed<eligible）→ note 提示
{
  const rows: CoverageRow[] = [
    row({ analyzed: true }),
    row({ analyzed: false }),
  ];
  const c = summarizePackageCoverage(rows);
  ok(c.analyzed === 1 && c.eligible === 2, "analyzed<eligible");
  ok(!!c.note && c.note.includes("尚未纳入"), "提示未纳入本次分析");
}

// FIX-13：解析失败的文件带出 parseError 原文；其它原因不带
{
  const ERR_E =
    "Invalid `prisma.projectDocumentPage.createMany()` invocation: … PostgresError { code: \"22021\", message: \"invalid byte sequence for encoding \\\"UTF8\\\": 0x00\" }";
  const ERR_F = "Invalid `prisma.projectDocumentPage.createMany()` invocation: … 22021 …";
  const rows: CoverageRow[] = [
    ...Array.from({ length: 4 }, (_, i) =>
      row({ title: `RFP-part-${i + 1}.pdf`, analyzed: true, pageCount: 12 }),
    ),
    row({ title: "2026004-Appendix-B-RFP-e(PDF).pdf", parseStatus: "failed", analyzed: false, parseError: ERR_E }),
    row({ title: "2026004-Appendix-B-RFP-f(PDF).pdf", parseStatus: "failed", analyzed: false, parseError: ERR_F }),
  ];
  const c = summarizePackageCoverage(rows);
  ok(
    c.uploaded === 6 && c.analyzed === 4 && c.excludedFiles.length === 2,
    "上传 6 · 纳入分析 4 · 排除 2",
  );
  const e = c.excludedFiles.find((f) => f.filename.includes("-e("));
  const f = c.excludedFiles.find((f) => f.filename.includes("-f("));
  ok(
    e?.exclusionReason === "文件解析失败" && f?.exclusionReason === "文件解析失败",
    "两个排除明细的排除原因仍是「文件解析失败」（标签不变，原文不拼进去）",
  );
  ok(e?.parseError === ERR_E && f?.parseError === ERR_F, "解析失败原文 = 各自的 parseError，逐字不变");
}

{
  const c = summarizePackageCoverage([
    row({ title: "no-reason.pdf", parseStatus: "failed", analyzed: false, parseError: null }),
    row({ title: "blank-reason.pdf", parseStatus: "failed", analyzed: false, parseError: "   " }),
    row({ title: "undefined-reason.pdf", parseStatus: "failed", analyzed: false }),
  ]);
  ok(
    c.excludedFiles.length === 3 && c.excludedFiles.every((f) => f.parseError === null),
    "解析失败但没有记下原因（空 / 只有空白 / 没取到）：原文为 null",
  );
}

{
  const c = summarizePackageCoverage([
    // 超出页数上限、格式不支持——即使行上残留着旧的 parseError，也不当作解析失败原文带出
    row({ title: "big.pdf", pageCount: 120, analyzed: false, parseError: "上一次的旧报错" }),
    row({ title: "old.doc", fileType: "doc", analyzed: false, parseError: "不支持的文件格式: doc" }),
    row({ title: "ok.pdf", analyzed: true, parseError: "不应出现" }),
  ]);
  const big = c.excludedFiles.find((f) => f.filename === "big.pdf");
  const old = c.excludedFiles.find((f) => f.filename === "old.doc");
  ok(
    c.excludedFiles.length === 2 && big?.parseError === null && old?.parseError === null,
    "超出 80 页上限、格式不支持的文件：解析失败原文为空",
  );
  ok(
    !!big && big.exclusionReason.includes("120 页") && c.excludedReasons.over_page_limit === 1,
    "超出页数上限的排除原因照旧（含真实页数）",
  );
}

// FIX-13：存进综合解读的快照只有既有六项，解析失败原文不进去
{
  const SECRET = "Invalid `prisma…` invocation in /var/task/.next/server/chunks/1234.js:1:2 … 22021";
  const c = summarizePackageCoverage([
    row({ title: "a.pdf", analyzed: true }),
    row({ title: "b.pdf", parseStatus: "failed", analyzed: false, parseError: SECRET, contentHashReady: true, pageCount: 3 }),
  ]);
  const snap = toAnalystCoverage(c);
  ok(
    snap.uploaded === 2 && snap.eligible === 1 && snap.analyzed === 1 && snap.excluded.length === 1,
    "快照的计数与覆盖清单一致",
  );
  ok(
    Object.keys(snap.excluded[0]!).sort().join() ===
      "contentHashReady,exclusionReason,fileType,filename,pageCount,parseStatus",
    "快照里被排除的文件只有六项：文件名、类型、解析状态、内容指纹就绪、页数、排除原因",
  );
  ok(
    snap.excluded[0]!.filename === "b.pdf" && snap.excluded[0]!.exclusionReason === "文件解析失败" &&
      snap.excluded[0]!.parseStatus === "failed" && snap.excluded[0]!.contentHashReady === true && snap.excluded[0]!.pageCount === 3,
    "六项的值与覆盖清单相同",
  );
  ok(!JSON.stringify(snap).includes("22021") && !JSON.stringify(snap).includes("/var/task"), "快照序列化后不含解析失败原文");
  ok(c.excludedFiles[0]!.parseError === SECRET, "现算的覆盖清单仍带原文（给界面用）");
}

// FIX-13：界面上「未纳入：」后面那段文字
{
  const ERR = "Invalid `prisma.projectDocumentPage.createMany()` invocation: … 22021 …";
  const c = summarizePackageCoverage([
    row({ title: "B-e.pdf", parseStatus: "failed", analyzed: false, parseError: ERR }),
    row({ title: "B-f.pdf", parseStatus: "failed", analyzed: false, parseError: null }),
    row({ title: "big.pdf", pageCount: 120, analyzed: false }),
    row({ title: "old.doc", fileType: "doc", analyzed: false }),
  ]);
  const line = (name: string) => {
    const f = c.excludedFiles.find((x) => x.filename === name)!;
    return `${f.filename} · 未纳入：${exclusionReasonWithParseError(f.exclusionReason, f.parseError)}`;
  };
  ok(line("B-e.pdf") === `B-e.pdf · 未纳入：文件解析失败（原因：${ERR}）`, "面板明细：解析失败的文件写「未纳入：文件解析失败（原因：〈parseError 原文〉）」");
  ok(line("B-f.pdf") === "B-f.pdf · 未纳入：文件解析失败（原因：系统未记录原因）", "面板明细：没有记录原因时写「（原因：系统未记录原因）」");
  ok(
    line("big.pdf") === `big.pdf · 未纳入：${c.excludedFiles.find((x) => x.filename === "big.pdf")!.exclusionReason}` &&
      !line("big.pdf").includes("原因：") && !line("old.doc").includes("原因："),
    "面板明细：超出页数上限、格式不支持的文件照旧，不加「（原因：…）」",
  );

  // 「排除 K（原因）」展开列表：条目来自快照（不存原文），原文按文件名取当前的记录
  const current = parseErrorsByFilename(c.excludedFiles);
  ok(
    Object.keys(current).sort().join() === "B-e.pdf,B-f.pdf" && current["B-e.pdf"] === ERR && current["B-f.pdf"] === null,
    "对照表只收当前因解析失败被排除的文件",
  );
  const snap = toAnalystCoverage(c).excluded;
  const text = (name: string, map: Record<string, string | null> | undefined) => {
    const f = snap.find((x) => x.filename === name)!;
    return snapshotExclusionText(f.exclusionReason, f.filename, map);
  };
  ok(text("B-e.pdf", current) === `文件解析失败（原因：${ERR}）`, "展开列表：解析失败的文件按同样的写法带原文，原文取当前的记录");
  ok(text("B-f.pdf", current) === "文件解析失败（原因：系统未记录原因）", "展开列表：当前没有记录原因 → 系统未记录原因");
  ok(text("big.pdf", current) === snap.find((x) => x.filename === "big.pdf")!.exclusionReason, "展开列表：其它原因照旧");
  ok(text("B-e.pdf", {}) === "文件解析失败（上次分析时的记录，文件状态之后已变，重新分析后更新）", "展开列表：快照里解析失败、现在已经不在解析失败之列（重新处理成功了）→ 注明这是上次分析时的记录，不带原因");
  ok(text("big.pdf", {}) === snap.find((x) => x.filename === "big.pdf")!.exclusionReason, "展开列表：其它原因的记录不加这句说明");
  ok(text("B-e.pdf", undefined) === "文件解析失败", "展开列表：拿不到当前清单时只显示标签");
  ok(snapshotExclusionText("文件解析失败", "constructor", current) === "文件解析失败（上次分析时的记录，文件状态之后已变，重新分析后更新）", "对照表按自有属性取值：文件名叫 constructor 也不会取到原型上的东西");
  const odd = parseErrorsByFilename([
    { filename: "__proto__", exclusionReason: "文件解析失败", parseError: "proto 的原因" },
    { filename: "dup.pdf", exclusionReason: "文件解析失败", parseError: "第一个" },
    { filename: "dup.pdf", exclusionReason: "文件解析失败", parseError: "第二个" },
  ]);
  ok(snapshotExclusionText("文件解析失败", "__proto__", odd) === "文件解析失败（原因：proto 的原因）", "文件名叫 __proto__ 也照常取到自己的原因");
  ok(snapshotExclusionText("文件解析失败", "dup.pdf", odd) === "文件解析失败（原因：第二个）", "两个同名的失败文件：共用后一个的原因（快照里没有文件 id，只能按文件名对）");

  // 面板清单下面那句「下一步怎么办」：只在有解析失败的文件时出现
  ok(hasParseFailedExclusion(c.excludedFiles) && PARSE_FAILED_NEXT_STEP_HINT === "解析失败的文件 AI 没有读到。请到右上角「项目文件」里重新处理，再回到这里重新分析；仍然失败请把上面的原因发给管理员。" && PARSE_FAILED_NEXT_STEP_HINT.includes("「项目文件」") && PARSE_FAILED_NEXT_STEP_HINT.includes("重新处理") && PARSE_FAILED_NEXT_STEP_HINT.includes("重新分析"), "面板：有解析失败的文件时给出下一步（去「项目文件」重新处理，再重新分析）");
  ok(!hasParseFailedExclusion(c.excludedFiles.filter((f) => f.exclusionReason !== "文件解析失败")) && !hasParseFailedExclusion([]), "面板：只有其它原因的排除（或没有排除）时不出现这句话");
}

// FIX-13：项目文件列表里失败文件行下方的那一行
{
  const LONG = `Invalid \`db.projectDocument.update()\` invocation in\n/var/task/x.js:1:2\n${"e".repeat(260)}`;
  ok(fileListParseErrorLine("failed", LONG) === `原因：${LONG}` && fileListParseErrorLine("failed", LONG)!.length === LONG.length + 3, "文件列表：解析失败的文件显示「原因：」加原因全文（300 字不截断，换行保留）");
  ok(fileListParseErrorLine("failed", `  ${LONG}\n`) === `原因：${LONG}`, "文件列表：原因首尾的空白去掉");
  ok(fileListParseErrorLine("failed", null) === "原因：系统未记录原因" && fileListParseErrorLine("failed", "   ") === "原因：系统未记录原因" && fileListParseErrorLine("failed", undefined) === "原因：系统未记录原因", "文件列表：没有记录原因时写「原因：系统未记录原因」（与分析面板一致）");
  ok(fileListParseErrorLine("done", "旧的原因") === null && fileListParseErrorLine("parsing", "旧的原因") === null && fileListParseErrorLine("pending", null) === null && fileListParseErrorLine(null, "x") === null, "文件列表：不是解析失败状态的文件不显示这一行（即使还留着旧原因）");
}

// FIX-13：投标简报、工作台汇总用的覆盖清单不带原文
{
  const c = summarizePackageCoverage([
    row({ title: "a.pdf", analyzed: true }),
    row({ title: "b.pdf", parseStatus: "failed", analyzed: false, parseError: "22021 /var/task" }),
    row({ title: "big.pdf", pageCount: 120, analyzed: false }),
  ]);
  const w = withoutParseErrors(c);
  ok(w.excludedFiles.length === 2 && w.excludedFiles.every((f) => f.parseError === null) && !JSON.stringify(w).includes("22021"), "去掉原文的覆盖清单：每个被排除文件的解析失败原文都为空");
  ok(w.uploaded === c.uploaded && w.analyzed === c.analyzed && w.excluded === c.excluded && w.label === c.label && w.note === c.note && w.excludedFiles[0]!.exclusionReason === "文件解析失败", "去掉原文的覆盖清单：计数、说明与排除原因的标签不变");
  ok(c.excludedFiles[0]!.parseError === "22021 /var/task", "原来那份清单不被改动");
}

// 空项目
{
  const c = summarizePackageCoverage([]);
  ok(c.uploaded === 0 && c.label === "已分析 0 / 0 个文件", "空项目安全");
}

console.log(`\npackage-coverage: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
