export type SalesActionDto = {
  id: string;
  signalKey: string;
  category: string;
  title: string;
  description: string | null;
  priority: string;
  status: "open" | "in_progress" | "completed" | "dismissed" | "auto_resolved";
  dueAt: string | null;
  resolutionNote: string | null;
  dismissedReason: string | null;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  opportunity: { id: string; title: string; stage: string } | null;
  assignedTo: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
};

export type SalesActionMetrics = {
  open: number;
  overdue: number;
  completed: number;
  dismissed: number;
  autoResolved: number;
  completionRate: number | null;
};

export type SalesActionSyncDto = {
  status: "running" | "completed" | "failed";
  scannedCount: number;
  createdCount: number;
  autoResolvedCount: number;
  truncated: boolean;
  startedAt: string;
  completedAt: string | null;
};
