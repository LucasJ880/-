/**
 * 阶段→任务联动
 *
 * 每个阶段有一组标准任务模板。阶段推进时：
 * 1. 将上一阶段的自动任务标为完成
 * 2. 为新阶段创建待办任务
 *
 * 自动任务通过 title 前缀 `[阶段]` 识别，避免误关人工创建的任务。
 */

import { db } from "@/lib/db";
import type { TenderStage } from "./types";
import { STAGE_LABEL } from "./stage-transition";

export interface StageTaskTemplate {
  title: string;
  description: string;
  priority: string;
  daysFromNow?: number;
  /** FIX-5：到期日取项目的截标时间（没有截标时间、或已经过了，仍按 daysFromNow 算） */
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
    // FIX-5：这两条原来排在「项目提交」阶段——可进入那个阶段就意味着标已经交了。
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
  createdAt: Date;
};

/**
 * FIX-5：进入某个阶段时要建哪些任务（纯函数）。
 *   - 标题以「[阶段名]」开头；创建人与负责人是推进阶段的那个人；
 *   - 到期日 = now + 天数；标了 dueAtClose 的取截标时间（没有、或已经过了，仍按天数）；
 *   - 创建时间依次加 1 毫秒：同一批任务按模板里的先后顺序排（任务表没有排序列）。
 */
export function buildStageTaskRows(input: { stage: TenderStage; projectId: string; actorId: string; now: Date; closeDate: Date | null }): StageTaskRow[] {
  const templates = STAGE_TASK_TEMPLATES[input.stage] ?? [];
  const prefix = buildStagePrefix(input.stage);
  return templates.map((t, idx) => {
    const byDays = t.daysFromNow ? new Date(input.now.getTime() + t.daysFromNow * DAY_MS) : null;
    const closing = t.dueAtClose && input.closeDate && input.closeDate.getTime() > input.now.getTime() ? input.closeDate : null;
    return {
      title: `${prefix} ${t.title}`,
      description: t.description,
      priority: t.priority,
      status: "todo" as const,
      projectId: input.projectId,
      creatorId: input.actorId,
      assigneeId: input.actorId,
      dueDate: closing ?? byDays,
      createdAt: new Date(input.now.getTime() + idx),
    };
  });
}

function buildStagePrefix(stage: TenderStage): string {
  return `[${STAGE_LABEL[stage]}]`;
}

/**
 * 阶段推进后的联动操作：关闭旧阶段任务 + 创建新阶段任务
 */
export async function onStageAdvancedTasks(
  projectId: string,
  fromStage: TenderStage,
  toStage: TenderStage,
  actorId: string,
  /** FLOW-H4a：skipCreate = 只关上一阶段的自动任务，不为新阶段建任务（不传时与原来相同） */
  opts: { skipCreate?: boolean } = {},
) {
  const prefix = buildStagePrefix(fromStage);

  // 1. 将上一阶段的自动任务标为完成
  await db.task.updateMany({
    where: {
      projectId,
      title: { startsWith: prefix },
      status: { in: ["todo", "in_progress"] },
    },
    data: {
      status: "done",
      completedAt: new Date(),
    },
  });

  // 2. 为新阶段创建任务
  if (opts.skipCreate) return;
  const templates = STAGE_TASK_TEMPLATES[toStage];
  if (!templates || templates.length === 0) return;

  const newPrefix = buildStagePrefix(toStage);
  const now = new Date();

  // 避免重复创建：检查是否已有同前缀任务
  const existing = await db.task.count({
    where: {
      projectId,
      title: { startsWith: newPrefix },
      status: { in: ["todo", "in_progress"] },
    },
  });
  if (existing > 0) return;

  // FIX-5：原来这里给每条任务写了 sortOrder——任务表没有这一列，每次都报错，任务从来没建出来过
  const project = await db.project.findUnique({ where: { id: projectId }, select: { closeDate: true } });
  const tasks = buildStageTaskRows({ stage: toStage, projectId, actorId, now, closeDate: project?.closeDate ?? null });

  await db.task.createMany({ data: tasks });
}
