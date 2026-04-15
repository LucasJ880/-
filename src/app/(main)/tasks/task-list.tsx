"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  MoreHorizontal,
  CheckSquare,
  Square,
  AlertTriangle,
} from "lucide-react";
import {
  cn,
  TASK_PRIORITY,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/utils";
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

interface TimeGroup {
  key: string;
  label: string;
  tasks: Task[];
  isOverdue?: boolean;
}

interface ProjectGroup {
  projectId: string | null;
  projectName: string;
  projectColor: string;
  tasks: Task[];
  doneCount: number;
  totalCount: number;
}

const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function dateSort(a: Task, b: Task): number {
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
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

/* ── One-click complete button ── */
function TaskCheckButton({ task, onToggle }: { task: Task; onToggle: (id: string, s: TaskStatus) => void }) {
  const [animating, setAnimating] = useState(false);
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAnimating(true);
    onToggle(task.id, task.status === "done" ? "todo" : "done");
    setTimeout(() => setAnimating(false), 400);
  };
  if (task.status === "done") return <button onClick={handleClick} className="shrink-0 text-[#2e7a56] hover:scale-110 transition-transform"><CheckCircle2 size={18} /></button>;
  if (task.status === "in_progress") return <button onClick={handleClick} className="shrink-0 text-[#2b6055] hover:scale-110 transition-transform"><Clock size={18} /></button>;
  if (task.status === "cancelled") return <button onClick={handleClick} className="shrink-0 text-[#a63d3d] hover:scale-110 transition-transform"><XCircle size={18} /></button>;
  return <button onClick={handleClick} className={cn("shrink-0 text-border transition-all hover:text-[#2e7a56] hover:scale-110", animating && "scale-125 text-[#2e7a56]")}><Circle size={18} /></button>;
}

/* ── AI next hint ── */
function AiNextHint({ task, allTasks, visible }: { task: Task; allTasks: Task[]; visible: boolean }) {
  if (!visible || !task.project) return null;
  const projectTasks = allTasks.filter(
    (t) => t.project?.id === task.project?.id && t.status !== "done" && t.status !== "cancelled" && t.id !== task.id
  );
  if (!projectTasks.length) return null;
  projectTasks.sort((a, b) => { const pw = (PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2); return pw !== 0 ? pw : dateSort(a, b); });
  const next = projectTasks[0];
  const total = allTasks.filter((t) => t.project?.id === task.project?.id).length;
  const done = allTasks.filter((t) => t.project?.id === task.project?.id && t.status === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const due = next.dueDate ? formatDue(next.dueDate, next.status) : null;
  return (
    <div className="mx-5 -mt-1 mb-1 animate-in fade-in slide-in-from-top-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent duration-300">
      <span className="font-medium">进度 {pct}%</span><span className="mx-1.5 text-accent/40">|</span>下一步：{next.title}{due && <span className="text-muted ml-1">({due.text})</span>}
    </div>
  );
}

/* ── Task row ── */
function TaskRow({
  task, allTasks, showProject, onToggle, onOpenDrawer, onEdit, onDelete, justCompleted,
  selected, onSelect, batchMode,
}: {
  task: Task; allTasks: Task[]; showProject: boolean;
  onToggle: (id: string, s: TaskStatus) => void; onOpenDrawer: (id: string) => void;
  onEdit: (t: Task) => void; onDelete: (id: string) => void; justCompleted: boolean;
  selected?: boolean; onSelect?: (id: string) => void; batchMode?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const due = formatDue(task.dueDate, task.status);
  const showPriority = task.priority === "urgent" || task.priority === "high";
  return (
    <>
      <div className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-background">
        {batchMode ? (
          <button onClick={(e) => { e.stopPropagation(); onSelect?.(task.id); }} className="shrink-0 text-muted hover:text-accent">
            {selected ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
          </button>
        ) : (
          <TaskCheckButton task={task} onToggle={onToggle} />
        )}
        <button onClick={() => onOpenDrawer(task.id)} className={cn("min-w-0 flex-1 text-left text-sm font-medium truncate transition-colors hover:text-accent", task.status === "done" && "text-muted line-through")}>
          {task.title}
        </button>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {showProject && task.project && (
            <Link
              href={`/projects/${task.project.id}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-muted hover:text-accent transition-colors"
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: task.project.color }} />
              <span className="max-w-[140px] truncate">{task.project.name}</span>
            </Link>
          )}
          {due && <span className={cn("whitespace-nowrap", due.cls)}>{due.text}</span>}
          {showPriority && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", TASK_PRIORITY[task.priority].color)}>{TASK_PRIORITY[task.priority].label}</span>}
        </div>
        <div className="relative">
          <button onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }} className="rounded p-1 text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-background"><MoreHorizontal size={15} /></button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-28 rounded-lg border border-border bg-card-bg py-1 shadow-lg">
                <button onClick={() => { setMenuOpen(false); onEdit(task); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-background"><Pencil size={12} /> 编辑</button>
                <button onClick={() => { setMenuOpen(false); onDelete(task.id); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#a63d3d] hover:bg-[rgba(166,61,61,0.04)]"><Trash2 size={12} /> 删除</button>
              </div>
            </>
          )}
        </div>
      </div>
      <AiNextHint task={task} allTasks={allTasks} visible={justCompleted} />
    </>
  );
}

/* ── Time view ── */
export function TaskTimeView({
  timeGroups, allTasks, collapsedGroups, onToggleGroup,
  onToggle, onOpenDrawer, onEdit, onDelete, justCompletedId,
  batchMode, selectedIds, onSelect,
}: {
  timeGroups: TimeGroup[];
  allTasks: Task[];
  collapsedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  onToggle: (id: string, s: TaskStatus) => void;
  onOpenDrawer: (id: string) => void;
  onEdit: (t: Task) => void;
  onDelete: (id: string) => void;
  justCompletedId: string | null;
  batchMode: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {timeGroups.map((group) => {
        const collapsed = collapsedGroups.has(group.key);
        return (
          <div key={group.key} className="rounded-xl border border-border bg-card-bg overflow-hidden">
            <button onClick={() => onToggleGroup(group.key)} className={cn("flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-background", group.isOverdue && "border-l-2 border-l-[#a63d3d]")}>
              {collapsed ? <ChevronRight size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
              <span className={cn("text-sm font-semibold", group.isOverdue ? "text-[#a63d3d]" : "text-foreground")}>{group.label}</span>
              {group.isOverdue && <AlertTriangle size={13} className="text-[#a63d3d]" />}
              <span className="ml-auto text-xs text-muted">{group.tasks.length} 项</span>
            </button>
            {!collapsed && (
              <div className="divide-y divide-border border-t border-border">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} allTasks={allTasks} showProject={true} onToggle={onToggle} onOpenDrawer={onOpenDrawer} onEdit={onEdit} onDelete={onDelete} justCompleted={justCompletedId === task.id} batchMode={batchMode} selected={selectedIds.has(task.id)} onSelect={onSelect} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Project view ── */
export function TaskProjectView({
  projectGroups, allTasks, collapsedGroups, onToggleGroup,
  onToggle, onOpenDrawer, onEdit, onDelete, justCompletedId,
  batchMode, selectedIds, onSelect,
}: {
  projectGroups: ProjectGroup[];
  allTasks: Task[];
  collapsedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  onToggle: (id: string, s: TaskStatus) => void;
  onOpenDrawer: (id: string) => void;
  onEdit: (t: Task) => void;
  onDelete: (id: string) => void;
  justCompletedId: string | null;
  batchMode: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {projectGroups.map((group) => {
        const groupKey = group.projectId ?? "__none__";
        const collapsed = collapsedGroups.has(groupKey);
        const pct = group.totalCount > 0 ? Math.round((group.doneCount / group.totalCount) * 100) : 0;
        return (
          <div key={groupKey} className="rounded-xl border border-border bg-card-bg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-background">
              <button onClick={() => onToggleGroup(groupKey)} className="shrink-0 text-muted hover:text-foreground">
                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              {group.projectId && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: group.projectColor }} />}
              {group.projectId ? (
                <Link href={`/projects/${group.projectId}`} className="text-sm font-semibold truncate hover:text-accent transition-colors">
                  {group.projectName}
                </Link>
              ) : (
                <span className="text-sm font-semibold truncate text-muted">{group.projectName}</span>
              )}
              {group.projectId && (
                <div className="flex items-center gap-2 ml-2 flex-1 max-w-[200px]">
                  <div className="h-1.5 flex-1 rounded-full bg-border/50"><div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                  <span className="text-xs text-muted whitespace-nowrap">{pct}%</span>
                </div>
              )}
              <button onClick={() => onToggleGroup(groupKey)} className="ml-auto text-xs text-muted shrink-0 hover:text-foreground">{group.tasks.length} 项</button>
            </div>
            {!collapsed && (
              <div className="divide-y divide-border border-t border-border">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} allTasks={allTasks} showProject={false} onToggle={onToggle} onOpenDrawer={onOpenDrawer} onEdit={onEdit} onDelete={onDelete} justCompleted={justCompletedId === task.id} batchMode={batchMode} selected={selectedIds.has(task.id)} onSelect={onSelect} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
