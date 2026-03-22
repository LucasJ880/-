"use client";

import { Calendar, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TenderProject } from "@/lib/tender/types";

function fmtDateShort(raw: string | null): string {
  if (!raw) return "待补充";
  const d = new Date(raw);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function isWithin48h(raw: string | null): boolean {
  if (!raw) return false;
  const diff = new Date(raw).getTime() - Date.now();
  return diff > 0 && diff < 48 * 3600_000;
}

function isPast(raw: string | null): boolean {
  if (!raw) return false;
  return new Date(raw).getTime() < Date.now();
}

interface DateChipProps {
  label: string;
  value: string | null;
  warn?: boolean;
  overdue?: boolean;
  icon?: React.ReactNode;
}

function DateChip({ label, value, warn, overdue, icon }: DateChipProps) {
  const isEmpty = !value;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        overdue
          ? "border-danger/30 bg-danger-light"
          : warn
            ? "border-warning/30 bg-warning-light"
            : isEmpty
              ? "border-border border-dashed bg-background"
              : "border-border bg-card-bg"
      )}
    >
      <span className="text-muted">{icon || <Calendar size={14} />}</span>
      <div className="min-w-0">
        <span className="text-[11px] text-muted">{label}</span>
        <p
          className={cn(
            "text-xs font-medium",
            overdue
              ? "text-danger-text"
              : warn
                ? "text-warning-text"
                : isEmpty
                  ? "text-muted italic"
                  : "text-foreground"
          )}
        >
          {fmtDateShort(value)}
        </p>
      </div>
    </div>
  );
}

export function ProjectKeyDates({ project }: { project: TenderProject }) {
  const closeDate = project.closeDate || project.dueDate;
  const qCloseOverdue = isPast(project.questionCloseDate);
  const qCloseWarn = !qCloseOverdue && isWithin48h(project.questionCloseDate);
  const closeOverdue = isPast(closeDate) && !project.submittedAt;
  const closeWarn = !closeOverdue && isWithin48h(closeDate);

  return (
    <div className="flex flex-wrap gap-2">
      <DateChip
        label="发布时间"
        value={project.publicDate}
        icon={<Calendar size={14} />}
      />
      <DateChip
        label="提问截止"
        value={project.questionCloseDate}
        warn={qCloseWarn}
        overdue={qCloseOverdue}
        icon={qCloseWarn || qCloseOverdue ? <AlertTriangle size={14} /> : <Clock size={14} />}
      />
      <DateChip
        label="截标时间"
        value={closeDate}
        warn={closeWarn}
        overdue={closeOverdue}
        icon={closeWarn || closeOverdue ? <AlertTriangle size={14} /> : <Clock size={14} />}
      />
    </div>
  );
}
