import { db } from "@/lib/db";
import { calculateProjectProgress } from "./calculator";
import type { ProjectProgress, ProjectProgressInput } from "./types";
import { startOfWeekToronto } from "@/lib/time";

export async function getProjectProgress(projectId: string): Promise<ProjectProgress> {
  const weekStart = startOfWeekToronto();

  const [project, taskAgg, weekCompleted, moduleCounts] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: { startDate: true, dueDate: true, status: true },
    }),
    db.task.groupBy({
      by: ["status"],
      where: { projectId },
      _count: true,
    }),
    db.task.count({
      where: {
        projectId,
        status: "done",
        updatedAt: { gte: weekStart },
      },
    }),
    Promise.all([
      db.prompt.count({ where: { projectId } }),
      db.knowledgeBase.count({ where: { projectId } }),
      db.agent.count({ where: { projectId } }),
      db.conversation.count({ where: { projectId } }),
      db.evaluationRun.count({ where: { projectId } }),
      db.conversationFeedback.count({ where: { projectId } }),
    ]),
  ]);

  const statusMap: Record<string, number> = {};
  for (const row of taskAgg) {
    statusMap[row.status] = row._count;
  }

  const total = Object.values(statusMap).reduce((s, v) => s + v, 0);
  const done = statusMap["done"] ?? 0;
  const inProgress = statusMap["in_progress"] ?? 0;

  const input: ProjectProgressInput = {
    id: projectId,
    startDate: project?.startDate ?? null,
    dueDate: project?.dueDate ?? null,
    status: project?.status ?? "active",
    taskStats: { total, done, inProgress },
    moduleStats: {
      prompts: moduleCounts[0],
      knowledgeBases: moduleCounts[1],
      agents: moduleCounts[2],
      conversations: moduleCounts[3],
      evaluations: moduleCounts[4],
      feedbacks: moduleCounts[5],
    },
    weekCompletedTasks: weekCompleted,
  };

  return calculateProjectProgress(input);
}

export async function getMultiProjectProgress(
  projectIds: string[]
): Promise<Record<string, ProjectProgress>> {
  const result: Record<string, ProjectProgress> = {};
  const promises = projectIds.map(async (pid) => {
    result[pid] = await getProjectProgress(pid);
  });
  await Promise.all(promises);
  return result;
}
