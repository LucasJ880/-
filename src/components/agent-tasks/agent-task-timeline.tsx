"use client";

import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  XCircle,
  SkipForward,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./approval-card";

interface TaskStep {
  id: string;
  stepIndex: number;
  skillId: string;
  agentName: string;
  title: string;
  status: string;
  riskLevel: string;
  requiresApproval: boolean;
  outputSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  approvalRequests?: Array<{ deadlineAt: string | null; status: string }>;
}

interface Props {
  taskId: string;
  steps: TaskStep[];
  onRefresh: () => void;
}

const STEP_ICON: Record<string, { icon: React.ElementType; color: string }> = {
  pending:          { icon: Circle,         color: "text-slate-400" },
  running:          { icon: Loader2,        color: "text-blue-500" },
  waiting_approval: { icon: AlertTriangle,  color: "text-amber-500" },
  approved:         { icon: CheckCircle2,   color: "text-emerald-500" },
  completed:        { icon: CheckCircle2,   color: "text-green-500" },
  failed:           { icon: XCircle,        color: "text-red-500" },
  rejected:         { icon: XCircle,        color: "text-red-500" },
  skipped:          { icon: SkipForward,    color: "text-gray-400" },
};

export function AgentTaskTimeline({ taskId, steps, onRefresh }: Props) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  return (
    <div className="relative">
      {/* 竖线 */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/50" />

      <div className="space-y-1">
        {steps.map((step, idx) => {
          const cfg = STEP_ICON[step.status] ?? STEP_ICON.pending;
          const Icon = cfg.icon;
          const isLast = idx === steps.length - 1;
          const isExpanded = expandedStep === step.id;
          const hasDetail = step.outputSummary || step.error || step.status === "waiting_approval";

          return (
            <div key={step.id}>
              {/* 步骤行 */}
              <div
                className={cn(
                  "flex items-start gap-3 relative",
                  hasDetail ? "cursor-pointer" : ""
                )}
                onClick={() => hasDetail && setExpandedStep(isExpanded ? null : step.id)}
              >
                {/* 图标 */}
                <div className="relative z-10 flex-shrink-0 mt-0.5">
                  <Icon
                    className={cn(
                      "h-[22px] w-[22px]",
                      cfg.color,
                      step.status === "running" ? "animate-spin" : ""
                    )}
                  />
                </div>

                {/* 内容 */}
                <div className={cn("flex-1 min-w-0", isLast ? "" : "pb-2")}>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-sm",
                      step.status === "completed" || step.status === "approved"
                        ? "text-foreground"
                        : step.status === "pending" || step.status === "skipped"
                        ? "text-muted-foreground"
                        : "text-foreground font-medium"
                    )}>
                      {step.title}
                    </span>

                    {step.riskLevel !== "low" && (
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded",
                        step.riskLevel === "high"
                          ? "bg-red-500/10 text-red-600"
                          : "bg-amber-500/10 text-amber-600"
                      )}>
                        {step.riskLevel === "high" ? "高风险" : "中风险"}
                      </span>
                    )}

                    {hasDetail && (
                      <span className="flex-shrink-0">
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        )}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {step.agentName}
                    {step.completedAt && (
                      <span> · {new Date(step.completedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* 展开详情 */}
              {isExpanded && (
                <div className="ml-8 mt-1 mb-2">
                  {step.status === "waiting_approval" && (
                    <ApprovalCard
                      taskId={taskId}
                      step={{
                        ...step,
                        deadlineAt: step.approvalRequests?.[0]?.deadlineAt ?? null,
                        approvalStatus: step.approvalRequests?.[0]?.status ?? null,
                      }}
                      onAction={onRefresh}
                    />
                  )}

                  {step.outputSummary && step.status !== "waiting_approval" && (
                    <div className="rounded-lg border border-border/30 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      {step.outputSummary}
                    </div>
                  )}

                  {step.error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600">
                      {step.error}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
