/**
 * CJK-PDF 包 — 真实 E2E（隔离实库 + 全本地 blob + 真实 Chromium 渲染）
 *
 * 证三件事（对应用户报告的两个症状）：
 * 1. 「全是 html」→ 生成文档现在落库为真 PDF（fileType=pdf，%PDF 魔数）；
 * 2. 「受损打不开」→ PDF 可解析、中文逐字可抽取（unpdf 程序化断言，不靠肉眼）；
 * 3. 降级安全：Chromium 不可用时回落 HTML（现状行为）且显式标注，绝不存坏字节。
 *
 * 用法（仅隔离分支）：
 *   DATABASE_URL=... DIRECT_URL=... DATABASE_ENVIRONMENT=isolated \
 *     PRODUCT_CONTENT_LOCAL_STORE=1 npx tsx scripts/cjk-pdf-e2e.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";
import { generateProjectDocument } from "@/lib/projects/generate/generate-docs";
import { extractText } from "unpdf";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

function assertIsolated(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL 未设置");
  if (/ep-super-field-antfibsl/.test(url)) throw new Error("拒绝在生产库上运行");
  if (process.env.DATABASE_ENVIRONMENT !== "isolated") throw new Error("需 isolated");
  if (process.env.PRODUCT_CONTENT_LOCAL_STORE !== "1") {
    throw new Error("需 PRODUCT_CONTENT_LOCAL_STORE=1（全本地 blob，不碰远端 store）");
  }
}

/** 本地 blob store 的 proxyUrl → 磁盘路径读回字节 */
function readLocalBlob(proxyUrl: string): Buffer {
  const pathname = decodeURIComponent(proxyUrl.replace(/^\/api\/files\//, ""));
  const root =
    process.env.PRODUCT_CONTENT_LOCAL_STORE_DIR ||
    join(process.cwd(), ".data", "product-content-blobs");
  return readFileSync(join(root, pathname));
}

async function main() {
  assertIsolated();
  console.log("CJK-PDF 包 — 真实 E2E");

  const project = await db.project.findFirst({
    where: { workDomain: "tender", orgId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, orgId: true, ownerId: true },
  });
  if (!project) throw new Error("快照上无 tender 项目");
  console.log(`  项目：${project.name.slice(0, 40)}`);

  for (const docType of ["china_supplier_brief", "teammate_tasks"] as const) {
    const row = await generateProjectDocument({
      projectId: project.id,
      orgId: project.orgId,
      userId: project.ownerId,
      docType,
    });
    if (!row || !("blobUrl" in row) || !row.blobUrl) {
      ok(false, `E2E[${docType}]: 生成失败（无 blobUrl）`, row);
      continue;
    }
    const meta = JSON.parse((row as { metaJson?: string }).metaJson ?? "{}");
    const bytes = readLocalBlob(row.blobUrl);
    const isPdf = bytes.subarray(0, 5).toString("latin1").startsWith("%PDF-");
    ok(
      meta.renderMode === "chromium_pdf" && isPdf,
      `E2E[${docType}]-01: 落库为真 PDF（renderMode=${meta.renderMode}，magic=${bytes.subarray(0, 5).toString("latin1")}，${bytes.length} bytes）`,
    );
    const { totalPages, text } = await extractText(new Uint8Array(bytes), {
      mergePages: true,
    });
    const full = Array.isArray(text) ? text.join("") : String(text);
    const hasCjk = /[一-鿿]{2,}/.test(full);
    ok(
      totalPages >= 1 && hasCjk,
      `E2E[${docType}]-02: PDF 可解析且中文完好（${totalPages} 页，含中文=${hasCjk}）`,
    );
    const fileRow = await db.projectDocument.findFirst({
      where: { projectId: project.id, title: (row as { title: string }).title },
      select: { fileType: true },
    });
    ok(
      fileRow?.fileType === "pdf",
      `E2E[${docType}]-03: 项目文件列表登记为 pdf（实得 ${fileRow?.fileType}）`,
    );
  }

  // 降级安全：Chromium 不可用 → 回落 HTML + 显式标注（绝不阻塞、绝不存坏字节）
  const prevPath = process.env.CHROME_EXECUTABLE_PATH;
  process.env.CHROME_EXECUTABLE_PATH = "/nonexistent/chrome-for-fallback-test";
  try {
    const row = await generateProjectDocument({
      projectId: project.id,
      orgId: project.orgId,
      userId: project.ownerId,
      docType: "tech_confirm",
    });
    const meta = JSON.parse((row as { metaJson?: string }).metaJson ?? "{}");
    const bytes = readLocalBlob((row as { blobUrl: string }).blobUrl);
    ok(
      String(meta.renderMode).startsWith("html_fallback:") &&
        bytes.toString("utf8", 0, 15).includes("<!doctype"),
      `E2E[fallback]-04: Chromium 不可用 → 显式降级存 HTML（renderMode=${String(meta.renderMode).slice(0, 40)}…）`,
    );
  } finally {
    if (prevPath === undefined) delete process.env.CHROME_EXECUTABLE_PATH;
    else process.env.CHROME_EXECUTABLE_PATH = prevPath;
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

void main().catch((e) => { console.error(e); process.exit(1); });
