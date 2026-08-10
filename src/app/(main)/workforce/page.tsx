"use client";

/**
 * Job Center（2D-1，READ-ONLY）
 *
 * 青砚数字员工的任务总览：AI 正在做什么、完成多少、哪里需要我。
 * 数据全部来自 GET /api/workforce/jobs（真实 Read Model，无 mock）；
 * 本页无任何 mutation 入口。
 */

import { useCallback, useEffect, useState } from "react";
import { Briefcase, HandHelping, Loader2, RefreshCw, ChevronDown, Building2 } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { WorkforceJobListItem } from "@/lib/workforce-runtime/read-model";
import { JobCard } from "./job-card";

type TabKey = "all" | "working" | "needs_you" | "completed";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "working", label: "进行中" },
  { key: "needs_you", label: "需要你" },
  { key: "completed", label: "已完成" },
];

const EMPTY_COPY: Record<TabKey, { title: string; description: string }> = {
  all: {
    title: "还没有 AI 任务",
    description: "把工作交给青砚数字员工后，任务进展会出现在这里",
  },
  working: {
    title: "现在没有进行中的任务",
    description: "新委派的工作开始后会显示在这里",
  },
  needs_you: {
    title: "没有需要你处理的事项",
    description: "当任务等待你的审批或补充信息时，会出现在这里",
  },
  completed: {
    title: "还没有完成的任务",
    description: "任务完成后会在这里留档",
  },
};

type LoadError =
  | { kind: "org_selection" }
  | { kind: "no_org" }
  | { kind: "server" };

export default function WorkforceJobCenterPage() {
  const [tab, setTab] = useState<TabKey>("all");
  const [jobs, setJobs] = useState<WorkforceJobListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);

  const load = useCallback(
    async (opts: { tab: TabKey; cursor?: string | null; silent?: boolean }) => {
      const isMore = Boolean(opts.cursor);
      if (isMore) setLoadingMore(true);
      else if (opts.silent) setRefreshing(true);
      else setLoading(true);

      try {
        const qs = new URLSearchParams({ status: opts.tab });
        if (opts.cursor) qs.set("cursor", opts.cursor);
        const res = await apiFetch(`/api/workforce/jobs?${qs}`);
        if (res.status === 403) {
          const body = (await res.json().catch(() => null)) as
            | { needsSelection?: boolean }
            | null;
          setError(body?.needsSelection ? { kind: "org_selection" } : { kind: "no_org" });
          setJobs([]);
          setNextCursor(null);
          return;
        }
        if (!res.ok) {
          setError({ kind: "server" });
          return;
        }
        const data = (await res.json()) as {
          jobs: WorkforceJobListItem[];
          nextCursor: string | null;
        };
        setError(null);
        setJobs((prev) => (isMore ? [...prev, ...data.jobs] : data.jobs));
        setNextCursor(data.nextCursor);
      } catch {
        setError({ kind: "server" });
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    setJobs([]);
    setNextCursor(null);
    void load({ tab });
  }, [tab, load]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="AI 任务"
        description="青砚数字员工正在为你处理的工作：进展、需要你的事项与最终结果"
        actions={
          <button
            type="button"
            onClick={() => void load({ tab, silent: true })}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-muted/5 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
            刷新
          </button>
        }
      />

      {/* Tab 栏：移动端可横滑 */}
      <div className="mt-4 flex items-center gap-1 overflow-x-auto rounded-xl bg-foreground/[0.04] p-1 [scrollbar-width:none]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
              tab === t.key
                ? "bg-card font-medium text-foreground shadow-sm"
                : "text-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {loading ? (
          <JobListSkeleton />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void load({ tab })} />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={tab === "needs_you" ? HandHelping : Briefcase}
            title={EMPTY_COPY[tab].title}
            description={EMPTY_COPY[tab].description}
          />
        ) : (
          <div className="space-y-2.5">
            {jobs.map((job) => (
              <JobCard key={job.jobId} job={job} />
            ))}
            {nextCursor ? (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => void load({ tab, cursor: nextCursor })}
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
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function JobListSkeleton() {
  return (
    <div className="space-y-2.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-border/60 bg-card px-4 py-3.5"
        >
          <div className="h-4 w-2/3 rounded bg-foreground/[0.07]" />
          <div className="mt-2.5 h-3 w-1/3 rounded bg-foreground/[0.05]" />
          <div className="mt-3.5 h-1.5 w-full rounded-full bg-foreground/[0.05]" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: LoadError;
  onRetry: () => void;
}) {
  if (error.kind === "org_selection") {
    return (
      <EmptyState
        icon={Building2}
        title="请先选择工作组织"
        description="你属于多个组织，选择后即可查看该组织的 AI 任务"
        action={
          <Link
            href="/select-org"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            选择组织
          </Link>
        }
      />
    );
  }
  if (error.kind === "no_org") {
    return (
      <EmptyState
        icon={Building2}
        title="暂无可用组织"
        description="加入组织后即可查看 AI 任务"
      />
    );
  }
  return (
    <EmptyState
      title="加载失败"
      description="网络或服务暂时不可用，请稍后重试"
      action={
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/5"
        >
          重试
        </button>
      }
    />
  );
}
