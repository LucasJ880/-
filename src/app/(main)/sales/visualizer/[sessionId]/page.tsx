"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Images,
  Layers,
  Loader2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import type {
  VisualizerSessionDetail,
  VisualizerSessionStatus,
} from "@/lib/visualizer/types";
import { VISUALIZER_SESSION_STATUS_LABEL } from "@/lib/visualizer/types";

const STATUS_COLOR: Record<VisualizerSessionStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-blue-100 text-blue-800",
  archived: "bg-slate-100 text-slate-500",
};

export default function VisualizerSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<VisualizerSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/visualizer/sessions/${sessionId}`);
      if (res.status === 403) {
        setError("无权访问该可视化方案");
        setSession(null);
        return;
      }
      if (res.status === 404) {
        setError("可视化方案不存在");
        setSession(null);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? "加载失败");
        setSession(null);
        return;
      }
      const data = (await res.json()) as VisualizerSessionDetail;
      setSession(data);
    } catch (err) {
      console.error("Load visualizer session failed:", err);
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const startEditTitle = () => {
    if (!session) return;
    setTitleDraft(session.title);
    setEditingTitle(true);
  };
  const cancelEditTitle = () => {
    setEditingTitle(false);
    setTitleDraft("");
  };
  const saveTitle = async () => {
    if (!session) return;
    const next = titleDraft.trim();
    if (!next) return;
    if (next === session.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    try {
      const res = await apiFetch(`/api/visualizer/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "保存失败");
        return;
      }
      setSession((prev) => (prev ? { ...prev, title: next } : prev));
      setEditingTitle(false);
    } catch (err) {
      console.error("Save title failed:", err);
      alert("保存失败");
    } finally {
      setSavingTitle(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? "加载失败"}
        </div>
      </div>
    );
  }

  const status = session.status as VisualizerSessionStatus;

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 返回
      </button>

      <PageHeader
        title="可视化方案"
        description="Visualizer 编辑器（画布交互将于 PR #2 接入）"
      />

      {/* Session 基本信息卡片 */}
      <div className="rounded-xl border border-border/60 bg-white/60 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveTitle();
                    if (e.key === "Escape") cancelEditTitle();
                  }}
                  className="h-9 flex-1 rounded-md border border-border bg-white px-2 text-sm"
                />
                <button
                  onClick={saveTitle}
                  disabled={savingTitle}
                  className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1.5 text-xs text-white hover:bg-foreground/90 disabled:opacity-60"
                >
                  {savingTitle ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  保存
                </button>
                <button
                  onClick={cancelEditTitle}
                  disabled={savingTitle}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" /> 取消
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-foreground">
                  {session.title}
                </h2>
                <button
                  onClick={startEditTitle}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-xs text-muted hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" /> 改名
                </button>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  STATUS_COLOR[status] ?? STATUS_COLOR.draft,
                )}
              >
                {VISUALIZER_SESSION_STATUS_LABEL[status] ?? status}
              </span>
              <span>·</span>
              <span>
                客户：
                <Link
                  href={`/sales/customers/${session.customer.id}`}
                  className="text-foreground underline underline-offset-2"
                >
                  {session.customer.name}
                </Link>
              </span>
              {session.opportunity && (
                <>
                  <span>·</span>
                  <span className="truncate">机会：{session.opportunity.title}</span>
                </>
              )}
              {session.quote && (
                <>
                  <span>·</span>
                  <span>报价 v{session.quote.version}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs text-muted sm:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide">原图</div>
            <div className="mt-0.5 text-sm text-foreground">
              {session.counts.sourceImages} 张
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide">方案</div>
            <div className="mt-0.5 text-sm text-foreground">
              {session.counts.variants} 个
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide">创建时间</div>
            <div className="mt-0.5 text-sm text-foreground">
              {new Date(session.createdAt).toLocaleDateString("zh-CN")}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide">最后更新</div>
            <div className="mt-0.5 text-sm text-foreground">
              {new Date(session.updatedAt).toLocaleDateString("zh-CN")}
            </div>
          </div>
        </div>
      </div>

      {/* 原图区 — PR #2 接入上传 */}
      <section className="rounded-xl border border-border/60 bg-white/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Images className="h-4 w-4 text-muted" />
          <h3 className="text-sm font-semibold text-foreground">原始照片</h3>
          <span className="ml-auto text-xs text-muted">
            {session.sourceImages.length} 张
          </span>
        </div>
        {session.sourceImages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/80 bg-white/40 px-4 py-10 text-center text-sm text-muted">
            <p>暂无上传的现场照片</p>
            <p className="mt-1 text-xs opacity-80">
              图片上传 + 窗户区域标记将在 PR #2 接入
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {session.sourceImages.map((img) => (
              <li
                key={img.id}
                className="overflow-hidden rounded-lg border border-border/60 bg-white/70"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.fileUrl}
                  alt={img.fileName}
                  className="aspect-[4/3] w-full object-cover"
                />
                <div className="px-2 py-1.5 text-xs">
                  <div className="truncate font-medium text-foreground">
                    {img.roomLabel || img.fileName}
                  </div>
                  <div className="mt-0.5 text-muted">{img.regionCount} 个窗户区域</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 方案区 — PR #2 接入编辑 */}
      <section className="rounded-xl border border-border/60 bg-white/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted" />
          <h3 className="text-sm font-semibold text-foreground">方案列表</h3>
          <span className="ml-auto text-xs text-muted">
            {session.variants.length} 个
          </span>
        </div>
        {session.variants.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/80 bg-white/40 px-4 py-10 text-center text-sm text-muted">
            <p>暂无方案</p>
            <p className="mt-1 text-xs opacity-80">
              画布编辑器 + Option A/B 保存将在 PR #2 接入
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {session.variants.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-white/70 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{v.name}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {v.productOptionCount} 个产品
                    {v.hasSalesSelection && "（销售已推荐）"}
                    {v.hasCustomerSelection && "（客户已选）"}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {new Date(v.updatedAt).toLocaleDateString("zh-CN")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
