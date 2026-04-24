"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Images, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type {
  VisualizerSessionSummary,
  VisualizerSessionStatus,
} from "@/lib/visualizer/types";
import { VISUALIZER_SESSION_STATUS_LABEL } from "@/lib/visualizer/types";

interface VisualizerListProps {
  customerId: string;
  /** 可选：从客户下的销售机会列表中选择一个关联到新 session */
  opportunities?: { id: string; title: string; stage: string }[];
}

const STATUS_COLOR: Record<VisualizerSessionStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-blue-100 text-blue-800",
  archived: "bg-slate-100 text-slate-500",
};

export function VisualizerList({ customerId, opportunities }: VisualizerListProps) {
  const [sessions, setSessions] = useState<VisualizerSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOppId, setSelectedOppId] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/visualizer/sessions?customerId=${encodeURIComponent(customerId)}`,
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? "加载失败");
        setSessions([]);
        return;
      }
      const data = (await res.json()) as { sessions: VisualizerSessionSummary[] };
      setSessions(data.sessions ?? []);
    } catch (err) {
      console.error("Load visualizer sessions failed:", err);
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch("/api/visualizer/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          opportunityId: selectedOppId || undefined,
        }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((raw as { error?: string }).error ?? "创建失败");
        return;
      }
      const created = (raw as { session: VisualizerSessionSummary }).session;
      window.location.href = `/sales/visualizer/${created.id}`;
    } catch (err) {
      console.error("Create visualizer session failed:", err);
      setError("创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部操作条：可选挂机会 + 新建 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-white/60 px-3 py-2">
        <span className="text-xs text-muted shrink-0">关联机会（可选）：</span>
        <select
          value={selectedOppId}
          onChange={(e) => setSelectedOppId(e.target.value)}
          disabled={creating || !opportunities || opportunities.length === 0}
          className="h-8 min-w-[160px] flex-1 rounded-md border border-border bg-white px-2 text-xs disabled:opacity-60"
        >
          <option value="">不挂机会</option>
          {opportunities?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-white hover:bg-foreground/90 disabled:opacity-60"
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          新建方案
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-muted">
          <Images className="h-8 w-8 opacity-30" />
          <p className="mt-2 text-sm">暂无可视化方案</p>
          <p className="mt-1 text-xs opacity-70">点击上方「新建方案」为该客户发起窗饰预览</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const status = s.status as VisualizerSessionStatus;
            const previews = s.previewImages.slice(0, 3);
            const extraCount = s.counts.variants - previews.length;
            return (
              <Link
                key={s.id}
                href={`/sales/visualizer/${s.id}`}
                className="flex items-start gap-3 rounded-lg border border-border/50 bg-white/60 px-4 py-3 hover:bg-white/80 transition-colors"
              >
                {/* 缩略图堆叠 */}
                <div className="shrink-0">
                  {previews.length > 0 ? (
                    <div className="flex -space-x-3">
                      {previews.map((url, idx) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={`${s.id}-preview-${idx}`}
                          src={url}
                          alt={`${s.title} 方案封面 ${idx + 1}`}
                          className="h-14 w-20 rounded border-2 border-white object-cover shadow-sm"
                          style={{ zIndex: previews.length - idx }}
                        />
                      ))}
                      {extraCount > 0 && (
                        <div className="flex h-14 w-10 items-center justify-center rounded border-2 border-white bg-slate-100 text-[11px] font-medium text-slate-600 shadow-sm">
                          +{extraCount}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-14 w-20 items-center justify-center rounded border border-dashed border-border bg-slate-50 text-[10px] text-muted">
                      暂无封面
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {s.title}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        STATUS_COLOR[status] ?? STATUS_COLOR.draft,
                      )}
                    >
                      {VISUALIZER_SESSION_STATUS_LABEL[status] ?? status}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    <span>{s.counts.sourceImages} 张照片</span>
                    <span>{s.counts.variants} 个方案</span>
                    {s.opportunityTitle && (
                      <span className="truncate">机会：{s.opportunityTitle}</span>
                    )}
                  </div>
                </div>

                <span className="shrink-0 text-xs text-muted">
                  {new Date(s.updatedAt).toLocaleDateString("zh-CN")}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
