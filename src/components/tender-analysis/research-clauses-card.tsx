"use client";

/**
 * TREE-3 招标要求页「标书条款（调研树）」卡片：加拿大 / 本地含量、是否限定品牌、是否接受等效品三项，引文（文件名 +
 * 页码 + 标书原文）、等效品要交的证明、未写明时的澄清问题草稿。只读：不改已确认的要求、不进关键事实槽位、不发任何东西。
 * 开关关着时接口 404 → 卡片不显示；还没有调研树 → 不显示（「开始调研」在情报页签，TREE-5）；读取中与读取出错也不显示
 * （这张卡是补充信息；不让开关关着的项目因为网络出错多出一张卡）。调研还在跑、条款还没查完时每 15 秒重读一次，最多 10 分钟。
 */

import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import type { ResearchClausesView, ResearchTreeView } from "@/lib/tender-research-tree/view";
import type { ClauseCitation, ClauseQuestionResult } from "@/lib/tender-research-tree/types";

export const RESEARCH_CLAUSES_TEXT = {
  title: "标书条款（调研树 · 只读，不改已确认的要求）",
  pending: "正在查标书条款，查完会显示在这里。",
  downgraded: "AI 给的出处对不上标书原文，这一项按未写明处理",
  conflict: "「限定品牌」与「接受等效品」两项结论互相矛盾，请对照下面的原文自己判断",
  draftTitle: "澄清问题草稿（可复制到本页下方「正式澄清（RFI）」里使用，系统不会自动发出）",
  draftMeaning: "意思：",
  proofTitle: "等效品要交的证明",
  startedAt: "调研发起于",
  questions: {
    local_content: "加拿大 / 本地含量",
    brand: "是否限定品牌（不接受替代）",
    equivalents: "是否接受等效品",
  },
} as const;

/** 在查时重读的间隔与次数（15 秒一次，最多 40 次 ≈ 10 分钟） */
export const CLAUSES_POLL_MS = 15_000;
export const CLAUSES_POLL_MAX = 40;

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

/** 重读时出错：保留上一次读到的（不让卡片在查的过程中一闪消失）；第一次读就出错 → 出错（不显示） */
export function keepOnError(prev: ClausesCardState, next: ClausesCardState): ClausesCardState {
  return next.kind === "error" && prev.kind === "ok" ? prev : next;
}

/** 还要不要再读一次：读到了、条款还在查 */
export function shouldPollClauses(state: ClausesCardState): boolean {
  return visibleClausesOf(state)?.state === "pending";
}

/** 发起时间的写法（本地时区，到分钟） */
export function startedAtZh(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

function Question({ q, proof }: { q: ClauseQuestionResult; proof: ClauseCitation | null }) {
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
      {proof ? (
        <div className="pl-3 text-[11px]">
          <p className="text-muted">{RESEARCH_CLAUSES_TEXT.proofTitle}：</p>
          <ul className="pl-3">
            <Cite c={proof} />
          </ul>
        </div>
      ) : null}
      {q.clarification ? (
        <div className="rounded-md border border-border/70 bg-background/60 p-2">
          <p className="text-[11px] text-muted">{RESEARCH_CLAUSES_TEXT.draftTitle}</p>
          <p className="mt-0.5 select-all text-[11px] text-foreground">{q.clarification.en}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {RESEARCH_CLAUSES_TEXT.draftMeaning}
            {q.clarification.zh}
          </p>
        </div>
      ) : null}
    </li>
  );
}

/** 展示部分（不取数，测试直接渲染） */
export function ResearchClausesPanel({ clauses, startedAt }: { clauses: ResearchClausesView; startedAt?: string | null }) {
  const when = startedAtZh(startedAt);
  const stamp = when ? <p className="text-[11px] text-muted">{`${RESEARCH_CLAUSES_TEXT.startedAt} ${when}`}</p> : null;
  if (clauses.state === "pending") {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs text-muted">{RESEARCH_CLAUSES_TEXT.pending}</p>
        {stamp}
      </div>
    );
  }
  if (clauses.state === "stopped") {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs text-muted">{clauses.messageZh}</p>
        {stamp}
      </div>
    );
  }
  const f = clauses.findings;
  return (
    <div className="mt-2 space-y-2">
      {/* 没有结论时状态短标签与原因句重复（「未接通」+「未接通：…」），只写原因句 */}
      {f ? (
        <p className="text-xs">
          <span className="font-medium text-foreground">{clauses.statusZh}</span>
          {clauses.reasonZh ? <span className="text-muted"> · {clauses.reasonZh}</span> : null}
        </p>
      ) : (
        clauses.messagesZh.map((m, i) => (
          <p key={i} className="text-xs text-muted">
            {m}
          </p>
        ))
      )}
      {f?.conflict ? <p className="text-[11px] text-amber-700">{RESEARCH_CLAUSES_TEXT.conflict}</p> : null}
      {f ? (
        <ul className="space-y-2">
          {f.questions.map((q) => (
            <Question key={q.key} q={q} proof={q.key === "equivalents" ? f.proof : null} />
          ))}
        </ul>
      ) : null}
      {stamp}
    </div>
  );
}

export function ResearchClausesCard({ projectId }: { projectId: string }) {
  const [state, setState] = useState<ClausesCardState>({ kind: "loading" });
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/projects/${encodeURIComponent(projectId)}/research-tree`)
      .then(async (res) => {
        if (cancelled) return;
        const view = res.ok ? ((await res.json()) as ResearchTreeView) : null;
        if (!cancelled) setState((prev) => keepOnError(prev, clausesCardStateOf(res.status, view)));
      })
      .catch(() => !cancelled && setState((prev) => keepOnError(prev, { kind: "error" })));
    return () => {
      cancelled = true;
    };
  }, [projectId, reads]);

  // 条款还在查：隔一会儿再读一次（最多 10 分钟）
  useEffect(() => {
    if (!shouldPollClauses(state) || reads >= CLAUSES_POLL_MAX) return;
    const t = setTimeout(() => setReads((n) => n + 1), CLAUSES_POLL_MS);
    return () => clearTimeout(t);
  }, [state, reads]);

  // 开关关、还没有调研树、读取中、读取出错：什么都不渲染
  const clauses = visibleClausesOf(state);
  if (!clauses || state.kind !== "ok") return null;

  return (
    <section className="rounded-xl border border-border/70 bg-background/40 p-4" data-testid="research-clauses-card">
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <ScrollText size={14} className="text-accent" />
        {RESEARCH_CLAUSES_TEXT.title}
      </h3>
      <ResearchClausesPanel clauses={clauses} startedAt={state.view.job?.createdAt ?? null} />
    </section>
  );
}
