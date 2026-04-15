"use client";

import { useState } from "react";
import {
  ChevronDown,
  Trash2,
  Clock,
  CheckSquare,
  Flag,
  LayoutList,
  FolderKanban,
  Columns3,
} from "lucide-react";
import {
  cn,
  TASK_STATUS,
  TASK_PRIORITY,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/utils";

type ViewMode = "time" | "project" | "kanban";

/* ── Batch Action Bar ── */
export function BatchActionBar({
  count, onStatusChange, onPriorityChange, onDelete, onCancel,
}: {
  count: number;
  onStatusChange: (s: TaskStatus) => void;
  onPriorityChange: (p: TaskPriority) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [showStatus, setShowStatus] = useState(false);
  const [showPriority, setShowPriority] = useState(false);
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5 shadow-sm">
      <CheckSquare size={16} className="text-accent" />
      <span className="text-sm font-medium text-accent">已选 {count} 项</span>
      <div className="flex items-center gap-2 ml-auto">
        {/* Status dropdown */}
        <div className="relative">
          <button onClick={() => { setShowStatus(!showStatus); setShowPriority(false); }} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-background">
            <Clock size={12} /> 改状态 <ChevronDown size={10} />
          </button>
          {showStatus && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowStatus(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-border bg-card-bg py-1 shadow-lg">
                {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
                  <button key={s} onClick={() => { setShowStatus(false); onStatusChange(s); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-background">
                    {TASK_STATUS[s].label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Priority dropdown */}
        <div className="relative">
          <button onClick={() => { setShowPriority(!showPriority); setShowStatus(false); }} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-background">
            <Flag size={12} /> 改优先级 <ChevronDown size={10} />
          </button>
          {showPriority && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowPriority(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-28 rounded-lg border border-border bg-card-bg py-1 shadow-lg">
                {(Object.keys(TASK_PRIORITY) as TaskPriority[]).map((p) => (
                  <button key={p} onClick={() => { setShowPriority(false); onPriorityChange(p); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-background">
                    {TASK_PRIORITY[p].label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button onClick={onDelete} className="flex items-center gap-1.5 rounded-lg border border-[rgba(166,61,61,0.2)] px-2.5 py-1.5 text-xs font-medium text-[#a63d3d] hover:bg-[rgba(166,61,61,0.04)]">
          <Trash2 size={12} /> 删除
        </button>
        <button onClick={onCancel} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-background">
          取消
        </button>
      </div>
    </div>
  );
}

/* ── Filter tabs + view toggle ── */
export function TaskFilters({
  filter, onFilterChange,
  viewMode, onViewModeChange,
  statusCounts,
}: {
  filter: TaskStatus | "all";
  onFilterChange: (f: TaskStatus | "all") => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  statusCounts: Record<string, number>;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex gap-2 flex-wrap">
        {(["all", "todo", "in_progress", "done", "cancelled"] as const).map((s) => {
          const count = statusCounts[s];
          const label = s === "all" ? "全部" : TASK_STATUS[s].label;
          return (
            <button key={s} onClick={() => onFilterChange(s)} className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors", filter === s ? "border-accent bg-accent/5 font-medium text-accent" : "border-border text-muted hover:bg-card-bg")}>
              {label} <span className="text-xs opacity-60">({count})</span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-1 rounded-lg border border-border p-0.5">
        <button onClick={() => onViewModeChange("time")} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", viewMode === "time" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground")}>
          <LayoutList size={13} /> 时间
        </button>
        <button onClick={() => onViewModeChange("project")} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", viewMode === "project" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground")}>
          <FolderKanban size={13} /> 项目
        </button>
        <button onClick={() => onViewModeChange("kanban")} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", viewMode === "kanban" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground")}>
          <Columns3 size={13} /> 看板
        </button>
      </div>
    </div>
  );
}
