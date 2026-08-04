export type SalesActionDto = {
  id: string;
  signalKey: string;
  category: string;
  title: string;
  description: string | null;
  priority: string;
  status: "open" | "in_progress" | "completed" | "dismissed";
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
  completionRate: number | null;
};
