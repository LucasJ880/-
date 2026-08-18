"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

type GeneratedDoc = {
  id: string;
  fileUrl?: string | null;
  blobUrl?: string | null;
  version?: number;
  title?: string;
};

export function ChinaSupplierBriefPanel({ projectId }: { projectId: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<GeneratedDoc | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [includeHistorical, setIncludeHistorical] = useState(false);
  const [notes, setNotes] = useState(
    "请核对：仅公开/招标确认项可发给国内厂家；默认不含估值与内部成本。",
  );

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: "china_supplier_brief",
          previewOnly: true,
          includePublicHistoricalAmounts: includeHistorical,
          confirmNotes: notes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `预览失败（${res.status}）`);
      setPreviewText(String(data.previewText || ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: "china_supplier_brief",
          confirmNotes: notes,
          includePublicHistoricalAmounts: includeHistorical,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `生成失败（${res.status}）`);
      }
      const document = data.document as GeneratedDoc | undefined;
      if (!document?.id) {
        throw new Error("生成成功但未返回 document id");
      }
      setDoc(document);
      setConfirmOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openUrl = doc?.fileUrl || doc?.blobUrl || null;

  return (
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">国内供应商简报 PDF</h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            服务端 Chromium 生成真 PDF（中文完好）；默认 allowlist，不含估值/成本/利润/内部备注。
          </p>
          <p className="text-[11px] text-amber-800 bg-amber-50 rounded px-2 py-1 mt-2 inline-block">
            已知限制：中文字体当前为 Helvetica，中文可能显示为缺字或方框；完整字体嵌入延后。
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          生成 China Supplier Brief
        </button>
      </div>

      {confirmOpen && (
        <div className="rounded-lg border border-[var(--border)] p-3 space-y-2 bg-[var(--card-bg)]">
          <p className="text-sm font-medium">生成前确认 / 预览</p>
          <p className="text-xs text-[var(--muted)]">
            服务端将再次过滤敏感字段。公开历史金额默认关闭，打开后也仅允许有来源的历史参考。
          </p>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeHistorical}
              onChange={(e) => setIncludeHistorical(e.target.checked)}
            />
            包含公开历史采购金额（默认关闭；标记为历史参考，非本次预算）
          </label>
          <textarea
            className="w-full rounded border px-2 py-1.5 text-sm min-h-[72px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {previewText && (
            <pre className="max-h-56 overflow-auto rounded border bg-white p-2 text-[11px] whitespace-pre-wrap">
              {previewText}
            </pre>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void preview()}
              className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {busy ? "处理中…" : "预览正文"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void generate()}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {busy ? "生成中…" : "确认生成"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmOpen(false);
                setPreviewText(null);
              }}
              className="rounded-lg border px-3 py-1.5 text-xs"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
          {error}
        </p>
      )}

      {doc && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm space-y-2">
          <p>
            已生成文档 <span className="font-mono text-xs">{doc.id}</span>
            {doc.version != null ? ` · v${doc.version}` : ""}
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            {openUrl ? (
              <>
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  查看 / 打开
                </a>
                <a href={openUrl} download className="underline">
                  下载
                </a>
              </>
            ) : (
              <span className="text-amber-800">
                未返回 file URL，请到项目文件区查找生成记录
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
