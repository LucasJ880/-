/**
 * 审核状态机纯函数
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/review-helpers.test.ts
 */

import { canApproveRun } from "../review-pure";
import { canTransition } from "../status";
import {
  tenderAnalysisProgressLabel,
  statementKindLabel,
  runStatusLabel,
} from "../display-labels";

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

console.log("tender-auto-analysis review-helpers");

ok(canApproveRun("REVIEW_REQUIRED"), "REVIEW_REQUIRED 可批准");
ok(!canApproveRun("PENDING"), "PENDING 不可批准");
ok(!canApproveRun("ANALYZING"), "ANALYZING 不可批准");
ok(!canApproveRun("APPROVED"), "APPROVED 不可再批准");
ok(!canApproveRun("FAILED"), "FAILED 不可批准");
ok(
  canTransition("REVIEW_REQUIRED", "APPROVED"),
  "状态机允许 REVIEW_REQUIRED → APPROVED",
);
ok(
  !canTransition("REVIEW_REQUIRED", "PENDING"),
  "批准不可回退 PENDING",
);

ok(statementKindLabel("CONFIRMED_FACT") === "文件事实", "文件事实标签");
ok(
  statementKindLabel("DOCUMENT_INTERPRETATION") === "文件解释",
  "文件解释标签",
);
ok(statementKindLabel("AI_INFERENCE") === "AI推断", "AI推断标签");
ok(statementKindLabel("RECOMMENDATION") === "建议", "建议标签");

ok(runStatusLabel("REVIEW_REQUIRED") === "等待审核", "等待审核中文");
ok(runStatusLabel("APPROVED") === "已批准", "已批准中文");
ok(runStatusLabel("FAILED") === "分析失败", "分析失败中文");

ok(
  tenderAnalysisProgressLabel({ status: "PENDING" }) === "等待分析",
  "进度：等待分析",
);
ok(
  tenderAnalysisProgressLabel({ status: "EXTRACTING" }) === "正在提取",
  "进度：正在提取",
);
ok(
  tenderAnalysisProgressLabel({
    status: "EXTRACTING",
    pagesDone: 3,
    pagesTotal: 10,
  }) === "已解析 3/10 页",
  "进度：已解析 x/y 页",
);
ok(
  tenderAnalysisProgressLabel({ status: "ANALYZING" }) === "正在分析",
  "进度：正在分析",
);
ok(
  tenderAnalysisProgressLabel({ status: "REVIEW_REQUIRED" }) === "等待审核",
  "进度：等待审核",
);

console.log(`\nreview-helpers: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
