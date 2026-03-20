export interface TaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  project: { name: string; color: string } | null;
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
  recentTasks: (TaskItem & { updatedAt: string })[];
}

export interface ReminderSummaryData {
  immediate: {
    sourceKey: string;
    type: string;
    title: string;
    subtitle: string;
  }[];
  today: {
    sourceKey: string;
    type: string;
    title: string;
    subtitle: string;
  }[];
  upcoming: {
    sourceKey: string;
    type: string;
    title: string;
    subtitle: string;
  }[];
  unreadCount: number;
}

export interface SimpleTask {
  id: string;
  title: string;
}
