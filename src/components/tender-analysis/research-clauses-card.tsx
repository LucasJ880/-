"use client";

/**
 * TREE-3 招标要求页「标书条款（调研树）」卡片：条款员的三问、引文（文件名 + 页码 + 标书原文）、等效证明、
 * 未写明时的澄清问题草稿。只读：不改已确认的要求、不进关键事实槽位、不发任何东西。
 * 开关关着时接口 404 → 卡片不显示；还没有调研树 → 不显示（「开始调研」在情报页签，TREE-5）。
 * 读取中与读取出错也不显示（这张卡是补充信息；不让开关关着的项目因为网络出错多出一张卡）。
 */

import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import type { ResearchClausesView, ResearchTreeView } from "@/lib/tender-research-tree/view";
import type { ClauseCitation, ClauseQuestionResult } from "@/lib/tender-research-tree/types";

export const RESEARCH_CLAUSES_TEXT = {
  title: "标书条款（调研树）",
  readOnlyNote: "只读，不改已确认的要求",
  pending: "条款员还在查，查完会显示在这里。",
  downgraded: "模型给的出处对不上原文，按未写明",
  draftTitle: "澄清问题草稿（可复制到正式澄清，系统不会自动发出）",
  proofTitle: "要什么证明",
  questions: {
    local_content: "加拿大 / 本地含量",
    brand: "是否指定品牌",
    equivalents: "是否接受等效品",
  },
} as const;

export type ClausesCardState = { kind: "loading" } | { kind: "hidden" } | { kind: "error" } | { kind: "ok"; view: ResearchTreeView };

/** 接口的回应 → 卡片状态（404 = 开关关或项目没有组织 → 不显示） */
export function clausesCardStateOf(status: number, view: ResearchTreeView | null): ClausesCardState {
  if (status === 404) return { kind: "hidden" };
  if (status < 200 || status >= 300 || !view) return { kind: "error" };
  return { kind: "ok", view };
}

/** 卡片要显示的条款结果：只有读到了、有调研树、有条款一步时才显示；其余（开关关、读取中、出错、没有树）都是 null */
export function visibleClausesOf(state: ClausesCardState): ResearchClausesView | null {
  return state.kind === "ok" && state.view.job && state.view.clauses ? state.view.clauses : null;
}

function Cite({ c }: { c: ClauseCitation }) {
  return (
    <li className="text-[11px] text-muted">
      <span className="text-foreground">
        {c.documentTitle} · {c.pageLabelZh}
      </span>
      ：「{c.excerpt}」
    </li>
  );
}

function Question({ q }: { q: ClauseQuestionResult }) {
  const stated = q.answer !== "not_stated";
  return (
    <li className="space-y-1" data-testid={`research-clause-${q.key}`}>
      <p className="text-xs">
        <span className="text-muted">{RESEARCH_CLAUSES_TEXT.questions[q.key]}：</span>
        <span className={stated ? "font-medium text-foreground" : "text-muted"}>{q.answerZh}</span>
      </p>
      {q.downgraded ? <p className="text-[11px] text-amber-700">{RESEARCH_CLAUSES_TEXT.downgraded}</p> : null}
      {q.citations.length > 0 ? (
        <ul className="space-y-0.5 pl-3">
          {q.citations.map((c, i) => (
            <Cite key={`${c.documentId}-${c.pageNumber}-${i}`} c={c} />
          ))}
        </ul>
      ) : null}
      {q.clarification ? (
        <div className="rounded-md border border-border/70 bg-background/60 p-2">
          <p className="text-[11px] text-muted">{RESEARCH_CLAUSES_TEXT.draftTitle}</p>
          <p className="mt-0.5 select-all text-[11px] text-foreground">{q.clarification.en}</p>
          <p className="mt-0.5 text-[11px] text-muted">{q.clarification.zh}</p>
        </div>
      ) : null}
    </li>
  );
}

/** 展示部分（不取数，测试直接渲染） */
export function ResearchClausesPanel({ clauses }: { clauses: ResearchClausesView }) {
  if (clauses.state === "pending") return <p className="mt-2 text-xs text-muted">{RESEARCH_CLAUSES_TEXT.pending}</p>;
  const f = clauses.findings;
  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs">
        <span className="font-medium text-foreground">{clauses.statusZh}</span>
        {clauses.reasonZh ? <span className="text-muted"> · {clauses.reasonZh}</span> : null}
      </p>
      {!f
        ? clauses.messagesZh.map((m, i) => (
            <p key={i} className="text-xs text-muted">
              {m}
            </p>
          ))
        : null}
      {f ? (
        <ul className="space-y-2">
          {f.questions.map((q) => (
            <Question key={q.key} q={q} />
          ))}
        </ul>
      ) : null}
      {f?.proof ? (
        <div className="text-xs">
          <p className="text-muted">{RESEARCH_CLAUSES_TEXT.proofTitle}：</p>
          <ul className="pl-3">
            <Cite c={f.proof} />
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ResearchClausesCard({ projectId }: { projectId: string }) {
  const [state, setState] = useState<ClausesCardState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/projects/${encodeURIComponent(projectId)}/research-tree`)
      .then(async (res) => {
        if (cancelled) return;
        const view = res.ok ? ((await res.json()) as ResearchTreeView) : null;
        if (!cancelled) setState(clausesCardStateOf(res.status, view));
      })
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 开关关、还没有调研树、读取中、读取出错：什么都不渲染
  const clauses = visibleClausesOf(state);
  if (!clauses) return null;

  return (
    <section className="rounded-xl border border-border/70 bg-background/40 p-4" data-testid="research-clauses-card">
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <ScrollText size={14} className="text-accent" />
        {RESEARCH_CLAUSES_TEXT.title}
        <span className="text-[11px] font-normal text-muted">（{RESEARCH_CLAUSES_TEXT.readOnlyNote}）</span>
      </h3>
      <ResearchClausesPanel clauses={clauses} />
    </section>
  );
}
