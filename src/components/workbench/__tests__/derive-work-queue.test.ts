/**
 * Workbench 工作队列派生测试
 * 运行：npx tsx src/components/workbench/__tests__/derive-work-queue.test.ts
 */

import { deriveWorkQueue } from "../derive-work-queue";
import { deriveAiHint } from "../derive-ai-hint";
import type { Stats } from "@/components/dashboard/types";

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
