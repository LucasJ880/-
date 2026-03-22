/**
 * 工作流模板定义 — tender_review 及通用模板引擎
 */

export interface TemplateTask {
  phase: string;
  name: string;
  offsetType: "business_days" | "calendar_days";
  offsetDays: number;
  offsetFrom: "creation" | "deadline";
  description?: string;
}

function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  const direction = days >= 0 ? 1 : -1;
  const absDays = Math.abs(days);
  while (added < absDays) {
    result.setDate(result.getDate() + direction);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

function addCalendarDays(from: Date, days: number): Date {
  const result = new Date(from);
  result.setDate(result.getDate() + days);
  return result;
}

export function resolveTaskDueDate(
  task: TemplateTask,
  creationDate: Date,
  deadline: Date | null
): Date {
  const base = task.offsetFrom === "deadline" && deadline ? deadline : creationDate;
  if (task.offsetType === "business_days") {
    return addBusinessDays(base, task.offsetDays);
  }
  return addCalendarDays(base, task.offsetDays);
}

export const TENDER_REVIEW_TASKS: TemplateTask[] = [
  // 初步审阅
  {
    phase: "初步审阅",
    name: "审阅招标文件",
    offsetType: "business_days",
    offsetDays: 3,
    offsetFrom: "creation",
    description: "阅读 BidToGo 提供的文档和情报",
  },
  {
    phase: "初步审阅",
    name: "验证资质条件",
    offsetType: "business_days",
    offsetDays: 3,
    offsetFrom: "creation",
    description: "检查是否满足投标要求",
  },
  {
    phase: "初步审阅",
    name: "确认是否跟进",
    offsetType: "business_days",
    offsetDays: 5,
    offsetFrom: "creation",
    description: "审批节点：跟进/放弃",
  },
  // 报价准备
  {
    phase: "报价准备",
    name: "联系供应商询价",
    offsetType: "business_days",
    offsetDays: 7,
    offsetFrom: "creation",
    description: "条件：确认跟进后触发",
  },
  {
    phase: "报价准备",
    name: "指派项目负责人",
    offsetType: "business_days",
    offsetDays: 5,
    offsetFrom: "creation",
  },
  {
    phase: "报价准备",
    name: "准备初步报价",
    offsetType: "business_days",
    offsetDays: 10,
    offsetFrom: "creation",
  },
  // 投标制作
  {
    phase: "投标制作",
    name: "准备投标材料",
    offsetType: "calendar_days",
    offsetDays: -5,
    offsetFrom: "deadline",
  },
  {
    phase: "投标制作",
    name: "内部审批",
    offsetType: "calendar_days",
    offsetDays: -3,
    offsetFrom: "deadline",
  },
  {
    phase: "投标制作",
    name: "提交投标",
    offsetType: "calendar_days",
    offsetDays: -1,
    offsetFrom: "deadline",
  },
  // 跟踪
  {
    phase: "跟踪",
    name: "监控截止日期",
    offsetType: "calendar_days",
    offsetDays: 0,
    offsetFrom: "deadline",
    description: "自动提醒",
  },
  {
    phase: "跟踪",
    name: "记录结果",
    offsetType: "calendar_days",
    offsetDays: 30,
    offsetFrom: "deadline",
    description: "中标/未中标",
  },
];

export const WORKFLOW_TEMPLATES: Record<string, TemplateTask[]> = {
  tender_review: TENDER_REVIEW_TASKS,
};
