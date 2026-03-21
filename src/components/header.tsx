"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bell,
  User,
  AlertTriangle,
  Calendar,
  Search,
  X,
  CheckSquare,
  FolderKanban,
  Loader2,
  LogOut,
  ChevronDown,
  Eye,
  ArrowRight,
  Star,
  Settings2,
} from "lucide-react";
import { cn, TASK_PRIORITY, TASK_STATUS, type TaskPriority, type TaskStatus } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";
import type { NotificationItem } from "@/components/notification/types";

/* ── Search types ── */

interface SearchTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  project: { name: string; color: string } | null;
}

interface SearchProject {
  id: string;
  name: string;
  color: string;
  status: string;
  _count: { tasks: number };
}

interface SearchResult {
  tasks: SearchTask[];
  projects: SearchProject[];
}

/* ── Search Panel ── */

function SearchPanel({
  open,
  query,
  onClose,
}: {
  open: boolean;
  query: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!open || !query.trim()) {
      setData(null);
      return;
    }

    setLoading(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      apiFetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then(setData)
        .catch(() => setData({ tasks: [], projects: [] }))
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timerRef.current);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  if (!open || !query.trim()) return null;

  const empty = data && data.tasks.length === 0 && data.projects.length === 0;

  return (
    <div
      ref={panelRef}
      id="global-search-results"
      role="region"
      aria-label="搜索结果"
      className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-[360px] rounded-xl border border-border bg-card-bg shadow-xl"
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" />
          搜索中...
        </div>
      ) : empty ? (
        <div className="px-4 py-6 text-center text-sm text-muted">
          未找到与「{query}」相关的结果
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {data && data.tasks.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 border-b border-border/60 px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <CheckSquare size={11} />
                任务
                <span className="ml-auto font-normal tabular-nums">{data.tasks.length}</span>
              </div>
              {data.tasks.map((t) => {
                const pInfo = TASK_PRIORITY[t.priority as TaskPriority] || TASK_PRIORITY.medium;
                const sInfo = TASK_STATUS[t.status as TaskStatus] || TASK_STATUS.todo;
                return (
                  <Link
                    key={t.id}
                    href={`/tasks/${t.id}`}
                    onClick={onClose}
                    className="flex items-center gap-2 px-4 py-2 transition-colors hover:bg-background"
                  >
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm", t.status === "done" && "text-muted line-through")}>
                        {t.title}
                      </p>
                      {t.project && (
                        <div className="mt-0.5 flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.project.color }} />
                          <span className="text-[10px] text-muted">{t.project.name}</span>
                        </div>
                      )}
                    </div>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", pInfo.color)}>
                      {pInfo.label}
                    </span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", sInfo.color)}>
                      {sInfo.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {data && data.projects.length > 0 && (
            <div className={data.tasks.length > 0 ? "border-t border-border" : ""}>
              <div className="flex items-center gap-1.5 border-b border-border/60 px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <FolderKanban size={11} />
                项目
                <span className="ml-auto font-normal tabular-nums">{data.projects.length}</span>
              </div>
              {data.projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-background"
                >
                  <span className="h-3 w-3 shrink-0 rounded" style={{ backgroundColor: p.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.name}</p>
                    <span className="text-[10px] text-muted">{p._count.tasks} 个任务</span>
                  </div>
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    p.status === "active" ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]" : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
                  )}>
                    {p.status === "active" ? "进行中" : "已归档"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Notification type icons ── */

const NTYPE_ICONS: Record<string, typeof Bell> = {
  task_due: CheckSquare,
  calendar_event: Calendar,
  followup: Bell,
  runtime_failed: AlertTriangle,
  feedback: Star,
  project_update: FolderKanban,
};

/* ── Notification Panel ── */

function NotificationPanel({
  open,
  onClose,
  onCountChange,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onCountChange: (n: number) => void;
  onNavigate?: (item: NotificationItem) => void;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/api/notifications?pageSize=12&status=active")
      .then((r) => r.json())
      .then((d) => {
        setItems(d.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    apiFetch("/api/notifications/unread-count")
      .then((r) => r.json())
      .then((d) => onCountChange(d.count ?? 0))
      .catch(() => {});
  }, [onCountChange]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  const handleAction = useCallback(
    async (id: string, action: "read" | "done") => {
      await apiFetch(`/api/notifications/${id}/${action}`, { method: "PATCH" });
      load();
    },
    [load]
  );

  if (!open) return null;

  const unreadItems = items.filter((i) => i.status === "unread");
  const readItems = items.filter((i) => i.status === "read");

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-50 mt-2 w-[400px] rounded-xl border border-border bg-card-bg shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">通知中心</h3>
        {unreadItems.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              const ids = unreadItems.map((i) => i.id);
              await apiFetch("/api/notifications/batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids, action: "mark_read" }),
              });
              load();
            }}
            className="text-[11px] text-accent hover:text-accent-hover"
          >
            全部已读
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={16} className="animate-spin text-accent" />
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <Bell size={24} className="mx-auto mb-2 text-muted/30" />
          <p className="text-sm text-muted">暂无通知</p>
          <p className="mt-0.5 text-xs text-muted/60">一切正常运行中</p>
        </div>
      ) : (
        <div className="max-h-[420px] divide-y divide-border/50 overflow-y-auto">
          {items.map((item) => {
            const Icon = NTYPE_ICONS[item.type] ?? Bell;
            const isUnread = item.status === "unread";
            return (
              <div
                key={item.id}
                className={cn(
                  "group flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-[rgba(43,96,85,0.03)]",
                  isUnread && "bg-[rgba(43,96,85,0.02)]"
                )}
              >
                <div className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  isUnread ? "bg-[rgba(43,96,85,0.10)] text-accent" : "bg-[rgba(110,125,118,0.06)] text-muted"
                )}>
                  <Icon size={13} />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (isUnread) handleAction(item.id, "read");
                    onNavigate?.(item);
                    onClose();
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className={cn("text-[13px] leading-snug", isUnread ? "font-medium text-foreground" : "text-muted")}>
                    {item.title}
                  </p>
                  {item.summary && (
                    <p className="mt-0.5 truncate text-[11px] text-muted/60">{item.summary}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-muted/40">
                    {formatTimeAgo(item.createdAt)}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                  {isUnread && (
                    <button
                      type="button"
                      onClick={() => handleAction(item.id, "read")}
                      title="标记已读"
                      className="rounded p-1 text-muted hover:bg-[rgba(43,96,85,0.06)] hover:text-foreground"
                    >
                      <Eye size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleAction(item.id, "done")}
                    title="标记完成"
                    className="rounded p-1 text-muted hover:bg-[rgba(46,122,86,0.08)] hover:text-[#2e7a56]"
                  >
                    <CheckSquare size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-center gap-4 border-t border-border px-4 py-2.5">
        <Link
          href="/settings/notifications"
          onClick={onClose}
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-accent"
        >
          <Settings2 size={12} />
          通知偏好
        </Link>
        <Link
          href="/notifications"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover"
        >
          查看全部 <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "昨天";
  if (diffDay < 7) return `${diffDay} 天前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* ── Header ── */

export function Header() {
  const [notifCount, setNotifCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ name: string; email: string; role: string } | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(() => {
    apiFetch("/api/notifications/unread-count")
      .then((r) => r.json())
      .then((d) => setNotifCount(d.count ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    loadCount();
    apiFetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.user) setCurrentUser(d.user); })
      .catch(() => {});
    const interval = setInterval(loadCount, 60_000);
    return () => clearInterval(interval);
  }, [loadCount]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === "Escape" && searchOpen) {
        closeSearch();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [searchOpen, closeSearch]);

  const handleNotificationNavigate = useCallback((item: NotificationItem) => {
    if (item.entityType === "task" && item.entityId) {
      window.location.href = `/tasks/${item.entityId}`;
    } else if (item.projectId && item.activityId) {
      window.location.href = `/projects/${item.projectId}?activity=${item.activityId}`;
    } else if (item.projectId) {
      window.location.href = `/projects/${item.projectId}`;
    } else if (item.entityType === "conversation" && item.entityId) {
      window.location.href = `/projects/${item.projectId}/conversations/${item.entityId}`;
    }
  }, []);

  return (
    <header className="flex h-14 items-center justify-between border-b border-[rgba(26,36,32,0.06)] bg-[rgba(250,248,244,0.65)] px-6 backdrop-blur-md supports-[backdrop-filter]:bg-[rgba(250,248,244,0.55)]">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Calendar size={15} />
          <span>
            {new Date().toLocaleDateString("zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </span>
        </div>

        <div ref={searchRef} className="relative">
          <div
            className="relative"
            role="combobox"
            aria-expanded={searchOpen}
            aria-controls={searchOpen && searchQuery.trim() ? "global-search-results" : undefined}
            aria-haspopup="listbox"
          >
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={inputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => {
                if (searchQuery.trim()) setSearchOpen(true);
              }}
              placeholder="搜索任务、项目...  ⌘K"
              aria-autocomplete="list"
              autoComplete="off"
              className="h-8 w-56 rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none transition-[width,box-shadow,border-color] placeholder:text-muted focus:w-72 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card-bg"
            />
            {searchQuery && (
              <button
                onClick={closeSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <SearchPanel open={searchOpen} query={searchQuery} onClose={closeSearch} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => setPanelOpen(!panelOpen)}
            className="relative rounded-lg p-2 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <Bell size={18} />
            {notifCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#a63d3d] px-1 text-[10px] font-bold text-white">
                {notifCount > 99 ? "99+" : notifCount}
              </span>
            )}
          </button>
          <NotificationPanel
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            onCountChange={setNotifCount}
            onNavigate={handleNotificationNavigate}
          />
        </div>
        <div ref={userMenuRef} className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="ml-2 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-background"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-medium text-white">
              {currentUser?.name?.[0]?.toUpperCase() || <User size={16} />}
            </div>
            <span className="text-sm font-medium">
              {currentUser?.name || "..."}
            </span>
            <ChevronDown size={14} className="text-muted" />
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-border bg-card-bg shadow-xl">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-medium">{currentUser?.name}</p>
                <p className="mt-0.5 text-xs text-muted">{currentUser?.email}</p>
              </div>
              <div className="py-1">
                <button
                  onClick={async () => {
                    await apiFetch("/api/auth/logout", { method: "POST" });
                    window.location.href = "/login";
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[#a63d3d] transition-colors hover:bg-[rgba(166,61,61,0.04)]"
                >
                  <LogOut size={14} />
                  退出登录
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
