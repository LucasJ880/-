/**
 * Phase G — 按 ANALYSIS_TASK_SPECS 幂等创建人工任务
 * unique([sourceId, sourceTemplateKey])；冲突忽略。
 */

import { db } from "@/lib/db";
import { ANALYSIS_TASK_SPECS } from "./constants";
import { isPrismaUniqueViolation } from "@/lib/bid-workflow/prisma-errors";

export type CreateAnalysisTasksInput = {
  runId: string;
  projectId: string;
  orgId: string;
  createdById?: string | null;
};

export type CreateAnalysisTasksResult = {
  createdCount: number;
  skippedCount: number;
};

export async function createAnalysisTasks(
  input: CreateAnalysisTasksInput,
): Promise<CreateAnalysisTasksResult> {
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: { ownerId: true, orgId: true },
  });
  if (!project) {
    throw new Error(`createAnalysisTasks: project not found ${input.projectId}`);
  }

  const ownerId = project.ownerId;
  const creatorId = input.createdById?.trim() || ownerId;

  let createdCount = 0;
  let skippedCount = 0;

  for (const spec of ANALYSIS_TASK_SPECS) {
    try {
      await db.task.create({
        data: {
          title: spec.title,
          description: spec.description,
          status: "todo",
          priority: spec.priority,
          projectId: input.projectId,
          creatorId,
          assigneeId: ownerId,
          sourceType: "tender_analysis",
          sourceId: input.runId,
          sourceTemplateKey: spec.templateKey,
        },
      });
      createdCount += 1;
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        skippedCount += 1;
        continue;
      }
      throw err;
    }
  }

  return { createdCount, skippedCount };
}
