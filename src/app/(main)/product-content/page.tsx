"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { cn } from "@/lib/utils";

interface JobRow {
  id: string;
  title: string;
  status: string;
  executionMode: string;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ANALYZING: "分析中",
  NEEDS_INPUT: "待补充",
  PLAN_READY: "计划就绪",
  AWAITING_APPROVAL: "待审批",
  GENERATING_VISUALS: "生成视觉",
  READY_FOR_REVIEW: "待复核",
  APPROVED: "已批准",
  DELIVERED: "已交付",
  FAILED: "失败",
};

export default function ProductContentListPage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [executionMode, setExecutionMode] = useState<"AUTOPILOT" | "ALWAYS_ASK">(
    "AUTOPILOT",
  );

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setJobs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(`/api/product-content/jobs?orgId=${orgId}`);
      if (res.ok) {
        const data = (await res.json()) as { jobs?: JobRow[] };
        setJobs(data.jobs ?? []);
      } else {
        setJobs([]);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, ambiguous]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !title.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch("/api/product-content/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, title: title.trim(), executionMode }),
      });
      if (res.ok) {
        setTitle("");
        await load();
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "创建失败");
      }
    } finally {
      setCreating(false);
    }
  }

  if (orgLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载组织…
      </div>
    );
  }

  if (ambiguous || !orgId) {
    return (
      <div className="p-6">
        <PageHeader title="产品内容" description="AI 外贸产品内容总监" />
        <p className="mt-6 text-sm text-muted-foreground">
          您属于多个组织，请先在侧栏切换当前组织后再使用本功能。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="产品内容"
        description="管理 AI 外贸产品内容生成任务"
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <RefreshCw size={14} /> 刷新
          </button>
        }
      />

      <form
        onSubmit={handleCreate}
        className="rounded-lg border bg-card p-4 shadow-sm"
      >
        <h2 className="mb-3 text-sm font-medium">新建任务</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground">
            标题
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm text-foreground"
              placeholder="例如：全棉四件套出口资料"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            执行模式
            <select
              value={executionMode}
              onChange={(e) =>
                setExecutionMode(e.target.value as "AUTOPILOT" | "ALWAYS_ASK")
              }
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="AUTOPILOT">自动推进</option>
              <option value="ALWAYS_ASK">逐步确认</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={creating || !title.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            创建
          </button>
        </div>
      </form>

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3 text-sm font-medium">任务列表</div>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : jobs.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">暂无任务，请先创建。</p>
        ) : (
          <ul className="divide-y">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/product-content/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/40"
                >
                  <div>
                    <p className="font-medium text-foreground">{job.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(job.updatedAt).toLocaleString("zh-CN")} ·{" "}
                      {job.executionMode === "ALWAYS_ASK" ? "逐步确认" : "自动推进"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      job.status === "FAILED"
                        ? "bg-red-100 text-red-700"
                        : job.status === "DELIVERED"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-700",
                    )}
                  >
                    {STATUS_LABELS[job.status] ?? job.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
