/**
 * Phase E 将填充：生成 18 章中文报告 sections。
 * 本阶段写最小占位 section，便于 UI/下游联调。
 */

import { db } from "@/lib/db";
import { SECTION_KEYS } from "./constants";

export type GenerateReportInput = {
  runId: string;
};

export type GenerateReportResult = {
  sectionCount: number;
  stub: true;
};

/** TODO(Phase E): 真实报告生成 */
export async function generateReportSections(
  input: GenerateReportInput,
): Promise<GenerateReportResult> {
  const existing = await db.tenderAnalysisSection.count({
    where: { runId: input.runId },
  });
  if (existing > 0) {
    return { sectionCount: existing, stub: true };
  }

  // 仅写入首个章节占位，避免空跑无产物
  await db.tenderAnalysisSection.create({
    data: {
      runId: input.runId,
      sectionKey: SECTION_KEYS[0],
      contentZh: "（自动分析草稿占位：结构分析尚未完成，待 Phase E 填充）",
      confidence: "UNKNOWN",
      reviewStatus: "AI_DRAFT",
      structuredJson: { stub: true, phase: "1.1-D" },
    },
  });

  return { sectionCount: 1, stub: true };
}
