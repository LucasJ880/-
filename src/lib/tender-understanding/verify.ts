/**
 * Evidence Verifier — LLM 候选进入业务结果前的硬校验
 *
 * 逐条验证：
 * 1. sourceDocumentId 存在于本次分析文档集；
 * 2. pageNumber 存在；
 * 3. sourceSnippet 逐字（whitespace/NFKC 归一化后）出现在该页；
 * 4. claim 与 snippet 语义支持（值类事实：claim 中的日期/金额/数量必须出现在
 *    snippet 或同页文本；文本类：内容词重叠下限）。
 *
 * 验不过 → reject（记录 reasonCode），绝不落业务结果。
 * "value 正确但 evidence 错" 在这里直接被拒 —— 不降低 #97 建立的 Evidence 纪律。
 */

import type {
  AmbiguityCandidateV2,
  AnalyzerInput,
  FactCandidateV2,
  RequirementCandidateV2,
  RiskCandidateV2,
} from "./contract";
import {
  extractDatesYmd,
  extractDurationsDays,
  extractMoneyAmounts,
  extractNumbers,
  normalizeForMatch,
  tokenOverlapRatio,
} from "./normalize";

export type RejectReasonCode =
  | "DOCUMENT_NOT_IN_SCOPE"
  | "PAGE_NOT_FOUND"
  | "SNIPPET_NOT_ON_PAGE"
  | "VALUE_NOT_IN_EVIDENCE"
  | "NO_SEMANTIC_SUPPORT";

export type RejectedCandidate<T> = {
  candidate: T;
  reasonCode: RejectReasonCode;
};

export type PageIndex = Map<string, string>; // `${documentId}:${pageNumber}` -> normalized page text

export function buildPageIndex(input: AnalyzerInput): PageIndex {
  const index: PageIndex = new Map();
  for (const doc of input.documents) {
    for (const page of doc.pages) {
      index.set(
        `${doc.documentId}:${page.pageNumber}`,
        normalizeForMatch(page.contentText),
      );
    }
  }
  return index;
}

type EvidencedCandidate = {
  sourceDocumentId: string;
  pageNumber: number;
  sourceSnippet: string;
};

function checkEvidence(
  c: EvidencedCandidate,
  index: PageIndex,
  documentIds: Set<string>,
): RejectReasonCode | null {
  if (!documentIds.has(c.sourceDocumentId)) return "DOCUMENT_NOT_IN_SCOPE";
  const pageText = index.get(`${c.sourceDocumentId}:${c.pageNumber}`);
  if (pageText === undefined) return "PAGE_NOT_FOUND";
  const snippet = normalizeForMatch(c.sourceSnippet);
  if (snippet.length === 0 || !pageText.includes(snippet)) {
    return "SNIPPET_NOT_ON_PAGE";
  }
  return null;
}

/**
 * 值支持检查：claim/rawValue 中的具体值（日期/时长/金额；quantity 事实另查裸数字）
 * 必须出现在 sourceSnippet 本身 —— "值正确但引文不含值" 即 FAIL
 * （引对页但引错句同样拒收，spec §21）。
 */
function checkValueSupport(
  claimAndRaw: string,
  snippet: string,
  factType: string,
): boolean {
  const sn = normalizeForMatch(snippet);

  for (const d of extractDatesYmd(claimAndRaw)) {
    if (!extractDatesYmd(sn).includes(d)) return false;
  }

  const durations = extractDurationsDays(claimAndRaw);
  if (durations.length > 0) {
    const snippetDurations = new Set([
      ...extractDurationsDays(sn),
      ...extractNumbers(sn),
    ]);
    if (!durations.every((d) => snippetDurations.has(d))) return false;
  }

  const money = extractMoneyAmounts(claimAndRaw);
  if (money.length > 0) {
    const evidenceMoney = new Set([
      ...extractMoneyAmounts(sn),
      ...extractNumbers(sn),
    ]);
    if (!money.every((m) => evidenceMoney.has(m))) return false;
  }

  if (factType === "quantity") {
    const nums = extractNumbers(claimAndRaw);
    const snNums = new Set(extractNumbers(sn));
    if (nums.length > 0 && !nums.every((n) => snNums.has(n))) return false;
  }
  return true;
}

const MIN_CLAIM_SNIPPET_OVERLAP = 0.15;

function checkSemanticSupport(claim: string, snippet: string): boolean {
  // claim 是转述，阈值取低位；完全无内容词交集才判不支持
  return tokenOverlapRatio(claim, snippet) >= MIN_CLAIM_SNIPPET_OVERLAP;
}

export type VerifiedCandidates = {
  facts: FactCandidateV2[];
  requirements: RequirementCandidateV2[];
  risks: RiskCandidateV2[];
  ambiguities: AmbiguityCandidateV2[];
  rejected: {
    facts: RejectedCandidate<FactCandidateV2>[];
    requirements: RejectedCandidate<RequirementCandidateV2>[];
    risks: RejectedCandidate<RiskCandidateV2>[];
    ambiguities: RejectedCandidate<AmbiguityCandidateV2>[];
  };
};

export function verifyCandidates(
  input: AnalyzerInput,
  candidates: {
    facts: FactCandidateV2[];
    requirements: RequirementCandidateV2[];
    risks: RiskCandidateV2[];
    ambiguities: AmbiguityCandidateV2[];
  },
): VerifiedCandidates {
  const index = buildPageIndex(input);
  const documentIds = new Set(input.documents.map((d) => d.documentId));

  const out: VerifiedCandidates = {
    facts: [],
    requirements: [],
    risks: [],
    ambiguities: [],
    rejected: { facts: [], requirements: [], risks: [], ambiguities: [] },
  };

  for (const f of candidates.facts) {
    const evidenceFail = checkEvidence(f, index, documentIds);
    if (evidenceFail) {
      out.rejected.facts.push({ candidate: f, reasonCode: evidenceFail });
      continue;
    }
    if (
      !checkValueSupport(
        `${f.claim} ${f.rawValue ?? ""}`,
        f.sourceSnippet,
        f.factType,
      )
    ) {
      out.rejected.facts.push({ candidate: f, reasonCode: "VALUE_NOT_IN_EVIDENCE" });
      continue;
    }
    if (!checkSemanticSupport(f.claim, f.sourceSnippet)) {
      out.rejected.facts.push({ candidate: f, reasonCode: "NO_SEMANTIC_SUPPORT" });
      continue;
    }
    out.facts.push(f);
  }

  for (const r of candidates.requirements) {
    const evidenceFail = checkEvidence(r, index, documentIds);
    if (evidenceFail) {
      out.rejected.requirements.push({ candidate: r, reasonCode: evidenceFail });
      continue;
    }
    if (!checkSemanticSupport(r.statement, r.sourceSnippet)) {
      out.rejected.requirements.push({
        candidate: r,
        reasonCode: "NO_SEMANTIC_SUPPORT",
      });
      continue;
    }
    // mandatory=true 但 signal 在证据上下文找不到 → 降级 uncertain（不拒收，但不得算 mandatory）
    if (r.mandatory === true) {
      const pageText = index.get(`${r.sourceDocumentId}:${r.pageNumber}`)!;
      const signal = r.mandatorySignal ? normalizeForMatch(r.mandatorySignal) : "";
      const signalOk =
        signal.length > 0 &&
        (normalizeForMatch(r.sourceSnippet).includes(signal) ||
          pageText.includes(signal));
      if (!signalOk) {
        out.requirements.push({ ...r, mandatory: "uncertain" });
        continue;
      }
    }
    out.requirements.push(r);
  }

  for (const k of candidates.risks) {
    const evidenceFail = checkEvidence(k, index, documentIds);
    if (evidenceFail) {
      out.rejected.risks.push({ candidate: k, reasonCode: evidenceFail });
      continue;
    }
    // 语义门（Final Review §15）：引文真实存在但与 risk 断言无关 → 拒收。
    // 通用 token 支持判定，零领域词；宁可拒掉 borderline，不让 unsupported
    // claim 进业务结果。
    if (!checkSemanticSupport(k.description, k.sourceSnippet)) {
      out.rejected.risks.push({ candidate: k, reasonCode: "NO_SEMANTIC_SUPPORT" });
      continue;
    }
    out.risks.push(k);
  }

  for (const a of candidates.ambiguities) {
    const evidenceFail = checkEvidence(a, index, documentIds);
    if (evidenceFail) {
      out.rejected.ambiguities.push({ candidate: a, reasonCode: evidenceFail });
      continue;
    }
    // 语义门（Final Review §16）：topic/description/whatIsUnknown 组合文本
    // 必须被引文支持，否则拒收。
    const ambiguityClaim = `${a.topic} ${a.description} ${a.whatIsUnknown}`;
    if (!checkSemanticSupport(ambiguityClaim, a.sourceSnippet)) {
      out.rejected.ambiguities.push({
        candidate: a,
        reasonCode: "NO_SEMANTIC_SUPPORT",
      });
      continue;
    }
    out.ambiguities.push(a);
  }

  return out;
}

export function tallyRejections(
  rejected: VerifiedCandidates["rejected"],
): { reasonCode: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const group of [
    rejected.facts,
    rejected.requirements,
    rejected.risks,
    rejected.ambiguities,
  ]) {
    for (const r of group) {
      counts.set(r.reasonCode, (counts.get(r.reasonCode) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).map(([reasonCode, count]) => ({
    reasonCode,
    count,
  }));
}
