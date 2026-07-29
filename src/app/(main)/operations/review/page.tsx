"use client";

/**
 * 发布审核队列 — Phase C：展示 Playbook / 风险 / 相似度 / Postiz 状态
 */

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, ShieldAlert, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

interface ReviewJob {
  id: string;
  status: string;
  normalizedStatus: string;
  channel: string;
  captionText: string;
  hashtags: string | null;
  hookText: string | null;
  ctaText: string | null;
  scheduledAt: string | null;
  sampledForReview: boolean;
  errorMessage: string | null;
  externalJobId: string | null;
  externalPostUrl: string | null;
  providerStatus: string | null;
  similarityScore: number | null;
  playbookEnforcementMode: string | null;
  hasApprovedPlaybook: boolean | null;
  riskResult: string | null;
  riskScore: number | null;
  riskIssues: Array<{ code: string; severity: string; message: string }>;
  approvedById: string | null;
  attemptCount: number;
  createdAt: string;
  asset: { id: string; title: string; videoUrl: string; language: string };
  account: {
    id: string;
    platform: string;
    handle: string;
    groupName: string;
    tier: string;
  };
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  xiaohongshu: "小红书",
};

const STATUS_LABEL: Record<string, string> = {
  pending_human_approval: "待人工审批",
  review: "待人工审批（旧）",
  blocked: "已阻断",
  ai_reviewed: "AI 已审",
  needs_revision: "需修改",
  draft: "草稿",
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
      const res = await apiFetch(
        "/api/operations/publish-jobs?status=pending_human_approval,review,blocked,ai_reviewed,needs_revision",
      );
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
          ...(action === "approve" &&
          edited !== undefined &&
          edited !== job.captionText
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
      <PageHeader
        title="发布审核队列"
        description="展示 Playbook 状态、风险与差异化结果。无批准 Playbook 时仅允许人工审核发布（兼容模式）。"
        actions={
          <button
            type="button"
            onClick={load}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-background"
          >
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
            刷新
          </button>
        }
      />

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
          {jobs.map((j) => {
            const legacy =
              j.hasApprovedPlaybook === false ||
              j.riskIssues?.some(
                (i) => i.code === "PLAYBOOK_NOT_APPROVED_LEGACY_FALLBACK",
              );
            return (
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
                    {STATUS_LABEL[j.normalizedStatus] ??
                      STATUS_LABEL[j.status] ??
                      j.status}
                  </span>
                  <span className="font-medium">
                    {j.account.handle}
                    <span className="ml-1 text-xs text-muted">
                      {PLATFORM_LABELS[j.account.platform] ?? j.account.platform}
                      · {j.account.groupName}
                      {j.account.tier === "premium" ? " · 精品号" : ""}
                    </span>
                  </span>
                  <span className="text-xs text-muted">视频：{j.asset.title}</span>
                </div>

                {legacy ? (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    兼容模式：仅允许人工审核发布。当前账号没有有效批准的运营方案，本内容使用
                    BrandProfile / personaNotes 兼容上下文生成，不符合自动发布条件。
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted">
                    Playbook：已批准可用 · 执行模式 {j.playbookEnforcementMode ?? "warn"}
                  </p>
                )}

                <div className="mt-2 grid gap-1 text-xs text-muted md:grid-cols-2">
                  <span>
                    风险：{j.riskResult ?? "—"}
                    {typeof j.riskScore === "number" ? `（${j.riskScore}）` : ""}
                  </span>
                  <span>
                    跨账号相似度：
                    {typeof j.similarityScore === "number"
                      ? `${(j.similarityScore * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                  <span>通道：{j.channel} · Postiz/外部状态：{j.providerStatus ?? "未派发"}</span>
                  <span>
                    外部任务：{j.externalJobId ?? "—"}
                    {j.externalPostUrl ? (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={j.externalPostUrl}
                          className="text-accent hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          帖子链接
                        </a>
                      </>
                    ) : null}
                  </span>
                </div>

                {j.riskIssues?.length ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-stone-700">
                    {j.riskIssues.slice(0, 6).map((issue, idx) => (
                      <li key={`${issue.code}-${idx}`}>
                        [{issue.severity}] {issue.code}: {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {j.errorMessage && (
                  <p className="mt-2 text-xs text-red-600">原因：{j.errorMessage}</p>
                )}

                {(j.hookText || j.ctaText) && (
                  <p className="mt-2 text-xs text-muted">
                    {j.hookText ? `Hook：${j.hookText}` : ""}
                    {j.ctaText ? ` · CTA：${j.ctaText}` : ""}
                  </p>
                )}

                <textarea
                  value={drafts[j.id] ?? j.captionText}
                  onChange={(e) =>
                    setDrafts((m) => ({ ...m, [j.id]: e.target.value }))
                  }
                  rows={4}
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
                    className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent)] disabled:opacity-50"
                  >
                    <Check size={14} />
                    {busyId === j.id ? "处理中…" : "通过并派发"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
