"use client";

/**
 * 版本历史抽屉（T1A）：聚合既有三条版本链的只读视图 —
 * ProjectQuote.version / ProjectGeneratedDocument.version+stale / TenderAnalysisRun 运行史。
 * 不新建版本模型，不提供写操作；Revision/Version 不再作为一级页面（T0 Decision）。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileDown, FileText, History, Loader2, ScanSearch } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { BodyPortal } from "@/components/project-detail/project-utility-drawers";
import { apiFetch } from "@/lib/api-fetch";
import { QUOTE_STATUS_LABELS, TEMPLATE_LABELS, type QuoteStatus, type TemplateType } from "@/lib/quote/types";

interface QuoteVersion {
  id: string;
  templateType: string;
  version: number;
  status: string;
  title: string | null;
  currency: string;
  totalAmount: string | null;
  updatedAt: string;
}

interface GeneratedDocVersion {
  id: string;
  title: string;
  docType: string;
  version: number;
  stale: boolean;
  fileUrl: string | null;
  blobUrl: string | null;
}

interface AnalysisRunVersion {
  id: string;
  status: string;
  statusLabel?: string;
  statusLabelShort?: string;
  runKind: string;
  runKindLabel?: string;
  createdAt?: string;
  approvedAt?: string | null;
}

export function VersionHistoryDrawer({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [quotes, setQuotes] = useState<QuoteVersion[]>([]);
  const [docs, setDocs] = useState<GeneratedDocVersion[] | null>(null);
  const [runs, setRuns] = useState<AnalysisRunVersion[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [quotesRes, docsRes, runsRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}/quotes`).catch(() => null),
        // 生成文档接口要求管理权限；无权限时安静降级为「不可见」
        apiFetch(`/api/projects/${projectId}/generate-pdf`).catch(() => null),
        apiFetch(`/api/projects/${projectId}/tender-analysis/runs`).catch(() => null),
      ]);
      if (quotesRes?.ok) {
        const data = await quotesRes.json();
        setQuotes(Array.isArray(data.quotes) ? data.quotes : []);
      } else {
        setQuotes([]);
      }
      if (docsRes?.ok) {
        const data = await docsRes.json();
        setDocs(Array.isArray(data.documents) ? data.documents : []);
      } else {
        setDocs(null);
      }
      if (runsRes?.ok) {
        const data = await runsRes.json();
        setRuns(Array.isArray(data.runs) ? data.runs : []);
      } else {
        setRuns([]);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <BodyPortal>
      <Drawer open={open} onClose={onClose} title="版本历史" width="w-[520px]">
      <div className="space-y-6 p-5">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={18} className="animate-spin text-accent/40" />
          </div>
        ) : (
          <>
            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FileText size={14} className="text-accent/70" />
                报价版本
              </h3>
              {quotes.length === 0 ? (
                <p className="mt-2 text-xs text-muted">暂无报价单。</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {quotes.map((q) => (
                    <li key={q.id}>
                      <Link
                        href={`/projects/${projectId}/quotes/${q.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent/5"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {q.title ?? `报价单 v${q.version}`}
                          <span className="ml-2 text-[10px] text-muted">
                            v{q.version} · {TEMPLATE_LABELS[q.templateType as TemplateType] ?? q.templateType}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-muted">
                          {QUOTE_STATUS_LABELS[q.status as QuoteStatus] ?? q.status}
                          {q.updatedAt ? ` · ${q.updatedAt.slice(0, 10)}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FileDown size={14} className="text-accent/70" />
                生成文档版本
              </h3>
              {docs === null ? (
                <p className="mt-2 text-xs text-muted">当前账号无权查看生成文档记录。</p>
              ) : docs.length === 0 ? (
                <p className="mt-2 text-xs text-muted">暂无生成文档。</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {docs.map((d) => {
                    const url = d.fileUrl || d.blobUrl;
                    const row = (
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate">
                          {d.title}
                          <span className="ml-2 text-[10px] text-muted">v{d.version}</span>
                          {d.stale ? (
                            <span className="ml-1 text-[10px] text-amber-600">可能过期</span>
                          ) : null}
                        </span>
                        {url ? <span className="shrink-0 text-[11px] text-accent">打开</span> : null}
                      </span>
                    );
                    return (
                      <li key={d.id}>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent/5"
                          >
                            {row}
                          </a>
                        ) : (
                          <div className="flex rounded-lg border border-border px-3 py-2 text-sm">{row}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ScanSearch size={14} className="text-accent/70" />
                分析运行历史
              </h3>
              {runs.length === 0 ? (
                <p className="mt-2 text-xs text-muted">暂无分析运行记录。</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {runs.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {r.runKindLabel ?? r.runKind}
                        {r.createdAt ? (
                          <span className="ml-2 text-[10px] text-muted">{r.createdAt.slice(0, 10)}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted">
                        {r.statusLabelShort ?? r.statusLabel ?? r.status}
                        {r.approvedAt ? " · 已批准" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 flex items-center gap-1 text-[10px] text-muted">
                <History size={10} />
                当前生效的分析请在「招标要求」查看；此处仅为历史记录。
              </p>
            </section>
          </>
        )}
      </div>
      </Drawer>
    </BodyPortal>
  );
}
