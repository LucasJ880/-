"use client";

/**
 * 运营数据看板 — 矩阵账号健康 / 发布任务状态 / 近 14 天发布趋势
 * 数据来自青砚自有管道；平台侧互动数据待 Postiz Analytics 接入。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { cn } from "@/lib/utils";

interface PlatformAccounts {
  total: number;
  active: number;
  limited: number;
  banned: number;
  paused: number;
}

interface DashboardData {
  accounts: { total: number; byPlatform: Record<string, PlatformAccounts> };
  assets: { byStatus: Record<string, number> };
  jobs: { byStatus: Record<string, number> };
  pendingReview: number;
  recent: {
    days: number;
    daily: { date: string; total: number; published: number; failed: number }[];
    byPlatform: Record<string, number>;
  };
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  xiaohongshu: "小红书",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  review: "待审核",
  blocked: "已拦截",
  queued: "队列中",
  processing: "发布中",
  published: "已发布",
  failed: "失败",
  canceled: "已取消",
};

const ASSET_STATUS_LABELS: Record<string, string> = {
  pending: "待配文案",
  ready: "可排期",
  scheduled: "已排期",
  published: "已发布",
  blocked: "已拦截",
};

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-card-bg px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-bold",
          tone === "warn" && value > 0 && "text-amber-600",
          tone === "danger" && value > 0 && "text-red-600",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export default function OperationsDashboardPage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/operations/dashboard");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "加载失败");
      setData(body);
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

  const maxDaily = Math.max(1, ...(data?.recent.daily.map((d) => d.total) ?? [1]));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">运营数据看板</h1>
          <p className="mt-1 text-sm text-muted">
            矩阵账号健康、发布任务状态与近 {data?.recent.days ?? 14} 天发布趋势。
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

      {data && (
        <>
          {data.pendingReview > 0 && (
            <Link
              href="/operations/review"
              className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 transition-colors hover:bg-amber-100"
            >
              <ShieldAlert size={15} />
              {data.pendingReview} 个发布任务在审核队列等待处理 →
            </Link>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="矩阵账号" value={data.accounts.total} />
            <StatCard label="队列中/发布中" value={(data.jobs.byStatus.queued ?? 0) + (data.jobs.byStatus.processing ?? 0)} />
            <StatCard label="已发布" value={data.jobs.byStatus.published ?? 0} />
            <StatCard label="失败" value={data.jobs.byStatus.failed ?? 0} tone="danger" />
          </div>

          {/* 近 14 天发布趋势 */}
          <div className="rounded-xl border border-border bg-card-bg p-4">
            <h2 className="text-sm font-semibold">近 {data.recent.days} 天发布任务</h2>
            <div className="mt-3 flex h-28 items-end gap-1">
              {data.recent.daily.map((d) => (
                <div key={d.date} className="group relative flex-1">
                  <div
                    className="w-full rounded-t bg-accent/70 transition-colors group-hover:bg-accent"
                    style={{ height: `${Math.max(2, (d.total / maxDaily) * 100)}px` }}
                  />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[11px] text-background group-hover:block">
                    {d.date.slice(5)}：{d.total} 条（成 {d.published} / 败 {d.failed}）
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted">
              <span>{data.recent.daily[0]?.date.slice(5)}</span>
              <span>{data.recent.daily.at(-1)?.date.slice(5)}</span>
            </div>
            {Object.keys(data.recent.byPlatform).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                {Object.entries(data.recent.byPlatform).map(([p, n]) => (
                  <span key={p} className="rounded-full bg-background px-2 py-0.5">
                    {PLATFORM_LABELS[p] ?? p}：{n}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* 账号健康 */}
            <div className="rounded-xl border border-border bg-card-bg p-4">
              <h2 className="text-sm font-semibold">账号健康（按平台）</h2>
              {Object.keys(data.accounts.byPlatform).length === 0 ? (
                <p className="mt-3 text-sm text-muted">还没有登记矩阵账号。</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pb-2 font-normal">平台</th>
                      <th className="pb-2 text-right font-normal">总数</th>
                      <th className="pb-2 text-right font-normal">正常</th>
                      <th className="pb-2 text-right font-normal">限流</th>
                      <th className="pb-2 text-right font-normal">封禁</th>
                      <th className="pb-2 text-right font-normal">暂停</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.accounts.byPlatform).map(([p, row]) => (
                      <tr key={p} className="border-t border-border">
                        <td className="py-2">{PLATFORM_LABELS[p] ?? p}</td>
                        <td className="py-2 text-right">{row.total}</td>
                        <td className="py-2 text-right text-emerald-600">{row.active}</td>
                        <td className={cn("py-2 text-right", row.limited > 0 && "font-medium text-amber-600")}>{row.limited}</td>
                        <td className={cn("py-2 text-right", row.banned > 0 && "font-medium text-red-600")}>{row.banned}</td>
                        <td className="py-2 text-right text-muted">{row.paused}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 任务与资产状态 */}
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card-bg p-4">
                <h2 className="text-sm font-semibold">发布任务状态</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(JOB_STATUS_LABELS).map(([s, label]) => {
                    const n = data.jobs.byStatus[s] ?? 0;
                    if (n === 0) return null;
                    return (
                      <span
                        key={s}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs",
                          s === "failed" || s === "blocked"
                            ? "bg-red-100 text-red-700"
                            : s === "review"
                              ? "bg-amber-100 text-amber-700"
                              : s === "published"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-background text-muted",
                        )}
                      >
                        {label} {n}
                      </span>
                    );
                  })}
                  {Object.values(data.jobs.byStatus).every((n) => n === 0) && (
                    <span className="text-sm text-muted">还没有发布任务。</span>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card-bg p-4">
                <h2 className="text-sm font-semibold">视频资产状态</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(ASSET_STATUS_LABELS).map(([s, label]) => {
                    const n = data.assets.byStatus[s] ?? 0;
                    if (n === 0) return null;
                    return (
                      <span key={s} className="rounded-full bg-background px-2.5 py-1 text-xs text-muted">
                        {label} {n}
                      </span>
                    );
                  })}
                  {Object.values(data.assets.byStatus).every((n) => n === 0) && (
                    <span className="text-sm text-muted">还没有视频资产。</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted">
            平台侧互动数据（播放 / 点赞 / 涨粉）将在 Postiz Analytics 接入后展示。
          </p>
        </>
      )}
    </div>
  );
}
