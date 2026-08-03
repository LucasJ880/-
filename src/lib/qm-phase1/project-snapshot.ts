/**
 * 项目授权范围内的真实快照（非占位）
 * 仅读取 orgId+projectId 匹配的任务/文件/进度/记录。
 */

import type { PrismaClient } from "@prisma/client";

export type ProjectBriefSnapshot = {
  projectId: string;
  orgId: string;
  projectName: string;
  localDate: string;
  timezone: string;
  openTasks: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  overdueTasks: Array<{ id: string; title: string; dueDate: string | null }>;
  recentFiles: Array<{ id: string; name: string; createdAt: string }>;
  recentRecords: Array<{ id: string; kind: string; summary: string; createdAt: string }>;
  progressNotes: string[];
};

/** 项目未建模独立时区时，使用自动化默认时区 */
export const PROJECT_BRIEF_DEFAULT_TZ = "America/Toronto";

export function localDateInTz(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export async function loadProjectBriefSnapshot(input: {
  db: Pick<PrismaClient, "project" | "task" | "projectDocument" | "projectProgressSummary">;
  orgId: string;
  projectId: string;
  timezone?: string;
  now?: Date;
}): Promise<
  | { ok: true; snapshot: ProjectBriefSnapshot }
  | { ok: false; code: "PROJECT_NOT_FOUND" | "ORG_MISMATCH"; message: string }
> {
  const now = input.now ?? new Date();
  const project = await input.db.project.findFirst({
    where: { id: input.projectId },
    select: {
      id: true,
      name: true,
      orgId: true,
      ownerId: true,
    },
  });
  if (!project) {
    return { ok: false, code: "PROJECT_NOT_FOUND", message: "project not found" };
  }
  if (!project.orgId || project.orgId !== input.orgId) {
    return {
      ok: false,
      code: "ORG_MISMATCH",
      message: "project does not belong to org",
    };
  }

  const timezone = input.timezone?.trim() || PROJECT_BRIEF_DEFAULT_TZ;
  const localDate = localDateInTz(now, timezone);

  const tasks = await input.db.task.findMany({
    where: {
      projectId: project.id,
      status: { notIn: ["done", "cancelled"] },
    },
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
    },
    take: 40,
    orderBy: { updatedAt: "desc" },
  });

  const openTasks = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
  }));
  const overdueTasks = tasks
    .filter((t) => t.dueDate && t.dueDate.getTime() < now.getTime())
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    }));

  const files = await input.db.projectDocument.findMany({
    where: { projectId: project.id },
    select: { id: true, title: true, createdAt: true },
    take: 15,
    orderBy: { createdAt: "desc" },
  });
  const recentFiles = files.map((f) => ({
    id: f.id,
    name: f.title,
    createdAt: f.createdAt.toISOString(),
  }));

  const summaries = await input.db.projectProgressSummary.findMany({
    where: { projectId: project.id },
    select: {
      id: true,
      statusLabel: true,
      executiveSummary: true,
      overallStatus: true,
      createdAt: true,
    },
    take: 5,
    orderBy: { createdAt: "desc" },
  });

  const recentRecords = summaries.map((s) => ({
    id: s.id,
    kind: "project_progress_summary",
    summary: (s.executiveSummary || s.statusLabel || s.overallStatus || "").slice(
      0,
      200,
    ),
    createdAt: s.createdAt.toISOString(),
  }));
  const progressNotes = summaries
    .map((s) => (s.executiveSummary || s.statusLabel || "").trim())
    .filter(Boolean)
    .slice(0, 5);

  return {
    ok: true,
    snapshot: {
      projectId: project.id,
      orgId: project.orgId,
      projectName: project.name,
      localDate,
      timezone,
      openTasks,
      overdueTasks,
      recentFiles,
      recentRecords,
      progressNotes,
    },
  };
}

export function renderBriefMarkdown(snapshot: ProjectBriefSnapshot): string {
  const lines = [
    `# 项目每日简报 — ${snapshot.projectName}`,
    ``,
    `- 日期：${snapshot.localDate}（${snapshot.timezone}）`,
    `- 项目：${snapshot.projectName}`,
    `- 组织：${snapshot.orgId}`,
    `- 未完成任务：${snapshot.openTasks.length}`,
    `- 逾期任务：${snapshot.overdueTasks.length}`,
    `- 近期文件：${snapshot.recentFiles.length}`,
    ``,
    `## 逾期任务`,
  ];
  if (snapshot.overdueTasks.length === 0) {
    lines.push(`- （无）`);
  } else {
    for (const t of snapshot.overdueTasks.slice(0, 10)) {
      lines.push(
        `- ${t.title}${t.dueDate ? `（截止 ${t.dueDate.slice(0, 10)}）` : ""}`,
      );
    }
  }
  lines.push(``, `## 未完成任务（节选）`);
  if (snapshot.openTasks.length === 0) {
    lines.push(`- （无）`);
  } else {
    for (const t of snapshot.openTasks.slice(0, 15)) {
      lines.push(`- [${t.status}] ${t.title}`);
    }
  }
  lines.push(``, `## 近期文件`);
  if (snapshot.recentFiles.length === 0) {
    lines.push(`- （无）`);
  } else {
    for (const f of snapshot.recentFiles.slice(0, 10)) {
      lines.push(`- ${f.name}`);
    }
  }
  lines.push(``, `## 进度记录`);
  if (snapshot.progressNotes.length === 0) {
    lines.push(`- （无）`);
  } else {
    for (const n of snapshot.progressNotes) {
      lines.push(`- ${n.slice(0, 160)}`);
    }
  }
  lines.push(
    ``,
    `---`,
    `本简报由青砚 QM Phase1 服务主体生成，仅建议、不自动执行外部副作用。`,
  );
  return lines.join("\n");
}
