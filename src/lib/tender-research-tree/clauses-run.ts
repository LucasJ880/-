/**
 * 条款员（① 条款，TREE-3）：不联网，只读本项目已解析的标书。
 *
 * 1. 读标书页（与一键分析同一口径的「哪些是标书」）；没有可用标书 / 都是扫描件 → 「未接通」。
 * 2. 关键词规则找段落；一条都没命中 → 不请求模型，三问「未写明」+ 澄清草稿。
 * 3. 有命中 → 每棵树一次模型请求（先记游标再请求；续跑见到请求过、没交单 → 不再请求，交「未接通」）；
 *    剩余时间不够一次请求就先让出。
 * 4. 引文逐字核对，页码由代码按段号填；对不上的答案改成「未写明」。
 * 5. 模型失败或格式不对 → 「未接通」，不交任何答案与草稿（不编结果）。
 */

import type { AdapterContext, AdapterResult } from "@/lib/agent-runtime-v2/adapters";
import { LostLeaseError } from "@/lib/agent-runtime/lease";
import { callStructured } from "@/lib/tender-understanding/llm";
import {
  ClauseDecisionSchema,
  RESEARCH_CLAUSES_PROMPT_NAME,
  RESEARCH_CLAUSES_PROMPT_VERSION,
  buildClausesSystemPrompt,
  buildClausesUserPrompt,
  findClauseSnippets,
  notStatedFindings,
  statedCount,
  verifyClauseDecision,
  type ClauseScanStats,
} from "./clauses";
import type { BranchCursorState, CursorKind } from "./cursor";
import type { ResearchExternalDeps, ResearchStore, TenderPagesRow } from "./deps";
import { TEXT_ZH, statusLineZh, type BranchDef } from "./fork-rules";
import { RESEARCH_TREE_TIMING, type BranchLimits } from "./limits";
import { branchDone, branchYield } from "./results";
import {
  RESEARCH_HANDOFF_VERSION,
  type BranchStatus,
  type ClauseFindingsV1,
  type NotFoundEntry,
  type ResearchHandoffV1,
} from "./types";

export type ClausesRunInput = {
  ctx: AdapterContext;
  def: BranchDef;
  ext: ResearchExternalDeps;
  store: ResearchStore;
  projectId: string;
  initiatedByUserId: string;
  limits: BranchLimits;
  state: BranchCursorState;
  /** 先写后发：经租约防栅栏记一条游标（写不进去抛错；租约丢了原样抛出） */
  record: (kind: CursorKind, data: Record<string, unknown>) => Promise<void>;
  sliceDeadline: number;
};

/** 条款员一次模型请求至少要留这么多时间（模型超时 + 余量）：不够就先让出，不把唯一的一次撞在截止上 */
export const CLAUSES_MIN_CALL_MS = RESEARCH_TREE_TIMING.MODEL_TIMEOUT_MS + RESEARCH_TREE_TIMING.CALL_MARGIN_MS;

function statsOf(t: TenderPagesRow, snippetCount: number): ClauseScanStats {
  return {
    documentCount: t.documentCount,
    pagesWithText: t.pages.length,
    scannedPages: t.scannedPages,
    snippetCount,
  };
}

function reasonOf(stats: ClauseScanStats, called: boolean): string {
  const scanned = stats.scannedPages > 0 ? `；另有 ${stats.scannedPages} 页是扫描件，没有文字` : "";
  if (stats.snippetCount === 0) return `关键词规则在 ${stats.documentCount} 份标书的 ${stats.pagesWithText} 页里没有命中，没有请求模型${scanned}`;
  return `在 ${stats.documentCount} 份标书的 ${stats.pagesWithText} 页里找到 ${stats.snippetCount} 段相关条款${called ? "，请模型判断了一次" : ""}${scanned}`;
}

export async function runClausesBranch(i: ClausesRunInput): Promise<AdapterResult> {
  const st = i.state;
  if (st.finished) return branchDone(st.finished);
  const started = i.ext.now();

  const handoff = (status: BranchStatus, clauses: ClauseFindingsV1 | null, notFound: NotFoundEntry[], reasonZh: string | null): ResearchHandoffV1 => ({
    version: RESEARCH_HANDOFF_VERSION,
    branchKey: i.def.stepId,
    kind: i.def.kind,
    labelZh: i.def.labelZh,
    status,
    statusZh: statusLineZh(status, statedCount(clauses), i.def.kind),
    reasonZh,
    found: [],
    records: [],
    clauses,
    notFound,
    suggestedBranches: [],
    usage: { searches: 0, reads: 0, modelCalls: st.modelCalls, blockedSites: 0, elapsedMs: Math.max(0, i.ext.now() - (st.firstAt ?? started)) },
    blockedSites: [],
    rejectedFacts: 0,
  });

  const finish = async (h: ResearchHandoffV1): Promise<AdapterResult> => {
    try {
      await i.record("finish", { handoff: h });
    } catch (err) {
      // 租约丢了原样抛出；别的写不进去也照样交单（模型请求已经记过，不会多花）
      if (err instanceof LostLeaseError) throw err;
    }
    return branchDone(h);
  };
  const unavailable = (messageZh: string, clauses: ClauseFindingsV1 | null = null, reasonZh: string | null = null) =>
    finish(handoff("unavailable", clauses, [{ reason: "unavailable", messageZh }], reasonZh));

  let tender: TenderPagesRow;
  try {
    tender = await i.store.loadTenderPages(i.projectId);
  } catch {
    return unavailable(TEXT_ZH.internalError);
  }
  if (tender.documentCount === 0 || tender.pages.length === 0) {
    return unavailable(tender.emptyDocumentCount > 0 ? TEXT_ZH.clausesScannedOnly : TEXT_ZH.clausesNoDocs);
  }

  const snippets = findClauseSnippets(tender.pages);
  const stats = statsOf(tender, snippets.length);

  // 一条都没命中：不请求模型，三问「未写明」+ 草稿
  if (snippets.length === 0) {
    const f = notStatedFindings(stats);
    return finish(handoff("none", f, [{ reason: "none", messageZh: "三问在标书里都没有写明，已给澄清问题草稿" }], reasonOf(stats, false)));
  }
  if (i.limits.modelCalls < 1) {
    return finish(handoff("limit", null, [{ reason: "limit", messageZh: TEXT_ZH.limit }], `本组织把每支模型请求调到了 ${i.limits.modelCalls} 次`));
  }
  // 每棵树只请求一次：请求过、没交单（中断了）→ 不再请求
  if (st.modelCalls >= 1) return unavailable(TEXT_ZH.clausesModelUsed, null, reasonOf(stats, true));
  if (i.sliceDeadline - i.ext.now() < CLAUSES_MIN_CALL_MS) return branchYield(i.def.stepId, 1);

  await i.record("model_call", { turn: 1, snippets: snippets.length });
  st.modelCalls += 1;
  const invoker = i.ext.invokerFor({ orgId: i.ctx.orgId, userId: i.initiatedByUserId, promptVersion: RESEARCH_CLAUSES_PROMPT_VERSION });
  const res = await callStructured(
    invoker,
    {
      promptName: RESEARCH_CLAUSES_PROMPT_NAME,
      promptVersion: RESEARCH_CLAUSES_PROMPT_VERSION,
      systemPrompt: buildClausesSystemPrompt(),
      userPrompt: buildClausesUserPrompt(snippets),
      maxTokens: RESEARCH_TREE_TIMING.MODEL_MAX_TOKENS,
      timeoutMs: RESEARCH_TREE_TIMING.MODEL_TIMEOUT_MS,
      tenderStage: "triage",
      deadlineAt: Math.max(i.ext.now() + 1_000, i.sliceDeadline - RESEARCH_TREE_TIMING.CALL_MARGIN_MS),
    },
    ClauseDecisionSchema,
    { maxAttempts: 2 },
  );
  if (!res.ok) {
    await i.record("decision", { turn: 1, ok: false, errorCode: res.errorCode });
    return unavailable(TEXT_ZH.clausesModelFailed, null, reasonOf(stats, true));
  }
  const f = verifyClauseDecision(res.value, snippets, stats);
  await i.record("decision", {
    turn: 1,
    ok: true,
    answers: Object.fromEntries(f.questions.map((q) => [q.key, q.answer])),
    downgraded: f.questions.filter((q) => q.downgraded).map((q) => q.key),
    ...(res.logs.some((l) => l.fallbackUsed) ? { fallbackUsed: true } : {}),
  });
  const n = statedCount(f);
  return finish(
    handoff(
      n > 0 ? "found" : "none",
      f,
      n > 0 ? [] : [{ reason: "none", messageZh: "三问在标书里都没有写明，已给澄清问题草稿" }],
      reasonOf(stats, true),
    ),
  );
}
