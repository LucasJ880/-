/**
 * Tender Real Evaluation Benchmark Runner (tender-eval/v1)
 *
 * 用法：
 *   npm run test:tender-eval
 *   npx tsx scripts/tender-eval-run.ts [--out artifacts/tender-eval]
 *
 * 行为：
 * - 逐 case 组装文档集（真实 PDF 缺失 → 该 case SKIPPED，不合成顶替）；
 * - 跑生产确定性管线（Phase E/F/G 纯函数面，TENDER_ANALYSIS_LLM 保持关闭）；
 * - 按 tender-eval/v1 契约评分；
 * - 输出 artifacts/tender-eval/<runId>/results.json + results.md（目录已 gitignore；
 *   基线快照人工拷贝至 docs/tender-eval/ 提交）。
 *
 * 本脚本只读生产代码，不修改任何生产行为。
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ANALYSIS_VERSION,
  PARSE_VERSION,
  PROMPT_VERSION,
} from "@/lib/tender-auto-analysis/constants";
import { shouldUseTenderAnalysisLlm } from "@/lib/tender-auto-analysis/extract/llm-enrich";
import { TENDER_EVAL_CASES } from "@/lib/tender-eval/cases";
import { isCaseSkip, TENDER_EVAL_CONTRACT_VERSION } from "@/lib/tender-eval/contract";
import {
  evaluateCase,
  MATCH_TOKEN_COVERAGE_THRESHOLD,
} from "@/lib/tender-eval/evaluate";
import { runDeterministicPipeline } from "@/lib/tender-eval/run-pipeline";
import {
  renderRunMarkdown,
  type CaseRunRecord,
  type RunRecord,
  type SkippedCaseRecord,
} from "@/lib/tender-eval/report-io";

function gitSha(): string {
  try {
    return execSync("git rev-parse --short=12 HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
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
    lane: "DETERMINISTIC",
    llmEnabled: shouldUseTenderAnalysisLlm(),
    model: null,
    analysisVersion: ANALYSIS_VERSION,
    promptVersion: PROMPT_VERSION,
    parseVersion: PARSE_VERSION,
    matchTokenCoverageThreshold: MATCH_TOKEN_COVERAGE_THRESHOLD,
    nodeVersion: process.version,
  };

  if (metadata.llmEnabled) {
    console.warn(
      "⚠️ TENDER_ANALYSIS_LLM=1 检测到——本 runner 只运行确定性管线；LLM 开关不影响抽取输出（llm-enrich 为 no-op），已记录进 metadata。",
    );
  }

  const cases: (CaseRunRecord | SkippedCaseRecord)[] = [];
  for (const mod of TENDER_EVAL_CASES) {
    const loaded = await mod.load();
    if (isCaseSkip(loaded)) {
      console.log(`⏭️  ${loaded.caseId}: SKIPPED — ${loaded.reason}`);
      cases.push({
        meta: { caseId: loaded.caseId, skipped: true, reason: loaded.reason },
      });
      continue;
    }
    console.log(`▶ ${loaded.caseId}: ${loaded.title}`);
    const pipeline = runDeterministicPipeline(loaded);
    const evaluation = evaluateCase(loaded, pipeline);
    const m = evaluation.metrics;
    console.log(
      `   req recall ${fmt(m.requirementRecallStrict)} (mandatory ${fmt(m.mandatoryRecallStrict)}) | critical facts ${fmt(m.criticalFactAccuracy)} | evidence acc ${fmt(m.evidenceAccuracy)} | risk recall ${fmt(m.riskRecall)} | critical risk missed ${m.criticalRiskMissed}`,
    );
    cases.push({
      meta: {
        caseId: loaded.caseId,
        title: loaded.title,
        projectType: loaded.projectType,
        provenance: loaded.provenance,
        documentCount: loaded.documentSet.length,
        pageCount: loaded.documentSet.reduce((a, d) => a + d.pages.length, 0),
        skipped: false,
      },
      evaluation,
    });
  }

  const run: RunRecord = { metadata, cases };
  const outDir = join(process.cwd(), outBase, runId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
  writeFileSync(join(outDir, "results.md"), renderRunMarkdown(run));
  console.log(`\n✅ 结果已写入 ${outBase}/${runId}/results.{json,md}`);
}

function fmt(r: number | null): string {
  return r === null ? "N/A" : `${(r * 100).toFixed(1)}%`;
}

main().catch((err) => {
  console.error("tender-eval-run failed:", err);
  process.exit(1);
});
