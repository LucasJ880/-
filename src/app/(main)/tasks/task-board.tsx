"use client";

import { useState } from "react";
import Link from "next/link";
import { Circle, Clock, CheckCircle2 } from "lucide-react";
import { cn, TASK_PRIORITY, type TaskStatus, type TaskPriority } from "@/lib/utils";
import { daysRemainingToronto, toToronto } from "@/lib/time";

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  needReminder: boolean;
  createdAt: string;
  project: { id: string; name: string; color: string } | null;
  assignee: { id: string; name: string } | null;
}

const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function prioritySort(a: Task, b: Task): number {
  return (PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2);
}

function formatDue(dueDate: string | null, taskStatus: string): { text: string; cls: string } | null {
  if (!dueDate) return null;
  const diff = daysRemainingToronto(dueDate);
  if (taskStatus === "done" || taskStatus === "cancelled") {
    const t = toToronto(new Date(dueDate));
    return { text: `${t.getMonth() + 1}/${t.getDate()}`, cls: "text-muted" };
  }
  if (diff < 0) return { text: `逾期${Math.abs(diff)}天`, cls: "text-[#a63d3d] font-medium" };
  if (diff === 0) return { text: "今天", cls: "text-[#b06a28] font-medium" };
  if (diff === 1) return { text: "明天", cls: "text-[#9a6a2f]" };
  const t = toToronto(new Date(dueDate));
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][t.getDay()];
  if (diff <= 6) return { text: weekday, cls: "text-muted" };
  return { text: `${t.getMonth() + 1}/${t.getDate()}`, cls: "text-muted" };
}

const KANBAN_COLUMNS: { status: TaskStatus; label: string; icon: typeof Circle; color: string }[] = [
  { status: "todo", label: "待办", icon: Circle, color: "#6e7d76" },
  { status: "in_progress", label: "进行中", icon: Clock, color: "#2b6055" },
  { status: "done", label: "已完成", icon: CheckCircle2, color: "#2e7a56" },
];

function KanbanCard({
  task, onOpenDrawer, draggingId, onDragStart, onDragEnd,
}: {
  task: Task; onOpenDrawer: (id: string) => void;
  onToggle?: (id: string, s: TaskStatus) => void;
  draggingId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const due = formatDue(task.dueDate, task.status);
  const isDragging = draggingId === task.id;
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", task.id); onDragStart(task.id); }}
      onDragEnd={onDragEnd}
      className={cn(
        "cursor-grab rounded-lg border border-border bg-card-bg p-3 shadow-sm transition-all hover:shadow-md active:cursor-grabbing",
        isDragging && "opacity-40 scale-95"
      )}
    >
      <button onClick={() => onOpenDrawer(task.id)} className="w-full text-left">
        <p className={cn("text-sm font-medium leading-snug", task.status === "done" && "text-muted line-through")}>{task.title}</p>
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          {task.project && (
            <Link
              href={`/projects/${task.project.id}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-muted hover:text-accent transition-colors"
            >
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: task.project.color }} />
              <span className="max-w-[120px] truncate">{task.project.name}</span>
            </Link>
          )}
          {due && <span className={cn("whitespace-nowrap", due.cls)}>{due.text}</span>}
          {(task.priority === "urgent" || task.priority === "high") && (
            <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", TASK_PRIORITY[task.priority].color)}>
              {TASK_PRIORITY[task.priority].label}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

function KanbanColumn({
  column, tasks, onOpenDrawer, onToggle, onDrop, draggingId, onDragStart, onDragEnd, dragOver, setDragOver,
}: {
  column: typeof KANBAN_COLUMNS[0]; tasks: Task[];
  onOpenDrawer: (id: string) => void; onToggle: (id: string, s: TaskStatus) => void;
  onDrop: (taskId: string, newStatus: TaskStatus) => void;
  draggingId: string | null; onDragStart: (id: string) => void; onDragEnd: () => void;
  dragOver: string | null; setDragOver: (s: string | null) => void;
}) {
  const Icon = column.icon;
  const isOver = dragOver === column.status;
  return (
    <div
      className={cn(
        "flex flex-1 flex-col rounded-xl border bg-background/50 transition-colors",
        isOver ? "border-accent/40 bg-accent/5" : "border-border"
      )}
      onDragOver={(e) => { e.preventDefault(); setDragOver(column.status); }}
      onDragLeave={() => setDragOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(null);
        const taskId = e.dataTransfer.getData("text/plain");
        if (taskId) onDrop(taskId, column.status);
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <Icon size={14} style={{ color: column.color }} />
        <span className="text-sm font-semibold">{column.label}</span>
        <span className="ml-auto rounded-full bg-border/40 px-1.5 py-0.5 text-[10px] font-medium text-muted">{tasks.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ minHeight: 120 }}>
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted/50">拖拽到此处</div>
        ) : (
          tasks.map((t) => (
            <KanbanCard key={t.id} task={t} onOpenDrawer={onOpenDrawer} onToggle={onToggle} draggingId={draggingId} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          ))
        )}
      </div>
    </div>
  );
}

export function TaskKanbanView({
  filteredTasks, onOpenDrawer, onToggle, onDrop,
}: {
  filteredTasks: Task[];
  onOpenDrawer: (id: string) => void;
  onToggle: (id: string, s: TaskStatus) => void;
  onDrop: (taskId: string, newStatus: TaskStatus) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  return (
    <div className="flex gap-4" style={{ minHeight: 400 }}>
      {KANBAN_COLUMNS.map((col) => {
        const colTasks = filteredTasks.filter((t) => t.status === col.status).sort(prioritySort);
        return <KanbanColumn key={col.status} column={col} tasks={colTasks} onOpenDrawer={onOpenDrawer} onToggle={onToggle} onDrop={onDrop} draggingId={draggingId} onDragStart={setDraggingId} onDragEnd={() => setDraggingId(null)} dragOver={dragOver} setDragOver={setDragOver} />;
      })}
    </div>
  );
}
