/** 运营中心首页只读 View Model（非 Prisma 模型） */

export type OpsItemKind =
  | "overdue_task"
  | "due_today_task"
  | "stale_task"
  | "pending_action"
  | "followup_reminder";

export type OpsDashboardItem = {
  id: string;
  kind: OpsItemKind;
  title: string;
  projectId: string | null;
  projectName: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  statusLabel: string;
  sourceLabel: string;
  href: string;
  secondaryHref: string | null;
  priority: string | null;
};

export type OpsTaskSummary = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  projectId: string | null;
  projectName: string | null;
  assigneeName: string | null;
  sourceLabel: string;
  updatedAt: string;
};

export type OpsPendingActionSummary = {
  id: string;
  type: string;
  title: string;
  status: string;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
  agentRunId: string | null;
  reasonPreview: string | null;
  href: string;
};

export type OpsRelatedProjectSummary = {
  id: string;
  name: string;
  openTaskCount: number;
  overdueTaskCount: number;
  updatedAt: string;
};

export type OpsDashboardCounts = {
  overdue: number;
  dueToday: number;
  pendingApproval: number;
  inProgress: number;
};

export type OpsDashboardData = {
  generatedAt: string;
  dateLabel: string;
  userName: string;
  viewMode: "mine" | "team";
  canToggleTeamView: boolean;
  urgentItems: OpsDashboardItem[];
  todayTasks: OpsTaskSummary[];
  waitingItems: OpsDashboardItem[];
  pendingActions: OpsPendingActionSummary[];
  relatedProjects: OpsRelatedProjectSummary[];
  counts: OpsDashboardCounts;
  notes: string[];
};
