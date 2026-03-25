/**
 * 青砚 AI 上下文查询层
 *
 * 负责从数据库中加载 AI 对话所需的上下文数据。
 * 分两层：
 *   getWorkContext()        — 每次对话自动注入（轻量）
 *   getProjectDeepContext() — 提到具体项目时按需注入（深度）
 */

import { db } from "@/lib/db";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { formatDateTimeToronto } from "@/lib/time";
import type {
  WorkContext,
  ProjectSummary,
  TaskSummaryItem,
  ProjectDeepContext,
  SupplierSummary,
  InquirySummary,
} from "./prompts";

// ── 第一层：通用工作上下文 ────────────────────────────────────

function toDateStr(d: Date | null | undefined): string | null {
  if (!d) return null;
  return formatDateTimeToronto(d).slice(0, 10);
}

function toProjectSummary(p: {
  id: string;
  name: string;
  clientOrganization: string | null;
  tenderStatus: string | null;
  estimatedValue: number | null;
  currency: string | null;
  closeDate: Date | null;
  priority: string;
  status: string;
  sourceSystem: string | null;
}): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    clientOrganization: p.clientOrganization,
    tenderStatus: p.tenderStatus,
    estimatedValue: p.estimatedValue,
    currency: p.currency,
    closeDate: toDateStr(p.closeDate),
    priority: p.priority,
    status: p.status,
    sourceSystem: p.sourceSystem,
  };
}

const PROJECT_SELECT = {
  id: true,
  name: true,
  clientOrganization: true,
  tenderStatus: true,
  estimatedValue: true,
  currency: true,
  closeDate: true,
  priority: true,
  status: true,
  sourceSystem: true,
} as const;

export async function getWorkContext(userId: string, role: string): Promise<WorkContext> {
  const projectIds = await getVisibleProjectIds(userId, role);

  const projectWhere = projectIds !== null
    ? { id: { in: projectIds }, status: "active" }
    : { status: "active" };

  const taskWhere = projectIds !== null
    ? {
        status: { notIn: ["done", "cancelled"] },
        OR: [
          { projectId: { in: projectIds } },
          { projectId: null, creatorId: userId },
          { assigneeId: userId },
        ],
      }
    : { status: { notIn: ["done", "cancelled"] } };

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const urgentWhere = {
    ...projectWhere,
    closeDate: { gte: now, lte: sevenDaysLater },
    status: "active",
  };

  const [projects, recentTasks, urgentProjects] = await Promise.all([
    db.project.findMany({
      where: projectWhere,
      select: PROJECT_SELECT,
      orderBy: { updatedAt: "desc" },
      take: 15,
    }),
    db.task.findMany({
      where: taskWhere,
      select: {
        title: true,
        priority: true,
        status: true,
        dueDate: true,
        project: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    db.project.findMany({
      where: urgentWhere,
      select: PROJECT_SELECT,
      orderBy: { closeDate: "asc" },
      take: 5,
    }),
  ]);

  return {
    projects: projects.map(toProjectSummary),
    recentTasks: recentTasks.map((t): TaskSummaryItem => ({
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueDate: toDateStr(t.dueDate),
      projectName: t.project?.name ?? null,
    })),
    urgentProjects: urgentProjects.map(toProjectSummary),
  };
}

// ── 第二层：单项目深度上下文 ──────────────────────────────────

export async function getProjectDeepContext(projectId: string): Promise<ProjectDeepContext | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      intelligence: {
        select: {
          recommendation: true,
          riskLevel: true,
          fitScore: true,
          summary: true,
        },
      },
      documents: {
        select: { title: true, fileType: true },
        orderBy: { sortOrder: "asc" },
        take: 10,
      },
      members: {
        where: { status: "active" },
        select: {
          role: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });

  if (!project) return null;

  const [taskStats, recentMessages, suppliers, inquiries] = await Promise.all([
    db.task.groupBy({
      by: ["status"],
      where: { projectId },
      _count: true,
    }),
    db.projectMessage.findMany({
      where: { projectId, deletedAt: null },
      select: {
        body: true,
        type: true,
        createdAt: true,
        sender: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    project.orgId
      ? db.supplier.findMany({
          where: { orgId: project.orgId, status: "active" },
          select: { id: true, name: true, category: true, region: true, contactEmail: true },
          orderBy: { name: "asc" },
          take: 50,
        })
      : Promise.resolve([]),
    db.projectInquiry.findMany({
      where: { projectId },
      select: {
        roundNumber: true,
        status: true,
        items: {
          select: { status: true, isSelected: true, supplier: { select: { name: true } } },
        },
      },
      orderBy: { roundNumber: "asc" },
    }),
  ]);

  const totalTasks = taskStats.reduce((sum, g) => sum + g._count, 0);
  const doneTasks = taskStats.find((g) => g.status === "done")?._count ?? 0;
  const now = new Date();
  const overdueCount = await db.task.count({
    where: {
      projectId,
      status: { notIn: ["done", "cancelled"] },
      dueDate: { lt: now },
    },
  });

  return {
    project: {
      ...toProjectSummary(project),
      description: project.description,
      location: project.location,
      solicitationNumber: project.solicitationNumber,
      publicDate: toDateStr(project.publicDate),
      questionCloseDate: toDateStr(project.questionCloseDate),
      createdAt: formatDateTimeToronto(project.createdAt),
    },
    intelligence: project.intelligence,
    documents: project.documents,
    taskStats: { total: totalTasks, done: doneTasks, overdue: overdueCount },
    recentDiscussion: recentMessages.reverse().map((m) => ({
      sender: m.sender?.name || "系统",
      body: m.body,
      createdAt: formatDateTimeToronto(m.createdAt),
      type: m.type,
    })),
    members: project.members.map((m) => ({
      name: m.user.name || m.user.email,
      role: m.role,
    })),
    suppliers: suppliers.map((s): SupplierSummary => ({
      id: s.id,
      name: s.name,
      category: s.category,
      region: s.region,
      contactEmail: s.contactEmail,
    })),
    inquiries: inquiries.map((iq): InquirySummary => ({
      roundNumber: iq.roundNumber,
      status: iq.status,
      itemCount: iq.items.length,
      quotedCount: iq.items.filter((i) => i.status === "quoted").length,
      selectedSupplier: iq.items.find((i) => i.isSelected)?.supplier.name ?? null,
    })),
  };
}

// ── 项目名匹配 ───────────────────────────────────────────────

export function matchProjectByName(
  userMessage: string,
  projects: ProjectSummary[]
): ProjectSummary | null {
  if (!userMessage || projects.length === 0) return null;

  const msg = userMessage.toLowerCase();

  for (const p of projects) {
    const name = p.name.toLowerCase();
    if (name.length >= 3 && msg.includes(name)) return p;
  }

  for (const p of projects) {
    const words = p.name.split(/[\s\-_/|]+/).filter((w) => w.length >= 2);
    for (const w of words) {
      if (msg.includes(w.toLowerCase())) return p;
    }
  }

  return null;
}
