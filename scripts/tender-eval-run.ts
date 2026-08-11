/**
 * Tender Real Evaluation Benchmark Runner (tender-eval/v1)
 *
 * 用法：
 *   npm run test:tender-eval                       # 默认 V1 lane（确定性）
 *   npx tsx scripts/tender-eval-run.ts --lane=v1   # V1 生产确定性管线
 *   npx tsx scripts/tender-eval-run.ts --lane=v2   # V2 LLM Analyzer（需 OPENAI_API_KEY）
 *   npx tsx scripts/tender-eval-run.ts --lane=both # V1 + V2 side-by-side
 *
 * 行为：
 * - 逐 case 组装文档集（真实 PDF 缺失 → 该 case SKIPPED，不合成顶替）；
 * - V1 lane：生产确定性管线（Phase E/F/G 纯函数面）；
 * - V2 lane：tender-understanding/v2 真实 LLM 分析（Unified Model Runtime；
 *   无 API key → SKIPPED（BLOCKED_BY_ENV），禁止 mock 冒充真实 lane）；
 * - 按 tender-eval/v1 契约评分；输出 artifacts/tender-eval/<runId>/results.{json,md}。
 *
 * 本脚本只读生产代码，不修改任何生产行为。
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isAIConfigured } from "@/lib/ai/config";
import { getAiStats } from "@/lib/ai/monitor";
import {
  ANALYSIS_VERSION,
  PARSE_VERSION,
  PROMPT_VERSION,
} from "@/lib/tender-auto-analysis/constants";
import { shouldUseTenderAnalysisLlm } from "@/lib/tender-auto-analysis/extract/llm-enrich";
import { TENDER_EVAL_CASES } from "@/lib/tender-eval/cases";
import {
  isCaseSkip,
  TENDER_EVAL_CONTRACT_VERSION,
  type TenderEvalCase,
} from "@/lib/tender-eval/contract";
import {
  evaluateCase,
  MATCH_TOKEN_COVERAGE_THRESHOLD,
} from "@/lib/tender-eval/evaluate";
import {
  renderRunMarkdown,
  type CaseRunRecord,
  type EvalLane,
  type RunRecord,
  type SkippedCaseRecord,
} from "@/lib/tender-eval/report-io";
import { runDeterministicPipeline } from "@/lib/tender-eval/run-pipeline";
import { runV2Lane } from "@/lib/tender-eval/v2-adapter";

function gitSha(): string {
  try {
    return execSync("git rev-parse --short=12 HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function parseLaneArg(): EvalLane[] {
  const arg = process.argv.find((a) => a.startsWith("--lane="));
  const value = arg ? arg.slice("--lane=".length).toLowerCase() : "v1";
  if (value === "v1") return ["V1"];
  if (value === "v2") return ["V2"];
  if (value === "both") return ["V1", "V2"];
  console.error(`未知 lane: ${value}（可选 v1 / v2 / both）`);
  process.exit(1);
}

function fmt(r: number | null): string {
  return r === null ? "N/A" : `${(r * 100).toFixed(1)}%`;
}

function caseMeta(
  evalCase: TenderEvalCase,
  lane: EvalLane,
): Omit<CaseRunRecord["meta"], "analyzer"> {
  return {
    caseId: evalCase.caseId,
    lane,
    title: evalCase.title,
    projectType: evalCase.projectType,
    provenance: evalCase.provenance,
    documentCount: evalCase.documentSet.length,
    pageCount: evalCase.documentSet.reduce((a, d) => a + d.pages.length, 0),
    skipped: false,
  };
}

async function main(): Promise<void> {
  const lanes = parseLaneArg();
  const outBaseArg = process.argv.indexOf("--out");
  const outBase =
    outBaseArg >= 0 && process.argv[outBaseArg + 1]
      ? process.argv[outBaseArg + 1]!
      : "artifacts/tender-eval";

  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "Z")
    .replace("T", "-");
  const sha = gitSha();
  const runId = `${stamp}-${sha.slice(0, 7)}`;

  const metadata: RunRecord["metadata"] = {
    contractVersion: TENDER_EVAL_CONTRACT_VERSION,
    runId,
    timestamp: now.toISOString(),
    gitSha: sha,
    lanes,
    llmEnabled: shouldUseTenderAnalysisLlm(),
    analysisVersion: ANALYSIS_VERSION,
    promptVersion: PROMPT_VERSION,
    parseVersion: PARSE_VERSION,
    matchTokenCoverageThreshold: MATCH_TOKEN_COVERAGE_THRESHOLD,
    nodeVersion: process.version,
  };

  const v2Available = isAIConfigured();
  if (lanes.includes("V2") && !v2Available) {
    console.warn(
      "⚠️ V2 lane 需要 OPENAI_API_KEY（Unified Model Runtime）；未配置 → V2 记 SKIPPED（BLOCKED_BY_ENV），不使用 mock 冒充。",
    );
  }

  const cases: (CaseRunRecord | SkippedCaseRecord)[] = [];
  const pendingRawResults: { file: string; json: string }[] = [];
  for (const mod of TENDER_EVAL_CASES) {
    const loaded = await mod.load();
    if (isCaseSkip(loaded)) {
      for (const lane of lanes) {
        console.log(`⏭️  ${loaded.caseId} [${lane}]: SKIPPED — ${loaded.reason}`);
        cases.push({
          meta: { caseId: loaded.caseId, lane, skipped: true, reason: loaded.reason },
        });
      }
      continue;
    }

    for (const lane of lanes) {
      if (lane === "V1") {
        console.log(`▶ ${loaded.caseId} [V1]: ${loaded.title}`);
        const pipeline = runDeterministicPipeline(loaded);
        const evaluation = evaluateCase(loaded, pipeline);
        logMetrics(evaluation);
        cases.push({
          meta: { ...caseMeta(loaded, "V1"), analyzer: null },
          evaluation,
        });
        continue;
      }

      if (!v2Available) {
        cases.push({
          meta: {
            caseId: loaded.caseId,
            lane: "V2",
            skipped: true,
            reason: "BLOCKED_BY_ENV: OPENAI_API_KEY 未配置（真实 LLM lane 不得 mock）",
          },
        });
        continue;
      }

      console.log(`▶ ${loaded.caseId} [V2]: ${loaded.title}（真实 LLM）`);
      const statsBefore = getAiStats(24 * 60);
      const v2 = await runV2Lane(loaded);
      const statsAfter = getAiStats(24 * 60);
      const evaluation = evaluateCase(loaded, v2.output);
      // V2 原始结果落盘（诊断用；gitignored artifacts）
      pendingRawResults.push({
        file: `v2-result-${loaded.caseId}.json`,
        json: JSON.stringify(v2.result, null, 2),
      });
      logMetrics(evaluation);
      cases.push({
        meta: {
          ...caseMeta(loaded, "V2"),
          analyzer: {
            analyzerVersion: v2.analyzerMeta.analyzerVersion,
            models: v2.analyzerMeta.models,
            promptUsages: v2.analyzerMeta.promptUsages,
            llmCalls: v2.analyzerMeta.llmCalls,
            llmFailures: v2.analyzerMeta.llmFailures,
            windows: v2.analyzerMeta.windows,
            wallTimeMs: v2.analyzerMeta.wallTimeMs,
            inputChars: v2.analyzerMeta.inputChars,
            outputChars: v2.analyzerMeta.outputChars,
            promptTokens:
              statsAfter.totalPromptTokens - statsBefore.totalPromptTokens || null,
            completionTokens:
              statsAfter.totalCompletionTokens -
                statsBefore.totalCompletionTokens || null,
            rejectedCandidates: v2.analyzerMeta.rejectedCandidates,
            unknownSlots: v2.analyzerMeta.unknownSlots,
            conflictCount: v2.analyzerMeta.conflictCount,
            resolvedAmbiguityCount: v2.analyzerMeta.resolvedAmbiguityCount,
          },
        },
        evaluation,
      });
    }
  }

  const run: RunRecord = { metadata, cases };
  const outDir = join(process.cwd(), outBase, runId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
  writeFileSync(join(outDir, "results.md"), renderRunMarkdown(run));
  for (const raw of pendingRawResults) {
    writeFileSync(join(outDir, raw.file), raw.json);
  }
  console.log(`\n✅ 结果已写入 ${outBase}/${runId}/results.{json,md}`);
}

function logMetrics(evaluation: ReturnType<typeof evaluateCase>): void {
  const m = evaluation.metrics;
  console.log(
    `   req recall ${fmt(m.requirementRecallStrict)} (mandatory ${fmt(m.mandatoryRecallStrict)}) | critical facts ${fmt(m.criticalFactAccuracy)} | evidence acc ${fmt(m.evidenceAccuracy)} | risk recall ${fmt(m.riskRecall)} | critical risk missed ${m.criticalRiskMissed} | leak ${m.crossDomainLeakTotal}`,
  );
}

main().catch((err) => {
  console.error("tender-eval-run failed:", err);
  process.exit(1);
});
