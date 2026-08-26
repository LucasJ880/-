"use client";

/**
 * 工作台 · 分析师备忘录阅读卡（按节/类目直接阅读，无需下载）
 * 数据 = /api/projects/[id]/analyst-memo（服务端已渲染为受限 HTML，转义由渲染器契约保证）。
 * 无备忘录：canManage 显示生成入口（复用一键生成的自动续跑协议）；否则自渲染 null。
 */

import { useEffect, useState } from "react";
import { BookOpenText, Loader2, RefreshCw } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

type MemoView = {
  status: string;
  updatedAt?: string;
  chunkCount?: number;
  sections?: Array<{ titleZh: string; html: string }>;
  sources?: Array<{ title: string; url: string }>;
  fxNoteZh?: string | null;
};

export function AnalystMemoCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [view, setView] = useState<MemoView | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progressZh, setProgressZh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await apiJson<MemoView>(`/api/projects/${projectId}/analyst-memo`).catch(() => null);
    setView(res);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setProgressZh("启动全文多轮推理…");
    try {
      for (let round = 0; round < 12; round++) {
        const res = await apiJson<{ inProgress?: boolean; statusZh?: string }>(`/api/projects/${projectId}/generate-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docType: "analyst_memo" }),
        });
        if (!res.inProgress) break;
        setProgressZh(res.statusZh ?? "多轮推理进行中…");
        if (round === 11) throw new Error("轮次超限，请再点一次继续");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    }
    setBusy(false);
    setProgressZh(null);
  };

  if (!view) return null;
  const hasMemo = view.status === "done" && (view.sections?.length ?? 0) > 0;
  if (!hasMemo && !canManage) return null;

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5" data-testid="analyst-memo-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <BookOpenText size={16} className="text-accent" />
          分析师备忘录
          {hasMemo ? (
            <span className="text-[10px] font-normal text-muted">
              全文深读 {view.chunkCount ?? "?"} 块 · 更新于 {view.updatedAt ? view.updatedAt.slice(0, 16).replace("T", " ") : "—"} · AI_INFERRED 人审后使用
            </span>
          ) : null}
        </h3>
        {canManage ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] hover:bg-muted/20 disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {hasMemo ? "更新" : "生成备忘录"}
          </button>
        ) : null}
      </div>

      {progressZh ? <p className="mt-2 text-[11px] text-accent">{progressZh}（全文多轮推理，可能需要几分钟）</p> : null}
      {error ? <p className="mt-2 text-[11px] text-red-500">{error}</p> : null}

      {hasMemo ? (
        <>
          {/* 类目导航：节标题即类目，点击切换，无需下载 */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {view.sections!.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px]",
                  i === active ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:bg-muted/20",
                )}
              >
                {s.titleZh}
              </button>
            ))}
          </div>
          <div
            className="memo-body mt-3 max-h-[32rem] overflow-y-auto rounded-lg border border-border/50 px-4 py-3 text-[12.5px] leading-relaxed [&_h3]:mt-3 [&_h3]:text-[13px] [&_h3]:font-semibold [&_p]:my-1.5 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border/60 [&_th]:bg-muted/20 [&_th]:px-2 [&_th]:py-1 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5"
            // 服务端受限渲染器输出（全转义，AMV2-08 契约）；不接受任何其他 HTML 来源
            dangerouslySetInnerHTML={{ __html: view.sections![active]?.html ?? "" }}
          />
          {(view.sources?.length ?? 0) > 0 ? (
            <details className="mt-2 text-[11px] text-muted">
              <summary className="cursor-pointer">外部检索出处（{view.sources!.length}）{view.fxNoteZh ? " · 金额未经换算" : ""}</summary>
              <ul className="mt-1 list-disc pl-5">
                {view.sources!.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : canManage ? (
        <p className="mt-2 text-xs text-muted">尚未生成。点「生成备忘录」对全部标书做全文多轮推理（需先完成标书分析）。</p>
      ) : null}
    </div>
  );
}
