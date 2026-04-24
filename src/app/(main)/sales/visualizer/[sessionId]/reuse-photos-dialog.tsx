"use client";

/**
 * 复用同客户其他 session 的现场照片到当前 session
 *
 * - GET /api/visualizer/sessions/[id]/reuse-candidates 拉取候选（按 session 分组）
 * - POST /api/visualizer/sessions/[id]/images/clone 批量克隆（只 DB 写入，不复制 blob）
 * - 默认不勾选，支持按 session 一键全选
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, X, Copy, CheckSquare, Square } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

interface CandidateImage {
  id: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  roomLabel: string | null;
  createdAt: string;
}

interface CandidateGroup {
  sessionId: string;
  title: string;
  opportunityTitle: string | null;
  updatedAt: string;
  images: CandidateImage[];
}

interface Props {
  open: boolean;
  sessionId: string;
  onClose: () => void;
  onImported: (summary: { imported: number; skipped: number }) => void;
}

export default function ReusePhotosDialog(props: Props) {
  const { open, sessionId, onClose, onImported } = props;

  const [groups, setGroups] = useState<CandidateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(
        `/api/visualizer/sessions/${sessionId}/reuse-candidates`,
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setLoadError((j as { error?: string }).error ?? "加载失败");
        return;
      }
      const data = (await res.json()) as { groups: CandidateGroup[] };
      setGroups(data.groups);
      setSelection(new Set());
    } catch (err) {
      console.error("Load reuse candidates failed:", err);
      setLoadError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const totalImages = useMemo(
    () => groups.reduce((s, g) => s + g.images.length, 0),
    [groups],
  );

  const toggleImage = (imageId: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  };

  const toggleGroup = (group: CandidateGroup) => {
    const ids = group.images.map((i) => i.id);
    const allSelected = ids.every((id) => selection.has(id));
    setSelection((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selection.size === 0) return;
    setImporting(true);
    try {
      const res = await apiFetch(
        `/api/visualizer/sessions/${sessionId}/images/clone`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceImageIds: Array.from(selection) }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((data as { error?: string }).error ?? "复用失败");
        return;
      }
      const summary = data as { imported: number; skipped: number };
      onImported(summary);
    } catch (err) {
      console.error("Clone source images failed:", err);
      alert("网络错误，复用失败");
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">复用已有现场照片</h3>
            <p className="text-[11px] text-muted">
              同客户下其他方案里的照片可直接挂进当前方案（不重复上传）
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={importing}
            className="rounded p-1 text-muted hover:bg-slate-100 disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载候选照片…
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {loadError}
            </div>
          )}

          {!loading && !loadError && groups.length === 0 && (
            <div className="text-center text-sm text-muted">
              该客户暂无其他可视化方案，或其他方案里没有照片可复用。
            </div>
          )}

          {!loading && !loadError && groups.length > 0 && (
            <div className="space-y-4">
              {groups.map((g) => {
                const ids = g.images.map((i) => i.id);
                const allSelected = ids.every((id) => selection.has(id));
                const someSelected = !allSelected && ids.some((id) => selection.has(id));
                return (
                  <div key={g.sessionId} className="rounded-lg border border-border/60 bg-white/70">
                    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-foreground">
                          {g.title}
                        </div>
                        <div className="truncate text-[10px] text-muted">
                          {g.opportunityTitle ? `机会：${g.opportunityTitle} · ` : ""}
                          {new Date(g.updatedAt).toLocaleDateString("zh-CN")} 更新 ·{" "}
                          {g.images.length} 张照片
                        </div>
                      </div>
                      <button
                        onClick={() => toggleGroup(g)}
                        disabled={importing}
                        className="shrink-0 rounded-md border border-border bg-white px-2 py-1 text-[11px] text-muted hover:text-foreground disabled:opacity-60"
                      >
                        {allSelected ? "全部取消" : someSelected ? "反选" : "全选"}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
                      {g.images.map((img) => {
                        const checked = selection.has(img.id);
                        return (
                          <button
                            key={img.id}
                            type="button"
                            onClick={() => {
                              if (!importing) toggleImage(img.id);
                            }}
                            className={cn(
                              "group relative flex flex-col overflow-hidden rounded-md border text-left",
                              checked
                                ? "border-emerald-500 ring-2 ring-emerald-200"
                                : "border-border/60 hover:border-border",
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.fileUrl}
                              alt={img.fileName}
                              className="aspect-[4/3] w-full object-cover"
                            />
                            <div className="flex items-center gap-1 px-2 py-1 text-[10px]">
                              {checked ? (
                                <CheckSquare className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Square className="h-3 w-3 text-muted" />
                              )}
                              <span className="min-w-0 flex-1 truncate">
                                {img.roomLabel || img.fileName}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="rounded-md border border-blue-100 bg-blue-50/80 px-3 py-2 text-[11px] text-blue-900 leading-relaxed">
                同一张图片在当前方案已存在时会被自动跳过。克隆只新建数据库记录，不重复上传到存储。
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <span className="text-[11px] text-muted">
            {totalImages > 0 ? `已选 ${selection.size} / 共 ${totalImages} 张` : "暂无可选照片"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={importing}
              className="rounded-md border border-border bg-white px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-60"
            >
              取消
            </button>
            <button
              onClick={handleImport}
              disabled={importing || selection.size === 0}
              className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-white hover:bg-foreground/90 disabled:opacity-60"
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              复用 {selection.size} 张
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
