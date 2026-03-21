import type {
  ProjectProgress,
  ProjectProgressInput,
  ProjectStage,
  StageItem,
} from "./types";

export function calculateProjectProgress(input: ProjectProgressInput): ProjectProgress {
  const { taskStats, moduleStats, startDate, dueDate, weekCompletedTasks } = input;

  const taskProgress =
    taskStats.total > 0
      ? Math.round((taskStats.done / taskStats.total) * 100)
      : deriveModuleProgress(moduleStats);

  const now = new Date();
  let timeProgress = 0;
  let daysElapsed = 0;
  let daysTotal = 0;
  let daysRemaining = 0;
  let isOverdue = false;

  if (startDate && dueDate) {
    const start = startDate.getTime();
    const end = dueDate.getTime();
    const current = now.getTime();
    daysTotal = Math.max(1, Math.ceil((end - start) / 86400000));
    daysElapsed = Math.max(0, Math.ceil((current - start) / 86400000));
    daysRemaining = Math.max(0, Math.ceil((end - current) / 86400000));
    timeProgress = Math.min(Math.round((daysElapsed / daysTotal) * 100), 100);
    isOverdue = current > end && taskProgress < 100;
  } else if (dueDate) {
    const end = dueDate.getTime();
    daysRemaining = Math.max(0, Math.ceil((end - now.getTime()) / 86400000));
    isOverdue = now.getTime() > end && taskProgress < 100;
    timeProgress = isOverdue ? 100 : 0;
  }

  const stages = deriveStages(moduleStats, taskStats);
  const currentStage = deriveCurrentStage(moduleStats, taskStats);

  const { riskLevel, riskLabel, isAtRisk } = assessRisk({
    taskProgress,
    timeProgress,
    isOverdue,
    daysRemaining,
    dueDate,
    openTasks: taskStats.total - taskStats.done,
  });

  const weekDelta =
    taskStats.total > 0
      ? Math.round((weekCompletedTasks / taskStats.total) * 100)
      : 0;

  return {
    taskProgress,
    completedTasks: taskStats.done,
    totalTasks: taskStats.total,
    timeProgress,
    startDate: startDate?.toISOString() ?? null,
    dueDate: dueDate?.toISOString() ?? null,
    daysElapsed,
    daysTotal,
    daysRemaining,
    currentStage,
    stages,
    riskLevel,
    riskLabel,
    isOverdue,
    isAtRisk,
    weekDelta,
  };
}

function deriveModuleProgress(m: ProjectProgressInput["moduleStats"]): number {
  const checks = [
    m.prompts > 0,
    m.knowledgeBases > 0,
    m.agents > 0,
    m.conversations > 0,
    m.evaluations > 0,
    m.feedbacks > 0,
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}

function deriveCurrentStage(
  m: ProjectProgressInput["moduleStats"],
  t: ProjectProgressInput["taskStats"]
): ProjectStage {
  if (m.feedbacks > 0 || m.evaluations > 0) {
    if (t.total > 0 && t.done === t.total) return "mature";
    return "evaluating";
  }
  if (m.conversations > 0) return "running";
  if (m.agents > 0) return "testing";
  if (m.prompts > 0 || m.knowledgeBases > 0) return "configuring";
  return "setup";
}

const STAGE_DEFS: { key: ProjectStage; label: string }[] = [
  { key: "setup", label: "立项" },
  { key: "configuring", label: "配置" },
  { key: "testing", label: "测试" },
  { key: "running", label: "运行" },
  { key: "evaluating", label: "评估" },
  { key: "mature", label: "成熟" },
];

function deriveStages(
  m: ProjectProgressInput["moduleStats"],
  t: ProjectProgressInput["taskStats"]
): StageItem[] {
  const current = deriveCurrentStage(m, t);
  const currentIdx = STAGE_DEFS.findIndex((s) => s.key === current);

  return STAGE_DEFS.map((s, i) => ({
    key: s.key,
    label: s.label,
    status: i < currentIdx ? "done" : i === currentIdx ? "current" : "pending",
  }));
}

function assessRisk(ctx: {
  taskProgress: number;
  timeProgress: number;
  isOverdue: boolean;
  daysRemaining: number;
  dueDate: Date | null;
  openTasks: number;
}): { riskLevel: ProjectProgress["riskLevel"]; riskLabel: string | null; isAtRisk: boolean } {
  if (ctx.isOverdue) {
    return { riskLevel: "high", riskLabel: "已逾期", isAtRisk: true };
  }

  if (ctx.dueDate && ctx.daysRemaining <= 3 && ctx.daysRemaining >= 0 && ctx.taskProgress < 80) {
    return {
      riskLevel: "high",
      riskLabel: `还剩 ${ctx.daysRemaining} 天，完成度仅 ${ctx.taskProgress}%`,
      isAtRisk: true,
    };
  }

  if (ctx.timeProgress > 0 && ctx.taskProgress > 0) {
    const gap = ctx.timeProgress - ctx.taskProgress;
    if (gap >= 30) {
      return {
        riskLevel: "medium",
        riskLabel: `进度落后于计划 ${gap}%`,
        isAtRisk: true,
      };
    }
    if (gap >= 15) {
      return {
        riskLevel: "low",
        riskLabel: `进度略落后于计划`,
        isAtRisk: true,
      };
    }
  }

  return { riskLevel: "none", riskLabel: null, isAtRisk: false };
}
