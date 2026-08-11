/**
 * 导出生产/隔离库中某个 tender 项目的页级文本 → 本地私有 benchmark fixture
 *
 * 用法：
 *   npx tsx scripts/tender-eval-export-case.ts <projectId> <caseId>
 *
 * 输出（永不提交；fixtures/private/ 已在 .gitignore）：
 *   fixtures/private/tender-eval/<caseId>/pages.json      —— PageInput[]（含 documentId/pageNumber/contentText）
 *   fixtures/private/tender-eval/<caseId>/documents.json  —— 文档清单（title/role/pageCount）
 *   fixtures/private/tender-eval/<caseId>/golden-skeleton.md —— 人工填写黄金答案的模板
 *
 * 只读脚本：仅 SELECT，不写库。repo 为 PUBLIC——真实标书文本一律留在
 * fixtures/private/，benchmark case 文件只允许携带引文级 sourceQuote。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { db } from "@/lib/db";

async function main(): Promise<void> {
  const [projectId, caseId] = process.argv.slice(2);
  if (!projectId || !caseId) {
    console.error("用法: npx tsx scripts/tender-eval-export-case.ts <projectId> <caseId>");
    process.exit(1);
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, workDomain: true },
  });
  if (!project) {
    console.error(`项目不存在: ${projectId}`);
    process.exit(1);
  }

  const documents = await db.projectDocument.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      fileType: true,
      pageCount: true,
      parseStatus: true,
      pages: {
        orderBy: { pageNumber: "asc" },
        select: { pageNumber: true, contentText: true, parseStatus: true },
      },
    },
  });

  const withPages = documents.filter((d) => d.pages.length > 0);
  if (withPages.length === 0) {
    console.error(
      `该项目没有任何已解析页文本（documents=${documents.length}）。先在应用内触发解析（parseDocumentPagesAndStore），或确认文档为 PDF。`,
    );
    process.exit(1);
  }

  const outDir = join(process.cwd(), "fixtures/private/tender-eval", caseId);
  mkdirSync(outDir, { recursive: true });

  const pages = withPages.flatMap((d) =>
    d.pages.map((p) => ({
      documentId: d.id,
      pageNumber: p.pageNumber,
      contentText: p.contentText,
    })),
  );
  writeFileSync(join(outDir, "pages.json"), JSON.stringify(pages, null, 1));
  writeFileSync(
    join(outDir, "documents.json"),
    JSON.stringify(
      withPages.map((d) => ({
        documentId: d.id,
        title: d.title,
        fileType: d.fileType,
        pageCount: d.pageCount,
        parseStatus: d.parseStatus,
      })),
      null,
      2,
    ),
  );
  writeFileSync(
    join(outDir, "golden-skeleton.md"),
    [
      `# Golden Answer Skeleton — ${caseId}`,
      "",
      `项目：${project.name}（workDomain=${project.workDomain ?? "?"}）`,
      `文档：${withPages.map((d) => `${d.title}（${d.pages.length} 页）`).join("、")}`,
      "",
      "逐条人工填写（引文必须逐字来自 pages.json 对应页）：",
      "",
      "## goldenFacts",
      "| field | 期望值（归一化） | doc/page | 原文引文 | critical |",
      "| --- | --- | --- | --- | --- |",
      "| buyer |  |  |  |  |",
      "| tender_number |  |  |  |  |",
      "| closing_datetime |  |  |  |  |",
      "| enquiry_deadline |  |  |  |  |",
      "| site_visit |  |  |  |  |",
      "| quantity |  |  |  |  |",
      "| motorized_or_manual / motor_requirements |  |  |  |  |",
      "| fabric_requirements |  |  |  |  |",
      "| warranty / bond / insurance |  |  |  |  |",
      "| delivery / installation / training |  |  |  |  |",
      "| submittal_requirements / samples / shop_drawing |  |  |  |  |",
      "| pricing_instructions / evaluation_method |  |  |  |  |",
      "| addenda |  |  |  |  |",
      "",
      "## goldenRequirements（每条：text/category/mandatory/page/quote/importance）",
      "",
      "## knownAmbiguities / goldenRisks / goldenClarifications / expectedUnknowns",
      "",
      "填写完成后：在 src/lib/tender-eval/cases/ 新建 case 文件（参照 case-a-rcmp-riso-real.ts），",
      "documentSet 从本目录 pages.json 读取，provenance.kind=REAL，goldenAnswerMethod 按确认状态填写。",
    ].join("\n"),
  );

  console.log(
    `✅ 导出完成：${withPages.length} 份文档 / ${pages.length} 页 → fixtures/private/tender-eval/${caseId}/`,
  );
  console.log("下一步：人工填写 golden-skeleton.md，再新建 case 文件接入 runner。");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("export failed:", err);
    process.exit(1);
  });
