/**
 * Phase I — Executive Brief（30 秒看懂）纯投影
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/executive-brief.test.ts
 *
 * 覆盖任务书 INTEL-01..08 的纯逻辑部分（Missing ≠ Processing 等）。
 */

import {
  buildExecutiveBrief,
  type BriefSource,
} from "../executive-brief";

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

const fullSource: BriefSource = {
  oneLiner: "Supply and install motorized roller shades.",
  buyer: "Strathcona County",
  product: "Motorized roller shades",
  recommendation: null,
  nextActions: ["Confirm motor voltage", "Request Somfy quote"],
  blockers: [],
  unresolvedConflictCount: 0,
};

console.log("tender-auto-analysis executive-brief");

// INTEL-01：分析完成（REVIEW_REQUIRED）→ 各字段 READY 且有真实值，无需手工
{
  const b = buildExecutiveBrief({
    run: { status: "REVIEW_REQUIRED", fingerprint: "fp1", source: fullSource },
    currentFingerprint: "fp1",
    projectType: "窗帘工程",
  });
  ok(b.analysisStatus === "READY", "READY 状态");
  ok(b.fields.oneLiner.state === "READY" && !!b.fields.oneLiner.value, "一句话摘要 READY 有值");
  ok(b.fields.buyer.value === "Strathcona County", "采购单位真实值");
  ok(b.fields.product.state === "READY", "产品 READY");
  ok(b.fields.nextActions.state === "READY", "下一步 READY");
  ok(b.fields.recommendation.value?.includes("AI 建议") === true, "建议标注为 AI 建议（非最终决定）");
}

// INTEL-02/03：外部字段永远 NEEDS_EXTERNAL_RESEARCH，绝不 PROCESSING/调查中
{
  const b = buildExecutiveBrief({
    run: { status: "REVIEW_REQUIRED", fingerprint: "fp1", source: fullSource },
    currentFingerprint: "fp1",
    projectType: null,
  });
  ok(b.external.previousWinner.state === "NEEDS_EXTERNAL_RESEARCH", "上一轮中标方 → 需外部调查");
  ok(b.external.historicalContractValue.state === "NEEDS_EXTERNAL_RESEARCH", "历史合同金额 → 需外部调查");
  ok(b.external.possiblyRecurring.state === "NEEDS_EXTERNAL_RESEARCH", "周期采购 → 需外部调查");
  ok(
    b.external.previousWinner.state !== "PROCESSING",
    "外部字段绝不 PROCESSING（无 active run 背书）",
  );
}

// INTEL-03：无 run → NOT_STARTED，绝不 PROCESSING
{
  const b = buildExecutiveBrief({
    run: null,
    currentFingerprint: "fp1",
    projectType: null,
  });
  ok(b.analysisStatus === "NONE", "无 run → NONE");
  ok(b.fields.oneLiner.state === "NOT_STARTED", "无 run → 字段 NOT_STARTED（不是 PROCESSING）");
  ok(
    Object.values(b.fields).every((x) => x.state !== "PROCESSING"),
    "无 run 时任何分析字段都不显示 PROCESSING",
  );
}

// 活跃 run（ANALYZING）→ PROCESSING（唯一允许"分析中"，且有 active run）
{
  const b = buildExecutiveBrief({
    run: { status: "ANALYZING", fingerprint: null, source: null },
    currentFingerprint: null,
    projectType: null,
  });
  ok(b.analysisStatus === "PROCESSING", "ANALYZING → PROCESSING");
  ok(b.fields.buyer.state === "PROCESSING", "活跃 run → 字段 PROCESSING");
}

// INTEL-08：run FAILED → FAILED（不是"调查中"）
{
  const b = buildExecutiveBrief({
    run: { status: "FAILED", fingerprint: "fp1", source: null },
    currentFingerprint: "fp1",
    projectType: null,
  });
  ok(b.analysisStatus === "FAILED", "FAILED 状态");
  ok(b.fields.oneLiner.state === "FAILED", "FAILED → 字段 FAILED（非 PROCESSING）");
}

// INTEL-04/05：fingerprint 变化 → STALE（保留旧值 + 标记需重新分析）
{
  const b = buildExecutiveBrief({
    run: { status: "REVIEW_REQUIRED", fingerprint: "OLD", source: fullSource },
    currentFingerprint: "NEW",
    projectType: null,
  });
  ok(b.stale === true && b.analysisStatus === "STALE", "fingerprint 变化 → STALE");
  ok(b.fields.buyer.state === "STALE" && b.fields.buyer.value === "Strathcona County", "STALE 仍显示旧值");
}

// INTEL-07：未解决冲突 → 重大阻塞 CONFLICT（不生成虚假确定答案）
{
  const src: BriefSource = {
    ...fullSource,
    blockers: ["冲突：motor voltage（120V ↔ 24V）"],
    unresolvedConflictCount: 1,
  };
  const b = buildExecutiveBrief({
    run: { status: "REVIEW_REQUIRED", fingerprint: "fp1", source: src },
    currentFingerprint: "fp1",
    projectType: null,
  });
  ok(b.fields.majorBlockers.state === "CONFLICT", "未解决冲突 → 重大阻塞 CONFLICT");
  ok(b.fields.majorBlockers.value?.includes("120V") === true, "阻塞含冲突详情");
  ok(b.fields.recommendation.value?.includes("澄清") === true, "有阻塞 → 建议先澄清（HOLD leaning）");
}

// READY 但字段缺失 → UNKNOWN（不是"调查中"）
{
  const sparse: BriefSource = {
    oneLiner: null, buyer: null, product: null, recommendation: null,
    nextActions: [], blockers: [], unresolvedConflictCount: 0,
  };
  const b = buildExecutiveBrief({
    run: { status: "APPROVED", fingerprint: "fp1", source: sparse },
    currentFingerprint: "fp1",
    projectType: null,
  });
  ok(b.fields.buyer.state === "UNKNOWN", "READY 但缺 buyer → UNKNOWN（非 PROCESSING）");
  ok(b.fields.majorBlockers.value === "无", "READY 无阻塞 → 无");
}

console.log(`\nexecutive-brief: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
