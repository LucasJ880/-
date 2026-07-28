/**
 * 执行项目列表查询（强制 workDomain=delivery）
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PROJECT_WORK_DOMAIN } from "@/lib/projects/work-domain";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { startOfDayToronto } from "@/lib/time";
import {
  canViewAllDeliveryProjects,
  type OpsAccessContext,
} from "./access";
import {
  computeDeliveryHealth,
  deliveryHealthLabel,
  deliveryHealthSortRank,
  type DeliveryHealthStatus,
} from "./health";
import { suggestDeliveryNextStep } from "./next-step";
import {
  deliveryStageLabel,
  normalizeDeliveryStage,
  type DeliveryStage,
} from "./stage";
import type {
  DeliveryProjectDetail,
  DeliveryProjectListItem,
} from "./types";

export const DELIVERY_PAGE_SIZE_MAX = 50;
export const DELIVERY_PAGE_SIZE_DEFAULT = 20;

export type DeliveryListFilters = {
  search?: string | null;
  stage?: string | null;
  ownerId?: string | null;
  health?: string | null;
  /** overdue | upcoming | none */
  due?: string | null;
  view: "mine" | "team";
  page?: number;
  pageSize?: number;
};

export function clampDeliveryPageSize(raw: number | undefined): number {
  if (!raw || !Number.isFinite(raw)) return DELIVERY_PAGE_SIZE_DEFAULT;
  return Math.min(Math.max(1, Math.floor(raw)), DELIVERY_PAGE_SIZE_MAX);
}

function buildVisibilityWhere(
  ctx: OpsAccessContext,
  orgId: string,
  view: "mine" | "team",
): Prisma.ProjectWhereInput {
  const base: Prisma.ProjectWhereInput = {
    orgId,
    workDomain: PROJECT_WORK_DOMAIN.DELIVERY,
  };

  if (view === "team" && canViewAllDeliveryProjects(ctx)) {
    return base;
  }

  const userId = ctx.userId;
  if (!userId) {
    return { ...base, id: "__none__" };
  }

  return {
    AND: [
      base,
      {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: { userId, status: "active" },
            },
          },
        ],
      },
    ],
  };
}

export async function listDeliveryProjects(input: {
  orgId: string;
  ctx: OpsAccessContext;
  filters: DeliveryListFilters;
}): Promise<{
  items: DeliveryProjectListItem[];
  total: number;
  page: number;
  pageSize: number;
  sections: {
    needsAttention: number;
    active: number;
    onHold: number;
    recentlyCompleted: number;
  };
}> {
  const page = Math.max(1, input.filters.page ?? 1);
  const pageSize = clampDeliveryPageSize(input.filters.pageSize);
  const now = new Date();
  const today = startOfDayToronto(now);

  const whereParts: Prisma.ProjectWhereInput[] = [
    buildVisibilityWhere(input.ctx, input.orgId, input.filters.view),
  ];

  const stage = normalizeDeliveryStage(input.filters.stage);
  if (stage) whereParts.push({ deliveryStage: stage });

  if (input.filters.ownerId) {
    whereParts.push({ ownerId: input.filters.ownerId });
  }

  const q = input.filters.search?.trim();
  if (q) {
    whereParts.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { clientOrganization: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (input.filters.due === "overdue") {
    whereParts.push({
      plannedCompletionDate: { lt: today },
      deliveryStage: { notIn: ["completed", "cancelled"] },
    });
  } else if (input.filters.due === "upcoming") {
    whereParts.push({
      plannedCompletionDate: { gte: today },
      deliveryStage: { notIn: ["completed", "cancelled"] },
    });
  } else if (input.filters.due === "none") {
    whereParts.push({ plannedCompletionDate: null });
  }

  const where: Prisma.ProjectWhereInput = { AND: whereParts };

  const rows = await db.project.findMany({
    where,
    select: {
      id: true,
      name: true,
      clientOrganization: true,
      ownerId: true,
      deliveryStage: true,
      plannedCompletionDate: true,
      actualCompletionDate: true,
      updatedAt: true,
      owner: { select: { id: true, name: true } },
      tasks: {
        where: { status: { in: [...OPEN_TASK_STATUSES] } },
        select: {
          status: true,
          dueDate: true,
          waitingUntil: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  const healthFilter = input.filters.health?.trim().toLowerCase() || null;

  let items = rows.map((p) => toListItem(p, now));
  if (healthFilter) {
    items = items.filter((i) => i.health === healthFilter);
  }

  items.sort((a, b) => {
    const hr =
      deliveryHealthSortRank(a.health) - deliveryHealthSortRank(b.health);
    if (hr !== 0) return hr;
    return (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  });

  const sections = {
    needsAttention: items.filter(
      (i) =>
        i.health === "blocked" ||
        i.health === "at_risk" ||
        i.health === "attention",
    ).length,
    active: items.filter(
      (i) =>
        i.deliveryStage !== "completed" &&
        i.deliveryStage !== "cancelled" &&
        i.deliveryStage !== "on_hold",
    ).length,
    onHold: items.filter((i) => i.deliveryStage === "on_hold").length,
    recentlyCompleted: items.filter((i) => i.deliveryStage === "completed")
      .length,
  };

  const total = items.length;
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return { items: pageItems, total, page, pageSize, sections };
}

function toListItem(
  p: {
    id: string;
    name: string;
    clientOrganization: string | null;
    ownerId: string;
    deliveryStage: string | null;
    plannedCompletionDate: Date | null;
    actualCompletionDate: Date | null;
    updatedAt: Date;
    owner: { id: string; name: string | null } | null;
    tasks: Array<{
      status: string;
      dueDate: Date | null;
      waitingUntil: Date | null;
    }>;
  },
  now: Date,
): DeliveryProjectListItem {
  const health = computeDeliveryHealth({
    deliveryStage: p.deliveryStage,
    ownerId: p.ownerId,
    plannedCompletionDate: p.plannedCompletionDate,
    updatedAt: p.updatedAt,
    openTasks: p.tasks,
    now,
  });
  const today = startOfDayToronto(now);
  const overdueTaskCount = p.tasks.filter(
    (t) => t.dueDate && t.dueDate.getTime() < today.getTime(),
  ).length;
  const blockedTaskCount = p.tasks.filter(
    (t) => t.status.toLowerCase() === "blocked",
  ).length;
  const waitingTaskCount = p.tasks.filter((t) => {
    const s = t.status.toLowerCase();
    return s === "waiting_external" || s === "waiting_internal";
  }).length;
  const stage = normalizeDeliveryStage(p.deliveryStage);

  return {
    id: p.id,
    name: p.name,
    clientOrganization: p.clientOrganization,
    ownerId: p.ownerId,
    ownerName: p.owner?.name ?? null,
    deliveryStage: stage,
    deliveryStageLabel: deliveryStageLabel(stage),
    health: health.status,
    healthLabel: deliveryHealthLabel(health.status),
    primaryRisk: health.primaryRisk,
    plannedCompletionDate: p.plannedCompletionDate?.toISOString() ?? null,
    actualCompletionDate: p.actualCompletionDate?.toISOString() ?? null,
    openTaskCount: p.tasks.length,
    overdueTaskCount,
    blockedTaskCount,
    waitingTaskCount,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function getDeliveryProjectDetail(input: {
  orgId: string;
  projectId: string;
  ctx: OpsAccessContext;
  canManage: boolean;
  canReopenCompleted: boolean;
  /** 是否可查看来源投标项目（不因能看执行项目而自动放行） */
  canReadSourceTender?: boolean;
}): Promise<DeliveryProjectDetail | null> {
  const project = await db.project.findFirst({
    where: {
      id: input.projectId,
      orgId: input.orgId,
      workDomain: PROJECT_WORK_DOMAIN.DELIVERY,
    },
    select: {
      id: true,
      name: true,
      description: true,
      orgId: true,
      clientOrganization: true,
      ownerId: true,
      workDomain: true,
      deliveryStage: true,
      plannedCompletionDate: true,
      actualCompletionDate: true,
      updatedAt: true,
      sourceTenderProjectId: true,
      sourceTenderProject: {
        select: { id: true, name: true, workDomain: true },
      },
      owner: { select: { id: true, name: true } },
      members: {
        where: { status: "active" },
        select: { userId: true },
      },
      tasks: {
        where: { status: { in: [...OPEN_TASK_STATUSES] } },
        select: {
          title: true,
          status: true,
          dueDate: true,
          waitingUntil: true,
        },
      },
      documents: { select: { id: true } },
      discussion: {
        select: {
          messages: {
            where: { deletedAt: null },
            select: { id: true },
            take: 200,
          },
        },
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          action: true,
          createdAt: true,
          afterData: true,
          user: { select: { name: true } },
        },
      },
    },
  });

  if (!project) return null;

  const now = new Date();
  const base = toListItem(
    {
      id: project.id,
      name: project.name,
      clientOrganization: project.clientOrganization,
      ownerId: project.ownerId,
      deliveryStage: project.deliveryStage,
      plannedCompletionDate: project.plannedCompletionDate,
      actualCompletionDate: project.actualCompletionDate,
      updatedAt: project.updatedAt,
      owner: project.owner,
      tasks: project.tasks,
    },
    now,
  );

  const riskSignals: DeliveryProjectDetail["riskSignals"] = [];
  if (base.blockedTaskCount) {
    riskSignals.push({
      kind: "blocked_task",
      label: `${base.blockedTaskCount} 个阻塞任务`,
      source: "Task.status=blocked",
    });
  }
  if (base.overdueTaskCount) {
    riskSignals.push({
      kind: "overdue_task",
      label: `${base.overdueTaskCount} 个逾期任务`,
      source: "Task.dueDate",
    });
  }
  const waitingDue = project.tasks.filter((t) => {
    const s = t.status.toLowerCase();
    return (
      (s === "waiting_external" || s === "waiting_internal") &&
      t.waitingUntil &&
      t.waitingUntil.getTime() <= now.getTime()
    );
  });
  if (waitingDue.length) {
    riskSignals.push({
      kind: "waiting_due",
      label: `${waitingDue.length} 个等待截止已到期`,
      source: "Task.waitingUntil",
    });
  }
  if (
    project.plannedCompletionDate &&
    project.plannedCompletionDate.getTime() < startOfDayToronto(now).getTime() &&
    project.deliveryStage !== "completed"
  ) {
    riskSignals.push({
      kind: "plan_overdue",
      label: "项目计划完成日期已过",
      source: "Project.plannedCompletionDate",
    });
  }
  if (project.deliveryStage === "on_hold") {
    riskSignals.push({
      kind: "on_hold",
      label: "项目处于暂停",
      source: "Project.deliveryStage=on_hold",
    });
  }

  const sourceId = project.sourceTenderProjectId;
  const canLinkSource = Boolean(
    sourceId && input.canReadSourceTender && project.sourceTenderProject,
  );

  return {
    ...base,
    description: project.description,
    orgId: project.orgId,
    workDomain: "delivery",
    sourceTenderProjectId: sourceId,
    sourceTenderProjectName: project.sourceTenderProject?.name ?? null,
    sourceTenderHref: canLinkSource ? `/projects/${sourceId}` : null,
    nextStepSuggestion: suggestDeliveryNextStep({
      deliveryStage: project.deliveryStage,
      openTasks: project.tasks,
    }),
    recentActivity: project.auditLogs.map((a) => ({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt.toISOString(),
      userName: a.user?.name ?? null,
      summary: a.afterData
        ? (() => {
            try {
              return JSON.stringify(JSON.parse(a.afterData));
            } catch {
              return a.afterData;
            }
          })()
        : null,
    })),
    riskSignals,
    documentsCount: project.documents.length,
    messagesCount: project.discussion?.messages.length ?? 0,
    canManage: input.canManage,
    canReopenCompleted: input.canReopenCompleted,
  };
}

/** 运营首页重点执行项目（仅 delivery） */
export async function listFocusDeliveryProjects(input: {
  orgId: string;
  ctx: OpsAccessContext;
  limit?: number;
}): Promise<
  Array<
    DeliveryProjectListItem & {
      href: string;
    }
  >
> {
  const { items } = await listDeliveryProjects({
    orgId: input.orgId,
    ctx: input.ctx,
    filters: {
      view: canViewAllDeliveryProjects(input.ctx) ? "team" : "mine",
      page: 1,
      pageSize: 100,
    },
  });

  const active = items.filter(
    (i) => i.deliveryStage !== "cancelled",
  );

  const blocked = active.filter((i) => i.health === "blocked");
  const atRisk = active.filter((i) => i.health === "at_risk");
  const attention = active.filter((i) => i.health === "attention");
  const healthy = active
    .filter((i) => i.health === "healthy")
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

  const ordered = [...blocked, ...atRisk, ...attention, ...healthy];
  const limit = input.limit ?? 6;
  return ordered.slice(0, limit).map((i) => ({
    ...i,
    href: `/ops/projects/${i.id}`,
  }));
}

export type { DeliveryHealthStatus, DeliveryStage };
