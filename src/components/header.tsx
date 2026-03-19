"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bell,
  User,
  AlertTriangle,
  Clock,
  CalendarClock,
  Calendar,
  Search,
  X,
  CheckSquare,
  FolderKanban,
  Loader2,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { cn, TASK_PRIORITY, TASK_STATUS, type TaskPriority, type TaskStatus } from "@/lib/utils";
import Link from "next/link";

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
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
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
              <div className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <CheckSquare size={11} />
                任务
                <span className="ml-auto font-normal">{data.tasks.length}</span>
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
              <div className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <FolderKanban size={11} />
                项目
                <span className="ml-auto font-normal">{data.projects.length}</span>
              </div>
              {data.projects.map((p) => (
                <Link
                  key={p.id}
                  href="/projects"
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
                    p.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
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

/* ── Reminder types ── */

interface ReminderItem {
  sourceKey: string;
  type: "deadline" | "event" | "followup";
  title: string;
  subtitle: string;
  priority?: string;
  taskId?: string | null;
  eventId?: string | null;
  isRead: boolean;
  notify: boolean;
  project?: { name: string; color: string } | null;
  location?: string | null;
}

interface RemindersResponse {
  immediate: ReminderItem[];
  today: ReminderItem[];
  upcoming: ReminderItem[];
  unreadCount: number;
}

const TYPE_ICON: Record<string, { icon: typeof AlertTriangle; color: string }> = {
  deadline: { icon: CheckSquare, color: "text-orange-500" },
  event: { icon: Calendar, color: "text-blue-500" },
  followup: { icon: Bell, color: "text-purple-500" },
};

const LAYER_META = [
  { key: "immediate" as const, label: "需要立即处理", icon: AlertTriangle, color: "text-red-500" },
  { key: "today" as const, label: "今天关注", icon: Clock, color: "text-orange-500" },
  { key: "upcoming" as const, label: "近期跟进", icon: CalendarClock, color: "text-blue-500" },
];

/* ── Reminder Item Row ── */

function ReminderItemRow({
  item,
  onRead,
  onClose,
}: {
  item: ReminderItem;
  onRead: (sourceKey: string) => void;
  onClose: () => void;
}) {
  const typeInfo = TYPE_ICON[item.type] || TYPE_ICON.deadline;
  const TypeIcon = typeInfo.icon;
  const pInfo = item.priority
    ? TASK_PRIORITY[item.priority as TaskPriority] || TASK_PRIORITY.medium
    : null;

  const href = item.taskId ? `/tasks/${item.taskId}` : null;

  const inner = (
    <>
      <p className="truncate text-sm">{item.title}</p>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="text-[10px] text-muted">{item.subtitle}</span>
        {item.location && (
          <span className="text-[10px] text-muted">· {item.location}</span>
        )}
        {item.project && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.project.color }} />
            <span className="text-[10px] text-muted">{item.project.name}</span>
          </span>
        )}
      </div>
    </>
  );

  return (
    <div className="group flex items-center gap-2 px-4 py-2 transition-colors hover:bg-background">
      <TypeIcon size={14} className={cn("shrink-0", typeInfo.color)} />
      {href ? (
        <Link href={href} onClick={onClose} className="min-w-0 flex-1">
          {inner}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{inner}</div>
      )}
      {pInfo && (
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", pInfo.color)}>
          {pInfo.label}
        </span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onRead(item.sourceKey); }}
        title="标记已读"
        className="shrink-0 rounded p-1 text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-green-50 hover:text-green-600"
      >
        <CheckSquare size={13} />
      </button>
    </div>
  );
}

/* ── Reminder Panel ── */

function ReminderPanel({
  open,
  onClose,
  onCountChange,
}: {
  open: boolean;
  onClose: () => void;
  onCountChange: (n: number) => void;
}) {
  const [data, setData] = useState<RemindersResponse | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetch("/api/reminders")
      .then((r) => r.json())
      .then((d: RemindersResponse) => {
        setData(d);
        onCountChange(d.unreadCount);
      })
      .catch(() => {});
  }, [onCountChange]);

  useEffect(() => {
    if (!open) return;
    load();
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

  const handleRead = useCallback(
    (sourceKey: string) => {
      fetch("/api/reminders/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceKey }),
      }).then(() => load());
    },
    [load]
  );

  if (!open) return null;

  const totalItems =
    (data?.immediate.length ?? 0) +
    (data?.today.length ?? 0) +
    (data?.upcoming.length ?? 0);

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-50 mt-2 w-96 rounded-xl border border-border bg-card-bg shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">待处理提醒</h3>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-muted transition-colors hover:bg-background"
        >
          <X size={14} />
        </button>
      </div>

      {!data ? (
        <div className="px-4 py-6 text-center text-sm text-muted">加载中...</div>
      ) : totalItems === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted">暂无待处理提醒</p>
          <p className="mt-1 text-xs text-muted">所有事项都在正常推进中</p>
        </div>
      ) : (
        <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
          {LAYER_META.map(({ key, label, icon: LayerIcon, color }) => {
            const items = data[key];
            if (items.length === 0) return null;
            return (
              <div key={key}>
                <div className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <LayerIcon size={12} className={color} />
                  {label}
                  <span className="ml-auto font-normal">{items.length}</span>
                </div>
                {items.map((item) => (
                  <ReminderItemRow
                    key={item.sourceKey}
                    item={item}
                    onRead={handleRead}
                    onClose={onClose}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-border px-4 py-2.5">
        <Link
          href="/tasks"
          onClick={onClose}
          className="block text-center text-xs text-accent hover:text-accent-hover"
        >
          查看全部任务
        </Link>
      </div>
    </div>
  );
}

/* ── Header ── */

export function Header() {
  const [reminderCount, setReminderCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ name: string; email: string; role: string } | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifiedRef = useRef<Set<string>>(new Set());

  const loadCount = useCallback(() => {
    fetch("/api/reminders")
      .then((r) => r.json())
      .then((d: RemindersResponse) => {
        setReminderCount(d.unreadCount);
        const all = [...d.immediate, ...d.today, ...d.upcoming];
        for (const item of all) {
          if (item.notify && !notifiedRef.current.has(item.sourceKey)) {
            notifiedRef.current.add(item.sourceKey);
            if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
              const n = new Notification("青砚提醒", {
                body: `${item.title} — ${item.subtitle}`,
                icon: "/favicon.ico",
                tag: item.sourceKey,
              });
              setTimeout(() => n.close(), 10_000);
            }
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    loadCount();
    fetch("/api/auth/me")
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

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card-bg px-6">
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
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => { if (searchQuery.trim()) setSearchOpen(true); }}
              placeholder="搜索任务、项目...  ⌘K"
              className="h-8 w-56 rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-muted focus:border-accent focus:w-72"
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
            {reminderCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {reminderCount > 99 ? "99+" : reminderCount}
              </span>
            )}
          </button>
          <ReminderPanel open={panelOpen} onClose={() => setPanelOpen(false)} onCountChange={setReminderCount} />
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
                    await fetch("/api/auth/logout", { method: "POST" });
                    window.location.href = "/login";
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
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
