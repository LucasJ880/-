"use client";

/**
 * 内容日历 — 选题规划层
 * AI 按品牌记忆出选题 → 人工通过/跳过 → 关联视频资产扇出发布。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

interface PlanItem {
  id: string;
  plannedDate: string;
  groupName: string;
  topic: string;
  angle: string | null;
  suggestedCaption: string | null;
  hashtags: string | null;
  status: string;
  source: string;
  assetId: string | null;
  sourceSignalId?: string | null;
}

interface AssetOption {
  id: string;
  title: string;
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  proposed: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  dispatched: "bg-blue-100 text-blue-700",
  skipped: "bg-stone-200 text-stone-500",
};

const STATUS_LABELS: Record<string, string> = {
  proposed: "待审",
  approved: "已通过",
  dispatched: "已扇出",
  skipped: "跳过",
};

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function formatDay(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${key.slice(5).replace("-", "/")} ${weekdays[d.getDay()]}`;
}

export default function ContentCalendarPage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [items, setItems] = useState<PlanItem[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [genDays, setGenDays] = useState(7);
  const [genPerDay, setGenPerDay] = useState(1);
  const [generating, setGenerating] = useState(false);

  const [dispatchFor, setDispatchFor] = useState<string | null>(null);
  const [dispatchAsset, setDispatchAsset] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [planRes, assetRes] = await Promise.all([
        apiFetch("/api/operations/content-plan"),
        apiFetch("/api/operations/video-assets"),
      ]);
      const planData = await planRes.json();
      if (!planRes.ok) throw new Error(planData.error || "加载失败");
      setItems(planData.items);
      const assetData = await assetRes.json();
      if (assetRes.ok) {
        setAssets(
          (assetData.assets as Array<{ id: string; title: string; status: string }>)
            .filter((a) => a.status === "pending" || a.status === "ready")
            .map((a) => ({ id: a.id, title: a.title, status: a.status })),
        );
      }
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

  const byDate = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const it of items) {
      const key = dateKey(it.plannedDate);
      const list = m.get(key) ?? [];
      list.push(it);
      m.set(key, list);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/api/operations/content-plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, days: genDays, perDayPerGroup: genPerDay }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setNotice(`AI 生成了 ${data.created} 条选题（账号组：${data.groups.join("、")}），请逐条审核`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function patchItem(id: string, patch: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/operations/content-plan/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      setItems((prev) => prev.map((it) => (it.id === id ? data.item : it)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("删除这条选题？")) return;
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/operations/content-plan/${id}`, { method: "DELETE" });
      if (res.ok) setItems((prev) => prev.filter((it) => it.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDispatch(id: string) {
    if (!dispatchAsset || busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await apiFetch(`/api/operations/content-plan/${id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, assetId: dispatchAsset }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "扇出失败");
      const parts = [`新建 ${data.createdJobs} 个任务`, `入队 ${data.queued}`];
      if (data.held > 0) parts.push(`待审核 ${data.held}`);
      if (data.blocked > 0) parts.push(`拦截 ${data.blocked}`);
      setNotice(`扇出完成：${parts.join("，")}`);
      setDispatchFor(null);
      setDispatchAsset("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "扇出失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title="内容日历"
        description="AI 按品牌记忆为每个账号组批量出选题，人工审核后关联视频扇出。让矩阵从「来什么发什么」变成「按计划发」。"
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

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card-bg p-4">
        <label className="space-y-1 text-xs text-muted">
          生成天数
          <select
            value={genDays}
            onChange={(e) => setGenDays(Number(e.target.value))}
            className="block w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {[3, 7, 14].map((d) => (
              <option key={d} value={d}>{d} 天</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted">
          每组每天
          <select
            value={genPerDay}
            onChange={(e) => setGenPerDay(Number(e.target.value))}
            className="block w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {[1, 2, 3].map((d) => (
              <option key={d} value={d}>{d} 条</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Sparkles size={14} />
          {generating ? "生成中…（约 1 分钟）" : "AI 生成选题"}
        </button>
        <p className="text-xs text-muted">
          选题依据「品牌记忆」与账号组 persona，自动避开近两周已有方向
        </p>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && byDate.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted">
          未来两周还没有选题。点「AI 生成选题」开始规划。
        </div>
      )}

      {byDate.map(([day, dayItems]) => (
        <div key={day} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted">{formatDay(day)}</h2>
          {dayItems.map((it) => (
            <div
              key={it.id}
              className={cn(
                "rounded-xl border border-border bg-card-bg p-4",
                it.status === "skipped" && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px]", STATUS_STYLES[it.status])}>
                      {STATUS_LABELS[it.status] ?? it.status}
                    </span>
                    <span className="text-[11px] text-muted">{it.groupName}</span>
                    {it.source === "ai" && <span className="text-[11px] text-muted">AI</span>}
                    {it.source === "manual" && <span className="text-[11px] text-muted">手动</span>}
                    {it.source === "intelligence" && (
                      <a
                        href="/operations/intelligence"
                        className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-200"
                        title={it.sourceSignalId ? `信号 ${it.sourceSignalId}` : "来自市场情报"}
                      >
                        情报
                      </a>
                    )}
                    {it.status === "approved" && !it.assetId && (
                      <span className="text-[11px] text-amber-700">待配视频</span>
                    )}
                  </div>
                  <div className="mt-1 font-semibold">{it.topic}</div>
                  {it.angle && <p className="mt-1 text-xs leading-relaxed text-muted">{it.angle}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {it.status === "proposed" && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === it.id}
                        onClick={() => patchItem(it.id, { status: "approved" })}
                        className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                      >
                        <Check size={12} />
                        通过
                      </button>
                      <button
                        type="button"
                        disabled={busyId === it.id}
                        onClick={() => patchItem(it.id, { status: "skipped" })}
                        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-background disabled:opacity-50"
                      >
                        <X size={12} />
                        跳过
                      </button>
                    </>
                  )}
                  {it.status === "approved" && (
                    <button
                      type="button"
                      onClick={() => {
                        setDispatchFor(dispatchFor === it.id ? null : it.id);
                        setDispatchAsset("");
                      }}
                      className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
                    >
                      关联视频扇出
                    </button>
                  )}
                  {it.status !== "dispatched" && (
                    <button
                      type="button"
                      disabled={busyId === it.id}
                      onClick={() => handleDelete(it.id)}
                      className="rounded-md p-1 text-muted hover:text-red-600"
                      aria-label="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {it.suggestedCaption && it.status !== "dispatched" ? (
                <textarea
                  defaultValue={it.suggestedCaption}
                  rows={2}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== it.suggestedCaption) patchItem(it.id, { suggestedCaption: v });
                  }}
                  className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed text-foreground"
                />
              ) : (
                it.suggestedCaption && (
                  <p className="mt-2 whitespace-pre-wrap rounded-md bg-background px-2 py-1.5 text-xs leading-relaxed text-muted">
                    {it.suggestedCaption}
                  </p>
                )
              )}
              {it.hashtags && <p className="mt-1 text-xs text-accent">{it.hashtags}</p>}

              {dispatchFor === it.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-2">
                  <select
                    value={dispatchAsset}
                    onChange={(e) => setDispatchAsset(e.target.value)}
                    className="min-w-48 flex-1 rounded-md border border-border bg-card-bg px-2 py-1.5 text-xs text-foreground"
                  >
                    <option value="">选择视频资产…</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}（{a.status === "ready" ? "可排期" : "待配文案"}）
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!dispatchAsset || busyId === it.id}
                    onClick={() => handleDispatch(it.id)}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {busyId === it.id ? "扇出中…" : `扇出到「${it.groupName}」`}
                  </button>
                  {assets.length === 0 && (
                    <span className="text-xs text-muted">暂无可用视频，先到「视频资产」入库</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
