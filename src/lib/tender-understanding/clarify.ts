/**
 * Clarification 生成 — 全量文档分析完成后执行
 *
 * 流程（spec §26）：candidate ambiguity → 全 project 语料检索 → LLM 解决检查
 * （含 addenda / specifications / forms）→ 答案证据可验证 → 不提问（记入
 * resolvedAmbiguities）；仍未解决 → 生成 Clarification。
 *
 * 硬规则：
 * - 没有最低数量目标；0 条是合法结果（QUALITY > COUNT）。
 * - 文档集已回答的问题不得提出。
 * - 主题只能来自本 Tender 的已验证歧义/未知，不存在任何 fallback 模板。
 */

import type {
  AmbiguityCandidateV2,
  AnalyzerInput,
  ClarificationV2,
  CriticalFactSlotV2,
  CriticalFactType,
  ResolutionOutputV2,
  TenderRequirementV2,
} from "./contract";
import { resolutionOutputSchema } from "./contract";
import type { LlmCallLog, LlmInvoker } from "./llm";
import { callStructured } from "./llm";
import {
  contentTokens,
  normalizeForMatch,
  tokenJaccard,
  tokenOverlapRatio,
} from "./normalize";
import {
  buildResolveUserPrompt,
  PROMPT_RESOLVE,
  RESOLVE_SYSTEM_PROMPT,
} from "./prompts";

const RESOLVE_MAX_TOKENS = 3_000;
const RESOLVE_TIMEOUT_MS = 60_000;
const CANDIDATE_PAGES_PER_QUESTION = 3;
const AMBIGUITY_DEDUPE_JACCARD = 0.55;

export type ClarifyResult = {
  clarifications: ClarificationV2[];
  resolvedAmbiguities: {
    topic: string;
    answerSummary: string;
    evidence: { documentId: string; pageNumber: number; snippet: string }[];
  }[];
  logs: LlmCallLog[];
};

/** 词汇检索：按内容词覆盖率排页，取 top-k 作为解决检查语料 */
export function retrieveCandidatePages(
  input: AnalyzerInput,
  query: string,
  k = CANDIDATE_PAGES_PER_QUESTION,
): { documentId: string; pageNumber: number; contentText: string }[] {
  const scored: {
    documentId: string;
    pageNumber: number;
    contentText: string;
    score: number;
  }[] = [];
  for (const doc of input.documents) {
    for (const page of doc.pages) {
      const score = tokenOverlapRatio(query, page.contentText);
      if (score > 0) {
        scored.push({
          documentId: doc.documentId,
          pageNumber: page.pageNumber,
          contentText: page.contentText,
          score,
        });
      }
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ documentId, pageNumber, contentText }) => ({
      documentId,
      pageNumber,
      contentText,
    }));
}

function dedupeAmbiguities(items: AmbiguityCandidateV2[]): AmbiguityCandidateV2[] {
  const out: AmbiguityCandidateV2[] = [];
  for (const a of items) {
    const dup = out.some(
      (b) => tokenJaccard(a.topic + " " + a.whatIsUnknown, b.topic + " " + b.whatIsUnknown) >= AMBIGUITY_DEDUPE_JACCARD,
    );
    if (!dup) out.push(a);
  }
  return out;
}

function verifyResolutionEvidence(
  input: AnalyzerInput,
  res: ResolutionOutputV2,
): boolean {
  if (!res.resolved) return false;
  if (!res.answerDocumentId || !res.answerPageNumber || !res.answerSnippet) {
    return false;
  }
  const doc = input.documents.find((d) => d.documentId === res.answerDocumentId);
  const page = doc?.pages.find((p) => p.pageNumber === res.answerPageNumber);
  if (!page) return false;
  return normalizeForMatch(page.contentText).includes(
    normalizeForMatch(res.answerSnippet),
  );
}

function linkRequirements(
  ambiguity: AmbiguityCandidateV2,
  requirements: TenderRequirementV2[],
): string[] {
  return requirements
    .filter(
      (r) =>
        r.status !== "SUPERSEDED" &&
        tokenJaccard(ambiguity.topic + " " + ambiguity.description, r.statement) >=
          0.2,
    )
    .map((r) => r.id)
    .slice(0, 5);
}

/* ------------------------------ 分片可续跑接缝 ------------------------------ */

export const RESOLVE_TIMEOUT_MS_MAX = RESOLVE_TIMEOUT_MS;

export type ClarificationPlanItem = {
  /** 跨 tick 稳定键：同一批窗口输出恒产出同一键（缓存命中的前提） */
  key: string;
  ambiguity: AmbiguityCandidateV2;
  question: string;
  candidatePages: { documentId: string; pageNumber: number; contentText: string }[];
};

/** 去重 + 语料检索（纯）：确定澄清工作单。无 LLM。 */
export function planClarifications(
  input: AnalyzerInput,
  ambiguities: AmbiguityCandidateV2[],
): ClarificationPlanItem[] {
  return dedupeAmbiguities(ambiguities).map((amb) => ({
    key: `${amb.sourceDocumentId}#${amb.pageNumber}#${amb.topic}#${amb.whatIsUnknown}`.slice(
      0,
      300,
    ),
    ambiguity: amb,
    question: `${amb.topic}: ${amb.whatIsUnknown}`,
    candidatePages: retrieveCandidatePages(
      input,
      `${amb.topic} ${amb.whatIsUnknown} ${amb.description}`,
    ),
  }));
}

/**
 * 单条歧义的语料解决检查（一次 LLM）。无候选页 → 不调用模型。
 * 返回 null resolution = 未解决（保守方向：仍会生成澄清问题）。
 */
export async function resolveClarificationItem(
  item: ClarificationPlanItem,
  invoker: LlmInvoker,
  opts: { timeoutMs?: number } = {},
): Promise<{ resolution: ResolutionOutputV2 | null; logs: LlmCallLog[] }> {
  if (item.candidatePages.length === 0) return { resolution: null, logs: [] };
  const call = await callStructured(
    invoker,
    {
      promptName: PROMPT_RESOLVE.name,
      promptVersion: PROMPT_RESOLVE.version,
      systemPrompt: RESOLVE_SYSTEM_PROMPT,
      userPrompt: buildResolveUserPrompt({
        question: item.question,
        whatIsUnknown: item.ambiguity.whatIsUnknown,
        candidatePages: item.candidatePages,
      }),
      maxTokens: RESOLVE_MAX_TOKENS,
      timeoutMs: Math.max(
        1_000,
        Math.min(opts.timeoutMs ?? RESOLVE_TIMEOUT_MS, RESOLVE_TIMEOUT_MS),
      ),
    },
    resolutionOutputSchema,
  );
  // 调用失败（transient/invalid）→ 视为未解决，仍生成澄清（保守方向）
  return { resolution: call.ok ? call.value : null, logs: call.logs };
}

/**
 * 由工作单 + 解决检查结果组装澄清问题（纯）。
 * resolutions 以 plan item 的 key 索引；缺键 = 未解决。
 */
export function assembleClarifications(params: {
  input: AnalyzerInput;
  plan: ClarificationPlanItem[];
  resolutions: Record<string, ResolutionOutputV2 | null>;
  requirements: TenderRequirementV2[];
  criticalFacts: Record<CriticalFactType, CriticalFactSlotV2>;
}): Omit<ClarifyResult, "logs"> {
  const { input, requirements, criticalFacts } = params;
  const clarifications: ClarificationV2[] = [];
  const resolvedAmbiguities: ClarifyResult["resolvedAmbiguities"] = [];

  for (const item of params.plan) {
    const amb = item.ambiguity;
    const resolved = params.resolutions[item.key] ?? null;

    if (resolved && verifyResolutionEvidence(input, resolved)) {
      resolvedAmbiguities.push({
        topic: amb.topic,
        answerSummary: resolved.answerSummary ?? "（文档已回答）",
        evidence: [
          {
            documentId: resolved.answerDocumentId!,
            pageNumber: resolved.answerPageNumber!,
            snippet: resolved.answerSnippet!.slice(0, 600),
          },
        ],
      });
      continue;
    }

    const related = linkRequirements(amb, requirements);
    const touchesMandatory = related.some((id) =>
      requirements.some((r) => r.id === id && r.mandatory === true),
    );
    const touchesSubmissionBlocker =
      criticalFacts.closing_datetime.status === "UNKNOWN" &&
      contentTokens(amb.topic).some((t) =>
        ["closing", "deadline", "submission", "截标", "提交"].includes(t),
      );

    clarifications.push({
      id: `CL-${String(clarifications.length + 1).padStart(3, "0")}`,
      question: `${amb.topic}：${amb.whatIsUnknown}`,
      reason: amb.description,
      priority:
        touchesSubmissionBlocker || touchesMandatory
          ? touchesSubmissionBlocker
            ? "BLOCKING"
            : "HIGH"
          : "MEDIUM",
      relatedRequirementIds: related,
      supportingEvidence: [
        {
          documentId: amb.sourceDocumentId,
          pageNumber: amb.pageNumber,
          snippet: amb.sourceSnippet.slice(0, 600),
        },
      ],
      whatIsUnknown: amb.whatIsUnknown,
      businessImpact: touchesMandatory
        ? "影响强制要求合规判定，未澄清前无法确认响应性。"
        : "影响报价/履约准备的准确性。",
    });
  }

  return { clarifications, resolvedAmbiguities };
}

/**
 * 单次编排（eval/benchmark 与 flag-off 路径）：工作单 → 逐条解决检查 → 组装。
 * 生产 worker 走 v2-resumable 的跨 tick 编排，复用同一批阶段函数。
 */
export async function generateClarifications(params: {
  input: AnalyzerInput;
  ambiguities: AmbiguityCandidateV2[];
  requirements: TenderRequirementV2[];
  criticalFacts: Record<CriticalFactType, CriticalFactSlotV2>;
  invoker: LlmInvoker;
}): Promise<ClarifyResult> {
  const plan = planClarifications(params.input, params.ambiguities);
  const logs: LlmCallLog[] = [];
  const resolutions: Record<string, ResolutionOutputV2 | null> = {};

  for (const item of plan) {
    const res = await resolveClarificationItem(item, params.invoker);
    logs.push(...res.logs);
    resolutions[item.key] = res.resolution;
  }

  const assembled = assembleClarifications({
    input: params.input,
    plan,
    resolutions,
    requirements: params.requirements,
    criticalFacts: params.criticalFacts,
  });
  return { ...assembled, logs };
}
