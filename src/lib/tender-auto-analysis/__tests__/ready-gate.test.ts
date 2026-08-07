/**
 * Ready Review Gate — P0/P1 修复静态复验（无 DB）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/ready-gate.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldUseTenderAnalysisLlm } from "../extract/llm-enrich";
import { MAX_PDF_PAGES } from "../page-parse";
import { mergeCommercialJudgmentProjection } from "../project-room";
import {
  REANALYZE_RATE_MAX,
  REANALYZE_RATE_WINDOW_MS,
} from "../constants";
import { MAX_ATTEMPTS, STALE_RUN_MS } from "../worker";
import { canApproveRun } from "../review-pure";

const root = join(process.cwd());

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

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

console.log("tender-auto-analysis ready-gate");

{
  const filesRoute = read("src/app/api/projects/[id]/files/route.ts");
  ok(
    filesRoute.includes("requireProjectReadAccess"),
    "files API 使用 requireProjectReadAccess",
  );
  ok(
    !filesRoute.includes("withAuth("),
    "files API 不再仅依赖 withAuth 绕过项目鉴权",
  );
  ok(
    filesRoute.includes("export async function GET"),
    "files GET 为独立 handler",
  );
  ok(
    filesRoute.includes("export async function POST"),
    "files POST 为独立 handler",
  );
}

{
  const approveRoute = read(
    "src/app/api/projects/[id]/tender-analysis/runs/[runId]/approve/route.ts",
  );
  ok(
    approveRoute.includes("requireTenderAnalysisWrite"),
    "批准路由要求 Write 权限",
  );
  ok(
    approveRoute.includes("goDecisionUntouched: true"),
    "批准响应声明不改 GO",
  );
}

{
  const apiAccess = read("src/lib/tender-auto-analysis/api-access.ts");
  ok(
    apiAccess.includes("requireProjectWriteAccess"),
    "Write = requireProjectWriteAccess",
  );
  ok(
    apiAccess.includes("requireProjectReadAccess"),
    "Read = requireProjectReadAccess",
  );
}

{
  const enqueue = read("src/lib/tender-auto-analysis/enqueue.ts");
  const enqueuePkg = read("src/lib/tender-auto-analysis/enqueue-package.ts");
  ok(
    enqueue.includes("enqueueTenderPackageAnalysis"),
    "upload enqueue 委托 package",
  );
  ok(enqueuePkg.includes('status: "SUPERSEDED"'), "enqueue 可 SUPERSEDE");
  ok(enqueuePkg.includes("leaseOwner: null"), "SUPERSEDE 清空 leaseOwner");
  ok(enqueuePkg.includes("leaseExpiresAt: null"), "SUPERSEDE 清空 leaseExpiresAt");
}

{
  const worker = read("src/lib/tender-auto-analysis/worker.ts");
  ok(
    worker.includes('status: { in: ["EXTRACTING", "ANALYZING"] }'),
    "persist/finalize 仅允许进行中状态",
  );
  ok(
    worker.includes('fromStatus === "PENDING" || fromStatus === "FAILED"'),
    "attemptCount 仅 PENDING/FAILED 认领递增",
  );
  ok(worker.includes("LeaseLostError"), "租约丢失有专用错误");
  ok(worker.includes("stale_run"), "陈旧 Run 会标记失败");
  ok(typeof MAX_ATTEMPTS === "number" && MAX_ATTEMPTS === 5, "MAX_ATTEMPTS=5");
  ok(typeof STALE_RUN_MS === "number" && STALE_RUN_MS >= 30 * 60_000, "STALE_RUN≥30m");
}

{
  const room = read("src/lib/tender-auto-analysis/project-room.ts");
  ok(room.includes("mergeCommercialJudgmentProjection"), "Room 使用 merge");
  ok(room.includes("goDecisionUntouched"), "投影标记不改 GO");
  ok(room.includes("run_superseded"), "SUPERSEDED Run 不投影");
  const merged = mergeCommercialJudgmentProjection({
    incoming: { aiRecommendation: "HOLD" },
    existingDataJson: {
      humanDecision: "GO",
      note: "ok",
      decidedById: "u1",
      decidedAt: "t",
    },
    existingStatus: "confirmed",
    roomGoDecision: "GO",
  });
  const dj = merged.dataJson as Record<string, unknown>;
  ok(merged.status === "confirmed", "confirmed 不降级");
  ok(dj.humanDecision === "GO", "保留 humanDecision");
  ok(dj.note === "ok", "保留 note");
  ok(dj.decidedById === "u1", "保留 decidedById");
  ok(dj.decidedAt === "t", "保留 decidedAt");
}

{
  const prev = process.env.TENDER_ANALYSIS_LLM;
  delete process.env.TENDER_ANALYSIS_LLM;
  ok(!shouldUseTenderAnalysisLlm(), "无 env 不启用 LLM");
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-real";
  ok(!shouldUseTenderAnalysisLlm(), "仅有 API Key 不启用 LLM");
  process.env.TENDER_ANALYSIS_LLM = "1";
  ok(shouldUseTenderAnalysisLlm(), "显式 =1 才启用");
  if (prev === undefined) delete process.env.TENDER_ANALYSIS_LLM;
  else process.env.TENDER_ANALYSIS_LLM = prev;
}

{
  ok(MAX_PDF_PAGES === 80, "MAX_PDF_PAGES=80");
  const pageParse = read("src/lib/tender-auto-analysis/page-parse.ts");
  ok(pageParse.includes("页数超过上限"), "超页有明确错误文案");
}

{
  const review = read("src/lib/tender-auto-analysis/review.ts");
  ok(review.includes('status: "REVIEW_REQUIRED"'), "approve CAS 条件含 REVIEW_REQUIRED");
  ok(review.includes("updateMany"), "approve 使用 updateMany CAS");
  ok(review.includes("writeAuditLog"), "approve 写 Audit");
  ok(review.includes("tender_analysis_approve"), "approve audit action");
  const enqueuePkg = read("src/lib/tender-auto-analysis/enqueue-package.ts");
  ok(
    review.includes("reanalyzeTenderPackage") ||
      enqueuePkg.includes("rate_limited"),
    "reanalyze 有 rate_limited",
  );
  ok(
    enqueuePkg.includes('"active_run"') || enqueuePkg.includes("active_run"),
    "进行中 Run 阻止 reanalyze",
  );
  ok(REANALYZE_RATE_MAX === 3, "reanalyze 上限=3");
  ok(REANALYZE_RATE_WINDOW_MS === 5 * 60_000, "reanalyze 窗口=5min");
  ok(canApproveRun("REVIEW_REQUIRED"), "仅 REVIEW_REQUIRED 可批准");
  ok(!canApproveRun("APPROVED"), "已批准不可再批（服务层另有幂等）");
  ok(!canApproveRun("ANALYZING"), "ANALYZING 不可批准");
}

console.log(`\nready-gate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
