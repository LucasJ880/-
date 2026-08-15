"use client";

/**
 * FB-15 — 已发问题生命周期列表（草稿→已发送→已回答）
 * 已回答项可展开业主答复证据（文件/页码/逐字引文）；「检查业主回复」手动兜底。
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, MailCheck, RefreshCw } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";

type QuestionRow = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
};
type Resolution = {
  questionId: string;
  answerSummary: string;
  documentTitle: string | null;
  pageNumber: number;
  answerSnippet: string;
};

const STATUS_ZH: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-neutral-100 text-neutral-700" },
  generated: { label: "草稿", cls: "bg-neutral-100 text-neutral-700" },
  sent: { label: "已发送 · 待业主回复", cls: "bg-amber-100 text-amber-900" },
  replied: { label: "已回答", cls: "bg-emerald-100 text-emerald-900" },
  closed: { label: "已关闭", cls: "bg-neutral-100 text-neutral-700" },
};

export function ProjectQuestionStatusList({ projectId }: { projectId: string }) {
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  const [openId, setOpenId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, meta] = await Promise.all([
        apiJson<QuestionRow[]>(`/api/projects/${projectId}/questions`),
        apiJson<{ replyResolutions?: Resolution[] }>(
          `/api/projects/${projectId}/questions?meta=1`,
        ),
      ]);
      setQuestions(Array.isArray(list) ? list : []);
      setResolutions(
        new Map((meta.replyResolutions ?? []).map((r) => [r.questionId, r])),
      );
    } catch {
      /* 安静降级 */
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const check = async () => {
    setChecking(true);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/questions/check-replies`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "检索失败");
      setNotice(
        json.resolved > 0
          ? `在新文档中找到 ${json.resolved} 个问题的业主答复`
          : json.checked > 0
            ? "已检查新上传文档，暂未找到对应答复"
            : "没有待回复的已发送问题",
      );
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setChecking(false);
  };

  const visible = questions.filter((q) => q.status !== "draft" && q.status !== "generated");
  if (visible.length === 0) return null;

  return (
    <div className="mt-3 space-y-2" data-testid="question-status-list">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted">
          已发出的问题（{visible.filter((q) => q.status === "replied").length} 已回答 /{" "}
          {visible.filter((q) => q.status === "sent").length} 待回复）
        </p>
        <button
          type="button"
          disabled={checking}
          onClick={() => void check()}
          className="inline-flex items-center gap-1 text-xs text-accent underline disabled:opacity-50"
        >
          {checking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          检查业主回复
        </button>
      </div>
      {notice ? <p className="text-[11px] text-muted">{notice}</p> : null}
      <ul className="space-y-1.5">
        {visible.map((q) => {
          const st = STATUS_ZH[q.status] ?? STATUS_ZH.sent;
          const r = resolutions.get(q.id);
          const open = openId === q.id;
          return (
            <li key={q.id} className="rounded-lg border border-border/60 px-3 py-2 text-xs">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => setOpenId(open ? null : q.id)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                    {st.label}
                  </span>
                  <span className="truncate">{q.title}</span>
                </span>
                {r ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
              </button>
              {open && r ? (
                <div className="mt-2 rounded bg-emerald-50/60 p-2">
                  <p className="flex items-center gap-1 font-medium text-emerald-900">
                    <MailCheck size={12} />
                    业主答复：{r.answerSummary}
                  </p>
                  <p className="mt-1 text-muted">
                    来源：{r.documentTitle ?? "新上传文档"} · p.{r.pageNumber}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-muted">“{r.answerSnippet}”</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
