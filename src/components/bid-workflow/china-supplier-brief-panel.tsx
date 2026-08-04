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
  const [notes, setNotes] = useState(
    "请核对：招标确认项 / 历史数据 / AI 推断 / 待确认项后再发给国内厂家。",
  );

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
            复用既有 jsPDF 引擎；内容区分招标确认 / 历史数据 / AI 推断 / 待确认。
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
          <p className="text-sm font-medium">生成前确认</p>
          <p className="text-xs text-[var(--muted)]">
            将写入 ProjectGeneratedDocument 新版本，并标记旧版为 stale。请确认敏感内部信息不会误入厂家简报。
          </p>
          <textarea
            className="w-full rounded border px-2 py-1.5 text-sm min-h-[72px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
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
              onClick={() => setConfirmOpen(false)}
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
