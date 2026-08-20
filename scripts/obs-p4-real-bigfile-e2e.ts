/**
 * 观察期包4 — 真实大文件 E2E（隔离实库 + 真实 Blob，零模型调用）
 *
 * 提限禁令要求：提限必须隔离库真实大文件 E2E。本 harness 证三件事：
 * 1. 81–400 页真实 PDF 在解析层放行：逐页落库，pageCount/页行数一致；
 * 2. 包分析（legacy 管线）选择层把它排除（单文件 80 页上限不变）；
 * 3. coverage 给出显式排除原因（含真实页数——用户不用问就知道为什么）。
 *
 * 用法（仅隔离分支）：
 *   A. 库内已有可读的超限真实文档（需可用 blob 凭证）：
 *      DATABASE_URL=... DIRECT_URL=... DATABASE_ENVIRONMENT=isolated \
 *        npx tsx scripts/obs-p4-real-bigfile-e2e.ts [documentId]
 *      不传 documentId 自动选：历史因「页数超过上限」解析失败、页数最大的文档。
 *   B. 本地真实大 PDF 走完整上传→解析链（生产私有 store token 本地缺失时用；
 *      配 PRODUCT_CONTENT_LOCAL_STORE=1 全本地 blob，零远端依赖）：
 *      ... PRODUCT_CONTENT_LOCAL_STORE=1 \
 *        npx tsx scripts/obs-p4-real-bigfile-e2e.ts --seed-file=/path/to/real.pdf
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { sha256Content } from "@/lib/tender-auto-analysis/hash";
import {
  parseDocumentPagesAndStore,
  MAX_PDF_PAGES,
  PACKAGE_ANALYSIS_MAX_PDF_PAGES,
} from "@/lib/tender-auto-analysis/page-parse";
import { getTenderPackageDocuments } from "@/lib/tender-auto-analysis/package";
import { getPackageCoverage } from "@/lib/tender-auto-analysis/package-coverage";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

function assertIsolated(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL 未设置");
  if (/ep-super-field-antfibsl/.test(url)) {
    throw new Error("拒绝在生产库上运行（fail-closed）");
  }
  if (process.env.DATABASE_ENVIRONMENT !== "isolated") {
    throw new Error("DATABASE_ENVIRONMENT 必须为 isolated");
  }
}

async function main() {
  assertIsolated();
  console.log(
    `观察期包4 — 真实大文件 E2E（解析上限=${MAX_PDF_PAGES}，包分析上限=${PACKAGE_ANALYSIS_MAX_PDF_PAGES}）`,
  );

  const seedFile = process.argv
    .find((a) => a.startsWith("--seed-file="))
    ?.slice("--seed-file=".length);

  let documentId =
    process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;

  if (seedFile) {
    // 模式 B：真实本地大 PDF 走**产品同一条**上传→落行→解析链。
    // fixture 行建在隔离分支（用完即弃）；文件内容是真实招标文档，非伪造数据。
    const buffer = readFileSync(seedFile);
    const title = basename(seedFile);
    const tag = `obsP4fixture_${randomUUID().slice(0, 8)}`;
    const anyMember = await db.organizationMember.findFirstOrThrow({
      where: { org: { name: "Sunny Home & Deco" } },
      select: { userId: true, orgId: true },
    });
    const uploaded = await putPrivateBlob({
      pathname: `tender-obs-p4/${tag}/${title}`,
      body: buffer,
      contentType: "application/pdf",
    });
    const project = await db.project.create({
      data: {
        name: `${tag} 真实大文件解析验证`,
        orgId: anyMember.orgId,
        ownerId: anyMember.userId,
        workDomain: "tender",
      },
      select: { id: true },
    });
    const created = await db.projectDocument.create({
      data: {
        projectId: project.id,
        title,
        url: uploaded.proxyUrl,
        fileType: "pdf",
        fileSize: buffer.length,
        source: "upload",
        blobUrl: uploaded.proxyUrl,
        contentHash: sha256Content(buffer),
        parseStatus: "pending",
      },
      select: { id: true },
    });
    documentId = created.id;
    console.log(
      `  seed：${title}（${(buffer.length / 1024 / 1024).toFixed(1)}MB）→ ` +
        `project=${project.id} document=${documentId}`,
    );
  }

  if (!documentId) {
    const candidate = await db.projectDocument.findFirst({
      where: {
        fileType: { in: ["pdf", "PDF"] },
        parseStatus: "failed",
        parseError: { contains: "页数超过上限" },
        pageCount: { gt: PACKAGE_ANALYSIS_MAX_PDF_PAGES, lte: MAX_PDF_PAGES },
      },
      orderBy: { pageCount: "desc" },
      select: { id: true },
    });
    if (!candidate) {
      throw new Error(
        "找不到历史超限真实文档（需要一份 81–400 页、曾因页数上限解析失败的 PDF）",
      );
    }
    documentId = candidate.id;
  }

  const doc = await db.projectDocument.findUniqueOrThrow({
    where: { id: documentId },
    select: {
      id: true, title: true, projectId: true, pageCount: true,
      parseStatus: true, parseError: true,
    },
  });
  console.log(
    `  文档：${doc.title}（${doc.pageCount} 页，parseStatus=${doc.parseStatus}，` +
      `原错误=${doc.parseError ?? "-"}）`,
  );
  if (!doc.projectId) throw new Error("文档无 projectId");

  // ── 1. 解析层放行：真实下载 + 逐页落库 ──
  const t0 = Date.now();
  const result = await parseDocumentPagesAndStore(doc.id);
  const parseMs = Date.now() - t0;
  ok(result.ok, `E2E-01: 真实大文件解析成功（${parseMs}ms）`, result);
  if (!result.ok) throw new Error("解析失败，后续判定无意义");

  const after = await db.projectDocument.findUniqueOrThrow({
    where: { id: doc.id },
    select: { pageCount: true, parseStatus: true, _count: { select: { pages: true } } },
  });
  ok(
    after.parseStatus === "done" &&
      typeof after.pageCount === "number" &&
      after.pageCount > PACKAGE_ANALYSIS_MAX_PDF_PAGES,
    `E2E-02: parseStatus=done，pageCount=${after.pageCount} > ${PACKAGE_ANALYSIS_MAX_PDF_PAGES}`,
  );
  ok(
    after._count.pages === after.pageCount,
    `E2E-03: 页级行数 ${after._count.pages} = pageCount ${after.pageCount}（逐页可引用，零截断）`,
  );

  // ── 2. 包分析选择层排除（大文件不进 legacy 管线） ──
  const pkgDocs = await getTenderPackageDocuments(doc.projectId);
  ok(
    !pkgDocs.some((d) => d.documentId === doc.id),
    `E2E-04: 包分析选择层排除该文件（包含 ${pkgDocs.length} 份其它文件不受影响）`,
    pkgDocs.map((d) => `${d.filename}:${d.pageCount}`),
  );

  // ── 3. coverage 显式原因 ──
  const latestRun = await db.tenderAnalysisRun.findFirst({
    where: { projectId: doc.projectId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const coverage = await getPackageCoverage(doc.projectId, latestRun?.id ?? null);
  const detail = coverage.excludedFiles.find((f) => f.filename === doc.title);
  ok(
    !!detail &&
      detail.exclusionReason.includes(`${after.pageCount} 页`) &&
      detail.exclusionReason.includes(`${PACKAGE_ANALYSIS_MAX_PDF_PAGES} 页上限`),
    "E2E-05: coverage 排除原因含真实页数与上限",
    detail?.exclusionReason ?? coverage.excludedFiles,
  );
  ok(
    coverage.excludedReasons.over_page_limit === 1 &&
      !coverage.excludedReasons.parse_failed,
    "E2E-06: 排除归因 over_page_limit（不再是含糊的 parse_failed）",
    coverage.excludedReasons,
  );

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
