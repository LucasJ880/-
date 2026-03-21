export interface TaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  projectId?: string | null;
  project: { id?: string; name: string; color: string } | null;
}

export interface ProjectBreakdown {
  id: string;
  name: string;
  color: string;
  total: number;
  done: number;
  inProgress: number;
  todo: number;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
  source?: "qingyan" | "google";
  task: { id: string; title: string; status: string } | null;
}

export interface ProjectProgressData {
  taskProgress: number;
  completedTasks: number;
  totalTasks: number;
  timeProgress: number;
  startDate: string | null;
  dueDate: string | null;
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  currentStage: string;
  stages: { key: string; label: string; status: "done" | "current" | "pending" }[];
  riskLevel: "none" | "low" | "medium" | "high";
  riskLabel: string | null;
  isOverdue: boolean;
  isAtRisk: boolean;
  weekDelta: number;
}

export interface Stats {
  totalTasks: number;
  todoCount: number;
  inProgressCount: number;
  doneCount: number;
  totalProjects: number;
  week: {
    created: number;
    completed: number;
    overdue: number;
    active: number;
  };
  highPriorityTasks: TaskItem[];
  upcomingTasks: TaskItem[];
  projectBreakdown: ProjectBreakdown[];
  projectProgress: Record<string, ProjectProgressData>;
  recentTasks: (TaskItem & { updatedAt: string })[];
}

export interface ReminderItemData {
  sourceKey: string;
  type: string;
  title: string;
  subtitle: string;
  taskId?: string | null;
  projectId?: string | null;
  project?: { id?: string; name: string; color: string } | null;
}

export interface ReminderSummaryData {
  immediate: ReminderItemData[];
  today: ReminderItemData[];
  upcoming: ReminderItemData[];
  unreadCount: number;
}

export interface SimpleTask {
  id: string;
  title: string;
}

export interface ScheduleEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  type: "calendar" | "task_due" | "reminder" | "followup";
  source: "local" | "google" | "task" | "system";
  priority: "low" | "medium" | "high" | "urgent";
  status: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  entityType: string | null;
  entityId: string | null;
  taskId: string | null;
  description: string | null;
  location: string | null;
  isEditable: boolean;
  isDeletable: boolean;
}
