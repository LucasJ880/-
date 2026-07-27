/**
 * Workbench 工作队列派生测试
 * 运行：npx tsx src/components/workbench/__tests__/derive-work-queue.test.ts
 */

import { deriveWorkQueue } from "../derive-work-queue";
import { deriveAiHint } from "../derive-ai-hint";
import { startOfDayToronto } from "@/lib/time";
import type { ScheduleEvent, Stats } from "@/components/dashboard/types";

function scheduleTaskDue(
  id: string,
  taskId: string,
  at: Date,
): ScheduleEvent {
  const iso = at.toISOString();
  return {
    id,
    title: `日程任务 ${taskId}`,
    startAt: iso,
    endAt: iso,
    allDay: true,
    type: "task_due",
    source: "task",
    priority: "medium",
    status: "todo",
    projectId: null,
    projectName: null,
    projectColor: null,
    entityType: "task",
    entityId: taskId,
    taskId,
    description: null,
    location: null,
    isEditable: false,
    isDeletable: false,
  };
}

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.error(`✗ ${name}`);
  }
}

const baseStats = (over: Partial<Stats> = {}): Stats => ({
  totalTasks: 10,
  todoCount: 3,
  inProgressCount: 2,
  doneCount: 5,
  totalProjects: 2,
  week: { created: 1, completed: 2, overdue: 0, active: 4 },
  highPriorityTasks: [],
  upcomingTasks: [],
  projectBreakdown: [],
  projectProgress: {},
  recentTasks: [],
  ...over,
});

// 1) 不得用 overdue 数量伪造任务卡
{
  const q = deriveWorkQueue({
    stats: baseStats({ week: { created: 1, completed: 1, overdue: 5, active: 2 } }),
    reminderSummary: null,
    scheduleEvents: [],
    pendingApprovalCount: 0,
  });
  const taskOverdue = q.filter((i) => i.kind === "task_overdue");
  const summary = q.filter((i) => i.kind === "summary_overdue");
  ok(taskOverdue.length === 0, "无真实逾期对象时不生成任务卡");
  ok(summary.length === 1 && summary[0].summaryCount === 5, "仅输出逾期汇总卡");
}

// 2) 真实逾期任务 → 实体卡，不出现汇总卡
{
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const q = deriveWorkQueue({
    stats: baseStats({
      week: { created: 0, completed: 0, overdue: 3, active: 1 },
      highPriorityTasks: [
        {
          id: "t1",
          title: "补交报价",
          status: "todo",
          priority: "high",
          dueDate: yesterday,
          project: { id: "p1", name: "A项目", color: "#2b6055" },
        },
      ],
    }),
    reminderSummary: null,
    scheduleEvents: [],
    pendingApprovalCount: 0,
  });
  ok(q.some((i) => i.kind === "task_overdue" && i.entityId === "t1"), "真实逾期任务入队");
  ok(!q.some((i) => i.kind === "summary_overdue"), "有实体卡时不出逾期汇总");
}

// 3) 审批/分发仅汇总
{
  const q = deriveWorkQueue({
    stats: baseStats({ pendingDispatchCount: 2 }),
    reminderSummary: null,
    scheduleEvents: [],
    pendingApprovalCount: 4,
  });
  const ap = q.find((i) => i.kind === "summary_approvals");
  const dp = q.find((i) => i.kind === "summary_dispatch");
  ok(!!ap && ap.summaryCount === 4 && ap.summaryHref === "/assistant", "审批汇总卡");
  ok(!!dp && dp.summaryCount === 2 && dp.summaryHref === "/admin/project-intake", "分发汇总卡");
}

// 4) 风险项目需 progress 对象
{
  const q = deriveWorkQueue({
    stats: baseStats({
      projectBreakdown: [
        { id: "p1", name: "风险项", color: "#a63d3d", total: 3, done: 0, inProgress: 1, todo: 2 },
      ],
      projectProgress: {
        p1: {
          taskProgress: 10,
          completedTasks: 0,
          totalTasks: 3,
          timeProgress: 80,
          startDate: null,
          dueDate: null,
          daysElapsed: 10,
          daysTotal: 12,
          daysRemaining: 2,
          currentStage: "执行",
          stages: [],
          riskLevel: "high",
          riskLabel: "进度落后",
          isOverdue: false,
          isAtRisk: true,
          weekDelta: -5,
        },
      },
    }),
    reminderSummary: null,
    scheduleEvents: [],
    pendingApprovalCount: 0,
  });
  ok(q.some((i) => i.kind === "project_risk" && i.entityId === "p1"), "风险项目入队");
}

// 5) max 7
{
  const tasks = Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`,
    title: `任务${i}`,
    status: "in_progress" as const,
    priority: "medium",
    dueDate: null,
    project: null,
  }));
  const q = deriveWorkQueue({
    stats: baseStats({
      highPriorityTasks: tasks as Stats["highPriorityTasks"],
      recentTasks: tasks.map((t) => ({ ...t, updatedAt: new Date().toISOString() })),
    }),
    reminderSummary: null,
    scheduleEvents: [],
    pendingApprovalCount: 0,
    maxItems: 7,
  });
  ok(q.length <= 7, "队列最多 7 张");
}

// 6) AI hint 规则
{
  ok(
    deriveAiHint({
      id: "x",
      kind: "task_overdue",
      rank: 1,
      title: "a",
      subtitle: null,
      entityType: "task",
      entityId: "1",
    }) === "建议优先确认阻塞原因并调整截止日期",
    "逾期 hint",
  );
  ok(
    deriveAiHint({
      id: "y",
      kind: "summary_approvals",
      rank: 1,
      title: "待审批",
      subtitle: null,
      entityType: "summary",
      entityId: null,
    }) === null,
    "汇总卡无 hint",
  );
}

// 空 stats
ok(deriveWorkQueue({
  stats: null,
  reminderSummary: null,
  scheduleEvents: [],
  pendingApprovalCount: 0,
}).length === 0, "stats 空则空队列");

// 7) scheduleEvents：Toronto 今天 00:00 → task_due_today，不是 overdue
{
  const todayStart = startOfDayToronto();
  const q = deriveWorkQueue({
    stats: baseStats(),
    reminderSummary: null,
    scheduleEvents: [scheduleTaskDue("ev-today", "sched-today", todayStart)],
    pendingApprovalCount: 0,
  });
  const card = q.find((i) => i.entityId === "sched-today");
  ok(!!card && card.kind === "task_due_today", "今天 00:00 → task_due_today");
  ok(!q.some((i) => i.entityId === "sched-today" && i.kind === "task_overdue"), "今天 00:00 不是 overdue");
}

// 8) scheduleEvents：Toronto 昨天 23:59 → task_overdue
{
  const todayStart = startOfDayToronto();
  const yesterday2359 = new Date(todayStart.getTime() - 60_000);
  const q = deriveWorkQueue({
    stats: baseStats(),
    reminderSummary: null,
    scheduleEvents: [scheduleTaskDue("ev-yday", "sched-yday", yesterday2359)],
    pendingApprovalCount: 0,
  });
  const card = q.find((i) => i.entityId === "sched-yday");
  ok(!!card && card.kind === "task_overdue", "昨天 23:59 → task_overdue");
  ok(!q.some((i) => i.entityId === "sched-yday" && i.kind === "task_due_today"), "昨天不是 due_today");
}

// 9) Reminder 不合成 task；仅 followup 入队
{
  const q = deriveWorkQueue({
    stats: baseStats(),
    reminderSummary: {
      immediate: [
        {
          sourceKey: "fu-1",
          type: "followup",
          title: "跟进客户 A",
          subtitle: "电话",
          taskId: "real-task-1",
          projectId: "p1",
          project: { id: "p1", name: "项目A", color: "#2b6055" },
        },
        {
          sourceKey: "dl-1",
          type: "deadline",
          title: "截止提醒",
          subtitle: "勿重复",
          taskId: "t-deadline",
        },
      ],
      today: [
        {
          sourceKey: "ev-1",
          type: "event",
          title: "日程提醒",
          subtitle: "勿入队",
        },
      ],
      upcoming: [],
      unreadCount: 3,
    },
    scheduleEvents: [],
    pendingApprovalCount: 0,
  });
  const rem = q.filter((i) => i.kind === "reminder_followup");
  ok(rem.length === 1 && rem[0].id === "reminder:fu-1", "仅 followup 提醒入队");
  ok(rem[0].task === undefined, "Reminder 不合成 task 对象");
  ok(!!rem[0].reminder && rem[0].reminder.type === "followup", "保留真实 reminder 字段");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
