/**
 * Tender Understanding V2 — Shadow / Evaluation Mode 入口
 *
 * 用法：
 *   TENDER_ANALYSIS_V2_ENABLED=1 npx tsx scripts/tender-v2-shadow-run.ts <projectId>
 *
 * 行为：
 * - Feature flag 门控（TENDER_ANALYSIS_V2_ENABLED；production default = OFF）；
 * - 只读加载该 project 的文档页文本（严格 project-scoped；不跨 org / project）；
 * - 运行 V2 analyzer（真实 LLM，Unified Model Runtime）；
 * - 结果写 artifacts/tender-v2-shadow/<projectId>-<ts>.json —— 不写库、
 *   不替代 V1 canonical 结果、不触碰任何业务 Gate（approve/lock 语义零变更）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { db } from "@/lib/db";
import { analyzeTender } from "@/lib/tender-understanding/analyzer";
import type {
  AnalyzerDocument,
  DocumentSourceRole,
} from "@/lib/tender-understanding/contract";
import { isTenderAnalysisV2Enabled } from "@/lib/tender-understanding/flag";

const RUN_ROLE_MAP: Record<string, DocumentSourceRole> = {
  PRIMARY: "BASE_TENDER",
  ATTACHMENT: "SPECIFICATION",
  ADDENDUM: "ADDENDUM",
};

async function main(): Promise<void> {
  if (!isTenderAnalysisV2Enabled()) {
    console.error(
      "TENDER_ANALYSIS_V2_ENABLED 未开启（production default = OFF）。Shadow 模式需显式设置 TENDER_ANALYSIS_V2_ENABLED=1。",
    );
    process.exit(1);
  }
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("用法: TENDER_ANALYSIS_V2_ENABLED=1 npx tsx scripts/tender-v2-shadow-run.ts <projectId>");
    process.exit(1);
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) {
    console.error(`项目不存在: ${projectId}`);
    process.exit(1);
  }

  // 最近一次 V1 run 的文档角色（只读参考；无则默认 BASE_TENDER）
  const latestRun = await db.tenderAnalysisRun.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { documents: { select: { documentId: true, role: true } } },
  });
  const roleByDoc = new Map(
    (latestRun?.documents ?? []).map((d) => [
      d.documentId,
      RUN_ROLE_MAP[d.role] ?? "BASE_TENDER",
    ]),
  );

  const docs = await db.projectDocument.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      fileType: true,
      contentHash: true,
      pages: {
        orderBy: { pageNumber: "asc" },
        select: { pageNumber: true, contentText: true },
      },
    },
  });
  const documents: AnalyzerDocument[] = docs
    .filter((d) => d.pages.length > 0)
    .map((d) => ({
      documentId: d.id,
      name: d.title,
      type: d.fileType,
      sourceRole: roleByDoc.get(d.id) ?? "BASE_TENDER",
      pages: d.pages,
      contentHash: d.contentHash,
    }));
  if (documents.length === 0) {
    console.error("该项目没有已解析页文本的文档；先完成页解析再运行 shadow 分析。");
    process.exit(1);
  }

  console.log(
    `▶ V2 shadow 分析：${project.name}（${documents.length} 份文档 / ${documents.reduce((a, d) => a + d.pages.length, 0)} 页）`,
  );
  const { result } = await analyzeTender({ projectId, documents });

  const outDir = join(process.cwd(), "artifacts/tender-v2-shadow");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(outDir, `${projectId}-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(
    `✅ V2 shadow 结果（不落库、不替代 V1 canonical）：${outPath}`,
  );
  console.log(
    `   requirements=${result.requirements.length}（mandatory ${result.mandatoryRequirementIds.length}）｜unknown 槽位=${result.unknowns.length}｜risks=${result.risks.length}｜clarifications=${result.clarifications.length}｜LLM calls=${result.metadata.llmCalls}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("shadow run failed:", err);
    process.exit(1);
  });
