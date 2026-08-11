/**
 * 评估结果输出：JSON（机器可读）+ Markdown（人读）
 */

import type { TenderEvalCase } from "./contract";
import type { CaseEvaluation, Ratio } from "./evaluate";

export type RunMetadata = {
  contractVersion: string;
  runId: string;
  timestamp: string;
  gitSha: string;
  lane: "DETERMINISTIC" | "LLM";
  llmEnabled: boolean;
  model: string | null;
  analysisVersion: string;
  promptVersion: string;
  parseVersion: string;
  matchTokenCoverageThreshold: number;
  nodeVersion: string;
};

export type CaseRunRecord = {
  meta: {
    caseId: string;
    title: string;
    projectType: string;
    provenance: TenderEvalCase["provenance"];
    documentCount: number;
    pageCount: number;
    skipped: false;
  };
  evaluation: CaseEvaluation;
};

export type SkippedCaseRecord = {
  meta: { caseId: string; skipped: true; reason: string };
};

export type RunRecord = {
  metadata: RunMetadata;
  cases: (CaseRunRecord | SkippedCaseRecord)[];
};

export function pct(r: Ratio): string {
  return r === null ? "N/A" : `${(r * 100).toFixed(1)}%`;
}

function verdictList(items: { id: string; verdict: string }[]): string {
  if (items.length === 0) return "（无）";
  return items.map((i) => `\`${i.id}\`(${i.verdict})`).join("、");
}

export function renderCaseMarkdown(rec: CaseRunRecord): string {
  const e = rec.evaluation;
  const m = e.metrics;
  const lines: string[] = [];
  lines.push(`## ${rec.meta.caseId}`);
  lines.push("");
  lines.push(`${rec.meta.title}`);
  lines.push("");
  lines.push(
    `- 来源：${rec.meta.provenance.kind}（${rec.meta.provenance.source}）`,
  );
  lines.push(
    `- Golden 状态：${rec.meta.provenance.goldenAnswerMethod}${rec.meta.provenance.confirmedBy ? `（${rec.meta.provenance.confirmedBy}）` : ""}`,
  );
  lines.push(
    `- 文档 ${rec.meta.documentCount} 份 / ${rec.meta.pageCount} 页`,
  );
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
    `| 幻觉风险行 | ${m.hallucinatedRiskLines} | 与文档无关主题的风险输出 |`,
  );
  lines.push(
    `| Useful Clarification Rate | ${pct(m.usefulClarificationRate)} | 系统提问 ${m.systemClarifications} 条 |`,
  );
  lines.push(
    `| Already Answered Rate | ${pct(m.alreadyAnsweredRate)} | 幻觉提问 ${m.hallucinatedClarifications} 条 |`,
  );
  lines.push(
    `| NECESSARY 澄清覆盖率 | ${pct(m.necessaryClarificationCoverage)} | golden NECESSARY 主题被问到的比例 |`,
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
              `- \`${f.factId}\`${f.critical ? "【critical】" : ""}: ${f.verdict}${f.matchedFactKeys.length ? `（候选: ${f.matchedFactKeys.join(", ")}）` : ""}`,
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

export function renderRunMarkdown(run: RunRecord): string {
  const lines: string[] = [];
  lines.push("# Qingyan Tender Real Evaluation — Run Report");
  lines.push("");
  lines.push(`- Contract: ${run.metadata.contractVersion}`);
  lines.push(`- Run: \`${run.metadata.runId}\`（${run.metadata.timestamp}）`);
  lines.push(`- Git: \`${run.metadata.gitSha}\``);
  lines.push(
    `- Lane: ${run.metadata.lane}（TENDER_ANALYSIS_LLM=${run.metadata.llmEnabled ? "1" : "off"}，model=${run.metadata.model ?? "null"}）`,
  );
  lines.push(
    `- Versions: ${run.metadata.analysisVersion} / ${run.metadata.promptVersion} / ${run.metadata.parseVersion}`,
  );
  lines.push(
    `- 匹配阈值：token coverage ≥ ${run.metadata.matchTokenCoverageThreshold}（MATCHED），锚词判定见 evaluate.ts 头注`,
  );
  lines.push("");
  for (const c of run.cases) {
    if (isSkippedRecord(c)) {
      lines.push(`## ${c.meta.caseId}`);
      lines.push("");
      lines.push(`SKIPPED：${c.meta.reason}`);
      lines.push("");
      continue;
    }
    lines.push(renderCaseMarkdown(c));
  }
  return lines.join("\n");
}

function isSkippedRecord(
  c: CaseRunRecord | SkippedCaseRecord,
): c is SkippedCaseRecord {
  return c.meta.skipped === true;
}
