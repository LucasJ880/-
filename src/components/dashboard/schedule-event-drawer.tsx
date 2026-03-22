"use client";

import {
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FolderOpen,
  ListTodo,
  MapPin,
  Pencil,
  Tag,
  Trash2,
  X,
  Bell,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ScheduleEvent } from "./types";

interface Props {
  event: ScheduleEvent | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (event: ScheduleEvent) => void;
  onDelete?: (id: string) => void;
  onOpenProject?: (projectId: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  calendar: "日历事件",
  task_due: "任务截止",
  reminder: "提醒",
  followup: "跟进提醒",
};

const SOURCE_LABELS: Record<string, string> = {
  local: "青砚",
  google: "Google",
  task: "任务",
  system: "系统",
};

const PRIORITY_MAP: Record<string, { label: string; cls: string }> = {
  urgent: { label: "紧急", cls: "bg-danger/10 text-danger" },
  high: { label: "高", cls: "bg-warning/10 text-warning" },
  medium: { label: "中", cls: "bg-accent/10 text-accent" },
  low: { label: "低", cls: "bg-muted/30 text-muted" },
};

import { formatHHmmToronto, formatISODateToronto } from "@/lib/time";

function fmtTime(iso: string) {
  return formatHHmmToronto(iso);
}

function fmtDate(iso: string) {
  return formatISODateToronto(iso);
}

function fmtRange(start: string, end: string, allDay: boolean) {
  if (allDay) return `${fmtDate(start)}  全天`;
  const sameDay = fmtDate(start) === fmtDate(end);
  if (sameDay) return `${fmtDate(start)}  ${fmtTime(start)} – ${fmtTime(end)}`;
  return `${fmtDate(start)} ${fmtTime(start)} – ${fmtDate(end)} ${fmtTime(end)}`;
}

function sourceIcon(s: string) {
  if (s === "google") return "G";
  if (s === "task") return "T";
  if (s === "system") return "S";
  return "Q";
}

export function ScheduleEventDrawer({
  event,
  open,
  onClose,
  onEdit,
  onDelete,
  onOpenProject,
}: Props) {
  if (!event) return null;

  const pri = PRIORITY_MAP[event.priority] ?? PRIORITY_MAP.medium;
  const realEntityId = event.entityId ?? event.id.replace(/^(cal_|task_|rem_)/, "");
  const isTaskDue = event.type === "task_due";
  const isFollowup = event.type === "followup";
  const isCalendar = event.type === "calendar";

  return (
    <>
      {/* backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] transition-opacity duration-250",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />

      {/* panel */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-[420px] flex-col border-l border-border bg-[var(--card-bg)] shadow-[var(--shadow-float)] transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug text-foreground">
              {event.title}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {/* type badge */}
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/8 px-2 py-0.5 text-[11px] font-medium text-accent">
                {isCalendar && <Calendar size={11} />}
                {isTaskDue && <ListTodo size={11} />}
                {isFollowup && <Bell size={11} />}
                {TYPE_LABELS[event.type] ?? event.type}
              </span>

              {/* source badge */}
              <span className="inline-flex items-center gap-0.5 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent/10 text-[9px] font-bold text-accent">
                  {sourceIcon(event.source)}
                </span>
                {SOURCE_LABELS[event.source] ?? event.source}
              </span>

              {/* priority badge */}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  pri.cls
                )}
              >
                {pri.label}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="mt-0.5 rounded-[var(--radius-sm)] p-1.5 text-muted transition-colors hover:bg-[rgba(43,96,85,0.06)] hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* time info */}
          <div className="flex items-start gap-2.5 text-sm">
            <Clock size={15} className="mt-0.5 shrink-0 text-accent" />
            <span className="text-foreground/80">
              {fmtRange(event.startAt, event.endAt, event.allDay)}
            </span>
          </div>

          {/* location */}
          {event.location && (
            <div className="flex items-start gap-2.5 text-sm">
              <MapPin size={15} className="mt-0.5 shrink-0 text-accent" />
              <span className="text-foreground/80">{event.location}</span>
            </div>
          )}

          {/* project */}
          {event.projectName && (
            <div className="flex items-start gap-2.5 text-sm">
              <FolderOpen size={15} className="mt-0.5 shrink-0 text-accent" />
              <button
                onClick={() =>
                  event.projectId && onOpenProject?.(event.projectId)
                }
                className="text-accent underline-offset-2 transition-colors hover:underline"
              >
                {event.projectName}
              </button>
            </div>
          )}

          {/* status */}
          {event.status && (
            <div className="flex items-start gap-2.5 text-sm">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-accent" />
              <span className="text-foreground/80">状态：{event.status}</span>
            </div>
          )}

          {/* description */}
          {event.description && (
            <div className="rounded-lg border border-border/40 bg-[rgba(43,96,85,0.02)] px-4 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/70">
                {event.description}
              </p>
            </div>
          )}

          {/* context section */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
              快捷导航
            </h4>
            <div className="flex flex-wrap gap-2">
              {event.taskId && (
                <Link
                  href={`/tasks/${event.taskId}`}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border/60 bg-card-bg px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:border-accent/40 hover:text-accent"
                >
                  <ListTodo size={12} />
                  查看任务
                  <ExternalLink size={10} />
                </Link>
              )}
              {event.projectId && (
                <button
                  onClick={() => onOpenProject?.(event.projectId!)}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border/60 bg-card-bg px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:border-accent/40 hover:text-accent"
                >
                  <FolderOpen size={12} />
                  项目详情
                </button>
              )}
              {event.entityType === "task" && event.entityId && (
                <Link
                  href={`/tasks/${event.entityId}`}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border/60 bg-card-bg px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:border-accent/40 hover:text-accent"
                >
                  <Tag size={12} />
                  关联对象
                  <ExternalLink size={10} />
                </Link>
              )}
            </div>
          </div>

          {/* context summary cards */}
          {isTaskDue && event.taskId && (
            <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-medium text-warning">
                <AlertTriangle size={13} />
                任务截止提醒
              </div>
              <p className="mt-1 text-sm text-foreground/70">
                该任务将于 {fmtTime(event.startAt)} 到期，请及时处理。
              </p>
            </div>
          )}

          {isFollowup && (
            <div className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-medium text-accent">
                <Bell size={13} />
                跟进提醒
              </div>
              <p className="mt-1 text-sm text-foreground/70">
                计划 {fmtTime(event.startAt)} 跟进处理
                {event.taskId ? "，已关联到对应任务" : ""}。
              </p>
            </div>
          )}
        </div>

        {/* footer actions */}
        {(event.isEditable || event.isDeletable) && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {event.isEditable && onEdit && (
              <button
                onClick={() => onEdit(event)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border/60 px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:border-accent/40 hover:text-accent"
              >
                <Pencil size={12} />
                编辑
              </button>
            )}
            {event.isDeletable && onDelete && (
              <button
                onClick={() => {
                  const realId = event.id.replace(/^(cal_|task_|rem_)/, "");
                  onDelete(realId);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-danger/30 px-3 py-1.5 text-xs text-danger/70 transition-colors hover:border-danger hover:text-danger"
              >
                <Trash2 size={12} />
                删除
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
