import { daysRemainingToronto } from "@/lib/time";
import type {
  ProjectBreakdown,
  ProjectProgressData,
  ReminderItemData,
  ReminderSummaryData,
  ScheduleEvent,
  Stats,
  TaskItem,
} from "@/components/dashboard/types";
import type { WorkQueueItem } from "./types";

export const WORK_QUEUE_MAX = 7;

export type DeriveWorkQueueInput = {
  stats: Stats | null;
  reminderSummary: ReminderSummaryData | null;
  scheduleEvents: ScheduleEvent[];
  pendingApprovalCount: number;
  maxItems?: number;
};

function isOpenTask(t: TaskItem): boolean {
  return t.status !== "done" && t.status !== "cancelled";
}

/** 从真实任务对象判断逾期（不可用 week.overdue 数量伪造） */
function isOverdueTask(t: TaskItem): boolean {
  if (!t.dueDate || !isOpenTask(t)) return false;
  return daysRemainingToronto(t.dueDate) < 0;
}

function isDueTodayTask(t: TaskItem): boolean {
  if (!t.dueDate || !isOpenTask(t)) return false;
  return daysRemainingToronto(t.dueDate) === 0;
}

function collectKnownTasks(stats: Stats): TaskItem[] {
  const map = new Map<string, TaskItem>();
  for (const t of [
    ...stats.highPriorityTasks,
    ...stats.upcomingTasks,
    ...stats.recentTasks,
  ]) {
    if (!map.has(t.id)) map.set(t.id, t);
  }
  return [...map.values()];
}

function taskCard(
  t: TaskItem,
  kind: "task_overdue" | "task_due_today" | "task_in_progress",
  rank: number,
): WorkQueueItem {
  const diff = t.dueDate ? daysRemainingToronto(t.dueDate) : null;
  let subtitle: string | null = null;
  if (diff !== null) {
    if (diff < 0) subtitle = `已逾期 ${Math.abs(diff)} 天`;
    else if (diff === 0) subtitle = "今天到期";
    else subtitle = `${diff} 天后到期`;
  } else if (t.priority === "urgent" || t.priority === "high") {
    subtitle = t.priority === "urgent" ? "紧急" : "高优先级";
  }

  return {
    id: `task:${t.id}`,
    kind,
    rank,
    title: t.title,
    subtitle,
    entityType: "task",
    entityId: t.id,
    task: t,
    projectId: t.projectId ?? t.project?.id ?? null,
    projectName: t.project?.name ?? null,
    projectColor: t.project?.color ?? null,
    dueDate: t.dueDate,
    status: t.status,
  };
}

function projectRiskCard(
  p: ProjectBreakdown,
  progress: ProjectProgressData,
  rank: number,
): WorkQueueItem {
  return {
    id: `project:${p.id}`,
    kind: "project_risk",
    rank,
    title: p.name,
    subtitle: progress.riskLabel || (progress.isOverdue ? "项目已逾期" : "存在风险"),
    entityType: "project",
    entityId: p.id,
    projectId: p.id,
    projectName: p.name,
    projectColor: p.color,
    progress,
    dueDate: progress.dueDate,
    status: progress.currentStage || null,
    riskLevel: progress.riskLevel,
  };
}

function reminderCard(r: ReminderItemData, rank: number): WorkQueueItem {
  const projectId = r.projectId ?? r.project?.id ?? null;
  return {
    id: `reminder:${r.sourceKey}`,
    kind: "reminder_followup",
    rank,
    title: r.title,
    subtitle: r.subtitle || null,
    entityType: "reminder",
    entityId: r.taskId ?? projectId,
    reminder: r,
    projectId,
    projectName: r.project?.name ?? null,
    projectColor: r.project?.color ?? null,
    task: r.taskId
      ? {
          id: r.taskId,
          title: r.title,
          status: "todo",
          priority: "medium",
          dueDate: null,
          projectId,
          project: r.project
            ? { id: r.project.id, name: r.project.name, color: r.project.color }
            : null,
        }
      : undefined,
  };
}

function summaryCard(
  kind: "summary_overdue" | "summary_approvals" | "summary_dispatch",
  title: string,
  count: number,
  href: string,
  rank: number,
): WorkQueueItem {
  return {
    id: `summary:${kind}`,
    kind,
    rank,
    title,
    subtitle: "点击查看完整列表",
    entityType: "summary",
    entityId: null,
    summaryCount: count,
    summaryHref: href,
  };
}

/**
 * 从现有 Dashboard 数据派生中央工作队列。
 * - 禁止用数量伪造具体任务/项目卡
 * - 仅数量可用时输出一张汇总卡
 */
export function deriveWorkQueue(input: DeriveWorkQueueInput): WorkQueueItem[] {
  const max = input.maxItems ?? WORK_QUEUE_MAX;
  const { stats, reminderSummary, scheduleEvents, pendingApprovalCount } = input;
  if (!stats) return [];

  const items: WorkQueueItem[] = [];
  const seen = new Set<string>();
  const push = (item: WorkQueueItem) => {
    if (seen.has(item.id) || items.length >= max) return;
    seen.add(item.id);
    items.push(item);
  };

  const knownTasks = collectKnownTasks(stats);
  const overdueTasks = knownTasks
    .filter(isOverdueTask)
    .sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return da - db;
    });

  // 日程里的逾期 task_due（真实对象）
  for (const ev of scheduleEvents) {
    if (ev.type !== "task_due" || !ev.taskId) continue;
    if (seen.has(`task:${ev.taskId}`)) continue;
    const end = new Date(ev.endAt || ev.startAt).getTime();
    if (end >= Date.now()) continue;
    if (ev.status === "done" || ev.status === "cancelled") continue;
    push(
      taskCard(
        {
          id: ev.taskId,
          title: ev.title,
          status: ev.status || "todo",
          priority: ev.priority,
          dueDate: ev.endAt || ev.startAt,
          projectId: ev.projectId,
          project: ev.projectName
            ? {
                id: ev.projectId ?? undefined,
                name: ev.projectName,
                color: ev.projectColor || "#6e7d76",
              }
            : null,
        },
        "task_overdue",
        10,
      ),
    );
  }

  for (const t of overdueTasks) {
    push(taskCard(t, "task_overdue", 10));
  }

  // 有逾期数量但拿不到具体任务对象 → 汇总卡（不伪造）
  const concreteOverdue = items.filter((i) => i.kind === "task_overdue").length;
  if (stats.week.overdue > 0 && concreteOverdue === 0) {
    push(
      summaryCard(
        "summary_overdue",
        `已逾期 ${stats.week.overdue} 项`,
        stats.week.overdue,
        "/tasks",
        15,
      ),
    );
  }

  if (pendingApprovalCount > 0) {
    push(
      summaryCard(
        "summary_approvals",
        `待审批 ${pendingApprovalCount} 项`,
        pendingApprovalCount,
        "/assistant",
        20,
      ),
    );
  }

  const dispatch = stats.pendingDispatchCount ?? 0;
  if (dispatch > 0) {
    push(
      summaryCard(
        "summary_dispatch",
        `待分发 ${dispatch} 项`,
        dispatch,
        "/admin/project-intake",
        25,
      ),
    );
  }

  const dueToday = knownTasks
    .filter(isDueTodayTask)
    .sort((a, b) => (a.priority === "urgent" ? -1 : b.priority === "urgent" ? 1 : 0));
  for (const t of dueToday) {
    push(taskCard(t, "task_due_today", 30));
  }

  // 风险项目：必须有 progress 真实对象且 isAtRisk / high / overdue
  const progressMap = stats.projectProgress ?? {};
  const riskProjects = stats.projectBreakdown
    .map((p) => ({ p, progress: progressMap[p.id] }))
    .filter(
      ({ progress }) =>
        progress &&
        (progress.isAtRisk ||
          progress.isOverdue ||
          progress.riskLevel === "high" ||
          progress.riskLevel === "medium"),
    )
    .sort((a, b) => {
      const rank = (x: ProjectProgressData) =>
        x.isOverdue || x.riskLevel === "high" ? 0 : x.riskLevel === "medium" ? 1 : 2;
      return rank(a.progress!) - rank(b.progress!);
    });
  for (const { p, progress } of riskProjects) {
    if (progress) push(projectRiskCard(p, progress, 40));
  }

  // 客户待跟进：仅使用提醒接口返回的真实对象（immediate / today）
  if (reminderSummary) {
    const pool = [
      ...reminderSummary.immediate,
      ...reminderSummary.today,
    ];
    for (const r of pool) {
      push(reminderCard(r, 50));
    }
  }

  // 填充：进行中真实任务
  if (items.length < max) {
    const inProg = knownTasks.filter((t) => t.status === "in_progress");
    for (const t of inProg) {
      push(taskCard(t, "task_in_progress", 60));
    }
  }

  return items
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title, "zh"))
    .slice(0, max);
}
