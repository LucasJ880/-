"use client";

/**
 * 发布审核队列 — 抽检 + 规则拦截的任务在此人工处理
 * 通过（可改文案）→ 派发到通道；驳回 → 取消。
 */

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, ShieldAlert, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { cn } from "@/lib/utils";

interface ReviewJob {
  id: string;
  status: string;
  channel: string;
  captionText: string;
  hashtags: string | null;
  scheduledAt: string | null;
  sampledForReview: boolean;
  errorMessage: string | null;
  createdAt: string;
  asset: { id: string; title: string; videoUrl: string; language: string };
  account: { id: string; platform: string; handle: string; groupName: string };
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  xiaohongshu: "小红书",
};

export default function PublishReviewPage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [jobs, setJobs] = useState<ReviewJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/operations/publish-jobs?status=review,blocked");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setJobs(data.jobs);
      setDrafts({});
      setRowError({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (orgLoading || ambiguous) return;
    load();
  }, [orgLoading, ambiguous, orgId, load]);

  async function handleAction(job: ReviewJob, action: "approve" | "reject") {
    if (busyId) return;
    setBusyId(job.id);
    setRowError((m) => ({ ...m, [job.id]: "" }));
    try {
      const edited = drafts[job.id];
      const res = await apiFetch(`/api/operations/publish-jobs/${job.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          ...(action === "approve" && edited !== undefined && edited !== job.captionText
            ? { captionText: edited }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      await load();
    } catch (e) {
      setRowError((m) => ({
        ...m,
        [job.id]: e instanceof Error ? e.message : "操作失败",
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">发布审核队列</h1>
          <p className="mt-1 text-sm text-muted">
            抽检任务与规则拦截任务在此处理。被拦截的必须改文案后才能通过；通过即派发。
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-background"
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          刷新
        </button>
      </div>

      <OrgSelectBanner />

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {jobs.length === 0 && !loading ? (
        <div className="rounded-xl border border-border bg-card-bg px-4 py-10 text-center text-sm text-muted">
          审核队列为空。
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className="rounded-xl border border-border bg-card-bg p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                    j.status === "blocked"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700",
                  )}
                >
                  {j.status === "blocked" && <ShieldAlert size={12} />}
                  {j.status === "blocked" ? "规则拦截" : j.sampledForReview ? "抽检" : "高敏内容"}
                </span>
                <span className="font-medium">
                  {j.account.handle}
                  <span className="ml-1 text-xs text-muted">
                    {PLATFORM_LABELS[j.account.platform] ?? j.account.platform} · {j.account.groupName}
                  </span>
                </span>
                <span className="text-xs text-muted">视频：{j.asset.title}</span>
                <a
                  href={j.asset.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline"
                >
                  预览
                </a>
              </div>

              {j.errorMessage && (
                <p className="mt-2 text-xs text-red-600">滞留原因：{j.errorMessage}</p>
              )}

              <textarea
                value={drafts[j.id] ?? j.captionText}
                onChange={(e) => setDrafts((m) => ({ ...m, [j.id]: e.target.value }))}
                rows={3}
                className="mt-3 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
              {j.hashtags && (
                <p className="mt-1 text-xs text-muted">话题：{j.hashtags}</p>
              )}
              {rowError[j.id] && (
                <p className="mt-1 text-sm text-red-600">{rowError[j.id]}</p>
              )}

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleAction(j, "reject")}
                  disabled={busyId === j.id}
                  className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <X size={14} />
                  驳回
                </button>
                <button
                  type="button"
                  onClick={() => handleAction(j, "approve")}
                  disabled={busyId === j.id}
                  className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Check size={14} />
                  {busyId === j.id ? "处理中…" : "通过并派发"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
