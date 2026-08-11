/**
 * tender-eval/v1 评分引擎（确定性，无 LLM judge）
 *
 * 判定规则全部显式、可复现：
 * - Requirement:锚词命中 → 候选;内容词覆盖率 ≥ 0.35 且 mandatory 标志一致 → MATCHED,
 *   否则 PARTIAL;无候选 → MISSED;系统多余条目 → FALSE_POSITIVE;同一 golden 的
 *   第二个及以后候选 → DUPLICATE。
 * - Fact:锚词定位候选 → 归一化值判等;值对但证据缺/错 = CORRECT_VALUE_BAD_EVIDENCE(仍算失败)。
 * - Evidence:sourceRef 的 snippet 必须逐字(归一化后)出现在其声称的 doc+page 上;
 *   golden 指定允许页码时页码也必须命中。
 * - Clarification:幻觉探针 → HALLUCINATED;命中已回答主题 → ALREADY_ANSWERED;
 *   命中 golden 主题 → NECESSARY/USEFUL;其余 → LOW_VALUE。
 */

import type {
  ClarificationCandidate,
  FactCandidate,
  PageInput,
  RequirementCandidate,
  SourceRefCandidate,
} from "@/lib/tender-auto-analysis/extract/types";

import type {
  ClarificationVerdict,
  FactVerdict,
  GoldenEvidenceRef,
  RequirementVerdict,
  TenderEvalCase,
} from "./contract";
import {
  anchorGroupsMatch,
  normalizeText,
  tokenCoverage,
  valueMatchesText,
} from "./normalize";

/** MATCHED 的最低内容词覆盖率（v1 启发式阈值，写入报告以便复核） */
export const MATCH_TOKEN_COVERAGE_THRESHOLD = 0.35;

/* ---------------------------------- 系统输出 ---------------------------------- */

export type SystemOutput = {
  facts: FactCandidate[];
  requirements: RequirementCandidate[];
  clarifications: ClarificationCandidate[];
  /** 风险语料行（RISKS 报告章节按行拆分 + AI_INFERENCE/解释类事实文本） */
  riskLines: string[];
};

/* ---------------------------------- 证据核验 ---------------------------------- */

export type EvidenceCheck = {
  ref: SourceRefCandidate;
  snippetOnPage: boolean;
  pageAllowedByGolden: boolean | null; // null = golden 未限定页码
  valid: boolean;
};

function findPage(
  pages: PageInput[],
  documentId: string,
  pageNumber: number,
): PageInput | null {
  return (
    pages.find(
      (p) => p.documentId === documentId && p.pageNumber === pageNumber,
    ) ?? null
  );
}

export function checkEvidenceRefs(
  refs: SourceRefCandidate[],
  pages: PageInput[],
  goldenEvidence: GoldenEvidenceRef[],
): EvidenceCheck[] {
  return refs.map((ref) => {
    const page = findPage(pages, ref.documentId, ref.pageNumber);
    const snippetOnPage =
      page !== null &&
      normalizeText(ref.originalTextSnippet).length > 0 &&
      normalizeText(page.contentText).includes(
        normalizeText(ref.originalTextSnippet),
      );
    const constraints = goldenEvidence.filter(
      (g) => g.documentId === ref.documentId && g.pageNumbers.length > 0,
    );
    const anyConstraint = goldenEvidence.some((g) => g.pageNumbers.length > 0);
    const pageAllowedByGolden = !anyConstraint
      ? null
      : constraints.some((g) => g.pageNumbers.includes(ref.pageNumber));
    return {
      ref,
      snippetOnPage,
      pageAllowedByGolden,
      valid: snippetOnPage && pageAllowedByGolden !== false,
    };
  });
}

/* ---------------------------------- Facts ---------------------------------- */

export type FactEvaluation = {
  factId: string;
  critical: boolean;
  verdict: FactVerdict;
  matchedFactKeys: string[];
  valueOk: boolean;
  evidenceOk: boolean;
  detail: string;
};

function factFullText(f: FactCandidate): string {
  const structured = (f as FactCandidate & { structuredJson?: unknown })
    .structuredJson;
  return [
    f.factKey,
    f.contentZh,
    f.contentOriginal ?? "",
    structured ? JSON.stringify(structured) : "",
  ].join(" \n ");
}

export function evaluateFacts(
  evalCase: TenderEvalCase,
  facts: FactCandidate[],
  pages: PageInput[],
): FactEvaluation[] {
  return evalCase.goldenFacts.map((golden) => {
    const candidates = facts.filter((f) =>
      anchorGroupsMatch(factFullText(f), golden.matchAnchors),
    );
    if (candidates.length === 0) {
      return {
        factId: golden.factId,
        critical: golden.critical,
        verdict: "NOT_EXTRACTED" as const,
        matchedFactKeys: [],
        valueOk: false,
        evidenceOk: false,
        detail: "no system fact matched anchors",
      };
    }
    let best: { f: FactCandidate; valueOk: boolean; evidenceOk: boolean } | null =
      null;
    for (const f of candidates) {
      const valueOk = valueMatchesText(golden.expected, factFullText(f));
      const checks = checkEvidenceRefs(f.sourceRefs, pages, golden.evidence);
      const evidenceOk = checks.length > 0 && checks.some((c) => c.valid);
      const score = (valueOk ? 2 : 0) + (evidenceOk ? 1 : 0);
      const bestScore = best
        ? (best.valueOk ? 2 : 0) + (best.evidenceOk ? 1 : 0)
        : -1;
      if (score > bestScore) best = { f, valueOk, evidenceOk };
    }
    const { valueOk, evidenceOk } = best!;
    const verdict: FactVerdict = !valueOk
      ? "WRONG_VALUE"
      : evidenceOk
        ? "CORRECT"
        : "CORRECT_VALUE_BAD_EVIDENCE";
    return {
      factId: golden.factId,
      critical: golden.critical,
      verdict,
      matchedFactKeys: candidates.map((c) => c.factKey),
      valueOk,
      evidenceOk,
      detail: `candidates=[${candidates.map((c) => c.factKey).join(",")}]`,
    };
  });
}

/* ---------------------------------- Requirements ---------------------------------- */

export type RequirementEvaluation = {
  goldenId: string;
  mandatory: boolean;
  importance: string;
  verdict: Extract<RequirementVerdict, "MATCHED" | "PARTIAL" | "MISSED">;
  primaryCode: string | null;
  duplicateCodes: string[];
  coverage: number;
  evidenceOk: boolean;
};

export type ExtractedRequirementAttribution = {
  requirementCode: string;
  verdict: RequirementVerdict;
  goldenId: string | null;
};

export type RequirementsEvaluation = {
  perGolden: RequirementEvaluation[];
  perExtracted: ExtractedRequirementAttribution[];
};

function reqFullText(r: RequirementCandidate): string {
  return `${r.requirementCode} ${r.originalRequirement} ${r.chineseTranslation}`;
}

export function evaluateRequirements(
  evalCase: TenderEvalCase,
  extracted: RequirementCandidate[],
  pages: PageInput[],
): RequirementsEvaluation {
  // 每条 extracted 归属到覆盖率最高的 golden
  const attribution = new Map<string, { goldenId: string; coverage: number }>();
  for (const r of extracted) {
    let bestGolden: { goldenId: string; coverage: number } | null = null;
    for (const g of evalCase.goldenRequirements) {
      if (!anchorGroupsMatch(reqFullText(r), g.matchAnchors)) continue;
      const cov = tokenCoverage(g.text, r.originalRequirement);
      if (!bestGolden || cov > bestGolden.coverage) {
        bestGolden = { goldenId: g.goldenId, coverage: cov };
      }
    }
    if (bestGolden) attribution.set(r.requirementCode, bestGolden);
  }

  const perGolden: RequirementEvaluation[] = evalCase.goldenRequirements.map(
    (g) => {
      const members = extracted
        .filter((r) => attribution.get(r.requirementCode)?.goldenId === g.goldenId)
        .sort(
          (a, b) =>
            (attribution.get(b.requirementCode)?.coverage ?? 0) -
            (attribution.get(a.requirementCode)?.coverage ?? 0),
        );
      if (members.length === 0) {
        return {
          goldenId: g.goldenId,
          mandatory: g.mandatory,
          importance: g.importance,
          verdict: "MISSED" as const,
          primaryCode: null,
          duplicateCodes: [],
          coverage: 0,
          evidenceOk: false,
        };
      }
      const primary = members[0]!;
      const coverage = attribution.get(primary.requirementCode)?.coverage ?? 0;
      const mandatoryOk = primary.mandatory === g.mandatory;
      const verdict =
        coverage >= MATCH_TOKEN_COVERAGE_THRESHOLD && mandatoryOk
          ? ("MATCHED" as const)
          : ("PARTIAL" as const);
      const checks = checkEvidenceRefs(primary.sourceRefs, pages, g.evidence);
      return {
        goldenId: g.goldenId,
        mandatory: g.mandatory,
        importance: g.importance,
        verdict,
        primaryCode: primary.requirementCode,
        duplicateCodes: members.slice(1).map((m) => m.requirementCode),
        coverage: Number(coverage.toFixed(3)),
        evidenceOk: checks.length > 0 && checks.some((c) => c.valid),
      };
    },
  );

  const primaryByGolden = new Map(
    perGolden.filter((g) => g.primaryCode).map((g) => [g.primaryCode!, g]),
  );
  const duplicateCodes = new Set(
    perGolden.flatMap((g) => g.duplicateCodes),
  );
  const perExtracted: ExtractedRequirementAttribution[] = extracted.map((r) => {
    const primaryOf = primaryByGolden.get(r.requirementCode);
    if (primaryOf) {
      return {
        requirementCode: r.requirementCode,
        verdict: primaryOf.verdict,
        goldenId: primaryOf.goldenId,
      };
    }
    if (duplicateCodes.has(r.requirementCode)) {
      return {
        requirementCode: r.requirementCode,
        verdict: "DUPLICATE" as const,
        goldenId: attribution.get(r.requirementCode)?.goldenId ?? null,
      };
    }
    return {
      requirementCode: r.requirementCode,
      verdict: "FALSE_POSITIVE" as const,
      goldenId: null,
    };
  });

  return { perGolden, perExtracted };
}

/* ---------------------------------- Risks ---------------------------------- */

export type RiskEvaluation = {
  riskId: string;
  severity: string;
  verdict: "DETECTED" | "MISSED";
};

export type RisksEvaluation = {
  perGolden: RiskEvaluation[];
  hallucinatedLines: string[];
  unmatchedLines: string[];
};

export function evaluateRisks(
  evalCase: TenderEvalCase,
  riskLines: string[],
): RisksEvaluation {
  // 幻觉行先剔除：与文档无关主题的风险输出不得给 golden 记 DETECTED
  const hallucinatedLines: string[] = [];
  const cleanLines: string[] = [];
  for (const line of riskLines) {
    if (!line.trim()) continue;
    if (anchorGroupsMatch(line, evalCase.hallucinationProbes)) {
      hallucinatedLines.push(line);
    } else {
      cleanLines.push(line);
    }
  }
  const corpus = cleanLines.join("\n");
  const perGolden: RiskEvaluation[] = evalCase.goldenRisks.map((g) => ({
    riskId: g.riskId,
    severity: g.severity,
    verdict: anchorGroupsMatch(corpus, g.matchAnchors)
      ? ("DETECTED" as const)
      : ("MISSED" as const),
  }));
  const unmatchedLines = cleanLines.filter(
    (line) =>
      !evalCase.goldenRisks.some((g) => anchorGroupsMatch(line, g.matchAnchors)),
  );
  return { perGolden, hallucinatedLines, unmatchedLines };
}

/* ---------------------------------- Clarifications ---------------------------------- */

export type ClarificationEvaluation = {
  question: string;
  verdict: ClarificationVerdict;
  matchedClarId: string | null;
};

export type ClarificationsEvaluation = {
  perQuestion: ClarificationEvaluation[];
  goldenCoverage: { clarId: string; necessity: string; covered: boolean }[];
};

export function evaluateClarifications(
  evalCase: TenderEvalCase,
  questions: ClarificationCandidate[],
): ClarificationsEvaluation {
  const perQuestion: ClarificationEvaluation[] = questions.map((q) => {
    // 幻觉探针扫问题+理由（幻觉前提常在 reason 里）；主题匹配只看问题本身，
    // 避免 reason 中顺带提及的词误触主题分类。
    const probeText = `${q.question} ${q.reason}`;
    const topicText = q.question;
    if (anchorGroupsMatch(probeText, evalCase.hallucinationProbes)) {
      return { question: q.question, verdict: "HALLUCINATED" as const, matchedClarId: null };
    }
    const answered = evalCase.goldenClarifications.find(
      (g) => g.answeredInDocument && anchorGroupsMatch(topicText, g.matchAnchors),
    );
    if (answered) {
      return {
        question: q.question,
        verdict: "ALREADY_ANSWERED" as const,
        matchedClarId: answered.clarId,
      };
    }
    const golden = evalCase.goldenClarifications.find(
      (g) => !g.answeredInDocument && anchorGroupsMatch(topicText, g.matchAnchors),
    );
    if (golden) {
      return {
        question: q.question,
        verdict: golden.necessity,
        matchedClarId: golden.clarId,
      };
    }
    return { question: q.question, verdict: "LOW_VALUE" as const, matchedClarId: null };
  });

  const goldenCoverage = evalCase.goldenClarifications
    .filter((g) => !g.answeredInDocument)
    .map((g) => ({
      clarId: g.clarId,
      necessity: g.necessity,
      covered: perQuestion.some((p) => p.matchedClarId === g.clarId),
    }));

  return { perQuestion, goldenCoverage };
}

/* ---------------------------------- Ambiguities / Unknowns ---------------------------------- */

export type AmbiguityEvaluation = {
  ambiguityId: string;
  expected: string;
  verdict: "OK" | "PARTIAL" | "MISSED";
};

export function evaluateAmbiguities(
  evalCase: TenderEvalCase,
  facts: FactCandidate[],
  riskLines: string[],
  clarifications: ClarificationCandidate[],
): AmbiguityEvaluation[] {
  const flagCorpus = [
    ...facts.map((f) => factFullText(f)),
    ...riskLines,
  ].join("\n");
  const clarCorpus = clarifications
    .map((c) => `${c.question} ${c.reason}`)
    .join("\n");
  return evalCase.knownAmbiguities.map((g) => {
    const flagged = anchorGroupsMatch(flagCorpus, g.matchAnchors);
    const clarified = anchorGroupsMatch(clarCorpus, g.matchAnchors);
    if (g.expected === "CLARIFICATION_REQUIRED") {
      return {
        ambiguityId: g.ambiguityId,
        expected: g.expected,
        verdict: clarified ? "OK" : flagged ? "PARTIAL" : "MISSED",
      };
    }
    return {
      ambiguityId: g.ambiguityId,
      expected: g.expected,
      verdict: flagged || clarified ? "OK" : "MISSED",
    };
  });
}

export type UnknownViolation = {
  field: string;
  factKey: string;
  excerpt: string;
};

/** expectedUnknowns:只有 CONFIRMED_FACT(确定口吻)命中禁止锚词才算违规 */
export function evaluateExpectedUnknowns(
  evalCase: TenderEvalCase,
  facts: FactCandidate[],
): UnknownViolation[] {
  const out: UnknownViolation[] = [];
  for (const unknown of evalCase.expectedUnknowns) {
    for (const f of facts) {
      if (f.statementKind !== "CONFIRMED_FACT") continue;
      const text = factFullText(f);
      if (anchorGroupsMatch(text, unknown.forbiddenClaimAnchors)) {
        out.push({
          field: unknown.field,
          factKey: f.factKey,
          excerpt: f.contentZh.slice(0, 120),
        });
      }
    }
  }
  return out;
}

/* ---------------------------------- Scorecard ---------------------------------- */

/** null = 分母为 0（N/A），与 0 值严格区分 */
export type Ratio = number | null;

export type CaseMetrics = {
  goldenRequirements: number;
  goldenMandatoryRequirements: number;
  extractedRequirements: number;
  requirementRecallStrict: Ratio;
  requirementRecallLenient: Ratio;
  mandatoryRecallStrict: Ratio;
  mandatoryRecallLenient: Ratio;
  requirementPrecision: Ratio;
  falsePositiveRate: Ratio;
  duplicateRate: Ratio;
  goldenFacts: number;
  criticalFacts: number;
  factAccuracy: Ratio;
  criticalFactAccuracy: Ratio;
  factsCorrectValueBadEvidence: number;
  evidenceCoverage: Ratio;
  evidenceAccuracy: Ratio;
  unsupportedClaimRate: Ratio;
  goldenRisks: number;
  riskRecall: Ratio;
  criticalRiskMissed: number;
  hallucinatedRiskLines: number;
  systemClarifications: number;
  usefulClarificationRate: Ratio;
  alreadyAnsweredRate: Ratio;
  hallucinatedClarifications: number;
  necessaryClarificationCoverage: Ratio;
  ambiguitiesOk: number;
  ambiguitiesTotal: number;
  expectedUnknownViolations: number;
};

export type CaseEvaluation = {
  caseId: string;
  facts: FactEvaluation[];
  requirements: RequirementsEvaluation;
  risks: RisksEvaluation;
  clarifications: ClarificationsEvaluation;
  ambiguities: AmbiguityEvaluation[];
  unknownViolations: UnknownViolation[];
  metrics: CaseMetrics;
};

function ratio(numer: number, denom: number): Ratio {
  return denom === 0 ? null : Number((numer / denom).toFixed(4));
}

export function evaluateCase(
  evalCase: TenderEvalCase,
  output: SystemOutput,
): CaseEvaluation {
  const pages = evalCase.documentSet.flatMap((d) => d.pages);

  const facts = evaluateFacts(evalCase, output.facts, pages);
  const requirements = evaluateRequirements(
    evalCase,
    output.requirements,
    pages,
  );
  const risks = evaluateRisks(evalCase, output.riskLines);
  const clarifications = evaluateClarifications(
    evalCase,
    output.clarifications,
  );
  const ambiguities = evaluateAmbiguities(
    evalCase,
    output.facts,
    output.riskLines,
    output.clarifications,
  );
  const unknownViolations = evaluateExpectedUnknowns(evalCase, output.facts);

  const g = requirements.perGolden;
  const gm = g.filter((x) => x.mandatory);
  const matched = g.filter((x) => x.verdict === "MATCHED").length;
  const matchedOrPartial = g.filter((x) => x.verdict !== "MISSED").length;
  const mMatched = gm.filter((x) => x.verdict === "MATCHED").length;
  const mMatchedOrPartial = gm.filter((x) => x.verdict !== "MISSED").length;
  const ex = requirements.perExtracted;
  const fp = ex.filter((x) => x.verdict === "FALSE_POSITIVE").length;
  const dup = ex.filter((x) => x.verdict === "DUPLICATE").length;

  const factsCorrect = facts.filter((f) => f.verdict === "CORRECT").length;
  const critical = facts.filter((f) => f.critical);
  const criticalCorrect = critical.filter(
    (f) => f.verdict === "CORRECT",
  ).length;

  // Evidence 指标口径:所有 CONFIRMED_FACT 事实 + 全部 extracted requirement
  const confirmedFacts = output.facts.filter(
    (f) => f.statementKind === "CONFIRMED_FACT",
  );
  const claims: { refs: SourceRefCandidate[] }[] = [
    ...confirmedFacts.map((f) => ({ refs: f.sourceRefs })),
    ...output.requirements.map((r) => ({ refs: r.sourceRefs })),
  ];
  const withRefs = claims.filter((c) => c.refs.length > 0).length;
  const allRefs = claims.flatMap((c) => c.refs);
  const validRefs = allRefs.filter(
    (ref) => checkEvidenceRefs([ref], pages, [])[0]!.valid,
  ).length;
  const unsupported = claims.filter(
    (c) =>
      c.refs.length === 0 ||
      !c.refs.some((ref) => checkEvidenceRefs([ref], pages, [])[0]!.valid),
  ).length;

  const detected = risks.perGolden.filter(
    (r) => r.verdict === "DETECTED",
  ).length;
  const criticalRiskMissed = risks.perGolden.filter(
    (r) => r.severity === "CRITICAL" && r.verdict === "MISSED",
  ).length;

  const pq = clarifications.perQuestion;
  const useful = pq.filter(
    (q) => q.verdict === "NECESSARY" || q.verdict === "USEFUL",
  ).length;
  const already = pq.filter((q) => q.verdict === "ALREADY_ANSWERED").length;
  const hallucinated = pq.filter((q) => q.verdict === "HALLUCINATED").length;
  const necessaryGoldens = clarifications.goldenCoverage.filter(
    (c) => c.necessity === "NECESSARY",
  );
  const necessaryCovered = necessaryGoldens.filter((c) => c.covered).length;

  const metrics: CaseMetrics = {
    goldenRequirements: g.length,
    goldenMandatoryRequirements: gm.length,
    extractedRequirements: ex.length,
    requirementRecallStrict: ratio(matched, g.length),
    requirementRecallLenient: ratio(matchedOrPartial, g.length),
    mandatoryRecallStrict: ratio(mMatched, gm.length),
    mandatoryRecallLenient: ratio(mMatchedOrPartial, gm.length),
    requirementPrecision: ratio(
      ex.filter((x) => x.verdict === "MATCHED" || x.verdict === "PARTIAL")
        .length,
      ex.length,
    ),
    falsePositiveRate: ratio(fp, ex.length),
    duplicateRate: ratio(dup, ex.length),
    goldenFacts: facts.length,
    criticalFacts: critical.length,
    factAccuracy: ratio(factsCorrect, facts.length),
    criticalFactAccuracy: ratio(criticalCorrect, critical.length),
    factsCorrectValueBadEvidence: facts.filter(
      (f) => f.verdict === "CORRECT_VALUE_BAD_EVIDENCE",
    ).length,
    evidenceCoverage: ratio(withRefs, claims.length),
    evidenceAccuracy: ratio(validRefs, allRefs.length),
    unsupportedClaimRate: ratio(unsupported, claims.length),
    goldenRisks: risks.perGolden.length,
    riskRecall: ratio(detected, risks.perGolden.length),
    criticalRiskMissed,
    hallucinatedRiskLines: risks.hallucinatedLines.length,
    systemClarifications: pq.length,
    usefulClarificationRate: ratio(useful, pq.length),
    alreadyAnsweredRate: ratio(already, pq.length),
    hallucinatedClarifications: hallucinated,
    necessaryClarificationCoverage: ratio(
      necessaryCovered,
      necessaryGoldens.length,
    ),
    ambiguitiesOk: ambiguities.filter((a) => a.verdict === "OK").length,
    ambiguitiesTotal: ambiguities.length,
    expectedUnknownViolations: unknownViolations.length,
  };

  return {
    caseId: evalCase.caseId,
    facts,
    requirements,
    risks,
    clarifications,
    ambiguities,
    unknownViolations,
    metrics,
  };
}
