"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Sparkles,
  Mail,
  Send,
  BarChart3,
  Loader2,
  ChevronDown,
  FileQuestion,
  ClipboardList,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface AiActivityItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  projectId: string | null;
  projectName: string | null;
  detail: string;
  createdAt: string;
}

const ACTION_CONFIG: Record<string, { icon: typeof Sparkles; label: string; color: string }> = {
  ai_generate: {
    icon: Sparkles,
    label: "AI 生成",
    color: "text-accent bg-accent/10",
  },
  ai_send: {
    icon: Send,
    label: "发送",
    color: "text-[#2e7a56] bg-[rgba(46,122,86,0.1)]",
  },
  ai_analyze: {
    icon: BarChart3,
    label: "AI 分析",
    color: "text-[#6366f1] bg-[rgba(99,102,241,0.1)]",
  },
};

const TARGET_CONFIG: Record<string, { icon: typeof Mail; label: string }> = {
  project_email: { icon: Mail, label: "邮件草稿" },
  project_question: { icon: FileQuestion, label: "问题邮件" },
  report: { icon: ClipboardList, label: "周报" },
  project: { icon: BarChart3, label: "项目摘要" },
  quote_analysis: { icon: BarChart3, label: "报价分析" },
  task: { icon: Zap, label: "任务" },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHour < 24) return `${diffHour} 小时前`;
  if (diffDay < 7) return `${diffDay} 天前`;

  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  if (isToday) return "今天";
  if (isYesterday) return "昨天";
  return d.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function groupByDate(items: AiActivityItem[]): [string, AiActivityItem[]][] {
  const groups = new Map<string, AiActivityItem[]>();
  for (const item of items) {
    const key = new Date(item.createdAt).toDateString();
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }
  return Array.from(groups.entries());
}

export default function AiActivityPage() {
  const [items, setItems] = useState<AiActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  const load = useCallback(async (c?: string | null) => {
    const isMore = !!c;
    if (isMore) setLoadingMore(true);
    else setLoading(true);

    try {
      const url = c
        ? `/api/ai/activity?cursor=${c}`
        : "/api/ai/activity";
      const res = await apiFetch(url);
      if (!res.ok) return;
      const data = await res.json();

      setItems((prev) => (isMore ? [...prev, ...data.items] : data.items));
      setHasMore(data.hasMore);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = groupByDate(items);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2.5">
          <Activity size={20} className="text-accent" />
          <h1 className="text-lg font-bold">AI 活动日志</h1>
        </div>
        <p className="mt-1 text-sm text-muted">
          青砚 AI 为你执行的所有操作记录 — 生成、发送、分析、自动任务
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-accent/40" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <Sparkles size={32} className="text-accent/20" />
          <p className="text-sm font-medium text-muted">暂无 AI 活动记录</p>
          <p className="text-xs text-muted/60">
            当 AI 帮你生成邮件、分析项目或自动创建任务时，记录会出现在这里
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([dateKey, dateItems]) => (
            <div key={dateKey}>
              <div className="mb-2 flex items-center gap-2">
                <div className="h-px flex-1 bg-border/60" />
                <span className="text-xs font-medium text-muted">
                  {formatDate(dateItems[0].createdAt)}
                </span>
                <div className="h-px flex-1 bg-border/60" />
              </div>

              <div className="space-y-1.5">
                {dateItems.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => load(cursor)}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted hover:bg-muted/5 disabled:opacity-50"
              >
                {loadingMore ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ChevronDown size={14} />
                )}
                加载更多
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: AiActivityItem }) {
  const actionCfg = ACTION_CONFIG[item.action] ?? {
    icon: Activity,
    label: item.action,
    color: "text-muted bg-muted/10",
  };
  const targetCfg = TARGET_CONFIG[item.targetType] ?? {
    icon: Activity,
    label: item.targetType,
  };
  const ActionIcon = actionCfg.icon;
  const TargetIcon = targetCfg.icon;
  const isAutoTask =
    item.targetType === "task" && item.action === "ai_generate";

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-card px-4 py-3 transition-colors hover:bg-muted/5">
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          actionCfg.color
        )}
      >
        {isAutoTask ? <Zap size={13} /> : <ActionIcon size={13} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">
            {isAutoTask ? "自动创建" : actionCfg.label}
          </span>
          <span className="inline-flex items-center gap-1 text-muted">
            <TargetIcon size={11} />
            {targetCfg.label}
          </span>
          {item.detail && (
            <span className="truncate text-muted">— {item.detail}</span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-3 text-xs text-muted">
          <span>{formatTime(item.createdAt)}</span>
          {item.projectName && (
            <Link
              href={`/projects/${item.projectId}`}
              className="hover:text-foreground hover:underline"
            >
              {item.projectName}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
