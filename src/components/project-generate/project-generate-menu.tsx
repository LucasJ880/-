"use client";

import { useEffect, useState } from "react";
import { FileDown, Loader2, ChevronDown, ExternalLink, Download } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { BidDraftGateNotes, type BidDraftGates } from "@/components/tender/bid-draft-card";
import { RETIRED_PROJECT_PDF_DOC_TYPES } from "@/lib/bid-workflow/pdf-doc-types";

const OPTIONS = [
  { docType: "analyst_memo", label: "投标分析师备忘录 PDF（事实+标准展开+市场基准+GO/NO-GO）" },
  { docType: "supplier_rfq", label: "供应商询价单 PDF" },
  { docType: "internal_analysis", label: "内部项目分析 PDF" },
  { docType: "teammate_tasks", label: "同事执行任务单 PDF" },
  { docType: "owner_clarification", label: "RFI 问题清单 PDF（中英，可直接提交）" },
  { docType: "bid_draft", label: "投标文件起草 PDF（英文提交稿 + 中文审阅注）" },
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
    // 后缀跟随真实存储扩展名（PDF 渲染失败回落 HTML 时，命名 .pdf 会让阅读器误报"已损坏"）
    const realExt = /\.html?$/i.test(u.pathname) ? ".html" : ".pdf";
    u.searchParams.set("filename", filename.replace(/\.(pdf|html?)$/i, "") + realExt);
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
  const [progressZh, setProgressZh] = useState<string | null>(null);
  const [draftGates, setDraftGates] = useState<BidDraftGates | undefined>(undefined);

  const load = async () => {
    try {
      const res = await apiJson<{ documents: GenDoc[] }>(
        `/api/projects/${projectId}/generate-pdf`,
      );
      setDocs(res.documents ?? []);
    } catch {
      setDocs([]);
    }
    // FLOW-H5：起草元信息里的提醒（开关关闭时没有 gates，什么都不显示）
    apiJson<{ gates?: BidDraftGates }>(`/api/projects/${projectId}/bid-draft`).then((r) => setDraftGates(r.gates)).catch(() => setDraftGates(undefined));
  };

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, projectId]);

  if (!canManage) return null;

  const generate = async (docType: string) => {
    setBusy(docType);
    setError(null);
    setProgressZh(null);
    try {
      // 分析师备忘录 v2 是多轮管线：服务端每轮跑到时间预算即返回 inProgress，
      // 前端自动续点直到完成（状态服务端落盘，中断可续），一次点击等到结果。
      for (let round = 0; round < 12; round++) {
        const res = await apiJson<{ inProgress?: boolean; statusZh?: string }>(
          `/api/projects/${projectId}/generate-pdf`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docType }),
          },
        );
        if (!res.inProgress) break;
        setProgressZh(res.statusZh ?? "多轮推理进行中…");
        if (round === 11) throw new Error("多轮生成超出轮次上限，请再点一次继续");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    }
    // 成功、失败都收起下拉层：它是浮层，开着会盖住下面那行说明
    setOpen(false);
    setBusy(null);
    setProgressZh(null);
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
                <div key={o.docType}>
                <button
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
                {/* FLOW-H5：投标文件起草的 No-Go 提醒与「当前分析还没批准」的提示（开关开着时接口才返回；只提醒，不拦） */}
                {o.docType === "bid_draft" ? <div className="px-3 pb-2"><BidDraftGateNotes gates={draftGates} /></div> : null}
                </div>
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
      {progressZh ? (
        <p className="mt-2 text-[11px] text-accent">{progressZh}（全文多轮推理，可能需要几分钟）</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-red-500">{error}</p>
      ) : null}

      {docs.length > 0 ? (
        <ul className="mt-3 space-y-2 text-[12px]">
          {docs.slice(0, 8).map((d) => {
            const url = resolveDocUrl(d);
            const filename = d.title.endsWith(".pdf") ? d.title : `${d.title}.pdf`;
            // RFQ-PDF-1：已停止生成的两类供应商文件，旧文件还能打开，标明不是现在该发的那一份
            const retired = Object.prototype.hasOwnProperty.call(RETIRED_PROJECT_PDF_DOC_TYPES, d.docType);
            return (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-2.5 py-2"
              >
                {/* 标题单独截断，标记不参与截断：窄屏上长标题不会把标记挤没 */}
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="min-w-0 truncate">{d.title}</span>
                  {retired ? (
                    <span className="shrink-0 text-[10px] text-muted">已停用</span>
                  ) : d.stale ? (
                    <span className="shrink-0 text-[10px] text-amber-600">可能过期</span>
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
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-[color:var(--on-accent)] hover:bg-accent-hover"
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
          生成供应商询价单、内部分析或同事任务单，自动读取当前项目资料。生成后可直接下载发送。
        </p>
      )}
    </div>
  );
}
