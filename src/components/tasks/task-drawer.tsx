"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Circle,
  Clock,
  CheckCircle2,
  XCircle,
  Bell,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Calendar,
  Flag,
  User,
  MessageSquare,
  Activity,
  Send,
  FolderKanban,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import {
  cn,
  TASK_STATUS,
  TASK_PRIORITY,
  type TaskStatus,
  type TaskPriority,
} from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { daysRemainingToronto, toToronto, formatRelativeToronto } from "@/lib/time";

/* ── Types ── */

interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  needReminder: boolean;
  createdAt: string;
  updatedAt: string;
  project: { id: string; name: string; color: string } | null;
  assignee: { id: string; name: string } | null;
  creator: { id: string; name: string } | null;
  _count?: { comments: number; activities: number };
}

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string } | null;
}

interface ProjectProgress {
  taskProgress: number;
  completedTasks: number;
  totalTasks: number;
  timeProgress: number;
  daysRemaining: number;
  daysTotal: number;
  riskLevel: string;
  riskLabel: string | null;
  isOverdue: boolean;
  isAtRisk: boolean;
}

interface TaskDrawerProps {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onDeleted?: (taskId: string) => void;
}

const STATUS_CONFIG: Record<TaskStatus, { icon: typeof Circle; label: string; activeClass: string }> = {
  todo: { icon: Circle, label: "待办", activeClass: "border-[#6e7d76] bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" },
  in_progress: { icon: Clock, label: "进行中", activeClass: "border-[#2b6055] bg-[rgba(43,96,85,0.08)] text-[#2b6055]" },
  done: { icon: CheckCircle2, label: "已完成", activeClass: "border-[#2e7a56] bg-[rgba(46,122,86,0.08)] text-[#2e7a56]" },
  cancelled: { icon: XCircle, label: "已取消", activeClass: "border-[#a63d3d] bg-[rgba(166,61,61,0.08)] text-[#a63d3d]" },
};

function ProgressBar({ value, color = "bg-accent" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-border/50">
      <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/* ── Comment Section ── */
function CommentSection({ taskId }: { taskId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loadComments = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/tasks/${taskId}/comments`)
      .then((r) => r.json())
      .then((data) => { setComments(Array.isArray(data) ? data : []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments]);

  const handleSend = async () => {
    const text = newComment.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await apiFetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        const comment = await res.json();
        setComments((prev) => [...prev, comment]);
        setNewComment("");
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-5 pb-4">
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 size={14} className="animate-spin text-muted" />
        </div>
      ) : (
        <>
          {comments.length > 0 ? (
            <div ref={listRef} className="mb-3 max-h-60 space-y-3 overflow-y-auto">
              {comments.map((c) => (
                <div key={c.id} className="group">
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-[10px] font-medium text-accent">
                      {c.author?.name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <span className="text-xs font-medium">{c.author?.name ?? "未知"}</span>
                    <span className="text-[10px] text-muted">{formatRelativeToronto(c.createdAt)}</span>
                  </div>
                  <p className="ml-7 text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">{c.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mb-3 text-xs text-muted">暂无评论</p>
          )}

          {/* New comment input */}
          <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-1.5">
            <textarea
              ref={inputRef}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="写评论... (Enter 发送)"
              rows={1}
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted/50"
              style={{ minHeight: 32, maxHeight: 80 }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 80) + "px";
              }}
            />
            <button
              onClick={handleSend}
              disabled={!newComment.trim() || sending}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Main Drawer ── */
export function TaskDrawer({ taskId, open, onClose, onStatusChange, onDeleted }: TaskDrawerProps) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

  const loadTask = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/tasks/${id}`);
      if (res.ok) {
        const data = await res.json();
        setTask(data);
        if (data.project?.id) {
          apiFetch(`/api/projects/${data.project.id}/overview`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => { if (d?.progress) setProgress(d.progress); })
            .catch(() => {});
        } else {
          setProgress(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && taskId) {
      setTask(null);
      setProgress(null);
      setShowComments(false);
      setShowActivity(false);
      loadTask(taskId);
    }
  }, [open, taskId, loadTask]);

  const refreshProgress = useCallback((projectId: string) => {
    apiFetch(`/api/projects/${projectId}/overview`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.progress) setProgress(d.progress); })
      .catch(() => {});
  }, []);

  const handleStatusChange = async (newStatus: TaskStatus) => {
    if (!task || updating) return;
    setUpdating(true);
    try {
      const res = await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const data = await res.json();
        setTask((prev) => prev ? { ...prev, status: newStatus } : null);
        onStatusChange?.(task.id, newStatus);
        // API returns fresh projectProgress after status change
        if (data.projectProgress) {
          setProgress(data.projectProgress);
        } else if (task.project?.id) {
          refreshProgress(task.project.id);
        }
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!window.confirm("确定删除此任务？")) return;
    await apiFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    onDeleted?.(task.id);
    onClose();
  };

  const dueInfo = task?.dueDate ? (() => {
    const diff = daysRemainingToronto(task.dueDate);
    if (task.status === "done" || task.status === "cancelled") return null;
    if (diff < 0) return { text: `已逾期 ${Math.abs(diff)} 天`, cls: "text-[#a63d3d]" };
    if (diff === 0) return { text: "今天到期", cls: "text-[#b06a28]" };
    if (diff === 1) return { text: "明天到期", cls: "text-[#9a6a2f]" };
    return null;
  })() : null;

  const formatDate = (d: string) => {
    const t = toToronto(new Date(d));
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  };

  return (
    <Drawer open={open} onClose={onClose} title="任务详情" width="w-[500px]">
      {loading || !task ? (
        <div className="flex h-60 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto">
            {/* Title */}
            <div className="px-5 pt-5 pb-2">
              <h3 className={cn("text-lg font-semibold leading-snug", task.status === "done" && "text-muted line-through")}>
                {task.title}
              </h3>
            </div>

            {/* Parent project badge — always visible */}
            <div className="px-5 pb-3">
              {task.project ? (
                <Link
                  href={`/projects/${task.project.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent group"
                >
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: task.project.color }} />
                  <FolderKanban size={12} className="text-muted group-hover:text-accent shrink-0" />
                  <span className="truncate max-w-[280px]">{task.project.name}</span>
                  <ArrowRight size={11} className="text-muted group-hover:text-accent shrink-0" />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-1.5 text-xs text-muted">
                  <FolderKanban size={12} />
                  未关联项目
                </span>
              )}
            </div>

            {/* Status buttons */}
            <div className="flex gap-2 px-5 pb-4">
              {(Object.keys(STATUS_CONFIG) as TaskStatus[]).map((s) => {
                const cfg = STATUS_CONFIG[s];
                const Icon = cfg.icon;
                const isActive = task.status === s;
                return (
                  <button key={s} disabled={updating} onClick={() => handleStatusChange(s)}
                    className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all", isActive ? cfg.activeClass : "border-border text-muted hover:bg-background")}>
                    <Icon size={13} />{cfg.label}
                  </button>
                );
              })}
            </div>

            {/* Project progress — auto-refreshes after status change */}
            {task.project && (
              <div className="mx-5 mb-4 rounded-lg border border-border bg-background/50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted">项目进度</span>
                  {progress && (
                    <Link href={`/projects/${task.project.id}`} className="text-[10px] text-accent hover:underline">查看项目</Link>
                  )}
                </div>
                {progress ? (
                  <div className="space-y-2">
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-muted">
                        <span>任务完成 {progress.completedTasks}/{progress.totalTasks}</span>
                        <span className={cn(progress.isAtRisk && "text-[#a63d3d] font-medium", progress.isOverdue && "text-[#a63d3d] font-medium")}>{Math.round(progress.taskProgress)}%</span>
                      </div>
                      <ProgressBar value={progress.taskProgress} color={progress.isAtRisk ? "bg-[#b06a28]" : "bg-accent"} />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-muted">
                        <span>时间进度</span>
                        <span>{progress.daysRemaining > 0 ? `剩余 ${progress.daysRemaining} 天` : "已逾期"}</span>
                      </div>
                      <ProgressBar value={progress.timeProgress} color={progress.isOverdue ? "bg-[#a63d3d]" : "bg-[#6e7d76]"} />
                    </div>
                    {progress.riskLabel && <p className="text-[11px] font-medium text-[#b06a28]">{progress.riskLabel}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-muted">加载项目进度中...</p>
                )}
              </div>
            )}

            {/* Task meta */}
            <div className="space-y-3 px-5 pb-4">
              <div className="flex items-center gap-3 text-sm">
                <Calendar size={14} className="shrink-0 text-muted" />
                <span className="text-muted">截止日期</span>
                <span className={cn("ml-auto font-medium", dueInfo?.cls)}>
                  {task.dueDate ? formatDate(task.dueDate) : "未设置"}
                  {dueInfo && <span className="ml-1.5 text-xs">({dueInfo.text})</span>}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Flag size={14} className="shrink-0 text-muted" />
                <span className="text-muted">优先级</span>
                <span className={cn("ml-auto rounded px-1.5 py-0.5 text-xs font-medium", TASK_PRIORITY[task.priority]?.color)}>
                  {TASK_PRIORITY[task.priority]?.label ?? task.priority}
                </span>
              </div>
              {task.assignee && (
                <div className="flex items-center gap-3 text-sm">
                  <User size={14} className="shrink-0 text-muted" />
                  <span className="text-muted">负责人</span>
                  <span className="ml-auto font-medium">{task.assignee.name}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm">
                <Bell size={14} className="shrink-0 text-muted" />
                <span className="text-muted">到期提醒</span>
                <span className="ml-auto text-xs">{task.needReminder ? "已开启" : "未开启"}</span>
              </div>
            </div>

            {/* Description */}
            {task.description && (
              <div className="border-t border-border px-5 py-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">描述</h4>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{task.description}</p>
              </div>
            )}

            {/* Comments section */}
            <div className="border-t border-border">
              <button
                onClick={() => setShowComments(!showComments)}
                className="flex w-full items-center gap-2 px-5 py-3 text-sm font-medium text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                {showComments ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <MessageSquare size={14} />
                评论
                {task._count?.comments ? <span className="ml-1 text-xs">({task._count.comments})</span> : null}
              </button>
              {showComments && <CommentSection taskId={task.id} />}
            </div>

            {/* Activity section */}
            <div className="border-t border-border">
              <button
                onClick={() => setShowActivity(!showActivity)}
                className="flex w-full items-center gap-2 px-5 py-3 text-sm font-medium text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                {showActivity ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Activity size={14} />
                活动记录
              </button>
              {showActivity && (
                <div className="px-5 pb-3 text-xs text-muted">
                  <Link href={`/tasks/${task.id}`} className="text-accent hover:underline">
                    查看完整记录 &rarr;
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Bottom action bar */}
          <div className="flex items-center gap-3 border-t border-border px-5 py-4">
            {task.status !== "done" ? (
              <button onClick={() => handleStatusChange("done")} disabled={updating}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                <CheckCircle2 size={16} />标记完成
              </button>
            ) : (
              <button onClick={() => handleStatusChange("todo")} disabled={updating}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-background disabled:opacity-50">
                <Circle size={16} />重新打开
              </button>
            )}
            <button onClick={handleDelete}
              className="rounded-lg border border-border p-2.5 text-muted transition-colors hover:border-[rgba(166,61,61,0.3)] hover:bg-[rgba(166,61,61,0.04)] hover:text-[#a63d3d]">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
