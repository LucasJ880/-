/**
 * Tender Workbench 状态投影（纯函数）
 * 运行：npx tsx src/lib/tender/__tests__/workbench-state.test.ts
 * 覆盖任务书 UX-01..07 的纯逻辑。
 */

import {
  analysisPhaseFromRunStatus,
  deriveTenderWorkbenchState,
} from "../workbench-state";

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

console.log("tender workbench-state");

// run.status → phase
{
  ok(analysisPhaseFromRunStatus(null) === "none", "null → none");
  ok(analysisPhaseFromRunStatus("PENDING") === "processing", "PENDING → processing");
  ok(analysisPhaseFromRunStatus("ANALYZING") === "processing", "ANALYZING → processing");
  ok(analysisPhaseFromRunStatus("REVIEW_REQUIRED") === "review_required", "REVIEW_REQUIRED");
  ok(analysisPhaseFromRunStatus("APPROVED") === "approved", "APPROVED");
  ok(analysisPhaseFromRunStatus("FAILED") === "failed", "FAILED");
}

// UX-01: 0 files
{
  const s = deriveTenderWorkbenchState({ documentCount: 0, analysisPhase: "none" });
  ok(s.completedSteps === 0, "UX-01: 0/3");
  ok(s.steps[0].state === "pending" && s.steps[0].cta?.label === "去上传", "UX-01: step1 pending + 去上传");
  ok(s.primaryAction?.label === "上传招标文件" && s.primaryAction.target === "files", "UX-01: primary=上传招标文件");
  ok(s.recommendation.title === "上传招标文件", "UX-01: recommendation=上传");
  ok(s.fileEntryLabel === "上传招标文件", "UX-01: file entry=上传招标文件");
}

// UX-02: N files + parsing active
{
  const s = deriveTenderWorkbenchState({ documentCount: 10, analysisPhase: "none", parsingActive: true });
  ok(s.completedSteps === 1, "UX-02: 1/3");
  ok(s.steps[0].state === "done" && s.steps[0].cta === null, "UX-02: step1 done, NO upload CTA");
  ok(s.steps[0].caption === "已上传 10 个文件", "UX-02: step1 caption 已上传 10");
  ok(s.steps[1].state === "processing" && s.steps[1].caption === "文件解析中" && s.steps[1].cta === null, "UX-02: step2 文件解析中(阶段A), no CTA");
  ok(s.primaryAction === null, "UX-02: no primary CTA (AI working)");
  ok(s.recommendation.title === "等待文件解析完成", "UX-02: recommendation=等待解析");
  ok(!s.recommendation.body.includes("缺少源文件") && !s.recommendation.title.includes("缺少源文件"), "UX-02: NO 缺少源文件");
  ok(s.fileEntryLabel === "项目文件 · 10", "UX-02: file entry=项目文件 · 10");
}

// UX-02b: N files + run processing (no parse flag)
{
  const s = deriveTenderWorkbenchState({ documentCount: 7, analysisPhase: "processing" });
  ok(s.completedSteps === 1 && s.steps[1].caption === "AI 正在理解整个招标项目" && s.primaryAction === null, "UX-02b: run processing → 阶段B整包理解 / 1/3 / no CTA");
}

// UX-03: REVIEW_REQUIRED
{
  const s = deriveTenderWorkbenchState({ documentCount: 10, analysisPhase: "review_required" });
  ok(s.completedSteps === 1, "UX-03: 1/3");
  ok(s.steps[1].state === "active" && s.steps[1].cta?.label === "查看并确认" && s.steps[1].cta.target === "requirements", "UX-03: step2 待确认 + 查看并确认→requirements");
  ok(s.primaryAction?.label === "查看并确认招标要求", "UX-03: primary=查看并确认");
  ok(s.recommendation.title === "确认关键招标要求", "UX-03: recommendation=确认要求");
}

// UX-04: requirements confirmed (approved)
{
  const s = deriveTenderWorkbenchState({ documentCount: 10, analysisPhase: "approved" });
  ok(s.completedSteps === 2, "UX-04: 2/3");
  ok(s.steps[1].state === "done" && s.steps[1].caption === "招标要求已确认", "UX-04: step2 done");
  ok(s.steps[2].state === "active" && s.steps[2].cta?.label === "准备标书与报价" && s.steps[2].cta.target === "bid", "UX-04: step3 可开始 + 准备标书→bid");
  ok(s.primaryAction?.label === "准备标书与报价", "UX-04: primary=准备标书");
}

// UX-05: add files later — step1 stays done; re-analysis active → step2 分析中
{
  const s = deriveTenderWorkbenchState({ documentCount: 12, analysisPhase: "processing", parsingActive: true });
  ok(s.steps[0].state === "done" && s.completedSteps === 1, "UX-05: step1 remains done during re-analysis");
  ok(s.primaryAction === null && !s.recommendation.title.includes("缺少源文件"), "UX-05: no 缺少源文件 on re-analysis");
}

// UX-06 (logic): derive is pure from inputs → refresh reproduces same state (no reset to 0/3 when docs>0)
{
  const s = deriveTenderWorkbenchState({ documentCount: 5, analysisPhase: "processing" });
  ok(s.completedSteps === 1, "UX-06: docs>0 never 0/3");
}

// FAILED
{
  const s = deriveTenderWorkbenchState({ documentCount: 5, analysisPhase: "failed" });
  ok(s.steps[1].caption === "分析失败，结果可能过期" && s.primaryAction?.target === "requirements", "FAILED: step2 失败 + CTA→requirements");
}

// §11: exactly one primary CTA per state (never multiple)
{
  const states = [
    deriveTenderWorkbenchState({ documentCount: 0, analysisPhase: "none" }),
    deriveTenderWorkbenchState({ documentCount: 3, analysisPhase: "processing" }),
    deriveTenderWorkbenchState({ documentCount: 3, analysisPhase: "review_required" }),
    deriveTenderWorkbenchState({ documentCount: 3, analysisPhase: "approved" }),
  ];
  ok(states.every((s) => s.primaryAction === null || typeof s.primaryAction.label === "string"), "§11: ≤1 primary CTA per state");
  ok(states[1].primaryAction === null, "§11: AI 工作中 → 无 primary CTA");
}

// ═══ P0 Tender Identity + Analysis State Alignment — STATE-01..06 ═══

// STATE-01: documents uploaded + parsing → Step1 complete, Step2 = parsing, NOT complete
{
  const s = deriveTenderWorkbenchState({ documentCount: 4, analysisPhase: "none", parsingActive: true });
  ok(s.steps[0].state === "done", "STATE-01: step1 complete");
  ok(s.steps[1].state === "processing" && s.steps[1].caption === "文件解析中", "STATE-01: step2 = 文件解析中");
  ok(s.completedSteps === 1, "STATE-01: step2 NOT counted complete");
}

// STATE-02: ProjectIntelligence 存在但无 TenderAnalysisRun → Step2 不得 complete。
// 投影输入根本没有 intelligence 字段（by construction 不可能把 intelligence 当完成信号）；
// 页面在无 run 时传 analysisPhase="none" —— 无论 intelligence 是否存在，结果相同：
{
  const s = deriveTenderWorkbenchState({ documentCount: 4, analysisPhase: "none" });
  ok(s.steps[1].state !== "done", "STATE-02: no run → step2 not complete (intelligence 无法冒充)");
  ok(s.completedSteps === 1, "STATE-02: completedSteps=1 (仅文件)");
  ok(s.steps[1].caption === "Tender Package 尚未开始分析", "STATE-02: 真实状态文案，不显示分析完成");
  ok(s.steps[1].cta?.label === "开始项目解读", "STATE-02: 无 run → 真实入口（非永久转圈）");
}

// STATE-03: run PROCESSING → Step2 = AI 分析中（阶段 B 文案）
{
  const s = deriveTenderWorkbenchState({ documentCount: 4, analysisPhase: "processing" });
  ok(s.steps[1].state === "processing" && s.steps[1].caption === "AI 正在理解整个招标项目", "STATE-03: PROCESSING → 整包理解中");
}

// STATE-04: REVIEW_REQUIRED → Step2 待确认 + CTA 查看并确认
{
  const s = deriveTenderWorkbenchState({ documentCount: 4, analysisPhase: "review_required" });
  ok(s.steps[1].state === "active" && s.steps[1].cta?.label === "查看并确认", "STATE-04: 待确认 + 查看并确认");
}

// STATE-05: requirements approved → Step2 complete
{
  const s = deriveTenderWorkbenchState({ documentCount: 4, analysisPhase: "approved" });
  ok(s.steps[1].state === "done" && s.completedSteps === 2, "STATE-05: approved → step2 complete");
}

// STATE-06: 刷新后状态保持 canonical —— 纯函数：同输入必得同输出（无 reset / fake state）
{
  const a = deriveTenderWorkbenchState({ documentCount: 4, analysisPhase: "review_required" });
  const b = deriveTenderWorkbenchState({ documentCount: 4, analysisPhase: "review_required" });
  ok(JSON.stringify(a) === JSON.stringify(b), "STATE-06: deterministic projection (refresh-safe)");
}

console.log(`\nworkbench-state: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
