/**
 * 将项目截标日 / 开标日同步到成员个人日历。
 *
 * - 主负责人、主采购人：截标日（提前提醒 3 天）+ 开标日
 * - 参与者：截标日（提前提醒 1 天，知情）+ 开标日（全员）
 * - 日期清空时删除对应系统日程
 */

import { db } from "@/lib/db";
import { isProjectController } from "@/lib/projects/duty";
import { startOfDayToronto, endOfDayToronto } from "@/lib/time";

type MilestoneKind = "close" | "open";

function sourceKey(projectId: string, kind: MilestoneKind): string {
  return `project:${projectId}:${kind}`;
}

function dayBounds(date: Date) {
  return {
    startTime: startOfDayToronto(date),
    endTime: endOfDayToronto(date),
  };
}

async function upsertMilestoneForUser(params: {
  userId: string;
  projectId: string;
  projectName: string;
  kind: MilestoneKind;
  date: Date;
  reminderMinutes: number;
}) {
  const { userId, projectId, projectName, kind, date, reminderMinutes } = params;
  const key = sourceKey(projectId, kind);
  const title =
    kind === "close"
      ? `截标：${projectName}`
      : `开标：${projectName}`;
  const description =
    kind === "close"
      ? "项目截标日（可在项目详情中调整）"
      : "项目开标日（全员通知；可在项目详情中调整）";
  const { startTime, endTime } = dayBounds(date);

  const existing = await db.calendarEvent.findUnique({
    where: { userId_sourceKey: { userId, sourceKey: key } },
    select: { id: true },
  });

  if (existing) {
    await db.calendarEvent.update({
      where: { id: existing.id },
      data: {
        title,
        description,
        startTime,
        endTime,
        allDay: true,
        reminderMinutes,
        projectId,
        source: "project_milestone",
      },
    });
    return;
  }

  await db.calendarEvent.create({
    data: {
      title,
      description,
      startTime,
      endTime,
      allDay: true,
      reminderMinutes,
      source: "project_milestone",
      sourceKey: key,
      projectId,
      userId,
    },
  });
}

async function removeMilestoneForUser(
  userId: string,
  projectId: string,
  kind: MilestoneKind
) {
  await db.calendarEvent.deleteMany({
    where: {
      userId,
      sourceKey: sourceKey(projectId, kind),
    },
  });
}

export async function syncProjectMilestoneCalendars(
  projectId: string
): Promise<void> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      purchaserId: true,
      closeDate: true,
      openDate: true,
      members: {
        where: { status: "active" },
        select: { userId: true },
      },
    },
  });
  if (!project) return;

  const userIds = new Set<string>([
    project.ownerId,
    ...project.members.map((m) => m.userId),
  ]);
  if (project.purchaserId) userIds.add(project.purchaserId);

  for (const userId of userIds) {
    const controller = isProjectController(
      userId,
      project.ownerId,
      project.purchaserId
    );

    if (project.closeDate) {
      await upsertMilestoneForUser({
        userId,
        projectId: project.id,
        projectName: project.name,
        kind: "close",
        date: project.closeDate,
        reminderMinutes: controller ? 3 * 24 * 60 : 24 * 60,
      });
    } else {
      await removeMilestoneForUser(userId, project.id, "close");
    }

    if (project.openDate) {
      await upsertMilestoneForUser({
        userId,
        projectId: project.id,
        projectName: project.name,
        kind: "open",
        date: project.openDate,
        reminderMinutes: 24 * 60,
      });
    } else {
      await removeMilestoneForUser(userId, project.id, "open");
    }
  }

  // 已退出成员：清掉其里程碑日程
  await db.calendarEvent.deleteMany({
    where: {
      projectId,
      source: "project_milestone",
      userId: { notIn: [...userIds] },
    },
  });
}
