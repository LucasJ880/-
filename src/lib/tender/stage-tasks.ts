/**
 * 阶段→任务联动
 *
 * 每个阶段有一组标准任务模板。阶段推进时：
 * 1. 将新阶段之前所有阶段还没完成的自动任务标为完成（FIX-7：不只上一阶段——
 *    分析完成、询价发出会绕过阶段推进直接写阶段时间，跳级推进也会跳过中间的阶段）
 * 2. 为新阶段创建待办任务（项目不是进行中的不建；同一项目加锁，不重复建）
 * 项目被放弃时，还没完成的自动任务标为已取消（cancelOpenStageTasks）。
 *
 * 自动任务通过 title 前缀 `[阶段]` 识别，避免误关人工创建的任务。
 */

import { db } from "@/lib/db";
import type { TenderStage } from "./types";
import { STAGE_LABEL, STAGE_ORDER } from "./stage-transition";

export interface StageTaskTemplate {
  title: string;
  description: string;
  priority: string;
  daysFromNow?: number;
  /** FIX-7：到期日取项目的截标时间（没有截标时间、或已经过了，仍按 daysFromNow 算） */
  dueAtClose?: boolean;
}

export const STAGE_TASK_TEMPLATES: Partial<Record<TenderStage, StageTaskTemplate[]>> = {
  distribution: [
    {
      title: "分配项目负责人",
      description: "确认项目的主要负责人和团队成员",
      priority: "high",
      daysFromNow: 1,
    },
    {
      title: "初步评估项目可行性",
      description: "根据项目文档评估是否跟进",
      priority: "medium",
      daysFromNow: 2,
    },
  ],
  interpretation: [
    {
      title: "精读招标文件",
      description: "仔细阅读所有招标文件，标注关键条款",
      priority: "high",
      daysFromNow: 3,
    },
    {
      title: "确认投标资质要求",
      description: "核实资质/认证/保函等要求是否满足",
      priority: "high",
      daysFromNow: 2,
    },
    {
      title: "编制投标计划",
      description: "列出投标准备的时间表和分工",
      priority: "medium",
      daysFromNow: 3,
    },
  ],
  supplier_inquiry: [
    {
      title: "发送供应商询价单",
      description: "根据项目需求向供应商发送询价",
      priority: "high",
      daysFromNow: 2,
    },
    {
      title: "跟进供应商回复",
      description: "确认供应商收到询价并催促回复",
      priority: "medium",
      daysFromNow: 5,
    },
  ],
  supplier_quote: [
    {
      title: "汇总供应商报价",
      description: "整理所有供应商的报价进行对比分析",
      priority: "high",
      daysFromNow: 2,
    },
    {
      title: "生成项目报价单",
      description: "基于供应商报价和利润要求生成最终报价",
      priority: "high",
      daysFromNow: 3,
    },
    {
      title: "报价内部审核",
      description: "提交报价单进行内部审批",
      priority: "medium",
      daysFromNow: 4,
    },
    // FIX-7：这两条原来排在「项目提交」阶段——可进入那个阶段就意味着标已经交了。
    // 挪到这里：交标之前要做的事，进入「项目提交」时随「[供应商报价]」的任务一起被关掉。
    {
      title: "准备投标文件",
      description: "整理所有投标所需文件、资料、证书",
      priority: "urgent",
      daysFromNow: 5,
    },
    {
      title: "提交投标",
      description: "在截标日前完成投标提交",
      priority: "urgent",
      daysFromNow: 6,
      dueAtClose: true,
    },
  ],
  // 项目提交：不建任务（进入这个阶段 = 已经提交）
};

const DAY_MS = 86_400_000;

/** 要写进任务表的一条（只有任务表里有的列） */
export type StageTaskRow = {
  title: string;
  description: string;
  priority: string;
  status: "todo";
  projectId: string;
  creatorId: string;
  assigneeId: string;
  dueDate: Date | null;
};

/**
 * FIX-7：进入某个阶段时要建哪些任务（纯函数）。
 *   - 标题以「[阶段名]」开头；创建人与负责人是推进阶段的那个人；
 *   - 到期日 = now + 天数；标了 dueAtClose 的取截标时间；
 *   - 截标时间还没到时，任何一条的到期日都不晚于截标时间（截标之后才到期的任务没有意义）；
 *   - 没有截标时间、或已经过了：一律按天数。
 */
export function buildStageTaskRows(input: { stage: TenderStage; projectId: string; actorId: string; now: Date; closeDate: Date | null }): StageTaskRow[] {
  const templates = STAGE_TASK_TEMPLATES[input.stage] ?? [];
  const prefix = buildStagePrefix(input.stage);
  return templates.map((t) => {
    const byDays = t.daysFromNow ? new Date(input.now.getTime() + t.daysFromNow * DAY_MS) : null;
    const close = input.closeDate && input.closeDate.getTime() > input.now.getTime() ? input.closeDate : null;
    const dueDate = close && (t.dueAtClose || (byDays && byDays.getTime() > close.getTime())) ? close : byDays;
    return {
      title: `${prefix} ${t.title}`,
      description: t.description,
      priority: t.priority,
      status: "todo" as const,
      projectId: input.projectId,
      creatorId: input.actorId,
      assigneeId: input.actorId,
      dueDate,
    };
  });
}

function buildStagePrefix(stage: TenderStage): string {
  return `[${STAGE_LABEL[stage]}]`;
}

/** FIX-7：toStage 之前所有阶段的自动任务前缀（不含立项：立项没有模板） */
export function earlierStagePrefixes(toStage: TenderStage): string[] {
  const idx = STAGE_ORDER.indexOf(toStage);
  return STAGE_ORDER.slice(0, Math.max(idx, 0))
    .filter((s) => (STAGE_TASK_TEMPLATES[s]?.length ?? 0) > 0)
    .map(buildStagePrefix);
}

/** 所有阶段的自动任务前缀 */
export function allStagePrefixes(): string[] {
  return STAGE_ORDER.filter((s) => (STAGE_TASK_TEMPLATES[s]?.length ?? 0) > 0).map(buildStagePrefix);
}

const OPEN_AUTO_STATUSES = ["todo", "in_progress"];

/**
 * 阶段推进后的联动操作：关闭之前阶段的自动任务 + 创建新阶段任务
 */
export async function onStageAdvancedTasks(
  projectId: string,
  fromStage: TenderStage,
  toStage: TenderStage,
  actorId: string,
  /** FLOW-H4a：skipCreate = 只关上一阶段的自动任务，不为新阶段建任务（不传时与原来相同） */
  opts: { skipCreate?: boolean } = {},
) {
  void fromStage; // FIX-7：关的是 toStage 之前的所有阶段，不只 fromStage
  const prefixes = earlierStagePrefixes(toStage);

  // 1. 将之前阶段还没完成的自动任务标为完成
  if (prefixes.length > 0) {
    await db.task.updateMany({
      where: {
        projectId,
        OR: prefixes.map((p) => ({ title: { startsWith: p } })),
        status: { in: OPEN_AUTO_STATUSES },
      },
      data: {
        status: "done",
        completedAt: new Date(),
      },
    });
  }

  // 2. 为新阶段创建任务
  if (opts.skipCreate) return;
  const templates = STAGE_TASK_TEMPLATES[toStage];
  if (!templates || templates.length === 0) return;

  const newPrefix = buildStagePrefix(toStage);
  const now = new Date();

  // FIX-7：原来这里给每条任务写了 sortOrder——任务表没有这一列，每次都报错，任务从来没建出来过
  const project = await db.project.findUnique({ where: { id: projectId }, select: { closeDate: true, status: true } });
  // 已放弃 / 已归档的项目不建
  if (!project || project.status !== "active") return;
  const tasks = buildStageTaskRows({ stage: toStage, projectId, actorId, now, closeDate: project.closeDate ?? null });

  // 同一项目加锁再「查有没有、没有才建」：同时推进两次也只建一批
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`stage-tasks:${projectId}`}))) AS l`;
    // 避免重复创建：新阶段已有没完成的同前缀任务就不建
    const existing = await tx.task.count({
      where: {
        projectId,
        title: { startsWith: newPrefix },
        status: { in: OPEN_AUTO_STATUSES },
      },
    });
    if (existing > 0) return;
    await tx.task.createMany({ data: tasks });
  });
}

/**
 * FIX-7：项目被放弃时，把还没完成的自动任务标为已取消（人自己建的任务不动）。
 * 返回取消了几条。
 */
export async function cancelOpenStageTasks(projectId: string, client: Pick<typeof db, "task"> = db): Promise<number> {
  const r = await client.task.updateMany({
    where: {
      projectId,
      OR: allStagePrefixes().map((p) => ({ title: { startsWith: p } })),
      status: { in: OPEN_AUTO_STATUSES },
    },
    data: { status: "cancelled" },
  });
  return r.count;
}
