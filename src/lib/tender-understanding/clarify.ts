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

export async function generateClarifications(params: {
  input: AnalyzerInput;
  ambiguities: AmbiguityCandidateV2[];
  requirements: TenderRequirementV2[];
  criticalFacts: Record<CriticalFactType, CriticalFactSlotV2>;
  invoker: LlmInvoker;
}): Promise<ClarifyResult> {
  const { input, requirements, criticalFacts, invoker } = params;
  const logs: LlmCallLog[] = [];
  const clarifications: ClarificationV2[] = [];
  const resolvedAmbiguities: ClarifyResult["resolvedAmbiguities"] = [];

  const deduped = dedupeAmbiguities(params.ambiguities);

  for (const amb of deduped) {
    const question = `${amb.topic}: ${amb.whatIsUnknown}`;
    const candidatePages = retrieveCandidatePages(
      input,
      `${amb.topic} ${amb.whatIsUnknown} ${amb.description}`,
    );

    let resolved: ResolutionOutputV2 | null = null;
    if (candidatePages.length > 0) {
      const call = await callStructured(
        invoker,
        {
          promptName: PROMPT_RESOLVE.name,
          promptVersion: PROMPT_RESOLVE.version,
          systemPrompt: RESOLVE_SYSTEM_PROMPT,
          userPrompt: buildResolveUserPrompt({
            question,
            whatIsUnknown: amb.whatIsUnknown,
            candidatePages,
          }),
          maxTokens: RESOLVE_MAX_TOKENS,
          timeoutMs: RESOLVE_TIMEOUT_MS,
        },
        resolutionOutputSchema,
      );
      logs.push(...call.logs);
      if (call.ok) resolved = call.value;
      // 调用失败（transient/invalid）→ 视为未解决，仍生成澄清（保守方向）
    }

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

  return { clarifications, resolvedAmbiguities, logs };
}
