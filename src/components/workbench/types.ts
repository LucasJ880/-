import type {
  ProjectProgressData,
  ReminderItemData,
  TaskItem,
} from "@/components/dashboard/types";

/** 队列项类型：entity = 真实对象；summary = 仅有数量的汇总卡 */
export type WorkQueueKind =
  | "task_overdue"
  | "task_due_today"
  | "task_in_progress"
  | "project_risk"
  | "reminder_followup"
  | "summary_overdue"
  | "summary_approvals"
  | "summary_dispatch";

export type WorkEntityType = "task" | "project" | "reminder" | "summary";

export type WorkQueueItem = {
  id: string;
  kind: WorkQueueKind;
  /** 越小越靠前 */
  rank: number;
  title: string;
  subtitle: string | null;
  entityType: WorkEntityType;
  /** 任务/项目真实 id；汇总卡为空 */
  entityId: string | null;
  task?: TaskItem;
  projectId?: string | null;
  projectName?: string | null;
  projectColor?: string | null;
  progress?: ProjectProgressData;
  reminder?: ReminderItemData;
  summaryCount?: number;
  /** 汇总卡跳转 */
  summaryHref?: string;
  dueDate?: string | null;
  status?: string | null;
  riskLevel?: ProjectProgressData["riskLevel"];
};

export type WorkbenchSelection =
  | { type: "queue"; itemId: string }
  | null;
