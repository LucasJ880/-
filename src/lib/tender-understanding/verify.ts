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

/**
 * 归属纠正的最小引文长度（归一化后）。
 * 太短的引文可能在多处偶然唯一命中，纠正没有意义 —— 宁可按原样拒收。
 */
export const MIN_REATTRIBUTION_SNIPPET_CHARS = 24;

/**
 * 在**同一文档内**为引文寻找唯一的逐字所在单元。
 *
 * 用途：模型把引文归到了错误的单元号（生产实测：xlsx 多单元窗口下高发，
 * 92/115 的 SNIPPET_NOT_ON_PAGE 属于此类且**零歧义**）。
 * 纪律不变——引文仍必须逐字存在、位置仍必须真实；这里只把错误的单元号
 * 纠正成引文真正所在的那个单元。唯一性不成立（0 处或多处）→ 不纠正。
 * 跨文档不纠正：模型说是 A 文档却出现在 B 文档，属于实质性错误，照旧拒收。
 */
export function locateUniqueUnit(
  input: AnalyzerInput,
  documentId: string,
  snippet: string,
): number | null {
  const normalized = normalizeForMatch(snippet);
  if (normalized.length < MIN_REATTRIBUTION_SNIPPET_CHARS) return null;
  const doc = input.documents.find((d) => d.documentId === documentId);
  if (!doc) return null;

  let found: number | null = null;
  for (const page of doc.pages) {
    if (!normalizeForMatch(page.contentText).includes(normalized)) continue;
    if (found !== null) return null; // 多处命中 → 有歧义，不纠正
    found = page.pageNumber;
  }
  return found;
}

type EvidenceCheckResult =
  | { ok: true; correctedPageNumber: number | null }
  | { ok: false; reasonCode: RejectReasonCode };

function checkEvidence(
  c: EvidencedCandidate,
  index: PageIndex,
  documentIds: Set<string>,
  input: AnalyzerInput,
): EvidenceCheckResult {
  if (!documentIds.has(c.sourceDocumentId)) {
    return { ok: false, reasonCode: "DOCUMENT_NOT_IN_SCOPE" };
  }
  const snippet = normalizeForMatch(c.sourceSnippet);
  const pageText = index.get(`${c.sourceDocumentId}:${c.pageNumber}`);
  const missReason: RejectReasonCode =
    pageText === undefined ? "PAGE_NOT_FOUND" : "SNIPPET_NOT_ON_PAGE";

  if (pageText !== undefined && snippet.length > 0 && pageText.includes(snippet)) {
    return { ok: true, correctedPageNumber: null };
  }

  // 引错单元号 → 若引文在本文档内唯一定位，纠正到真实单元
  const corrected = locateUniqueUnit(input, c.sourceDocumentId, c.sourceSnippet);
  if (corrected !== null) return { ok: true, correctedPageNumber: corrected };

  return { ok: false, reasonCode: missReason };
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
  /** 引文逐字可核验但单元号被模型写错、已纠正到唯一真实单元的条数（可观测性） */
  reattributed: number;
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
    reattributed: 0,
    facts: [],
    requirements: [],
    risks: [],
    ambiguities: [],
    rejected: { facts: [], requirements: [], risks: [], ambiguities: [] },
  };

  for (const raw of candidates.facts) {
    const ev = checkEvidence(raw, index, documentIds, input);
    if (!ev.ok) {
      out.rejected.facts.push({ candidate: raw, reasonCode: ev.reasonCode });
      continue;
    }
    const f =
      ev.correctedPageNumber === null
        ? raw
        : { ...raw, pageNumber: ev.correctedPageNumber };
    if (ev.correctedPageNumber !== null) out.reattributed += 1;
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

  for (const rawReq of candidates.requirements) {
    const ev = checkEvidence(rawReq, index, documentIds, input);
    if (!ev.ok) {
      out.rejected.requirements.push({ candidate: rawReq, reasonCode: ev.reasonCode });
      continue;
    }
    const r =
      ev.correctedPageNumber === null
        ? rawReq
        : { ...rawReq, pageNumber: ev.correctedPageNumber };
    if (ev.correctedPageNumber !== null) out.reattributed += 1;
    if (!checkSemanticSupport(r.statement, r.sourceSnippet)) {
      out.rejected.requirements.push({
        candidate: r,
        reasonCode: "NO_SEMANTIC_SUPPORT",
      });
      continue;
    }
    // mandatory=true 但 signal 在证据上下文找不到 → 降级 uncertain（不拒收，但不得算 mandatory）
    if (r.mandatory === true) {
      const pageText = index.get(`${r.sourceDocumentId}:${r.pageNumber}`) ?? "";
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

  for (const rawRisk of candidates.risks) {
    const ev = checkEvidence(rawRisk, index, documentIds, input);
    if (!ev.ok) {
      out.rejected.risks.push({ candidate: rawRisk, reasonCode: ev.reasonCode });
      continue;
    }
    const k =
      ev.correctedPageNumber === null
        ? rawRisk
        : { ...rawRisk, pageNumber: ev.correctedPageNumber };
    if (ev.correctedPageNumber !== null) out.reattributed += 1;
    // 语义门（Final Review §15）：引文真实存在但与 risk 断言无关 → 拒收。
    // 通用 token 支持判定，零领域词；宁可拒掉 borderline，不让 unsupported
    // claim 进业务结果。
    if (!checkSemanticSupport(k.description, k.sourceSnippet)) {
      out.rejected.risks.push({ candidate: k, reasonCode: "NO_SEMANTIC_SUPPORT" });
      continue;
    }
    out.risks.push(k);
  }

  for (const rawAmb of candidates.ambiguities) {
    const ev = checkEvidence(rawAmb, index, documentIds, input);
    if (!ev.ok) {
      out.rejected.ambiguities.push({ candidate: rawAmb, reasonCode: ev.reasonCode });
      continue;
    }
    const a =
      ev.correctedPageNumber === null
        ? rawAmb
        : { ...rawAmb, pageNumber: ev.correctedPageNumber };
    if (ev.correctedPageNumber !== null) out.reattributed += 1;
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
