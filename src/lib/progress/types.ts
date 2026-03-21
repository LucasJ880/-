export interface ProjectProgress {
  taskProgress: number;
  completedTasks: number;
  totalTasks: number;
  timeProgress: number;
  startDate: string | null;
  dueDate: string | null;
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  currentStage: ProjectStage;
  stages: StageItem[];
  riskLevel: "none" | "low" | "medium" | "high";
  riskLabel: string | null;
  isOverdue: boolean;
  isAtRisk: boolean;
  weekDelta: number;
}

export interface StageItem {
  key: string;
  label: string;
  status: "done" | "current" | "pending";
}

export type ProjectStage =
  | "setup"
  | "configuring"
  | "testing"
  | "running"
  | "evaluating"
  | "mature";

export interface ProjectProgressInput {
  id: string;
  startDate: Date | null;
  dueDate: Date | null;
  status: string;
  taskStats: { total: number; done: number; inProgress: number };
  moduleStats: {
    prompts: number;
    knowledgeBases: number;
    agents: number;
    conversations: number;
    evaluations: number;
    feedbacks: number;
  };
  weekCompletedTasks: number;
}
