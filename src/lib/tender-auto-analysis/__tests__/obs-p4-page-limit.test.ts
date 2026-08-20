/**
 * 观察期包4 — 单文件页数上限 80 → 400（纯平面，零 DB / 零真实模型）
 *
 * 口径（2026-08-17 用户拍板）：
 * - 解析层 MAX_PDF_PAGES = 400：81–400 页文件解析落库，由 Workforce 页级窗口纳入
 * - 包分析（legacy 管线）单文件守 80（PACKAGE_ANALYSIS_MAX_PDF_PAGES）：
 *   EXTRACT_FACTS 300s 无 checkpoint + contentText 200k 截断，大文件不进
 * - workforce t2 新增整包 400 页 fail-closed 门（与 auto 路径同口径）
 * - 绝不静默截断；排除必须显式给原因（含真实页数）
 *
 * OBS-P4-VAL-*   常量口径
 * OBS-P4-COV-*   coverage 显式排除原因（纯函数）
 * OBS-P4-SEL-*   选择层跳过 + worker 兜底（源码探针）
 * OBS-P4-T2-*    workforce t2 整包门（源码探针）
 * 反例守卫：任何一层都不许出现「静默截断」形状。
 *
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/obs-p4-page-limit.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_PDF_PAGES,
  PACKAGE_ANALYSIS_MAX_PDF_PAGES,
} from "../page-parse";
import { MAX_TENDER_PACKAGE_PAGES } from "../package";
import { summarizePackageCoverage } from "../package-coverage";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
/** 只看代码（源码级断言不把设计说明当证据） */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

console.log("观察期包4 — 单文件页数上限 80 → 400");

// ── 常量口径 ─────────────────────────────────────────────
ok(MAX_PDF_PAGES === 400, "OBS-P4-VAL-01: 解析层上限 = 400");
ok(
  PACKAGE_ANALYSIS_MAX_PDF_PAGES === 80,
  "OBS-P4-VAL-02: 包分析（legacy）单文件上限 = 80 不变",
);
ok(
  MAX_PDF_PAGES <= MAX_TENDER_PACKAGE_PAGES,
  "OBS-P4-VAL-03: 解析上限 ≤ 整包上限（单文件极限恰好装满一个包）",
);

// ── coverage 显式排除原因（纯函数） ──────────────────────
const baseRow = {
  fileType: "pdf",
  parseStatus: "done",
  source: "upload",
  contentHashReady: true,
  analyzed: false,
};
{
  const cov = summarizePackageCoverage([
    { ...baseRow, documentId: "d1", title: "Doc4.pdf", pageCount: 216 },
    { ...baseRow, documentId: "d2", title: "Main.pdf", pageCount: 80, analyzed: true },
  ]);
  ok(
    cov.eligible === 1 && cov.excluded === 1 && cov.excludedReasons.over_page_limit === 1,
    "OBS-P4-COV-01: 216 页文件被归入 over_page_limit，80 页文件不受影响",
    cov,
  );
  const detail = cov.excludedFiles.find((f) => f.filename === "Doc4.pdf");
  ok(
    !!detail &&
      detail.exclusionReason.includes("216 页") &&
      detail.exclusionReason.includes(`${PACKAGE_ANALYSIS_MAX_PDF_PAGES} 页上限`),
    "OBS-P4-COV-02: 排除原因含真实页数与上限（用户不用问就知道为什么）",
    detail?.exclusionReason,
  );
}
{
  const cov = summarizePackageCoverage([
    { ...baseRow, documentId: "d3", title: "Broken.pdf", parseStatus: "failed", pageCount: 500 },
  ]);
  ok(
    cov.excludedReasons.parse_failed === 1 && !cov.excludedReasons.over_page_limit,
    "OBS-P4-COV-03: parse_failed 优先于 over_page_limit（真解析失败不被页数文案掩盖）",
  );
}
{
  const cov = summarizePackageCoverage([
    { ...baseRow, documentId: "d4", title: "Pending.pdf", parseStatus: "pending", pageCount: null },
  ]);
  ok(
    cov.eligible === 1 && cov.excluded === 0,
    "OBS-P4-COV-04: pageCount 未知（尚未解析）不预判排除",
  );
}

// ── 选择层 + worker 兜底（源码探针） ─────────────────────
const pkgCode = code("src/lib/tender-auto-analysis/package.ts");
const workerCode = code("src/lib/tender-auto-analysis/worker.ts");
const parseCode = code("src/lib/tender-auto-analysis/page-parse.ts");
const toolsCode = code("src/lib/tender-workforce/tools.ts");

ok(
  /row\.pageCount > PACKAGE_ANALYSIS_MAX_PDF_PAGES/.test(pkgCode),
  "OBS-P4-SEL-01: 入队选择层按包分析上限跳过超限文件",
);
ok(
  workerCode.includes("PAGE_LIMIT_EXCEEDED") &&
    /pageCount > PACKAGE_ANALYSIS_MAX_PDF_PAGES/.test(workerCode),
  "OBS-P4-SEL-02: worker 兜底守卫显式失败（入队时页数未知/force 的情况）",
);
ok(
  /totalPages > MAX_PDF_PAGES/.test(parseCode) &&
    parseCode.includes("页数超过上限"),
  "OBS-P4-SEL-03: 解析层 400 页护栏仍显式强制（超页明确报错文案）",
);
// 反例守卫：解析层绝不静默截断（不出现「只取前 N 页」的形状）
ok(
  !/pages\.slice\(\s*0\s*,\s*MAX_PDF_PAGES/.test(parseCode) &&
    !/pageTexts\.slice\(\s*0\s*,\s*MAX_PDF_PAGES/.test(parseCode),
  "OBS-P4-SEL-03b（反例守卫）: 解析层不存在静默截断到上限的写法",
);

// ── workforce t2 整包门（源码探针） ──────────────────────
ok(
  toolsCode.includes("PACKAGE_TOO_LARGE") &&
    /totalParsedPages > MAX_TENDER_PACKAGE_PAGES/.test(toolsCode),
  "OBS-P4-T2-01: t2 整包 400 页 fail-closed 门（与 auto 路径同口径）",
);
// 反例守卫：t2 绝不悄悄丢文档凑上限
ok(
  !/parsed\.slice\(\s*0/.test(toolsCode) &&
    !/parsed\s*=\s*parsed\.filter/.test(toolsCode),
  "OBS-P4-T2-01b（反例守卫）: t2 不存在静默丢弃已解析文档的写法",
);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
