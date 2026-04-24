"use client";

/**
 * 从量房记录一键导入图片到 Visualizer session
 *
 * - GET /api/sales/measurements?customerId=... 获取该客户下的量房记录
 * - POST /api/visualizer/sessions/[id]/images/import-from-measurement 批量导入
 * - 所有照片以弱耦合 measurementPhotoId 回链，不重复写 blob
 * - 默认勾选全部窗位；可按窗位过滤
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, X, Download, CheckSquare, Square } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

interface MeasurementPhoto {
  id: string;
  fileName: string;
  fileUrl: string;
}

interface MeasurementWindow {
  id: string;
  roomName: string;
  windowLabel: string | null;
  photos: MeasurementPhoto[];
}

interface MeasurementRecord {
  id: string;
  status: string;
  overallNotes: string | null;
  measuredAt: string;
  windows: MeasurementWindow[];
}

interface Props {
  open: boolean;
  sessionId: string;
  customerId: string;
  defaultRecordId: string | null;
  onClose: () => void;
  onImported: (summary: { imported: number; skipped: number }) => void;
}

export default function MeasurementImportDialog(props: Props) {
  const { open, sessionId, customerId, defaultRecordId, onClose, onImported } = props;

  const [records, setRecords] = useState<MeasurementRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [windowSelection, setWindowSelection] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(
        `/api/sales/measurements?customerId=${encodeURIComponent(customerId)}`,
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setLoadError((j as { error?: string }).error ?? "加载失败");
        return;
      }
      const data = (await res.json()) as { records: MeasurementRecord[] };
      setRecords(data.records);
      if (data.records.length === 0) {
        setSelectedRecordId(null);
        return;
      }
      // 优先用 session 已绑定的 record；否则选最新一条
      const target =
        data.records.find((r) => r.id === defaultRecordId) ?? data.records[0];
      setSelectedRecordId(target.id);
    } catch (err) {
      console.error("Load measurement records failed:", err);
      setLoadError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [customerId, defaultRecordId]);

  useEffect(() => {
    if (!open) return;
    void loadRecords();
  }, [open, loadRecords]);

  const currentRecord = useMemo<MeasurementRecord | null>(() => {
    if (!selectedRecordId) return null;
    return records.find((r) => r.id === selectedRecordId) ?? null;
  }, [records, selectedRecordId]);

  // 切换 record 时，默认全选所有**带照片**的窗位
  useEffect(() => {
    if (!currentRecord) {
      setWindowSelection(new Set());
      return;
    }
    const withPhotos = currentRecord.windows
      .filter((w) => w.photos.length > 0)
      .map((w) => w.id);
    setWindowSelection(new Set(withPhotos));
  }, [currentRecord]);

  const toggleWindow = (windowId: string) => {
    setWindowSelection((prev) => {
      const next = new Set(prev);
      if (next.has(windowId)) next.delete(windowId);
      else next.add(windowId);
      return next;
    });
  };

  const totalPhotos = useMemo(() => {
    if (!currentRecord) return 0;
    return currentRecord.windows
      .filter((w) => windowSelection.has(w.id))
      .reduce((s, w) => s + w.photos.length, 0);
  }, [currentRecord, windowSelection]);

  const handleImport = async () => {
    if (!currentRecord || totalPhotos === 0) return;
    setImporting(true);
    try {
      const res = await apiFetch(
        `/api/visualizer/sessions/${sessionId}/images/import-from-measurement`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            measurementRecordId: currentRecord.id,
            windowIds: Array.from(windowSelection),
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((data as { error?: string }).error ?? "导入失败");
        return;
      }
      const summary = data as { imported: number; skipped: number };
      onImported(summary);
    } catch (err) {
      console.error("Import from measurement failed:", err);
      alert("网络错误，导入失败");
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">从量房记录导入照片</h3>
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
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载量房记录…
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {loadError}
            </div>
          )}

          {!loading && !loadError && records.length === 0 && (
            <div className="text-center text-sm text-muted">
              该客户暂无量房记录。请先在「销售 · 量房」创建一条。
            </div>
          )}

          {!loading && !loadError && records.length > 0 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted">选择量房记录</label>
                <select
                  value={selectedRecordId ?? ""}
                  onChange={(e) => setSelectedRecordId(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
                  disabled={importing}
                >
                  {records.map((r) => {
                    const photoCount = r.windows.reduce(
                      (s, w) => s + w.photos.length,
                      0,
                    );
                    return (
                      <option key={r.id} value={r.id}>
                        {new Date(r.measuredAt).toLocaleDateString("zh-CN")} · {r.windows.length}{" "}
                        窗 · {photoCount} 张照片{r.status ? ` · ${r.status}` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              {currentRecord && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted">选择窗位</div>
                  {currentRecord.windows.length === 0 ? (
                    <div className="text-xs text-muted">该记录没有窗位</div>
                  ) : (
                    <ul className="space-y-1">
                      {currentRecord.windows.map((w) => {
                        const disabled = w.photos.length === 0;
                        const checked = windowSelection.has(w.id);
                        return (
                          <li
                            key={w.id}
                            className={cn(
                              "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                              disabled
                                ? "cursor-not-allowed border-border/40 bg-slate-50 text-muted"
                                : "cursor-pointer border-border/60 bg-white hover:bg-slate-50",
                            )}
                            onClick={() => {
                              if (!disabled && !importing) toggleWindow(w.id);
                            }}
                          >
                            {checked ? (
                              <CheckSquare className="h-3.5 w-3.5 text-blue-600" />
                            ) : (
                              <Square className="h-3.5 w-3.5 text-muted" />
                            )}
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {w.roomName}
                              {w.windowLabel ? ` · ${w.windowLabel}` : ""}
                            </span>
                            <span className="text-[10px] text-muted">
                              {w.photos.length} 张
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              <div className="rounded-md border border-blue-100 bg-blue-50/80 px-3 py-2 text-[11px] text-blue-900 leading-relaxed">
                已有同 measurementPhotoId 的照片会被自动跳过；导入不会重复上传到存储。
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
          <button
            onClick={onClose}
            disabled={importing}
            className="rounded-md border border-border bg-white px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-60"
          >
            取消
          </button>
          <button
            onClick={handleImport}
            disabled={importing || totalPhotos === 0 || !currentRecord}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-white hover:bg-foreground/90 disabled:opacity-60"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            导入 {totalPhotos} 张照片
          </button>
        </div>
      </div>
    </div>
  );
}
