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
import { RESEARCH_TREE_LIMITS, RESEARCH_TREE_TIMING, type BranchLimits } from "./limits";
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

/** 理由句（给人看）：查了多少份、多少处，找没找到可能相关的文字；不写内部说法 */
function reasonOf(stats: ClauseScanStats, called: boolean): string {
  const scanned = stats.scannedPages > 0 ? `；另有 ${stats.scannedPages} 页是扫描件，没有文字` : "";
  const where = `${stats.documentCount} 份标书（${stats.pagesWithText} 页 / 单元）`;
  if (stats.snippetCount === 0) return `在 ${where}里没找到与加拿大含量、品牌、等效品有关的文字${scanned}`;
  return `在 ${where}里找到 ${stats.snippetCount} 段可能相关的文字${called ? "，请 AI 判断了一次" : ""}${scanned}`;
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
    return finish(handoff("none", f, [{ reason: "none", messageZh: TEXT_ZH.clausesNoneStatedLine }], reasonOf(stats, false)));
  }
  const cap = Math.min(RESEARCH_TREE_LIMITS.CLAUSE_MODEL_REQUESTS_PER_TREE, i.limits.modelCalls);
  if (cap < 1) {
    return finish(handoff("limit", null, [{ reason: "limit", messageZh: "到上限：本组织把 AI 请求次数调到了 0，这次没有判断标书条款" }], reasonOf(stats, false)));
  }
  // 请求成功、结论已记下、交单前中断：原样交回这份结论（不再请求）
  if (st.clausesFindings) return finishFound(st.clausesFindings);
  // 每棵树只请求一次：请求过、没有结论（中断了或失败了）→ 不再请求
  if (st.modelCalls >= cap) return unavailable(TEXT_ZH.clausesModelUsed, null, reasonOf(stats, true));
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
  // 整份结论（答案枚举、核对过的 ≤200 字标书摘录、页码）记进这一行：交单前中断，续跑时原样交回、不再请求
  await i.record("decision", {
    turn: 1,
    ok: true,
    findings: f,
    downgraded: f.questions.filter((q) => q.downgraded).map((q) => q.key),
    ...(res.logs.some((l) => l.fallbackUsed) ? { fallbackUsed: true } : {}),
  });
  return finishFound(f);

  function finishFound(found: ClauseFindingsV1): Promise<AdapterResult> {
    const n = statedCount(found);
    return finish(handoff(n > 0 ? "found" : "none", found, n > 0 ? [] : [{ reason: "none", messageZh: TEXT_ZH.clausesNoneStatedLine }], reasonOf(statsFromFindings(found), true)));
  }
}

function statsFromFindings(f: ClauseFindingsV1): ClauseScanStats {
  return { documentCount: f.documentCount, pagesWithText: f.pagesWithText, scannedPages: f.scannedPages, snippetCount: f.snippetCount };
}
