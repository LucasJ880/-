/**
 * 分支游标：从这一支的 research.branch_step 审计重建循环状态（纯函数）。
 *
 * 先写后发：model_call 与 search_sent 在请求发出之前落库，所以崩在请求之后、结果之前的那一次也已算上。
 * decision 在执行动作之前落库：续跑时若最后一条成功的 decision 是搜索或读页、后面没有执行记录，就先执行它，
 * 不再为同一个决定请求一次模型。
 */

import type { FoundFact, ResearchHandoffV1, SuggestedBranch } from "./types";
import type { CursorRow } from "./deps";
import { RESEARCH_HANDOFF_VERSION } from "./types";

export type CursorKind =
  | "model_call"
  | "decision"
  | "search_sent"
  | "search_result"
  | "read_result"
  | "blocked_query"
  | "finish";

export type PendingAction = { action: "search"; query: string } | { action: "read"; url: string };

export type BranchCursorState = {
  nextSeq: number;
  modelCalls: number;
  searches: number;
  /** 实际发出了页面请求的读页次数（读页层另有自己的账，取大） */
  reads: number;
  /** 本支搜索命中的网址（已归一）与标题 */
  readable: Map<string, string>;
  /** 本支读过（或试过）的网址 */
  attempted: Set<string>;
  facts: FoundFact[];
  rejectedFacts: number;
  suggestions: SuggestedBranch[];
  blockedSites: Set<string>;
  /** 给模型看的已做动作摘要 */
  history: string[];
  /** 搜索服务鉴权失败过：这一支的搜索不再可用 */
  searchUnavailable: boolean;
  /** 读页层说过这一支不能再读页 */
  readsClosed: boolean;
  /** 末尾连续失败的模型请求数 */
  consecutiveModelFailures: number;
  /** 模型说过结束 */
  modelFinished: boolean;
  /** 还没执行的决定 */
  pending: PendingAction | null;
  /** 读到但没来得及让模型提取的页 */
  unextractedPage: string | null;
  /** 已经交过的单（再执行时原样交回） */
  finished: ResearchHandoffV1 | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function short(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function asFacts(v: unknown): FoundFact[] {
  if (!Array.isArray(v)) return [];
  const out: FoundFact[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    if (typeof r.factType !== "string" || typeof r.value !== "string" || typeof r.url !== "string") continue;
    if (typeof r.excerpt !== "string" || typeof r.fetchedAt !== "string") continue;
    out.push({ factType: r.factType, value: r.value, url: r.url, excerpt: r.excerpt, fetchedAt: r.fetchedAt, source: "web" });
  }
  return out;
}

function asSuggestions(v: unknown): SuggestedBranch[] {
  if (!Array.isArray(v)) return [];
  const out: SuggestedBranch[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    if (typeof r.kind === "string" && typeof r.reasonZh === "string") out.push({ kind: r.kind, reasonZh: r.reasonZh });
  }
  return out;
}

function asHandoff(v: unknown): ResearchHandoffV1 | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const h = v as Record<string, unknown>;
  return h.version === RESEARCH_HANDOFF_VERSION && Array.isArray(h.found) ? (v as ResearchHandoffV1) : null;
}

export function emptyCursorState(): BranchCursorState {
  return {
    nextSeq: 0,
    modelCalls: 0,
    searches: 0,
    reads: 0,
    readable: new Map(),
    attempted: new Set(),
    facts: [],
    rejectedFacts: 0,
    suggestions: [],
    blockedSites: new Set(),
    history: [],
    searchUnavailable: false,
    readsClosed: false,
    consecutiveModelFailures: 0,
    modelFinished: false,
    pending: null,
    unextractedPage: null,
    finished: null,
  };
}

/** 从这棵树的游标行里取这一支的，按 seq 重建状态 */
export function restoreCursorState(allRows: readonly CursorRow[], branchKey: string): BranchCursorState {
  const st = emptyCursorState();
  const rows = allRows.filter((r) => r.branchKey === branchKey).sort((a, b) => a.seq - b.seq);
  for (const r of rows) {
    st.nextSeq = Math.max(st.nextSeq, r.seq + 1);
    const d = r.data;
    switch (r.kind as CursorKind) {
      case "model_call":
        st.modelCalls += 1;
        break;
      case "decision": {
        if (d.ok !== true) {
          st.consecutiveModelFailures += 1;
          st.history.push(`（第 ${st.modelCalls} 次模型请求没有交回可用的结果）`);
          break;
        }
        st.consecutiveModelFailures = 0;
        st.unextractedPage = null;
        const facts = asFacts(d.facts);
        st.facts.push(...facts);
        st.rejectedFacts += typeof d.rejected === "number" ? d.rejected : 0;
        st.suggestions.push(...asSuggestions(d.suggestions));
        const action = str(d.action);
        if (action === "finish") {
          st.modelFinished = true;
          st.pending = null;
        } else if (action === "search" && str(d.query) !== null) {
          st.pending = { action: "search", query: str(d.query)! };
        } else if (action === "read" && str(d.url) !== null) {
          st.pending = { action: "read", url: str(d.url)! };
        } else {
          st.pending = null;
        }
        if (facts.length) st.history.push(`收下 ${facts.length} 条事实`);
        break;
      }
      case "blocked_query":
        st.pending = null;
        st.history.push(`（${str(d.messageZh) ?? "这一步被拦下，没有发出"}）`);
        break;
      case "search_sent":
        st.searches += 1;
        st.pending = null;
        st.history.push(`搜索「${short(str(d.query) ?? "", 120)}」`);
        break;
      case "search_result": {
        const hits = Array.isArray(d.hits) ? d.hits : [];
        let added = 0;
        for (const h of hits) {
          if (!h || typeof h !== "object") continue;
          const u = str((h as Record<string, unknown>).url);
          if (!u) continue;
          if (!st.readable.has(u)) added += 1;
          st.readable.set(u, short(str((h as Record<string, unknown>).title) ?? "", 160));
        }
        if (str(d.status) === "AUTH_ERROR") st.searchUnavailable = true;
        st.history.push(`  → ${hits.length} 条结果（新增可读网址 ${added} 个）${str(d.statusZh) ? `；${str(d.statusZh)}` : ""}`);
        break;
      }
      case "read_result": {
        st.pending = null;
        const url = str(d.url) ?? "";
        if (url) st.attempted.add(url);
        if (typeof d.attempts === "number" && d.attempts > 0) st.reads += 1;
        const site = str(d.blockedSite);
        if (site) st.blockedSites.add(site);
        if (str(d.outcome) === "limit") st.readsClosed = true;
        st.unextractedPage = str(d.outcome) === "ok" ? url : null;
        st.history.push(`读 ${short(url, 200)} → ${short(str(d.messageZh) ?? str(d.outcome) ?? "", 120)}`);
        break;
      }
      case "finish":
        st.finished = asHandoff(d.handoff);
        break;
      default:
        break;
    }
  }
  return st;
}
