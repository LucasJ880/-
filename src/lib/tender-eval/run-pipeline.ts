/**
 * 驱动真实生产管线（Phase E/F/G 纯函数面）产出 SystemOutput。
 *
 * 生产等价性说明（与 worker.ts 的 DB 步骤逐一对应）：
 * - EXTRACT_FACTS        → extract.ts 调 extractFactsFromPages（同函数）
 * - EXTRACT_REQUIREMENTS → extract.ts 调 extractRequirementsFromPages（同函数）
 * - BUILD_CLARIFICATIONS → clarifications.ts 调 buildClarificationCandidates（同函数）
 * - GENERATE_SECTIONS    → report.ts buildSectionsFromFacts；此处经由导出的
 *   buildReportDraftForFacts（同一实现），requirementLines 按 report.ts:355 的
 *   生产格式拼装。
 * 评估绝不修改、不复刻生产算法；LLM 开关（TENDER_ANALYSIS_LLM）保持关闭 =
 * 生产默认路径。
 */

import { buildClarificationCandidates } from "@/lib/tender-auto-analysis/clarifications";
import { extractFactsFromPages } from "@/lib/tender-auto-analysis/extract/facts";
import { extractRequirementsFromPages } from "@/lib/tender-auto-analysis/extract/requirements";
import type { PageInput } from "@/lib/tender-auto-analysis/extract/types";
import { buildReportDraftForFacts } from "@/lib/tender-auto-analysis/report";

import type { TenderEvalCase } from "./contract";
import type { SystemOutput } from "./evaluate";

export type PipelineRun = SystemOutput & {
  reportSections: ReturnType<typeof buildReportDraftForFacts>;
  pageCount: number;
};

export function runDeterministicPipeline(evalCase: TenderEvalCase): PipelineRun {
  const pages: PageInput[] = evalCase.documentSet.flatMap((d) => d.pages);
  const allText = pages.map((p) => p.contentText).join("\n");

  const facts = extractFactsFromPages(pages);
  const requirements = extractRequirementsFromPages(pages);
  const clarifications = buildClarificationCandidates(pages, allText);

  const factRows = facts.map((f) => ({
    statementKind: f.statementKind,
    contentZh: f.contentZh,
    contentOriginal: f.contentOriginal,
    confidence: f.confidence,
  }));
  // report.ts:355 的生产 requirementLines 格式
  const requirementLines = requirements.map(
    (r) =>
      `${r.requirementCode}｜${r.chineseTranslation}｜原文: ${r.originalRequirement.slice(0, 160)}｜合规: ${r.complianceStatus}`,
  );
  const reportSections = buildReportDraftForFacts(factRows, requirementLines);

  // 风险语料 = 用户可见 RISKS 章节逐行 + 判断类事实（AI_INFERENCE / 解释性歧义条目）
  const riskLines = [
    ...reportSections.RISKS.contentZh.split("\n"),
    ...facts
      .filter(
        (f) =>
          f.statementKind === "AI_INFERENCE" ||
          f.factKey === "qty_ambiguity_interpretation",
      )
      .map((f) => f.contentZh),
  ];

  return {
    facts,
    requirements,
    clarifications,
    riskLines,
    reportSections,
    pageCount: pages.length,
  };
}
