/**
 * T5-P1 Segment 1 — canonical V2 finalize 语义保全的真实 Postgres 校验（DB 平面，手动运行）
 *
 * 为什么必须打真库：本段的核心不变量是"**哪些列没有被写**"。
 * Prisma 的部分更新语义（data 里不出现的列原样保留）无法用纯函数断言，
 * 只有真实 UPDATE 后回读才算证明。
 *
 *   V2-CONV-05：summaryJson 逐字节未变（canonical V2 结果未被 V1 投影替换）
 *   V2-CONV-06：submissionChecklist 存活（交付物投影的语义来源）
 *   V2-CONV-07：analystSynthesis 存活
 *   V2-CONV-08：brief 存活
 *   FINALIZE-01..07：criticalFacts / conflicts / addendumChanges / evidenceCoverage /
 *                    metadata / unknowns 存活；summaryText PRESERVE；状态机与错误字段清理
 *   FINALIZE-08/08b：终态不可复活；跨 org 拒绝（fail-closed ownership）
 *   FINALIZE-09/10：V1 兼容 finalize 行为完全不变（仍写 V1 投影 + 覆盖 summaryText）
 *
 * 运行（仅隔离 Neon 分支，绝不指向生产）：
 *   DATABASE_URL="$CS" DIRECT_URL="$CS" npx tsx scripts/t5-seg1-canonical-finalize-db-validation.ts
 *
 * 与 scripts/pr106-v2-fence-db-validation.ts 同纪律：结束清理自建 fixtures，
 * 不注册进 test-all（test-all 主体是无 DB 的纯平面）。
 */

import { db } from "@/lib/db";
import {
  finalizeWorkforceTenderAnalysisRun,
  finalizeWorkforceTenderCanonicalV2Run,
  TENDER_AGENT_RUN_STATUS,
  TENDER_WORKFORCE_ANALYSIS_VERSION,
} from "@/lib/tender-workforce/analysis-run-service";
import {
  TENDER_ANALYSIS_RESULT_VERSION,
  type TenderAnalysisResultV1,
} from "@/lib/tender-workforce/result-contract";

const TAG = `t5seg1_${Date.now()}`;
let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

/** canonical V2 summaryJson 样本：列出所有必须存活的 V2 语义字段 */
const V2_SUMMARY = {
  engine: "v2",
  submissionChecklist: [
    { requirementId: "REQ-001", statement: "提交技术方案正本一份" },
    { requirementId: "REQ-002", statement: "提交已签署价格表" },
  ],
  analystSynthesis: { oneLinerZh: "V2 分析师结论", version: "tender-analyst/1" },
  brief: { oneLiner: "30 秒解读", recommendation: "ADVANCE" },
  criticalFacts: { deadline: "2026-09-01", buyer: "City of X" },
  unknowns: ["预算上限未披露"],
  conflicts: [{ id: "c1", note: "附录与正文冲突" }],
  addendumChanges: [{ id: "a1", change: "截标延期" }],
  evidenceCoverage: { covered: 12, total: 14 },
  metadata: { promptVersion: "tender-understanding-v2" },
};
const V2_SUMMARY_TEXT = "V2 canonical 摘要文本（不得被覆盖）";

async function main(): Promise<void> {
  console.log(`T5 Segment 1 — canonical V2 finalize 语义保全（${TAG}）`);

  const user = await db.user.create({
    data: {
      email: `${TAG}@test.qingyan.local`,
      name: `T5 Seg1 ${TAG}`,
      role: "sales",
      status: "active",
    },
  });
  const org = await db.organization.create({
    data: {
      name: `T5 Seg1 Org ${TAG}`,
      code: TAG,
      ownerId: user.id,
      status: "active",
    },
  });
  const project = await db.project.create({
    data: { name: `${TAG}-project`, ownerId: user.id, orgId: org.id },
  });

  let seq = 0;
  async function makeRun(status: string): Promise<string> {
    seq += 1;
    const run = await db.tenderAnalysisRun.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        status,
        runKind: "FULL",
        analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
        promptVersion: "tender-workforce-prompt-v1",
        idempotencyKey: `${TAG}-${seq}`,
        sourceHashFingerprint: `${TAG}-fp`,
        createdById: user.id,
        summaryJson: V2_SUMMARY as unknown as object,
        summaryText: V2_SUMMARY_TEXT,
        // 预置脏错误字段：验证终态化会清理
        errorCode: "PRIOR_ERROR",
        errorMessageSanitized: "上一轮遗留错误",
      },
      select: { id: true },
    });
    return run.id;
  }

  try {
    /* ── canonical V2：仅状态转换，summaryJson / summaryText 不参与 UPDATE ── */
    const idV2 = await makeRun(TENDER_AGENT_RUN_STATUS.running);
    // 基线快照：取**入库后**的值。Postgres jsonb 会规范化 key 顺序，
    // 直接和 JS 字面量比字节会假阳性；before/after 都经同一规范化，
    // 因此 before === after 才是「finalize 没有改写这一列」的真正证明。
    const before = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: idV2 },
      select: { summaryJson: true, summaryText: true },
    });
    const res = await finalizeWorkforceTenderCanonicalV2Run({
      orgId: org.id,
      projectId: project.id,
      analysisRunId: idV2,
    });
    ok(res.ok, "canonical V2 finalize 返回成功", res);

    const after = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: idV2 },
    });
    const sj = (after.summaryJson ?? {}) as Record<string, unknown>;

    ok(
      JSON.stringify(after.summaryJson) === JSON.stringify(before.summaryJson),
      "V2-CONV-05: summaryJson 与 finalize 前逐字节一致（未被 V1 投影替换）",
      { before: before.summaryJson, after: after.summaryJson },
    );
    ok(
      Object.keys(sj).length === Object.keys(V2_SUMMARY).length,
      "V2-CONV-05b: canonical V2 字段一个不少（无静默裁剪）",
      Object.keys(sj),
    );
    ok(
      Array.isArray(sj.submissionChecklist) &&
        (sj.submissionChecklist as unknown[]).length === 2,
      "V2-CONV-06: submissionChecklist 存活（交付物投影语义来源）",
    );
    ok(
      (sj.analystSynthesis as Record<string, unknown> | undefined)
        ?.oneLinerZh === "V2 分析师结论",
      "V2-CONV-07: analystSynthesis 存活",
    );
    ok(!!sj.brief, "V2-CONV-08: brief 存活");
    ok(!!sj.criticalFacts, "FINALIZE-01: criticalFacts 存活");
    ok(
      Array.isArray(sj.conflicts) &&
        (sj.conflicts as unknown[]).length === 1 &&
        Array.isArray(sj.addendumChanges),
      "FINALIZE-02: conflicts / addendumChanges 存活",
    );
    ok(
      !!sj.evidenceCoverage && !!sj.metadata && Array.isArray(sj.unknowns),
      "FINALIZE-03: evidenceCoverage / metadata / unknowns 存活",
    );
    ok(
      after.summaryText === V2_SUMMARY_TEXT &&
        after.summaryText === before.summaryText,
      "FINALIZE-04: summaryText 保留（V2_SUMMARY_TEXT_POLICY = PRESERVE）",
      after.summaryText,
    );
    ok(
      after.status === TENDER_AGENT_RUN_STATUS.reviewRequired,
      "FINALIZE-05: AGENT_ANALYZING → REVIEW_REQUIRED",
      after.status,
    );
    ok(after.completedAt != null, "FINALIZE-06: completedAt 已写入");
    ok(
      after.errorCode === null && after.errorMessageSanitized === null,
      "FINALIZE-07: 遗留错误字段被清空",
    );

    /* ── 终态不可复活 ── */
    const idTerm = await makeRun(TENDER_AGENT_RUN_STATUS.failed);
    const revive = await finalizeWorkforceTenderCanonicalV2Run({
      orgId: org.id,
      projectId: project.id,
      analysisRunId: idTerm,
    });
    const termAfter = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: idTerm },
      select: { status: true },
    });
    ok(
      !revive.ok && termAfter.status === TENDER_AGENT_RUN_STATUS.failed,
      "FINALIZE-08: 终态 run 拒绝终态化（fail-closed，不复活）",
      { revive, status: termAfter.status },
    );

    /* ── 跨 org 拒绝 ── */
    const idCross = await makeRun(TENDER_AGENT_RUN_STATUS.running);
    const cross = await finalizeWorkforceTenderCanonicalV2Run({
      orgId: `${org.id}_wrong`,
      projectId: project.id,
      analysisRunId: idCross,
    });
    const crossAfter = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: idCross },
      select: { status: true },
    });
    ok(
      !cross.ok && crossAfter.status === TENDER_AGENT_RUN_STATUS.running,
      "FINALIZE-08b: 跨 org 终态化被拒绝且状态未变",
      { cross, status: crossAfter.status },
    );

    /* ── V1 兼容路径：行为必须完全不变 ── */
    const idV1 = await makeRun(TENDER_AGENT_RUN_STATUS.running);
    const v1Result: TenderAnalysisResultV1 = {
      contractVersion: TENDER_ANALYSIS_RESULT_VERSION,
      projectSummary: "V1 执行摘要",
      readiness: "READY_TO_REVIEW",
      requirementsSummary: {
        total: 2,
        mandatory: 1,
        evidenceRequired: 1,
        sourceLinked: 2,
      },
      missingInformation: [],
      criticalRisks: [],
      importantRisks: [],
      clarifications: [],
      submissionRisks: [],
      recommendedNextActions: [],
      sourceCoverage: {
        documentCount: 1,
        parsedPageCount: 3,
        factCount: 4,
        sourceRefCount: 2,
      },
      analysisLimitations: [],
    };
    const v1res = await finalizeWorkforceTenderAnalysisRun({
      orgId: org.id,
      projectId: project.id,
      analysisRunId: idV1,
      result: v1Result,
      summaryText: "V1 摘要文本",
    });
    const v1After = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: idV1 },
    });
    const v1sj = (v1After.summaryJson ?? {}) as Record<string, unknown>;
    ok(
      v1res.ok === true,
      "FINALIZE-09: V1 兼容 finalize 仍然成功（契约未被本段改动）",
      v1res,
    );
    ok(
      v1res.ok &&
        v1sj.contractVersion === TENDER_ANALYSIS_RESULT_VERSION &&
        v1sj.submissionChecklist === undefined &&
        v1After.summaryText === "V1 摘要文本" &&
        v1After.status === TENDER_AGENT_RUN_STATUS.reviewRequired,
      "FINALIZE-10: V1 路径仍写 V1 投影并覆盖 summaryText（行为逐字段不变，V2 字段确实被替换掉）",
      { contractVersion: v1sj.contractVersion, summaryText: v1After.summaryText },
    );
  } finally {
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: org.id } });
    await db.project.deleteMany({ where: { orgId: org.id } });
    await db.organization.deleteMany({ where: { id: org.id } });
    await db.user.deleteMany({ where: { id: user.id } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("异常：", e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
