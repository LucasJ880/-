"use client";

import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Plus,
  Loader2,
  X,
  Bell,
  BellOff,
  ListTodo,
  CheckSquare,
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
import { daysRemainingToronto } from "@/lib/time";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskKanbanView } from "./task-board";
import { TaskTimeView, TaskProjectView } from "./task-list";
import { TaskFilters, BatchActionBar } from "./task-filters";

const PROJECT_SELECT_NONE = "__none__";

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

function prioritySort(a: Task, b: Task): number {
  const w: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return (w[a.priority] ?? 2) - (w[b.priority] ?? 2);
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

/* ── TaskFormModal ── */
function TaskFormModal({ open, onOpenChange, onSaved, editing, projects }: {
  open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void; editing: Task | null; projects: SimpleProject[];
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
      onSaved(); onOpenChange(false);
    } catch (err) { setSaveError(err instanceof Error ? err.message : "保存失败"); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-card-bg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑任务" : "新建任务"}</DialogTitle>
            <DialogDescription className="sr-only">
              {editing ? "编辑任务表单" : "新建任务表单"}，任务标题为必填。
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="task-form-title" className="mb-1 block text-sm font-medium text-foreground">
              任务标题 <span className="text-[#a63d3d]">*</span>
            </Label>
            <Input id="task-form-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="输入任务标题..." className="bg-background" autoFocus />
          </div>
          <div>
            <Label htmlFor="task-form-description" className="mb-1 block text-sm font-medium text-foreground">描述</Label>
            <textarea id="task-form-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="任务描述（可选）..." rows={3} className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1 block text-sm font-medium text-foreground">优先级</Label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(TASK_PRIORITY) as TaskPriority[]).map((p) => (
                  <Button key={p} type="button" size="sm" variant={priority === p ? "accent" : "outline"} onClick={() => setPriority(p)} className={cn("h-auto px-2.5 py-1 text-xs", priority === p && "text-white")}>
                    {TASK_PRIORITY[p].label}
                  </Button>
                ))}
              </div>
            </div>
            {editing && (
              <div>
                <Label className="mb-1 block text-sm font-medium text-foreground">状态</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
                    <Button key={s} type="button" size="sm" variant={status === s ? "accent" : "outline"} onClick={() => setStatus(s)} className={cn("h-auto px-2.5 py-1 text-xs", status === s && "text-white")}>
                      {TASK_STATUS[s].label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="task-form-project" className="mb-1 block text-sm font-medium text-foreground">所属项目</Label>
              <ShadSelect value={projectId || PROJECT_SELECT_NONE} onValueChange={(v) => setProjectId(v === PROJECT_SELECT_NONE ? "" : v)}>
                <SelectTrigger id="task-form-project" className="bg-background">
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PROJECT_SELECT_NONE}>无</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
            <div>
              <Label htmlFor="task-form-due" className="mb-1 block text-sm font-medium text-foreground">截止日期</Label>
              <Input id="task-form-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="bg-background" />
            </div>
          </div>
          <div>
            <Button type="button" variant="outline" onClick={() => setNeedReminder(!needReminder)} className={cn("h-auto w-full justify-start gap-2 px-3 py-2 font-normal", needReminder ? "border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] text-[#9a6a2f]" : "text-muted")}>
              {needReminder ? <Bell size={14} /> : <BellOff size={14} />}
              {needReminder ? "已开启到期提醒" : "开启到期提醒"}
            </Button>
          </div>
          {saveError && <p className="rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-3 py-2 text-sm text-[#a63d3d]">{saveError}</p>}
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" variant="accent" disabled={!title.trim() || saving}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editing ? "保存修改" : "创建任务"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

  useEffect(() => {
    if (openParam && !drawerOpen) { setDrawerTaskId(openParam); setDrawerOpen(true); }
  }, [openParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTasks = useCallback(() => {
    setLoading(true);
    apiFetch("/api/tasks?limit=500").then((r) => r.json()).then((data: { items: Task[] } | Task[]) => {
      setAllTasks(Array.isArray(data) ? data : data.items);
    }).finally(() => setLoading(false));
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

      {batchMode && selectedIds.size > 0 && (
        <BatchActionBar count={selectedIds.size} onStatusChange={handleBatchStatus} onPriorityChange={handleBatchPriority} onDelete={handleBatchDelete} onCancel={exitBatchMode} />
      )}

      <TaskFilters
        filter={filter}
        onFilterChange={setFilter}
        viewMode={viewMode}
        onViewModeChange={(v) => { setViewMode(v); exitBatchMode(); }}
        statusCounts={statusCounts}
      />

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
        <TaskKanbanView filteredTasks={filteredTasks} onOpenDrawer={openDrawer} onToggle={handleToggle} onDrop={handleKanbanDrop} />
      ) : viewMode === "time" ? (
        <TaskTimeView
          timeGroups={timeGroups} allTasks={allTasks} collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup}
          onToggle={handleToggle} onOpenDrawer={openDrawer} onEdit={(t) => { setEditingTask(t); setShowForm(true); }} onDelete={handleDelete}
          justCompletedId={justCompletedId} batchMode={batchMode} selectedIds={selectedIds} onSelect={toggleSelect}
        />
      ) : (
        <TaskProjectView
          projectGroups={projectGroups} allTasks={allTasks} collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup}
          onToggle={handleToggle} onOpenDrawer={openDrawer} onEdit={(t) => { setEditingTask(t); setShowForm(true); }} onDelete={handleDelete}
          justCompletedId={justCompletedId} batchMode={batchMode} selectedIds={selectedIds} onSelect={toggleSelect}
        />
      )}

      <TaskFormModal
        open={showForm}
        onOpenChange={(next) => {
          setShowForm(next);
          if (!next) setEditingTask(null);
        }}
        onSaved={loadTasks}
        editing={editingTask}
        projects={projects}
      />
      <TaskDrawer taskId={drawerTaskId} open={drawerOpen} onClose={() => { setDrawerOpen(false); setDrawerTaskId(null); }} onStatusChange={handleDrawerStatusChange} onDeleted={handleDrawerDeleted} />
    </div>
  );
}
