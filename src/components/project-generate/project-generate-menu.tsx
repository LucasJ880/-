"use client";

import { useEffect, useState } from "react";
import { FileDown, Loader2, ChevronDown } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { docType: "supplier_rfq", label: "国内供应商询价 PDF" },
  { docType: "tech_confirm", label: "供应商技术确认表 PDF" },
  { docType: "internal_analysis", label: "内部项目分析 PDF" },
  { docType: "teammate_tasks", label: "同事执行任务单 PDF" },
  { docType: "owner_clarification", label: "业主澄清问题 PDF" },
] as const;

type GenDoc = {
  id: string;
  title: string;
  docType: string;
  version: number;
  stale: boolean;
  fileUrl: string | null;
  blobUrl: string | null;
};

export function ProjectGenerateMenu({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [docs, setDocs] = useState<GenDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiJson<{ documents: GenDoc[] }>(
        `/api/projects/${projectId}/generate-pdf`,
      );
      setDocs(res.documents ?? []);
    } catch {
      setDocs([]);
    }
  };

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, projectId]);

  if (!canManage) return null;

  const generate = async (docType: string) => {
    setBusy(docType);
    setError(null);
    try {
      await apiJson(`/api/projects/${projectId}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType }),
      });
      await load();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    }
    setBusy(null);
  };

  const staleHint = docs.some((d) => d.stale);

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileDown size={16} className="text-accent" />
          一键生成
        </h3>
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted/20"
          >
            一键生成
            <ChevronDown size={12} />
          </button>
          {open ? (
            <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-border bg-card py-1 shadow-md">
              {OPTIONS.map((o) => (
                <button
                  key={o.docType}
                  type="button"
                  disabled={!!busy}
                  onClick={() => void generate(o.docType)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/30",
                    busy === o.docType && "opacity-60",
                  )}
                >
                  {busy === o.docType ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : null}
                  {o.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {staleHint ? (
        <p className="mt-2 text-[11px] text-amber-600">
          项目文件可能已更新，此前生成的 PDF 可能过期。建议重新生成。
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[11px] text-red-500">{error}</p>
      ) : null}

      {docs.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-[12px]">
          {docs.slice(0, 8).map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2">
              <span>
                {d.title}
                {d.stale ? (
                  <span className="ml-1 text-[10px] text-amber-600">可能过期</span>
                ) : null}
              </span>
              {d.fileUrl || d.blobUrl ? (
                <a
                  href={d.fileUrl || d.blobUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  打开
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted">
          生成供应商询价、内部分析或同事任务单，自动读取当前项目资料。
        </p>
      )}
    </div>
  );
}
