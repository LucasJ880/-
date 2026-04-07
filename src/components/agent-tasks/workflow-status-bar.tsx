"use client";

import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  XCircle,
  Clock,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TaskSummary {
  id: string;
  status: string;
  totalSteps: number;
  steps: Array<{ status: string; completedAt: string | null; startedAt: string | null }>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Props {
  tasks: TaskSummary[];
}

export function WorkflowStatusBar({ tasks }: Props) {
  if (tasks.length === 0) return null;

  const completed = tasks.filter((t) => t.status === "completed").length;
  const running = tasks.filter((t) =>
    ["running", "waiting_for_subagent", "waiting_for_tool"].includes(t.status)
  ).length;
  const waiting = tasks.filter((t) => t.status === "waiting_for_approval").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const queued = tasks.filter((t) => t.status === "queued" || t.status === "draft").length;

  const totalSteps = tasks.reduce((sum, t) => sum + t.totalSteps, 0);
  const completedSteps = tasks.reduce(
    (sum, t) =>
      sum + t.steps.filter((s) => ["completed", "approved", "skipped"].includes(s.status)).length,
    0
  );

  const lastActivity = tasks
    .flatMap((t) => t.steps)
    .filter((s) => s.completedAt)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())[0];

  return (
    <div className="flex items-center gap-4 px-5 py-2.5 border-b border-border/20 bg-muted/10">
      {/* Progress */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
              style={{ width: `${totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0}%` }}
            />
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {completedSteps}/{totalSteps} 步
        </span>
      </div>

      {/* Status badges */}
      <div className="flex items-center gap-2">
        {running > 0 && (
          <StatusBadge icon={Loader2} count={running} color="text-blue-600 bg-blue-50" spin label="运行中" />
        )}
        {waiting > 0 && (
          <StatusBadge icon={AlertTriangle} count={waiting} color="text-amber-600 bg-amber-50" label="待审批" />
        )}
        {failed > 0 && (
          <StatusBadge icon={XCircle} count={failed} color="text-red-600 bg-red-50" label="失败" />
        )}
        {completed > 0 && (
          <StatusBadge icon={CheckCircle2} count={completed} color="text-green-600 bg-green-50" label="完成" />
        )}
        {queued > 0 && (
          <StatusBadge icon={Clock} count={queued} color="text-slate-600 bg-slate-50" label="排队" />
        )}
      </div>

      {/* Last activity */}
      {lastActivity?.completedAt && (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden sm:inline">
          最近 {timeAgo(lastActivity.completedAt)}
        </span>
      )}
    </div>
  );
}

function StatusBadge({
  icon: Icon,
  count,
  color,
  spin,
  label,
}: {
  icon: React.ElementType;
  count: number;
  color: string;
  spin?: boolean;
  label: string;
}) {
  return (
    <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium", color)} title={label}>
      <Icon className={cn("h-3 w-3", spin && "animate-spin")} />
      <span>{count}</span>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}
