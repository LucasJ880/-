/**
 * 情报调研树的一支（`tender_research_branch` 的处理函数）：一个有上限的循环，一轮 = 一次模型请求。
 *
 * 每一轮：模型提出下一步（搜索 / 读页 / 结束）与针对上一页的事实；代码执行并扣额度；直到模型结束或额度用完。
 * 跨处理切片续跑：每一轮先记审计（research.branch_step）再发请求，续跑时从审计恢复；快到截止就让出。
 * 任何问题（模型不可用、搜索未接通、被挡、到上限、内部出错）都交一张写明原因的交接单、正常完成步骤；
 * 只有「不是调研 Job」「计划里没有这一步」这类不该发生的情况返回失败。租约丢了原样抛出交给运行时。
 */

import type { AdapterContext, AdapterResult } from "@/lib/agent-runtime-v2/adapters";
import { LostLeaseError, type RunFence } from "@/lib/agent-runtime/lease";
import { TENDER_CALL_DEADLINE_CODE } from "@/lib/ai/model-policy";
import { callStructured } from "@/lib/tender-understanding/llm";
import { isExternalIntelEnabled } from "@/lib/tender-intel/canadabuys";
import { hasWebSearchKey } from "@/lib/tender-intel/websearch";
import {
  HUMAN_RESEARCH_TRIGGERS,
  normalizeReadableUrl,
  type PageReadResult,
  type ResearchReadContext,
} from "@/lib/web-reader";
import { isResearchTreeEnabledForOrgWithEnv } from "./flags";
import {
  BRANCH_DEFS,
  RESEARCH_STEP_IDS,
  TEXT_ZH,
  branchDefOf,
  branchOutcome,
  decideWave2Full,
  decideWave2Relaxed,
  dedupeFacts,
  handoffFromOutput,
  staticHandoff,
  statusLineZh,
  type BranchDef,
} from "./fork-rules";
import { checkFact, internalNumberTokens, outboundBlockReason, OUTBOUND_BLOCK_ZH } from "./guards";
import { RESEARCH_TREE_LIMITS, RESEARCH_TREE_TIMING, effectiveBranchLimits, type BranchLimits } from "./limits";
import {
  BranchDecisionSchema,
  RESEARCH_BRANCH_PROMPT_NAME,
  RESEARCH_BRANCH_PROMPT_VERSION,
  buildBranchSystemPrompt,
  buildBranchUserPrompt,
  type BranchPromptInput,
  type PublicProjectFacts,
} from "./prompt";
import { restoreCursorState, type BranchCursorState, type CursorKind } from "./cursor";
import { CURSOR_TAKE, externalDeps, productionStore, type ResearchExternalDeps, type ResearchProjectRow, type ResearchStore } from "./deps";
import { RESEARCH_HANDOFF_VERSION, type FoundFact, type ResearchHandoffV1 } from "./types";

export type BranchRunDeps = { external: ResearchExternalDeps; store: ResearchStore };

export function defaultBranchRunDeps(): BranchRunDeps {
  return { external: externalDeps(), store: productionStore };
}

/* ───────────────────────────── 调研 Job 自检 ───────────────────────────── */

export type ResearchJobCheck =
  | { ok: true; projectId: string; initiatedByUserId: string }
  | { ok: false; error: string };

/** 工具只在调研 Job 里跑：组织一致、调研标记齐全、发起方式是人发起的几种 */
export function checkResearchJob(job: { orgId: string; metadata: unknown } | null, orgId: string): ResearchJobCheck {
  if (!job) return { ok: false, error: "RESEARCH_JOB_NOT_FOUND: 调研 Job 不存在" };
  if (job.orgId !== orgId) return { ok: false, error: "RESEARCH_JOB_ORG_MISMATCH: 调研 Job 不属于该组织" };
  const m = job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata) ? (job.metadata as Record<string, unknown>) : {};
  if (m.researchTree !== true || m.workDomain !== "tender" || m.researchTreeVersion !== 1) {
    return { ok: false, error: "NOT_RESEARCH_JOB: 这不是一条调研 Job" };
  }
  const trigger = typeof m.researchTrigger === "string" ? m.researchTrigger : "";
  if (!(HUMAN_RESEARCH_TRIGGERS as readonly string[]).includes(trigger)) {
    return { ok: false, error: "NOT_HUMAN_INITIATED: 调研 Job 不是由人发起的" };
  }
  const projectId = typeof m.researchProjectId === "string" ? m.researchProjectId.trim() : "";
  const initiatedByUserId = typeof m.initiatedByUserId === "string" ? m.initiatedByUserId.trim() : "";
  if (!projectId) return { ok: false, error: "RESEARCH_PROJECT_MISSING: 调研 Job 没有所属项目" };
  if (!initiatedByUserId) return { ok: false, error: "RESEARCH_INITIATOR_MISSING: 调研 Job 没有发起人" };
  return { ok: true, projectId, initiatedByUserId };
}

/** 交给模型的项目公开资料（只这几项） */
export function publicProjectFacts(p: ResearchProjectRow): PublicProjectFacts {
  const clean = (s: string | null) => (s && s.trim() ? s.trim().slice(0, 200) : null);
  return {
    name: p.name.trim().slice(0, 200),
    buyer: clean(p.clientOrganization),
    solicitationNumber: clean(p.solicitationNumber),
    location: clean(p.location),
    category: clean(p.category),
    closeYear: p.closeDate ? p.closeDate.getUTCFullYear() : null,
  };
}

/* ───────────────────────────── 结果 ───────────────────────────── */

function done(handoff: ResearchHandoffV1): AdapterResult {
  return {
    ok: true,
    data: {
      researchSummary: {
        branchKey: handoff.branchKey,
        status: handoff.status,
        statusZh: handoff.statusZh,
        foundCount: handoff.found.length,
        usage: handoff.usage,
      },
      researchHandoff: handoff,
    },
  };
}

function yieldSlice(branchKey: string, ticks: number): AdapterResult {
  return { ok: true, continuation: { reason: "TIME_BUDGET_YIELD", phase: `branch:${branchKey}`, ticks } };
}

/* ───────────────────────────── 入口 ───────────────────────────── */

export async function handleResearchBranch(ctx: AdapterContext): Promise<AdapterResult> {
  return runResearchBranch(ctx, defaultBranchRunDeps());
}

export async function runResearchBranch(ctx: AdapterContext, deps: BranchRunDeps): Promise<AdapterResult> {
  const def = branchDefOf(ctx.stepKey);
  if (!def) return { ok: false, error: `RESEARCH_UNKNOWN_BRANCH: 计划里没有这一支（${String(ctx.stepKey).slice(0, 60)}）` };
  const { external: ext, store } = deps;

  // 开关关：什么都不做（不读库、不写审计、不发请求）
  if (!isResearchTreeEnabledForOrgWithEnv(ctx.orgId, ext.env)) {
    return done(staticHandoff(def, "flag_off", TEXT_ZH.flagOff));
  }
  const job = await store.loadJob(ctx.runId);
  const jc = checkResearchJob(job, ctx.orgId);
  if (!jc.ok) return { ok: false, error: jc.error };

  if (def.notWired) return done(staticHandoff(def, "unavailable", TEXT_ZH.clausesNotWired));

  // 第二波：按分叉规则决定跑不跑
  let alreadyCovered: string[] = [];
  if (def.wave === 2) {
    const up = (key: string) => handoffFromOutput(ctx.priorEvidence?.[key]);
    if (def.stepId === RESEARCH_STEP_IDS.wave2Full) {
      const d = decideWave2Full(up(RESEARCH_STEP_IDS.priorAwards));
      if (!d.run) return done(staticHandoff(def, "not_needed", d.reasonZh));
      alreadyCovered = coveredFrom([up(RESEARCH_STEP_IDS.similar)]);
    } else {
      const d = decideWave2Relaxed([up(RESEARCH_STEP_IDS.similar), up(RESEARCH_STEP_IDS.wave2Full)]);
      if (!d.run) return done(staticHandoff(def, "not_needed", d.reasonZh));
      alreadyCovered = coveredFrom([up(RESEARCH_STEP_IDS.similar), up(RESEARCH_STEP_IDS.wave2Full)]);
    }
  }

  const fence = ctx.runFence;
  if (!fence) return done(staticHandoff(def, "unavailable", TEXT_ZH.internalError));
  let project: ResearchProjectRow | null;
  let settings: unknown;
  let rows: Awaited<ReturnType<ResearchStore["loadCursorRows"]>>;
  try {
    project = await store.loadProject(jc.projectId);
    settings = await store.loadOrgSettings(ctx.orgId);
    rows = await store.loadCursorRows(ctx.orgId, ctx.runId, CURSOR_TAKE);
  } catch {
    // 读库出错：这一支以「未接通」收尾，不连累别的支与树干（还没有发出任何请求）
    return done(staticHandoff(def, "unavailable", TEXT_ZH.internalError));
  }
  if (!project || project.orgId !== ctx.orgId || project.workDomain !== "tender") {
    return done(staticHandoff(def, "unavailable", "未接通：调研的项目不存在或不是招投标项目"));
  }
  const limits = effectiveBranchLimits(def.scale, settings);

  const loop = new BranchLoop({
    ctx,
    def,
    ext,
    store,
    fence,
    project,
    limits,
    initiatedByUserId: jc.initiatedByUserId,
    alreadyCovered,
    state: restoreCursorState(rows, def.stepId),
    historyOverflow: rows.length > RESEARCH_TREE_LIMITS.CURSOR_MAX_ROWS,
  });
  return loop.run();
}

function coveredFrom(handoffs: ReadonlyArray<ResearchHandoffV1 | null>): string[] {
  const out: string[] = [];
  for (const h of handoffs) {
    for (const f of h?.found ?? []) out.push(`${f.factType}：${f.value}（${f.url}）`);
  }
  return out.slice(0, 40);
}

/* ───────────────────────────── 循环 ───────────────────────────── */

type LoopInput = {
  ctx: AdapterContext;
  def: BranchDef;
  ext: ResearchExternalDeps;
  store: ResearchStore;
  fence: RunFence;
  project: ResearchProjectRow;
  limits: BranchLimits;
  initiatedByUserId: string;
  alreadyCovered: string[];
  state: BranchCursorState;
  historyOverflow: boolean;
};

type Latest = BranchPromptInput["latest"];

/** 本片里刚读到、还没交给模型提取的页 */
type FreshPage = { url: string; text: string; fetchedAt: string; truncated: boolean };

class StopBranch extends Error {
  constructor(readonly unavailableZh: string) {
    super(unavailableZh);
  }
}

class BranchLoop {
  private readonly started: number;
  private readonly sliceDeadline: number;
  private readonly internalNumbers: string[];
  private readonly searchConfigured: boolean;
  private reader: ResearchReadContext | null = null;
  private invoker: ReturnType<ResearchExternalDeps["invokerFor"]> | null = null;
  private readerUnavailable = false;
  private readerUsed = 0;
  private latest: Latest = null;
  private page: FreshPage | null = null;
  private ticks = 0;
  private exhausted = false;
  private unavailableZh: string | null = null;

  constructor(private readonly i: LoopInput) {
    this.started = i.ext.now();
    const budgetDeadline = i.ctx.executionBudget?.deadlineAt;
    this.sliceDeadline =
      typeof budgetDeadline === "number" && Number.isFinite(budgetDeadline)
        ? budgetDeadline
        : this.started + RESEARCH_TREE_TIMING.DEFAULT_SLICE_MS;
    this.internalNumbers = internalNumberTokens([i.project.estimatedValue, i.project.ourBidPrice, i.project.winningBidPrice]);
    this.searchConfigured = isExternalIntelEnabled(i.ext.env as NodeJS.ProcessEnv) && hasWebSearchKey(i.ext.env as NodeJS.ProcessEnv);
    if (i.state.unextractedPage) {
      this.latest = { kind: "note", text: `上一片读到了 ${i.state.unextractedPage}，但没来得及提取就让出了；这一页的正文没有保存，不会重读。` };
    }
  }

  private get st(): BranchCursorState {
    return this.i.state;
  }

  private remainingMs(): number {
    return this.sliceDeadline - this.i.ext.now();
  }

  private canSearch(): boolean {
    return this.searchConfigured && !this.st.searchUnavailable && this.st.searches < this.i.limits.searches;
  }

  private readsUsed(): number {
    return Math.max(this.st.reads, this.readerUsed);
  }

  private unreadUrls(): string[] {
    return [...this.st.readable.keys()].filter((u) => !this.st.attempted.has(u));
  }

  private canRead(): boolean {
    return !this.readerUnavailable && !this.st.readsClosed && this.readsUsed() < this.i.limits.reads && this.unreadUrls().length > 0;
  }

  /** 先写后发：每条游标都经租约防栅栏写入；写不进去就停（租约丢了原样抛出） */
  private async record(kind: CursorKind, data: Record<string, unknown>): Promise<void> {
    const seq = this.st.nextSeq++;
    try {
      await this.i.fence.guard((client) =>
        this.i.store.writeCursorRow(client, {
          orgId: this.i.ctx.orgId,
          userId: this.i.initiatedByUserId,
          jobId: this.i.ctx.runId,
          branchKey: this.i.def.stepId,
          seq,
          kind,
          data,
        }),
      );
    } catch (err) {
      if (err instanceof LostLeaseError) throw err;
      throw new StopBranch(TEXT_ZH.internalError);
    }
  }

  /** 每次外部请求之前：租约还在才发 */
  private async ensureLease(): Promise<void> {
    if (!(await this.i.fence.check())) throw new LostLeaseError(this.i.ctx.runId);
  }

  async run(): Promise<AdapterResult> {
    if (this.st.finished) return done(this.st.finished);
    try {
      if (this.i.historyOverflow) {
        this.exhausted = true;
        return await this.finish();
      }
      for (;;) {
        // 上一片留下的、还没执行的决定先执行（不为同一个决定再请求一次模型）
        if (this.st.pending) {
          const p = this.st.pending;
          if (p.action === "read" && this.remainingMs() < RESEARCH_TREE_TIMING.MIN_READ_TURN_MS) return yieldSlice(this.i.def.stepId, this.ticks);
          if (p.action === "search" && this.remainingMs() < RESEARCH_TREE_TIMING.MIN_TURN_MS) return yieldSlice(this.i.def.stepId, this.ticks);
          this.st.pending = null;
          if (p.action === "search") await this.doSearch(p.query);
          else await this.doRead(p.url);
          continue;
        }
        if (this.st.modelFinished) return await this.finish();
        if (this.st.consecutiveModelFailures >= RESEARCH_TREE_LIMITS.MAX_CONSECUTIVE_MODEL_FAILURES) {
          this.unavailableZh = TEXT_ZH.modelUnavailable;
          return await this.finish();
        }
        if (this.st.modelCalls >= this.i.limits.modelCalls) {
          this.exhausted = true;
          return await this.finish();
        }
        if (!this.canSearch() && !this.canRead() && !this.page) {
          // 什么都做不了：额度用完记到上限；否则是搜索没接通
          const searchSpent = this.st.searches >= this.i.limits.searches;
          const readSpent = this.st.readsClosed || this.readsUsed() >= this.i.limits.reads;
          if (searchSpent || (readSpent && this.st.readable.size > 0)) this.exhausted = true;
          else this.unavailableZh = TEXT_ZH.searchUnavailable;
          return await this.finish();
        }
        if (this.remainingMs() < RESEARCH_TREE_TIMING.MIN_TURN_MS) return yieldSlice(this.i.def.stepId, this.ticks);
        const outcome = await this.turn();
        if (outcome === "yield") return yieldSlice(this.i.def.stepId, this.ticks);
      }
    } catch (err) {
      if (err instanceof LostLeaseError) throw err;
      if (err instanceof StopBranch) {
        this.unavailableZh = err.unavailableZh;
        return this.finishWithoutRecord();
      }
      this.unavailableZh = TEXT_ZH.internalError;
      return this.finishWithoutRecord();
    }
  }

  /** 一轮：一次模型请求 → 执行它选的动作 */
  private async turn(): Promise<"continue" | "yield"> {
    this.ticks += 1;
    const turn = this.st.modelCalls + 1;
    await this.record("model_call", { turn });
    this.st.modelCalls += 1;
    await this.ensureLease();
    const page = this.page;
    this.invoker ??= this.i.ext.invokerFor({ orgId: this.i.ctx.orgId, userId: this.i.initiatedByUserId });
    const invoker = this.invoker;
    const callDeadline = Math.max(this.i.ext.now() + 1_000, this.sliceDeadline - RESEARCH_TREE_TIMING.CALL_MARGIN_MS);
    const res = await callStructured(
      invoker,
      {
        promptName: RESEARCH_BRANCH_PROMPT_NAME,
        promptVersion: RESEARCH_BRANCH_PROMPT_VERSION,
        systemPrompt: buildBranchSystemPrompt(this.i.def),
        userPrompt: buildBranchUserPrompt(this.promptInput()),
        maxTokens: RESEARCH_TREE_TIMING.MODEL_MAX_TOKENS,
        timeoutMs: RESEARCH_TREE_TIMING.MODEL_TIMEOUT_MS,
        tenderStage: "triage",
        deadlineAt: callDeadline,
      },
      BranchDecisionSchema,
      { maxAttempts: 2 },
    );
    if (!res.ok) {
      await this.record("decision", { turn, ok: false, errorCode: res.errorCode });
      this.st.consecutiveModelFailures += 1;
      this.st.history.push(`（第 ${turn} 次模型请求没有交回可用的结果）`);
      // 刚读到的页留着，下一轮还能提取（同一片里）；没有页时提示重新给出下一步
      if (!page) this.latest = { kind: "note", text: "上一次请求没有交回可用的结果，请重新给出下一步。" };
      if (res.errorCode === TENDER_CALL_DEADLINE_CODE) return "yield";
      return "continue";
    }
    this.page = null;
    this.st.consecutiveModelFailures = 0;
    const v = res.value;

    // 事实：只认刚读到的那一页
    const accepted: FoundFact[] = [];
    let rejected = 0;
    const room = RESEARCH_TREE_LIMITS.MAX_FACTS_PER_BRANCH - this.st.facts.length;
    for (const c of v.facts.slice(0, RESEARCH_TREE_LIMITS.MAX_FACTS_PER_TURN)) {
      if (!page || accepted.length >= room) {
        rejected += 1;
        continue;
      }
      const chk = checkFact(c, page.text, this.i.def.factTypes);
      if (!chk.ok) {
        rejected += 1;
        continue;
      }
      accepted.push({ factType: chk.factType, value: chk.value, url: page.url, excerpt: chk.excerpt, fetchedAt: page.fetchedAt, source: "web" });
    }
    rejected += Math.max(0, v.facts.length - RESEARCH_TREE_LIMITS.MAX_FACTS_PER_TURN);
    const fresh = dedupeFacts([...this.st.facts, ...accepted]).slice(this.st.facts.length);
    const suggestions = v.suggestedBranches
      .slice(0, RESEARCH_TREE_LIMITS.MAX_SUGGESTIONS_PER_TURN)
      .map((s) => ({ kind: s.kind.trim().slice(0, 40), reasonZh: s.reason.trim().slice(0, 200) }))
      .filter((s) => s.kind && s.reasonZh);

    const next = v.next;
    const decision: Record<string, unknown> = {
      turn,
      ok: true,
      action: next.action,
      facts: fresh,
      rejected,
      suggestions,
      ...(page ? { pageUrl: page.url } : {}),
      ...(res.logs.some((l) => l.fallbackUsed) ? { fallbackUsed: true } : {}),
    };
    if (next.action === "search") decision.query = next.query.slice(0, RESEARCH_TREE_LIMITS.MAX_QUERY_CHARS * 2);
    if (next.action === "read") decision.url = next.url.slice(0, 2048);
    await this.record("decision", decision);
    this.st.facts.push(...fresh);
    this.st.rejectedFacts += rejected;
    this.st.suggestions.push(...suggestions);
    if (fresh.length) this.st.history.push(`收下 ${fresh.length} 条事实`);

    if (next.action === "finish") {
      this.st.modelFinished = true;
      return "continue";
    }
    if (next.action === "search") {
      await this.doSearch(next.query);
      return "continue";
    }
    if (this.remainingMs() < RESEARCH_TREE_TIMING.MIN_READ_TURN_MS) {
      // 读页要的时间不够：决定已记下，下一片先执行它
      this.st.pending = { action: "read", url: next.url };
      return "yield";
    }
    await this.doRead(next.url);
    return "continue";
  }

  private async blocked(target: "search" | "read", messageZh: string): Promise<void> {
    await this.record("blocked_query", { target, messageZh });
    this.st.history.push(`（${messageZh}）`);
    this.latest = { kind: "note", text: messageZh };
  }

  private async doSearch(rawQuery: string): Promise<void> {
    const query = rawQuery.trim();
    if (!this.canSearch()) {
      await this.blocked("search", this.searchConfigured && !this.st.searchUnavailable ? "搜索额度已用完，没有发出" : "搜索现在不可用，没有发出");
      return;
    }
    const why = outboundBlockReason(query, { internalNumbers: this.internalNumbers, maxChars: RESEARCH_TREE_LIMITS.MAX_QUERY_CHARS });
    if (why) {
      await this.blocked("search", OUTBOUND_BLOCK_ZH[why]);
      return;
    }
    await this.record("search_sent", { query });
    this.st.searches += 1;
    this.st.history.push(`搜索「${query.slice(0, 120)}」`);
    await this.ensureLease();
    const timeoutMs = Math.max(1_000, Math.min(RESEARCH_TREE_TIMING.SEARCH_TIMEOUT_MS, this.remainingMs() - RESEARCH_TREE_TIMING.CALL_MARGIN_MS));
    const r = await this.i.ext.search(query, { timeoutMs, maxResults: RESEARCH_TREE_LIMITS.SEARCH_MAX_RESULTS });
    const hits: Array<{ url: string; title: string; snippet: string }> = [];
    for (const h of r.hits.slice(0, RESEARCH_TREE_LIMITS.SEARCH_MAX_RESULTS)) {
      const u = normalizeReadableUrl(h.url);
      if (!u) continue;
      hits.push({ url: u, title: String(h.title ?? "").slice(0, 160), snippet: String(h.snippet ?? "").slice(0, 500) });
    }
    const statusZh = SEARCH_STATUS_ZH[r.status] ?? null;
    await this.record("search_result", {
      status: r.status,
      httpStatus: r.httpStatus,
      hits: hits.map((h) => ({ url: h.url, title: h.title })),
      ...(statusZh ? { statusZh } : {}),
    });
    let added = 0;
    for (const h of hits) {
      if (!this.st.readable.has(h.url)) added += 1;
      this.st.readable.set(h.url, h.title);
    }
    if (r.status === "AUTH_ERROR") this.st.searchUnavailable = true;
    this.st.history.push(`  → ${hits.length} 条结果（新增可读网址 ${added} 个）${statusZh ? `；${statusZh}` : ""}`);
    this.latest = { kind: "search", query, hits };
  }

  private async openReader(): Promise<ResearchReadContext | null> {
    if (this.reader) return this.reader;
    if (this.readerUnavailable) return null;
    try {
      const session = await this.i.ext.openReadSession({ orgId: this.i.ctx.orgId, jobId: this.i.ctx.runId });
      const used = Math.min(this.st.reads, this.i.limits.reads, RESEARCH_TREE_LIMITS.READS_PER_BRANCH);
      this.reader = session.forBranch({
        branchKey: this.i.def.stepId,
        budget: { remaining: Math.max(0, this.i.limits.reads - used), used },
        blockedSites: [...this.st.blockedSites],
        deadlineAt: this.sliceDeadline - RESEARCH_TREE_TIMING.CALL_MARGIN_MS,
        allowUrl: (url: URL) => this.allowUrl(url),
      });
      this.readerUsed = this.reader.budget.used;
      return this.reader;
    } catch {
      // 读页会话建不出来（开关、Job 状态、分支数到上限等）：这一支不再读页
      this.readerUnavailable = true;
      return null;
    }
  }

  /** 读页层交来的网址：只有本支搜索结果里的、且网址本身过外发闸的才放行 */
  private allowUrl(url: URL): boolean {
    const key = normalizeReadableUrl(url.toString());
    if (!key || !this.st.readable.has(key)) return false;
    return outboundBlockReason(key, { internalNumbers: this.internalNumbers, maxChars: 4096 }) === null;
  }

  private async doRead(rawUrl: string): Promise<void> {
    const url = normalizeReadableUrl(rawUrl);
    if (!url || !this.st.readable.has(url)) {
      await this.blocked("read", "这个网址不在本支的搜索结果里，没有读");
      return;
    }
    if (this.st.attempted.has(url)) {
      await this.blocked("read", "这个网址这一支已经读过，没有再读");
      return;
    }
    const outbound = outboundBlockReason(url, { internalNumbers: this.internalNumbers, maxChars: 4096 });
    if (outbound) {
      await this.blocked("read", OUTBOUND_BLOCK_ZH[outbound]);
      return;
    }
    if (!this.canRead()) {
      await this.blocked("read", "这一支不能再读页了，没有读");
      return;
    }
    const reader = await this.openReader();
    if (!reader) {
      await this.blocked("read", "读网页现在不可用，没有读");
      return;
    }
    await this.ensureLease();
    const r: PageReadResult = await this.i.ext.readPage(url, reader);
    this.readerUsed = Math.max(this.readerUsed, reader.budget.used);
    this.st.attempted.add(url);
    if (r.attempts > 0) this.st.reads += 1;
    const blockedSite = r.blocked?.site ?? null;
    if (blockedSite) this.st.blockedSites.add(blockedSite);
    if (r.outcome === "limit") this.st.readsClosed = true;
    await this.record("read_result", {
      url,
      finalUrl: r.finalUrl,
      outcome: r.outcome,
      reason: r.reason,
      blockedSite,
      fetchedAt: r.fetchedAt,
      chars: r.text.length,
      attempts: r.attempts,
      fromCache: r.fromCache,
      messageZh: r.messageZh.slice(0, 200),
    });
    this.st.history.push(`读 ${url.slice(0, 200)} → ${r.messageZh.slice(0, 120)}`);
    if (r.outcome === "ok" && r.text) {
      this.page = { url, text: r.text, fetchedAt: r.fetchedAt, truncated: r.truncated || r.text.length > RESEARCH_TREE_LIMITS.PAGE_CHARS_FOR_MODEL };
      this.latest = { kind: "page", url, text: r.text, truncated: this.page.truncated };
    } else {
      const extra = blockedSite ? `（${blockedSite} 被挡，这一支不再读这个站，换别的来源）` : "";
      this.latest = { kind: "note", text: `读 ${url} 没有读到正文：${r.messageZh}${extra}` };
    }
  }

  private promptInput(): BranchPromptInput {
    const remainingReads = Math.max(0, this.i.limits.reads - this.readsUsed());
    return {
      def: this.i.def,
      project: publicProjectFacts(this.i.project),
      remaining: {
        searches: this.canSearch() ? this.i.limits.searches - this.st.searches : 0,
        reads: this.st.readsClosed || this.readerUnavailable ? 0 : remainingReads,
        modelCalls: this.i.limits.modelCalls - this.st.modelCalls + 1,
      },
      canSearch: this.canSearch(),
      history: this.st.history,
      accepted: this.st.facts.map((f) => ({ factType: f.factType, value: f.value, url: f.url })),
      alreadyCovered: this.i.alreadyCovered,
      readable: this.unreadUrls().map((u) => ({ url: u, title: this.st.readable.get(u) ?? "" })),
      latest: this.latest,
    };
  }

  /** 有一项额度用完（或读页层说这一支到上限）就记「到上限，未查完」 */
  private budgetSpent(): boolean {
    return (
      this.st.searches >= this.i.limits.searches ||
      this.readsUsed() >= this.i.limits.reads ||
      this.st.readsClosed ||
      this.st.modelCalls >= this.i.limits.modelCalls
    );
  }

  private buildHandoff(): ResearchHandoffV1 {
    const facts = dedupeFacts(this.st.facts);
    const spent = this.unavailableZh === null && this.budgetSpent();
    const { status, notFound } = branchOutcome({
      foundCount: facts.length,
      exhausted: this.exhausted || spent,
      anyBlocked: this.st.blockedSites.size > 0,
      unavailableZh: this.unavailableZh,
    });
    return {
      version: RESEARCH_HANDOFF_VERSION,
      branchKey: this.i.def.stepId,
      kind: this.i.def.kind,
      status,
      statusZh: notFound[0] && status !== "found" ? notFound[0].messageZh : statusLineZh(status, facts.length),
      found: facts,
      notFound,
      suggestedBranches: this.st.suggestions.slice(0, RESEARCH_TREE_LIMITS.MAX_UNCHASED_LEADS),
      usage: {
        searches: this.st.searches,
        reads: this.readsUsed(),
        modelCalls: this.st.modelCalls,
        blockedSites: this.st.blockedSites.size,
        elapsedMs: Math.max(0, this.i.ext.now() - this.started),
      },
      blockedSites: [...this.st.blockedSites].slice(0, 24),
      rejectedFacts: this.st.rejectedFacts,
    };
  }

  private async finish(): Promise<AdapterResult> {
    const handoff = this.buildHandoff();
    try {
      await this.record("finish", { handoff });
    } catch (err) {
      if (err instanceof LostLeaseError) throw err;
      // 交单记录写不进去也照样交单（下次再执行会按没有交过处理，不会多花：额度已经从前面的记录恢复）
    }
    return done(handoff);
  }

  /** 内部出错时：不再写任何记录，按已知的交单 */
  private finishWithoutRecord(): AdapterResult {
    return done(this.buildHandoff());
  }
}

const SEARCH_STATUS_ZH: Partial<Record<string, string>> = {
  EMPTY: "没有结果",
  TIMEOUT: "搜索超时",
  RATE_LIMITED: "搜索服务限流",
  PROVIDER_ERROR: "搜索服务出错",
  AUTH_ERROR: "搜索服务没有开通",
};

/** 测试用：每支的定义表 */
export const __BRANCH_DEFS_FOR_TEST = BRANCH_DEFS;
