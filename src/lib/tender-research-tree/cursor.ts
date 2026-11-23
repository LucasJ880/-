/**
 * 分支游标：从这一支的 research.branch_step 审计重建循环状态（纯函数）。
 *
 * 先写后发：model_call 与 search_sent 在请求发出之前落库，所以崩在请求之后、结果之前的那一次也已算上。
 * decision 在执行动作之前落库：续跑时若最后一条成功的 decision 是搜索或读页、后面没有执行记录，就先执行它，
 * 不再为同一个决定请求一次模型。
 */

import type { FoundFact, ResearchAwardRecordV1, ResearchHandoffV1, SuggestedBranch } from "./types";
import type { CursorRow } from "./deps";
import { RESEARCH_HANDOFF_VERSION } from "./types";

export type CursorKind =
  | "model_call"
  | "decision"
  | "search_sent"
  | "search_result"
  | "read_sent"
  | "read_result"
  | "blocked_query"
  | "open_data_result"
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
  /** 被挡的站 → 读页层给的原因句 */
  blockedSites: Map<string, string>;
  /** 发出过的搜索里出错的次数与成功的次数（含没有结果） */
  searchFailures: number;
  searchSuccesses: number;
  /** 模型要的搜索或读页因额度被拒过（这一支「到上限」） */
  limitHit: boolean;
  /** 这一支第一条游标的时间（毫秒）；用来算跨切片的总用时 */
  firstAt: number | null;
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
  /** 往期同标：已发出的联邦数据查询（按检索词序号；崩在结果之前的也算发过） */
  openDataSent: Set<number>;
  /** 往期同标：联邦数据转成的记录 */
  openDataRecords: ResearchAwardRecordV1[];
  /** 往期同标：最近一次联邦数据结果给模型看的行（模型请求过一次之后清空） */
  openDataLines: string[];
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
    out.push({
      factType: r.factType,
      value: r.value,
      url: r.url,
      ...(typeof r.requestedUrl === "string" ? { requestedUrl: r.requestedUrl } : {}),
      excerpt: r.excerpt,
      fetchedAt: r.fetchedAt,
      source: "web",
      ...(typeof r.group === "string" && r.group ? { group: r.group } : {}),
    });
  }
  return out;
}

function asRecords(v: unknown): ResearchAwardRecordV1[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is ResearchAwardRecordV1 =>
      !!x &&
      typeof x === "object" &&
      typeof (x as Record<string, unknown>).recordId === "string" &&
      typeof (x as Record<string, unknown>).url === "string" &&
      !!(x as Record<string, unknown>).fields &&
      typeof (x as Record<string, unknown>).fields === "object",
  );
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
    blockedSites: new Map(),
    searchFailures: 0,
    searchSuccesses: 0,
    limitHit: false,
    firstAt: null,
    history: [],
    searchUnavailable: false,
    readsClosed: false,
    consecutiveModelFailures: 0,
    modelFinished: false,
    pending: null,
    unextractedPage: null,
    finished: null,
    openDataSent: new Set(),
    openDataRecords: [],
    openDataLines: [],
  };
}

/** 从这棵树的游标行里取这一支的，按 seq 重建状态 */
export function restoreCursorState(allRows: readonly CursorRow[], branchKey: string): BranchCursorState {
  const st = emptyCursorState();
  const rows = allRows.filter((r) => r.branchKey === branchKey).sort((a, b) => a.seq - b.seq);
  /** 记了 read_sent、还没有 read_result 的网址（崩在读页途中） */
  let openRead: string | null = null;
  const closeOpenRead = () => {
    if (!openRead) return;
    // 读了、结果丢了：算读过一次，这一页不再读
    st.reads += 1;
    st.attempted.add(openRead);
    st.history.push(`（读 ${short(openRead, 200)} 时中断，这一页不再读）`);
    openRead = null;
  };
  for (const r of rows) {
    st.nextSeq = Math.max(st.nextSeq, r.seq + 1);
    const d = r.data;
    if (typeof d.at === "number" && Number.isFinite(d.at)) st.firstAt = st.firstAt === null ? d.at : Math.min(st.firstAt, d.at);
    switch (r.kind as CursorKind) {
      case "model_call":
        st.modelCalls += 1;
        st.openDataLines = [];
        break;
      case "decision": {
        if (d.ok !== true) {
          // 撞到这一片的截止不算模型失败（下一片接着做）
          if (d.errorCode !== "CALL_DEADLINE_EXCEEDED") st.consecutiveModelFailures += 1;
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
        if (typeof d.rejected === "number" && d.rejected > 0) st.history.push(`另有 ${d.rejected} 条对不上原文，没收`);
        if (d.blocked) {
          // 被外发闸拦下的决定：不记搜索词与网址，也不留待执行
          st.pending = null;
        } else if (action === "finish") {
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
        if (d.budget === true) st.limitHit = true;
        st.history.push(`（${str(d.messageZh) ?? "这一步被拦下，没有发出"}）`);
        break;
      case "search_sent":
        st.searches += 1;
        if (str(d.source) === "open_data") {
          // 联邦数据的查询不动「待执行的决定」（它在第一轮模型请求之前、由代码发出）
          if (typeof d.openDataIndex === "number") st.openDataSent.add(d.openDataIndex);
          st.history.push(`查联邦合同公开数据「${short(str(d.query) ?? "", 120)}」`);
          break;
        }
        st.pending = null;
        st.history.push(`搜索「${short(str(d.query) ?? "", 120)}」`);
        break;
      case "open_data_result": {
        const recs = asRecords(d.records);
        for (const r of recs) if (!st.openDataRecords.some((x) => x.recordId === r.recordId)) st.openDataRecords.push(r);
        st.openDataLines = Array.isArray(d.lines) ? d.lines.filter((x): x is string => typeof x === "string").slice(0, 10) : [];
        const rows = typeof d.rows === "number" ? d.rows : 0;
        st.history.push(
          d.ok === true
            ? `  → 联邦数据 ${rows} 行（同一采购方的 ${recs.length} 行记为记录）`
            : `  → 联邦数据没查成${str(d.messageZh) ? `：${short(str(d.messageZh)!, 80)}` : ""}`,
        );
        break;
      }
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
        const status = str(d.status);
        if (status === "AUTH_ERROR") st.searchUnavailable = true;
        if (status === "SUCCESS" || status === "EMPTY") st.searchSuccesses += 1;
        else st.searchFailures += 1;
        st.history.push(`  → ${hits.length} 条结果（新增可读网址 ${added} 个）${str(d.statusZh) ? `；${str(d.statusZh)}` : ""}`);
        break;
      }
      case "read_sent":
        closeOpenRead();
        st.pending = null;
        openRead = str(d.url);
        break;
      case "read_result": {
        st.pending = null;
        const url = str(d.url) ?? "";
        if (openRead === url) openRead = null;
        const finalUrl = str(d.finalUrl);
        if (finalUrl && finalUrl !== url) st.attempted.add(finalUrl);
        // 这一片的时间到了没读成的不算读过（下一片还能读）
        if (url && !(str(d.outcome) === "unreachable" && str(d.reason) === "deadline")) st.attempted.add(url);
        if (typeof d.attempts === "number" && d.attempts > 0) st.reads += 1;
        const site = str(d.blockedSite);
        if (site && !st.blockedSites.has(site)) st.blockedSites.set(site, str(d.messageZh) ?? "被挡");
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
  closeOpenRead();
  return st;
}

export type TreeReadEntry = { branchKey: string; blocked: boolean };

/**
 * 这棵树里别的支请求过的网址（含跳转后的网址，含崩在读页途中的）：同一网址在一棵树内只读一次——别的支读过或
 * 被挡过的这一支不再请求。网址是归一后的写法（与 read_sent / read_result 记的一致）。
 */
export function treeReadIndex(allRows: readonly CursorRow[], exceptBranch: string): Map<string, TreeReadEntry> {
  const out = new Map<string, TreeReadEntry>();
  for (const r of allRows) {
    if (!r.branchKey || r.branchKey === exceptBranch) continue;
    const d = r.data;
    if (r.kind === "read_sent") {
      const u = str(d.url);
      if (u && !out.has(u)) out.set(u, { branchKey: r.branchKey, blocked: false });
    } else if (r.kind === "read_result") {
      const u = str(d.url);
      if (!u) continue;
      if (str(d.outcome) === "unreachable" && str(d.reason) === "deadline") {
        // 没发请求的「时间到了」不算读过
        if (out.get(u)?.blocked === false && typeof d.attempts === "number" && d.attempts === 0) out.delete(u);
        continue;
      }
      const blocked = str(d.outcome) === "blocked";
      out.set(u, { branchKey: r.branchKey, blocked: blocked || out.get(u)?.blocked === true });
      const f = str(d.finalUrl);
      if (f && f !== u && !out.has(f)) out.set(f, { branchKey: r.branchKey, blocked });
    }
  }
  return out;
}
