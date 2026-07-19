"use client";

import { useEffect, useState } from "react";
import { FileDown, Loader2, ChevronDown, ExternalLink, Download } from "lucide-react";
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

function resolveDocUrl(d: GenDoc): string | null {
  return d.fileUrl || d.blobUrl || null;
}

/** 打开用原代理 URL；下载追加 download=1 触发 attachment */
function withDownloadParam(url: string, filename: string): string {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://local");
    u.searchParams.set("download", "1");
    u.searchParams.set("filename", filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
    // 相对路径代理：只返回 pathname+search
    if (url.startsWith("/")) {
      return `${u.pathname}${u.search}`;
    }
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}download=1&filename=${encodeURIComponent(filename)}`;
  }
}

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
          一键生成文档
        </h3>
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted/20"
          >
            选择生成
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
        <ul className="mt-3 space-y-2 text-[12px]">
          {docs.slice(0, 8).map((d) => {
            const url = resolveDocUrl(d);
            const filename = d.title.endsWith(".pdf") ? d.title : `${d.title}.pdf`;
            return (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-2.5 py-2"
              >
                <span className="min-w-0 flex-1 truncate">
                  {d.title}
                  {d.stale ? (
                    <span className="ml-1 text-[10px] text-amber-600">可能过期</span>
                  ) : null}
                </span>
                {url ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      <ExternalLink size={12} />
                      打开
                    </a>
                    <a
                      href={withDownloadParam(url, filename)}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hover"
                    >
                      <Download size={12} />
                      下载
                    </a>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted">
          生成供应商询价、内部分析或同事任务单，自动读取当前项目资料。生成后可直接下载发送。
        </p>
      )}
    </div>
  );
}
