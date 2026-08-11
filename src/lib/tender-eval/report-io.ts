/**
 * 评估结果输出：JSON（机器可读）+ Markdown（人读）
 *
 * 自 V2 起支持多 lane（V1 deterministic / V2 LLM analyzer）：
 * 每个 case × lane 一条记录；同 case 双 lane 时输出 side-by-side 对照。
 */

import type { TenderEvalCase } from "./contract";
import type { CaseEvaluation, Ratio } from "./evaluate";

export type EvalLane = "V1" | "V2";

export type LaneAnalyzerMeta = {
  analyzerVersion: string;
  models: string[];
  promptUsages: { promptName: string; promptVersion: string; calls: number }[];
  llmCalls: number;
  llmFailures: number;
  windows: number;
  wallTimeMs: number;
  inputChars: number;
  outputChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  rejectedCandidates: { reasonCode: string; count: number }[];
  unknownSlots: string[];
  conflictCount: number;
  resolvedAmbiguityCount: number;
};

export type RunMetadata = {
  contractVersion: string;
  runId: string;
  timestamp: string;
  gitSha: string;
  lanes: EvalLane[];
  llmEnabled: boolean;
  analysisVersion: string;
  promptVersion: string;
  parseVersion: string;
  matchTokenCoverageThreshold: number;
  nodeVersion: string;
};

export type CaseRunRecord = {
  meta: {
    caseId: string;
    lane: EvalLane;
    title: string;
    projectType: string;
    provenance: TenderEvalCase["provenance"];
    documentCount: number;
    pageCount: number;
    skipped: false;
    /** V2 lane 时的 analyzer 运行信息 */
    analyzer: LaneAnalyzerMeta | null;
  };
  evaluation: CaseEvaluation;
};

export type SkippedCaseRecord = {
  meta: {
    caseId: string;
    lane: EvalLane;
    skipped: true;
    reason: string;
  };
};

export type RunRecord = {
  metadata: RunMetadata;
  cases: (CaseRunRecord | SkippedCaseRecord)[];
};

export function pct(r: Ratio): string {
  return r === null ? "N/A" : `${(r * 100).toFixed(1)}%`;
}

export function isSkippedRecord(
  c: CaseRunRecord | SkippedCaseRecord,
): c is SkippedCaseRecord {
  return c.meta.skipped === true;
}

function verdictList(items: { id: string; verdict: string }[]): string {
  if (items.length === 0) return "（无）";
  return items.map((i) => `\`${i.id}\`(${i.verdict})`).join("、");
}

export function renderCaseMarkdown(rec: CaseRunRecord): string {
  const e = rec.evaluation;
  const m = e.metrics;
  const lines: string[] = [];
  lines.push(`## ${rec.meta.caseId} — lane ${rec.meta.lane}`);
  lines.push("");
  lines.push(`${rec.meta.title}`);
  lines.push("");
  lines.push(
    `- 来源：${rec.meta.provenance.kind}（${rec.meta.provenance.source}）`,
  );
  lines.push(
    `- Golden 状态：${rec.meta.provenance.goldenAnswerMethod}${rec.meta.provenance.confirmedBy ? `（${rec.meta.provenance.confirmedBy}）` : ""}`,
  );
  lines.push(`- 文档 ${rec.meta.documentCount} 份 / ${rec.meta.pageCount} 页`);
  if (rec.meta.analyzer) {
    const a = rec.meta.analyzer;
    lines.push(
      `- Analyzer：${a.analyzerVersion}｜models=${a.models.join(",") || "-"}｜LLM calls=${a.llmCalls}（失败 ${a.llmFailures}）｜windows=${a.windows}｜${(a.wallTimeMs / 1000).toFixed(1)}s｜tokens=${a.promptTokens ?? "?"}/${a.completionTokens ?? "?"}`,
    );
    lines.push(
      `- Prompts：${a.promptUsages.map((p) => `${p.promptVersion}×${p.calls}`).join("，") || "-"}｜UNKNOWN 槽位：${a.unknownSlots.join(",") || "无"}｜冲突 ${a.conflictCount}｜语料已解决歧义 ${a.resolvedAmbiguityCount}`,
    );
  }
  lines.push("");
  lines.push("### Scorecard");
  lines.push("");
  lines.push("| 指标 | 值 | 说明 |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| Requirement Recall (strict / lenient) | ${pct(m.requirementRecallStrict)} / ${pct(m.requirementRecallLenient)} | golden ${m.goldenRequirements} 条 |`,
  );
  lines.push(
    `| Mandatory Recall (strict / lenient) | ${pct(m.mandatoryRecallStrict)} / ${pct(m.mandatoryRecallLenient)} | mandatory golden ${m.goldenMandatoryRequirements} 条 |`,
  );
  lines.push(
    `| Requirement Precision | ${pct(m.requirementPrecision)} | 系统输出 ${m.extractedRequirements} 条 |`,
  );
  lines.push(
    `| False Positive Rate | ${pct(m.falsePositiveRate)} | Duplicate Rate ${pct(m.duplicateRate)} |`,
  );
  lines.push(
    `| Critical Fact Accuracy | ${pct(m.criticalFactAccuracy)} | 关键事实 ${m.criticalFacts} 项；全事实 ${pct(m.factAccuracy)}（${m.goldenFacts} 项） |`,
  );
  lines.push(
    `| 值对证据错（计失败） | ${m.factsCorrectValueBadEvidence} 项 | CORRECT_VALUE_BAD_EVIDENCE |`,
  );
  lines.push(
    `| Evidence Coverage / Accuracy | ${pct(m.evidenceCoverage)} / ${pct(m.evidenceAccuracy)} | Unsupported Claim Rate ${pct(m.unsupportedClaimRate)} |`,
  );
  lines.push(
    `| Risk Recall | ${pct(m.riskRecall)} | golden ${m.goldenRisks} 条；CRITICAL_RISK_MISSED = ${m.criticalRiskMissed} |`,
  );
  lines.push(
    `| Useful Clarification Rate | ${pct(m.usefulClarificationRate)} | 系统提问 ${m.systemClarifications} 条；幻觉 ${m.hallucinatedClarifications} 条 |`,
  );
  lines.push(
    `| Already Answered Rate | ${pct(m.alreadyAnsweredRate)} | NECESSARY 覆盖率 ${pct(m.necessaryClarificationCoverage)} |`,
  );
  lines.push(
    `| CROSS_DOMAIN_LEAK | **${m.crossDomainLeakTotal}** | facts ${m.crossDomainLeakFacts} + reqs ${m.crossDomainLeakRequirements} + 风险行 ${m.hallucinatedRiskLines} + 澄清 ${m.hallucinatedClarifications} |`,
  );
  lines.push(
    `| CROSS_DOMAIN_LEAK | **${m.crossDomainLeakTotal}** | facts ${m.crossDomainLeakFacts} + reqs ${m.crossDomainLeakRequirements} + 风险行 ${m.hallucinatedRiskLines} + 澄清 ${m.hallucinatedClarifications} |`,
  );
  lines.push(
    `| 歧义处理 | ${m.ambiguitiesOk}/${m.ambiguitiesTotal} OK | expectedUnknown 违规 ${m.expectedUnknownViolations} |`,
  );
  lines.push("");

  const missedReq = e.requirements.perGolden.filter(
    (g) => g.verdict === "MISSED",
  );
  lines.push(
    `### MISSED Requirements（${missedReq.length}/${m.goldenRequirements}）`,
  );
  lines.push("");
  lines.push(
    missedReq.length === 0
      ? "（无）"
      : missedReq
          .map(
            (g) =>
              `- \`${g.goldenId}\`${g.mandatory ? "【mandatory】" : ""}（${g.importance}）`,
          )
          .join("\n"),
  );
  lines.push("");

  const partial = e.requirements.perGolden.filter((g) => g.verdict === "PARTIAL");
  if (partial.length > 0) {
    lines.push(`### PARTIAL Requirements（${partial.length}）`);
    lines.push("");
    lines.push(
      partial
        .map(
          (g) =>
            `- \`${g.goldenId}\` ← \`${g.primaryCode}\`（coverage ${g.coverage}）`,
        )
        .join("\n"),
    );
    lines.push("");
  }

  const fps = e.requirements.perExtracted.filter(
    (x) => x.verdict === "FALSE_POSITIVE",
  );
  lines.push(`### FALSE_POSITIVE 输出（${fps.length}）`);
  lines.push("");
  lines.push(
    fps.length === 0
      ? "（无）"
      : fps.map((x) => `- \`${x.requirementCode}\``).join("\n"),
  );
  lines.push("");

  const badFacts = e.facts.filter((f) => f.verdict !== "CORRECT");
  lines.push(`### 未达标事实（${badFacts.length}/${m.goldenFacts}）`);
  lines.push("");
  lines.push(
    badFacts.length === 0
      ? "（无）"
      : badFacts
          .map(
            (f) =>
              `- \`${f.factId}\`${f.critical ? "【critical】" : ""}: ${f.verdict}${f.matchedFactKeys.length ? `（候选: ${f.matchedFactKeys.slice(0, 4).join(", ")}）` : ""}`,
          )
          .join("\n"),
  );
  lines.push("");

  lines.push("### 风险判定");
  lines.push("");
  lines.push(
    verdictList(
      e.risks.perGolden.map((r) => ({
        id: `${r.riskId}[${r.severity}]`,
        verdict: r.verdict,
      })),
    ),
  );
  if (e.risks.hallucinatedLines.length > 0) {
    lines.push("");
    lines.push(
      `幻觉风险行：${e.risks.hallucinatedLines.map((l) => `「${l.slice(0, 60)}…」`).join("；")}`,
    );
  }
  lines.push("");

  lines.push("### 澄清问题判定");
  lines.push("");
  if (e.clarifications.perQuestion.length === 0) {
    lines.push("（系统未生成澄清问题）");
  }
  for (const q of e.clarifications.perQuestion) {
    lines.push(
      `- [${q.verdict}] ${q.question.slice(0, 90)}${q.question.length > 90 ? "…" : ""}`,
    );
  }
  lines.push("");
  const uncoveredNecessary = e.clarifications.goldenCoverage.filter(
    (c) => c.necessity === "NECESSARY" && !c.covered,
  );
  if (uncoveredNecessary.length > 0) {
    lines.push(
      `未被问到的 NECESSARY 主题：${uncoveredNecessary.map((c) => `\`${c.clarId}\``).join("、")}`,
    );
    lines.push("");
  }

  if (e.crossDomainLeaks.length > 0) {
    lines.push("### 跨域泄漏明细");
    lines.push("");
    for (const l of e.crossDomainLeaks) {
      lines.push(`- [${l.kind}] ${l.excerpt}`);
    }
    lines.push("");
  }

  if (e.unknownViolations.length > 0) {
    lines.push("### expectedUnknown 违规");
    lines.push("");
    for (const v of e.unknownViolations) {
      lines.push(`- ${v.field} ← \`${v.factKey}\`：${v.excerpt}`);
    }
    lines.push("");
  }

  lines.push("### 歧义处理");
  lines.push("");
  lines.push(
    verdictList(
      e.ambiguities.map((a) => ({
        id: `${a.ambiguityId}(${a.expected})`,
        verdict: a.verdict,
      })),
    ),
  );
  lines.push("");
  return lines.join("\n");
}

const COMPARE_ROWS: {
  label: string;
  get: (m: CaseEvaluation["metrics"]) => string;
}[] = [
  { label: "Mandatory Recall (strict)", get: (m) => pct(m.mandatoryRecallStrict) },
  { label: "Mandatory Recall (lenient)", get: (m) => pct(m.mandatoryRecallLenient) },
  { label: "Requirement Recall (strict)", get: (m) => pct(m.requirementRecallStrict) },
  { label: "Requirement Precision", get: (m) => pct(m.requirementPrecision) },
  { label: "False Positive Rate", get: (m) => pct(m.falsePositiveRate) },
  { label: "Critical Fact Accuracy", get: (m) => pct(m.criticalFactAccuracy) },
  { label: "Evidence Accuracy", get: (m) => pct(m.evidenceAccuracy) },
  { label: "Unsupported Claim Rate", get: (m) => pct(m.unsupportedClaimRate) },
  { label: "Risk Recall", get: (m) => pct(m.riskRecall) },
  { label: "CRITICAL_RISK_MISSED", get: (m) => String(m.criticalRiskMissed) },
  {
    label: "Clarification Hallucinations",
    get: (m) => String(m.hallucinatedClarifications),
  },
  { label: "CROSS_DOMAIN_LEAK", get: (m) => String(m.crossDomainLeakTotal) },
  {
    label: "expectedUnknown 违规",
    get: (m) => String(m.expectedUnknownViolations),
  },
];

export function renderComparison(
  caseId: string,
  v1: CaseRunRecord,
  v2: CaseRunRecord,
): string {
  const lines: string[] = [];
  lines.push(`## ${caseId} — V1 vs V2 对照`);
  lines.push("");
  lines.push("| 指标 | V1 | V2 |");
  lines.push("| --- | --- | --- |");
  for (const row of COMPARE_ROWS) {
    lines.push(
      `| ${row.label} | ${row.get(v1.evaluation.metrics)} | ${row.get(v2.evaluation.metrics)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderRunMarkdown(run: RunRecord): string {
  const lines: string[] = [];
  lines.push("# Qingyan Tender Real Evaluation — Run Report");
  lines.push("");
  lines.push(`- Contract: ${run.metadata.contractVersion}`);
  lines.push(`- Run: \`${run.metadata.runId}\`（${run.metadata.timestamp}）`);
  lines.push(`- Git: \`${run.metadata.gitSha}\``);
  lines.push(`- Lanes: ${run.metadata.lanes.join(" + ")}`);
  lines.push(
    `- V1 versions: ${run.metadata.analysisVersion} / ${run.metadata.promptVersion} / ${run.metadata.parseVersion}`,
  );
  lines.push(
    `- 匹配阈值：token coverage ≥ ${run.metadata.matchTokenCoverageThreshold}（MATCHED），锚词判定见 evaluate.ts 头注`,
  );
  lines.push("");

  // side-by-side 优先呈现
  const byCase = new Map<string, CaseRunRecord[]>();
  for (const c of run.cases) {
    if (isSkippedRecord(c)) continue;
    const list = byCase.get(c.meta.caseId) ?? [];
    list.push(c);
    byCase.set(c.meta.caseId, list);
  }
  for (const [caseId, records] of byCase) {
    const v1 = records.find((r) => r.meta.lane === "V1");
    const v2 = records.find((r) => r.meta.lane === "V2");
    if (v1 && v2) lines.push(renderComparison(caseId, v1, v2));
  }

  for (const c of run.cases) {
    if (isSkippedRecord(c)) {
      lines.push(`## ${c.meta.caseId} — lane ${c.meta.lane}`);
      lines.push("");
      lines.push(`SKIPPED：${c.meta.reason}`);
      lines.push("");
      continue;
    }
    lines.push(renderCaseMarkdown(c));
  }
  return lines.join("\n");
}
