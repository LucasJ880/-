"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Plus,
  Loader2,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  Trash2,
  ChevronDown,
  ChevronRight,
  Pencil,
  X,
  Bell,
  BellOff,
  AlertTriangle,
  ListTodo,
  LayoutList,
  FolderKanban,
  Columns3,
  MoreHorizontal,
  CheckSquare,
  Square,
  Flag,
} from "lucide-react";
import Link from "next/link";
import {
  cn,
  TASK_STATUS,
  TASK_PRIORITY,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { daysRemainingToronto, toToronto } from "@/lib/time";
import { TaskDrawer } from "@/components/tasks/task-drawer";

/* ── Types ── */

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

interface SimpleProject {
  id: string;
  name: string;
  color: string;
}

type ViewMode = "time" | "project" | "kanban";

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

/* ── Helpers ── */
const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function prioritySort(a: Task, b: Task): number {
  return (PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2);
}

function dateSort(a: Task, b: Task): number {
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
}

function groupByTime(tasks: Task[]): TimeGroup[] {
  const overdue: Task[] = [];
  const today: Task[] = [];
  const thisWeek: Task[] = [];
  const later: Task[] = [];
  const noDue: Task[] = [];

  for (const t of tasks) {
    if (!t.dueDate) { noDue.push(t); continue; }
    const diff = daysRemainingToronto(t.dueDate);
    if (diff < 0 && t.status !== "done" && t.status !== "cancelled") overdue.push(t);
    else if (diff === 0) today.push(t);
    else if (diff >= 1 && diff <= 6) thisWeek.push(t);
    else later.push(t);
  }

  overdue.sort(prioritySort);
  today.sort(prioritySort);
  thisWeek.sort(dateSort);
  later.sort(dateSort);
  noDue.sort(prioritySort);

  const groups: TimeGroup[] = [];
  if (overdue.length) groups.push({ key: "overdue", label: "逾期", tasks: overdue, isOverdue: true });
  if (today.length) groups.push({ key: "today", label: "今天", tasks: today });
  if (thisWeek.length) groups.push({ key: "week", label: "本周", tasks: thisWeek });
  if (later.length) groups.push({ key: "later", label: "下周及以后", tasks: later });
  if (noDue.length) groups.push({ key: "nodue", label: "无截止日期", tasks: noDue });
  return groups;
}

function groupByProject(tasks: Task[], allTasks: Task[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();
  for (const t of tasks) {
    const pid = t.project?.id ?? "__none__";
    if (!map.has(pid)) {
      const projectTasks = allTasks.filter((at) => (at.project?.id ?? "__none__") === pid);
      map.set(pid, {
        projectId: t.project?.id ?? null,
        projectName: t.project?.name ?? "无项目",
        projectColor: t.project?.color ?? "#6e7d76",
        tasks: [],
        doneCount: projectTasks.filter((at) => at.status === "done").length,
        totalCount: projectTasks.length,
      });
    }
    map.get(pid)!.tasks.push(t);
  }
  const groups = Array.from(map.values());
  groups.forEach((g) => g.tasks.sort(dateSort));
  groups.sort((a, b) => (a.projectId === null ? 1 : b.projectId === null ? -1 : 0));
  return groups;
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

/* ── Task row (list views) ── */
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
            <span className="flex items-center gap-1 text-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: task.project.color }} />
              <span className="max-w-[80px] truncate">{task.project.name}</span>
            </span>
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

/* ── Kanban Card ── */
function KanbanCard({
  task, onOpenDrawer, onToggle, draggingId, onDragStart, onDragEnd,
}: {
  task: Task; onOpenDrawer: (id: string) => void;
  onToggle: (id: string, s: TaskStatus) => void;
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
            <span className="flex items-center gap-1 text-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: task.project.color }} />
              <span className="max-w-[70px] truncate">{task.project.name}</span>
            </span>
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

/* ── Kanban Column ── */
const KANBAN_COLUMNS: { status: TaskStatus; label: string; icon: typeof Circle; color: string }[] = [
  { status: "todo", label: "待办", icon: Circle, color: "#6e7d76" },
  { status: "in_progress", label: "进行中", icon: Clock, color: "#2b6055" },
  { status: "done", label: "已完成", icon: CheckCircle2, color: "#2e7a56" },
];

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

/* ── Batch Action Bar ── */
function BatchActionBar({
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

/* ── TaskFormModal ── */
function TaskFormModal({ open, onClose, onSaved, editing, projects }: {
  open: boolean; onClose: () => void; onSaved: () => void; editing: Task | null; projects: SimpleProject[];
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [projectId, setProjectId] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [needReminder, setNeedReminder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (editing) {
      setTitle(editing.title); setDescription(editing.description || ""); setPriority(editing.priority);
      setStatus(editing.status); setProjectId(editing.project?.id || "");
      setDueDate(editing.dueDate ? editing.dueDate.split("T")[0] : ""); setNeedReminder(editing.needReminder);
    } else {
      setTitle(""); setDescription(""); setPriority("medium"); setStatus("todo");
      setProjectId(""); setDueDate(""); setNeedReminder(false);
    }
  }, [editing, open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true); setSaveError("");
    try {
      const url = editing ? `/api/tasks/${editing.id}` : "/api/tasks";
      const res = await apiFetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description || null, priority, status, projectId: projectId || null, dueDate: dueDate || null, needReminder }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `保存失败 (${res.status})`); }
      onSaved(); onClose();
    } catch (err) { setSaveError(err instanceof Error ? err.message : "保存失败"); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card-bg p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{editing ? "编辑任务" : "新建任务"}</h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-background"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">任务标题 <span className="text-[#a63d3d]">*</span></label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="输入任务标题..." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent" autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">描述</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="任务描述（可选）..." rows={3} className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">优先级</label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(TASK_PRIORITY) as TaskPriority[]).map((p) => (
                  <button key={p} type="button" onClick={() => setPriority(p)} className={cn("rounded-lg border px-2.5 py-1 text-xs transition-colors", priority === p ? "border-accent bg-accent text-white" : "border-border hover:bg-background")}>{TASK_PRIORITY[p].label}</button>
                ))}
              </div>
            </div>
            {editing && (
              <div>
                <label className="mb-1 block text-sm font-medium">状态</label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
                    <button key={s} type="button" onClick={() => setStatus(s)} className={cn("rounded-lg border px-2.5 py-1 text-xs transition-colors", status === s ? "border-accent bg-accent text-white" : "border-border hover:bg-background")}>{TASK_STATUS[s].label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">所属项目</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent">
                <option value="">无</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">截止日期</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent" />
            </div>
          </div>
          <div>
            <button type="button" onClick={() => setNeedReminder(!needReminder)} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors", needReminder ? "border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] text-[#9a6a2f]" : "border-border text-muted hover:bg-background")}>
              {needReminder ? <Bell size={14} /> : <BellOff size={14} />}
              {needReminder ? "已开启到期提醒" : "开启到期提醒"}
            </button>
          </div>
          {saveError && <p className="rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-3 py-2 text-sm text-[#a63d3d]">{saveError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-background">取消</button>
            <button type="submit" disabled={!title.trim() || saving} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editing ? "保存修改" : "创建任务"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main ── */
export default function TasksPage() {
  return (
    <Suspense fallback={<div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
      <TasksPageContent />
    </Suspense>
  );
}

function TasksPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectFilter = searchParams.get("project") || "";
  const openParam = searchParams.get("open") || "";

  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<SimpleProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") return (localStorage.getItem("qy_task_view") as ViewMode) || "time";
    return "time";
  });
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [justCompletedId, setJustCompletedId] = useState<string | null>(null);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Batch selection
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Kanban drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    if (openParam && !drawerOpen) { setDrawerTaskId(openParam); setDrawerOpen(true); }
  }, [openParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTasks = useCallback(() => {
    setLoading(true);
    apiFetch("/api/tasks").then((r) => r.json()).then((data: Task[]) => setAllTasks(data)).finally(() => setLoading(false));
  }, []);

  const loadProjects = useCallback(() => {
    apiFetch("/api/projects?take=50").then((r) => r.json()).then((data: { id: string; name: string; color: string }[]) =>
      setProjects(data.map((p) => ({ id: p.id, name: p.name, color: p.color })))
    );
  }, []);

  useEffect(() => { loadTasks(); loadProjects(); }, [loadTasks, loadProjects]);

  const filteredTasks = useMemo(() => {
    let result = allTasks;
    if (projectFilter) result = result.filter((t) => t.project?.id === projectFilter);
    if (filter !== "all") result = result.filter((t) => t.status === filter);
    return result;
  }, [allTasks, projectFilter, filter]);

  const filterProjectName = projectFilter ? projects.find((p) => p.id === projectFilter)?.name : null;
  const timeGroups = useMemo(() => groupByTime(filteredTasks), [filteredTasks]);
  const projectGroups = useMemo(() => groupByProject(filteredTasks, allTasks), [filteredTasks, allTasks]);

  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("qy_task_view", viewMode); }, [viewMode]);

  const handleToggle = async (id: string, newStatus: TaskStatus) => {
    setAllTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    if (newStatus === "done") { setJustCompletedId(id); setTimeout(() => setJustCompletedId(null), 3500); }
    await apiFetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) });
  };

  const handleDelete = async (id: string) => {
    setAllTasks((prev) => prev.filter((t) => t.id !== id));
    await apiFetch(`/api/tasks/${id}`, { method: "DELETE" });
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  };

  const openDrawer = (taskId: string) => { setDrawerTaskId(taskId); setDrawerOpen(true); };

  const handleDrawerStatusChange = (taskId: string, newStatus: TaskStatus) => {
    setAllTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
  };

  const handleDrawerDeleted = (taskId: string) => {
    setAllTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  // Batch operations
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const exitBatchMode = () => { setBatchMode(false); setSelectedIds(new Set()); };

  const handleBatchStatus = async (status: TaskStatus) => {
    const ids = Array.from(selectedIds);
    setAllTasks((prev) => prev.map((t) => ids.includes(t.id) ? { ...t, status } : t));
    exitBatchMode();
    await apiFetch("/api/tasks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action: "status", value: status }) });
  };

  const handleBatchPriority = async (priority: TaskPriority) => {
    const ids = Array.from(selectedIds);
    setAllTasks((prev) => prev.map((t) => ids.includes(t.id) ? { ...t, priority } : t));
    exitBatchMode();
    await apiFetch("/api/tasks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action: "priority", value: priority }) });
  };

  const handleBatchDelete = async () => {
    if (!window.confirm(`确定删除 ${selectedIds.size} 个任务？`)) return;
    const ids = Array.from(selectedIds);
    setAllTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
    exitBatchMode();
    await apiFetch("/api/tasks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action: "delete" }) });
  };

  // Kanban drop
  const handleKanbanDrop = async (taskId: string, newStatus: TaskStatus) => {
    const task = allTasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;
    handleToggle(taskId, newStatus);
  };

  const statusCounts = useMemo(() => {
    const base = projectFilter ? allTasks.filter((t) => t.project?.id === projectFilter) : allTasks;
    return {
      all: base.length, todo: base.filter((t) => t.status === "todo").length,
      in_progress: base.filter((t) => t.status === "in_progress").length,
      done: base.filter((t) => t.status === "done").length,
      cancelled: base.filter((t) => t.status === "cancelled").length,
    };
  }, [allTasks, projectFilter]);

  return (
    <div className={cn("mx-auto space-y-5", viewMode === "kanban" ? "max-w-6xl" : "max-w-5xl")}>
      <PageHeader
        title="任务管理"
        description="管理和追踪您的所有工作任务"
        actions={
          <div className="flex items-center gap-2">
            {!batchMode && viewMode !== "kanban" && (
              <button type="button" onClick={() => setBatchMode(true)} className="flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium transition-all hover:bg-background">
                <CheckSquare size={15} /> 批量
              </button>
            )}
            <button type="button" onClick={() => { setEditingTask(null); setShowForm(true); }}
              className="flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent-hover active:scale-[0.98]">
              <Plus size={16} /> 新建任务
            </button>
          </div>
        }
      />

      {filterProjectName && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-sm">
          <span className="text-muted">筛选项目：</span>
          <span className="font-medium text-accent">{filterProjectName}</span>
          <button type="button" onClick={() => router.push("/tasks")} className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted hover:bg-background hover:text-foreground"><X size={12} /> 清除筛选</button>
        </div>
      )}

      {/* Batch action bar */}
      {batchMode && selectedIds.size > 0 && (
        <BatchActionBar count={selectedIds.size} onStatusChange={handleBatchStatus} onPriorityChange={handleBatchPriority} onDelete={handleBatchDelete} onCancel={exitBatchMode} />
      )}

      {/* Filter tabs + view toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {(["all", "todo", "in_progress", "done", "cancelled"] as const).map((s) => {
            const count = statusCounts[s];
            const label = s === "all" ? "全部" : TASK_STATUS[s].label;
            return (
              <button key={s} onClick={() => setFilter(s)} className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors", filter === s ? "border-accent bg-accent/5 font-medium text-accent" : "border-border text-muted hover:bg-card-bg")}>
                {label} <span className="text-xs opacity-60">({count})</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          <button onClick={() => { setViewMode("time"); exitBatchMode(); }} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", viewMode === "time" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground")}>
            <LayoutList size={13} /> 时间
          </button>
          <button onClick={() => { setViewMode("project"); exitBatchMode(); }} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", viewMode === "project" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground")}>
            <FolderKanban size={13} /> 项目
          </button>
          <button onClick={() => { setViewMode("kanban"); exitBatchMode(); }} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", viewMode === "kanban" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground")}>
            <Columns3 size={13} /> 看板
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2 rounded-[var(--radius-lg)] border border-border bg-card-bg p-4 shadow-card">
          {[1, 2, 3].map((i) => (<div key={i} className="flex animate-pulse items-center gap-4 border-b border-border py-3 last:border-0"><div className="h-4 flex-1 rounded bg-border" /><div className="h-5 w-16 rounded bg-border" /></div>))}
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card-bg/80 px-6 py-14 text-center shadow-card">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"><ListTodo size={28} strokeWidth={1.75} /></div>
          <h3 className="text-base font-semibold">暂无任务</h3>
          <p className="mt-1 max-w-sm text-sm text-muted">创建任务以跟踪工作进度，或让 AI 助手帮你从自然语言中提取任务。</p>
          <div className="mt-6 flex items-center gap-3">
            <button type="button" onClick={() => { setEditingTask(null); setShowForm(true); }} className="min-h-10 rounded-[var(--radius-md)] bg-accent px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover active:scale-[0.98]">新建任务</button>
            <Link href="/assistant" className="min-h-10 rounded-[var(--radius-md)] border border-border px-5 py-2 text-sm font-medium hover:bg-background/80">试试 AI 助手</Link>
          </div>
        </div>
      ) : viewMode === "kanban" ? (
        /* ── Kanban view ── */
        <div className="flex gap-4" style={{ minHeight: 400 }}>
          {KANBAN_COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.status).sort(prioritySort);
            return <KanbanColumn key={col.status} column={col} tasks={colTasks} onOpenDrawer={openDrawer} onToggle={handleToggle} onDrop={handleKanbanDrop} draggingId={draggingId} onDragStart={setDraggingId} onDragEnd={() => setDraggingId(null)} dragOver={dragOver} setDragOver={setDragOver} />;
          })}
        </div>
      ) : viewMode === "time" ? (
        /* ── Time view ── */
        <div className="space-y-3">
          {timeGroups.map((group) => {
            const collapsed = collapsedGroups.has(group.key);
            return (
              <div key={group.key} className="rounded-xl border border-border bg-card-bg overflow-hidden">
                <button onClick={() => toggleGroup(group.key)} className={cn("flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-background", group.isOverdue && "border-l-2 border-l-[#a63d3d]")}>
                  {collapsed ? <ChevronRight size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                  <span className={cn("text-sm font-semibold", group.isOverdue ? "text-[#a63d3d]" : "text-foreground")}>{group.label}</span>
                  {group.isOverdue && <AlertTriangle size={13} className="text-[#a63d3d]" />}
                  <span className="ml-auto text-xs text-muted">{group.tasks.length} 项</span>
                </button>
                {!collapsed && (
                  <div className="divide-y divide-border border-t border-border">
                    {group.tasks.map((task) => (
                      <TaskRow key={task.id} task={task} allTasks={allTasks} showProject={true} onToggle={handleToggle} onOpenDrawer={openDrawer} onEdit={(t) => { setEditingTask(t); setShowForm(true); }} onDelete={handleDelete} justCompleted={justCompletedId === task.id} batchMode={batchMode} selected={selectedIds.has(task.id)} onSelect={toggleSelect} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Project view ── */
        <div className="space-y-3">
          {projectGroups.map((group) => {
            const groupKey = group.projectId ?? "__none__";
            const collapsed = collapsedGroups.has(groupKey);
            const pct = group.totalCount > 0 ? Math.round((group.doneCount / group.totalCount) * 100) : 0;
            return (
              <div key={groupKey} className="rounded-xl border border-border bg-card-bg overflow-hidden">
                <button onClick={() => toggleGroup(groupKey)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-background">
                  {collapsed ? <ChevronRight size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                  {group.projectId && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: group.projectColor }} />}
                  <span className="text-sm font-semibold truncate">{group.projectName}</span>
                  {group.projectId && (
                    <div className="flex items-center gap-2 ml-2 flex-1 max-w-[200px]">
                      <div className="h-1.5 flex-1 rounded-full bg-border/50"><div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                      <span className="text-xs text-muted whitespace-nowrap">{pct}%</span>
                    </div>
                  )}
                  <span className="ml-auto text-xs text-muted shrink-0">{group.tasks.length} 项</span>
                </button>
                {!collapsed && (
                  <div className="divide-y divide-border border-t border-border">
                    {group.tasks.map((task) => (
                      <TaskRow key={task.id} task={task} allTasks={allTasks} showProject={false} onToggle={handleToggle} onOpenDrawer={openDrawer} onEdit={(t) => { setEditingTask(t); setShowForm(true); }} onDelete={handleDelete} justCompleted={justCompletedId === task.id} batchMode={batchMode} selected={selectedIds.has(task.id)} onSelect={toggleSelect} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <TaskFormModal open={showForm} onClose={() => { setShowForm(false); setEditingTask(null); }} onSaved={loadTasks} editing={editingTask} projects={projects} />
      <TaskDrawer taskId={drawerTaskId} open={drawerOpen} onClose={() => { setDrawerOpen(false); setDrawerTaskId(null); }} onStatusChange={handleDrawerStatusChange} onDeleted={handleDrawerDeleted} />
    </div>
  );
}
