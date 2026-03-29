"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface InspectionStep {
  id: string;
  title: string;
  status: string;
  outputSummary: string | null;
  checkReportJson: string | null;
}

interface InspectionTask {
  id: string;
  taskType: string;
  triggerType: string;
  intent: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  createdAt: string;
  completedAt: string | null;
  project: { id: string; name: string };
  steps: InspectionStep[];
}

const STATUS_MAP: Record<string, { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  completed: { label: "正常", color: "text-[#2e7a56]", Icon: CheckCircle2 },
  failed: { label: "有异常", color: "text-[#a63d3d]", Icon: XCircle },
  running: { label: "执行中", color: "text-accent", Icon: Loader2 },
  waiting_for_approval: { label: "待审批", color: "text-[#9a6a2f]", Icon: Clock },
};

interface Props {
  onProjectClick?: (id: string) => void;
}

export function DashboardAutoInspections({ onProjectClick }: Props) {
  const [tasks, setTasks] = useState<InspectionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true);
    apiFetch("/api/agent/tasks/recent?triggerType=cron&limit=5")
      .then((r) => r.json())
      .then((data) => setTasks(data.tasks ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-accent/20 bg-card-bg p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Shield size={15} className="text-accent" />
          自动巡检
        </div>
        <div className="mt-4 flex items-center justify-center py-4">
          <Loader2 size={18} className="animate-spin text-accent/40" />
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Shield size={15} className="text-accent" />
          自动巡检
        </div>
        <p className="mt-3 text-xs text-muted">暂无自动巡检记录。开启后，系统将每日自动检查活跃项目。</p>
      </div>
    );
  }

  const failedCount = tasks.filter((t) => t.status === "failed").length;

  return (
    <div className="rounded-xl border border-accent/20 bg-card-bg">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield size={15} className="text-accent" />
          <h2 className="text-sm font-semibold">自动巡检</h2>
          {failedCount > 0 && (
            <span className="rounded-full bg-[rgba(166,61,61,0.1)] px-2 py-0.5 text-[11px] font-medium text-[#a63d3d]">
              {failedCount} 项异常
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => load(false)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground"
        >
          <RefreshCw size={11} />
          刷新
        </button>
      </div>

      <div className="divide-y divide-border">
        {tasks.map((task) => {
          const st = STATUS_MAP[task.status] ?? STATUS_MAP.completed;
          const expanded = expandedId === task.id;
          const issueSteps = task.steps.filter((s) => {
            if (!s.checkReportJson) return false;
            try {
              const report = JSON.parse(s.checkReportJson);
              return report.issues && report.issues.length > 0;
            } catch {
              return false;
            }
          });

          return (
            <div key={task.id} className="px-4 py-3">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : task.id)}
                className="flex w-full items-center gap-3 text-left"
              >
                <st.Icon size={14} className={cn(st.color, task.status === "running" && "animate-spin")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{task.project.name}</span>
                    <span className={cn("text-[10px] font-medium", st.color)}>{st.label}</span>
                  </div>
                  <div className="text-[10px] text-muted">
                    {new Date(task.createdAt).toLocaleDateString("zh-CN", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {task.totalSteps} 个检查步骤
                    {issueSteps.length > 0 && ` · ${issueSteps.length} 项发现`}
                  </div>
                </div>
                {expanded ? (
                  <ChevronDown size={14} className="text-muted" />
                ) : (
                  <ChevronRight size={14} className="text-muted" />
                )}
              </button>

              {expanded && (
                <div className="mt-2 space-y-1.5 pl-7">
                  {task.steps.map((step) => {
                    let issues: Array<{ level: string; message: string }> = [];
                    if (step.checkReportJson) {
                      try {
                        const report = JSON.parse(step.checkReportJson);
                        issues = report.issues ?? [];
                      } catch {}
                    }

                    return (
                      <div key={step.id} className="rounded-md border border-border px-3 py-2">
                        <div className="flex items-center gap-2">
                          {step.status === "completed" ? (
                            <CheckCircle2 size={11} className="text-[#2e7a56]" />
                          ) : step.status === "failed" ? (
                            <XCircle size={11} className="text-[#a63d3d]" />
                          ) : (
                            <Clock size={11} className="text-muted" />
                          )}
                          <span className="text-[11px] font-medium">{step.title}</span>
                        </div>
                        {step.outputSummary && (
                          <p className="mt-1 text-[10px] text-muted leading-relaxed">{step.outputSummary}</p>
                        )}
                        {issues.length > 0 && (
                          <div className="mt-1.5 space-y-0.5">
                            {issues.slice(0, 5).map((issue, i) => (
                              <div
                                key={i}
                                className={cn(
                                  "flex items-start gap-1.5 text-[10px]",
                                  issue.level === "error" ? "text-[#a63d3d]" : "text-[#9a6a2f]"
                                )}
                              >
                                <AlertTriangle size={9} className="mt-0.5 shrink-0" />
                                {issue.message}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <Link
                    href={`/projects/${task.project.id}`}
                    className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                    onClick={(e) => {
                      if (onProjectClick) {
                        e.preventDefault();
                        onProjectClick(task.project.id);
                      }
                    }}
                  >
                    查看项目详情
                    <ChevronRight size={10} />
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
