/**
 * Human Draft Review 修复回归：批准幂等、LLM 默认关闭、Room GO 合并、页数上限
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/review-hardening.test.ts
 */

import { shouldUseTenderAnalysisLlm } from "../extract/llm-enrich";
import { MAX_PDF_PAGES } from "../page-parse";
import { mergeCommercialJudgmentProjection } from "../project-room";
import {
  REANALYZE_RATE_MAX,
  REANALYZE_RATE_WINDOW_MS,
} from "../constants";
import { SUPERSEDABLE_RUN_STATUSES } from "../enqueue-helpers";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("tender-auto-analysis review-hardening");

{
  const prev = process.env.TENDER_ANALYSIS_LLM;
  delete process.env.TENDER_ANALYSIS_LLM;
  ok(!shouldUseTenderAnalysisLlm(), "默认关闭 LLM（无 env）");
  process.env.TENDER_ANALYSIS_LLM = "0";
  ok(!shouldUseTenderAnalysisLlm(), "TENDER_ANALYSIS_LLM=0 关闭");
  process.env.TENDER_ANALYSIS_LLM = "1";
  ok(shouldUseTenderAnalysisLlm(), "仅 =1 时开启");
  if (prev === undefined) delete process.env.TENDER_ANALYSIS_LLM;
  else process.env.TENDER_ANALYSIS_LLM = prev;
}

{
  ok(MAX_PDF_PAGES >= 43, "页数上限覆盖 RCMP 43 页");
  ok(MAX_PDF_PAGES <= 120, "页数上限不过大");
}

{
  const noHuman = mergeCommercialJudgmentProjection({
    incoming: { aiRecommendation: "HOLD_PENDING_CLARIFICATION", runId: "r2" },
    existingDataJson: { topRisks: [] },
    existingStatus: "investigating",
    roomGoDecision: null,
  });
  ok(noHuman.status === "investigating", "无人工 GO 时保持 investigating");
  ok(
    (noHuman.dataJson as { aiRecommendation?: string }).aiRecommendation ===
      "HOLD_PENDING_CLARIFICATION",
    "无人工 GO 时写入 AI 建议",
  );

  const withHuman = mergeCommercialJudgmentProjection({
    incoming: {
      aiRecommendation: "HOLD_PENDING_CLARIFICATION",
      stanceZh: "审慎",
      runId: "r3",
    },
    existingDataJson: {
      humanDecision: "GO",
      note: "已定",
      decidedById: "u1",
      decidedAt: "2026-01-01T00:00:00.000Z",
    },
    existingStatus: "confirmed",
    roomGoDecision: "GO",
  });
  ok(withHuman.status === "confirmed", "有人工 GO 时不降级 confirmed");
  const dj = withHuman.dataJson as {
    humanDecision?: string;
    note?: string;
    aiRecommendation?: string;
    goDecisionUntouched?: boolean;
  };
  ok(dj.humanDecision === "GO", "保留 humanDecision");
  ok(dj.note === "已定", "保留 note");
  ok(dj.aiRecommendation === "HOLD_PENDING_CLARIFICATION", "仍写入 AI 建议字段");
  ok(dj.goDecisionUntouched === true, "标记 goDecisionUntouched");

  const fromRoomColumn = mergeCommercialJudgmentProjection({
    incoming: { aiRecommendation: "HOLD" },
    existingDataJson: {},
    existingStatus: "investigating",
    roomGoDecision: "NO_GO",
  });
  ok(
    (fromRoomColumn.dataJson as { humanDecision?: string }).humanDecision ===
      "NO_GO",
    "从 room.goDecision 回填 humanDecision",
  );
}

{
  ok(REANALYZE_RATE_MAX >= 1, "reanalyze 有速率上限");
  ok(REANALYZE_RATE_WINDOW_MS >= 60_000, "reanalyze 窗口至少 1 分钟");
  ok(
    (SUPERSEDABLE_RUN_STATUSES as readonly string[]).includes("EXTRACTING"),
    "EXTRACTING 可被 SUPERSEDE",
  );
  ok(
    !(SUPERSEDABLE_RUN_STATUSES as readonly string[]).includes("APPROVED"),
    "APPROVED 不可被 SUPERSEDE",
  );
}

console.log(`\nreview-hardening: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
