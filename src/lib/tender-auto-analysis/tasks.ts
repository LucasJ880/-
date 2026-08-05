/**
 * Phase E 将填充：按 TASK_TEMPLATE_KEYS 幂等创建人工任务。
 */

export type CreateAnalysisTasksInput = {
  runId: string;
  projectId: string;
  orgId: string;
  createdById?: string | null;
};

export type CreateAnalysisTasksResult = {
  createdCount: number;
  stub: true;
};

/** TODO(Phase E): 真实任务创建 */
export async function createAnalysisTasks(
  _input: CreateAnalysisTasksInput,
): Promise<CreateAnalysisTasksResult> {
  return { createdCount: 0, stub: true };
}
