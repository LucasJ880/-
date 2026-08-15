/**
 * T5-P1 Segment 3 §27 — 投影接线的真实 Postgres 验证（DB 平面，手动运行）
 *
 * **不跑真实模型**：用 seeded canonical V2 数据验证投影工具的读/写行为。
 * 纯平面只能证明"代码里没有写生成逻辑"，真正的"读对了、且一行没改"要打真库。
 *
 *   A  seeded 要求/来源引用 → 证据覆盖投影读数正确
 *   B  seeded canonical RISKS → 风险投影正确，且 RISKS 行前后逐字节不变
 *   C  seeded canonical 澄清 → 澄清投影正确，且澄清行前后不变
 *   D  submissionChecklist N 条 → 物化 N 条交付物
 *   E  submissionChecklist [] → 物化 0 条且 PASS
 *   F  canonical summaryJson → t9 V2 终态化 → summaryJson/summaryText 深度保全
 *   G  无 canonical 证据（兼容路径）→ 仍走 V1 finalize（写 V1 投影）
 *   H  无 canonical marker → 风险工具走兼容分支（模型桩，不打真实模型）
 *   I  有 marker 但 canonical 行缺失 → fail closed
 *
 * 运行（仅隔离 Neon 分支，绝不指向生产）：
 *   DATABASE_URL="$CS" DIRECT_URL="$CS" npx tsx scripts/t5-seg3-projection-db-validation.ts
 */

import { db } from "@/lib/db";
import {
  TENDER_WORKFORCE_TOOL_HANDLERS,
  TENDER_CANONICAL_V2_MARKER,
  TENDER_SEMANTIC_ENGINE_V2,
  setTenderRiskModelForTests,
} from "@/lib/tender-workforce/tools";
import {
  TENDER_AGENT_RUN_STATUS,
  TENDER_WORKFORCE_ANALYSIS_VERSION,
  buildWorkforceTenderIdempotencyKey,
} from "@/lib/tender-workforce/analysis-run-service";
import { WORKFORCE_JOB_RUN_TYPE } from "@/lib/workforce-runtime/constants";
import type { AdapterContext } from "@/lib/agent-runtime-v2/adapters";

const TAG = `t5seg3_${Date.now()}`;
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

const CANONICAL_SUMMARY = (checklist: Array<{ requirementId: string; statement: string }>) => ({
  engine: "v2",
  brief: { oneLiner: "30 秒解读", recommendation: "ADVANCE" },
  criticalFacts: { buyer: "City of X", deadline: "2026-09-01" },
  submissionChecklist: checklist,
  unknowns: ["预算上限未披露"],
  conflicts: [{ id: "c1", note: "附录与正文冲突" }],
  addendumChanges: [{ id: "a1", change: "截标延期" }],
  evidenceCoverage: { covered: 12, total: 14 },
  analystSynthesis: { oneLinerZh: "V2 分析师结论", version: "tender-analyst/1" },
  metadata: { promptVersion: "tender-understanding-v2" },
});

/** canonical V2 风险的真实形状（v2-map 写入 RISKS.structuredJson） */
const CANONICAL_RISKS = {
  risks: [
    {
      id: "r1",
      severity: "CRITICAL",
      riskType: "MANDATORY_REQUIREMENT_MISSING",
      description: "缺少投标保证金证明",
      relatedRequirementIds: ["REQ-001"],
      relatedFactIds: [],
      evidence: [],
      reasonCode: "BOND_MISSING",
    },
    {
      id: "r2",
      severity: "HIGH",
      riskType: "AMBIGUOUS_SPECIFICATION",
      description: "技术参数表述存在歧义",
      relatedRequirementIds: [],
      relatedFactIds: [],
      evidence: [],
      reasonCode: "SPEC_AMBIGUOUS",
    },
  ],
  conflicts: [{ topic: "交付期", values: ["30 天", "45 天"], resolution: "UNRESOLVED" }],
};

async function main() {
  console.log(`T5 Segment 3 — 投影接线真实 Postgres 验证（${TAG}）`);

  const user = await db.user.create({
    data: { email: `${TAG}@test.qingyan.local`, name: `${TAG}-user`, role: "sales", status: "active" },
  });
  const org = await db.organization.create({
    data: { name: `${TAG}-org`, code: TAG, ownerId: user.id, status: "active" },
  });
  const project = await db.project.create({
    data: { name: `${TAG}-project`, ownerId: user.id, orgId: org.id, workDomain: "tender" },
  });
  const session = await db.agentSession.create({
    data: { orgId: org.id, userId: user.id, channel: "web" },
  });
  const jobRun = await db.agentRun.create({
    data: {
      orgId: org.id,
      sessionId: session.id,
      runType: WORKFORCE_JOB_RUN_TYPE,
      status: "running",
      runtimeVersion: "v2",
      metadata: { workDomain: "tender", projectId: project.id } as never,
    },
    select: { id: true },
  });
  const doc = await db.projectDocument.create({
    data: {
      projectId: project.id,
      title: `${TAG}.pdf`,
      fileType: "pdf",
      url: `https://example.test/${TAG}.pdf`,
      uploadedById: user.id,
      parseStatus: "done",
      pageCount: 3,
    },
    select: { id: true },
  });

  let seq = 0;
  async function seedRun(input: {
    checklist?: Array<{ requirementId: string; statement: string }>;
    requirements?: string[];
    withRisks?: boolean;
    clarifications?: number;
    status?: string;
  }): Promise<string> {
    seq += 1;
    const run = await db.tenderAnalysisRun.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        status: input.status ?? TENDER_AGENT_RUN_STATUS.running,
        runKind: "FULL",
        analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
        promptVersion: "tender-workforce-prompt-v1",
        idempotencyKey: `${buildWorkforceTenderIdempotencyKey(jobRun.id)}:${seq}`,
        sourceHashFingerprint: `${TAG}-fp`,
        createdById: user.id,
        summaryJson: CANONICAL_SUMMARY(input.checklist ?? []) as never,
        summaryText: "V2 canonical 摘要文本",
        documents: {
          create: [
            { documentId: doc.id, role: "MAIN", contentHash: `${TAG}-hash` },
          ],
        },
      },
      select: { id: true },
    });
    for (const code of input.requirements ?? []) {
      const req = await db.tenderExtractedRequirement.create({
        data: {
          projectId: project.id,
          analysisRunId: run.id,
          requirementCode: code,
          category: "SUBMISSION",
          originalRequirement: `Requirement ${code}`,
          chineseTranslation: `要求 ${code}`,
          mandatory: true,
          evidenceRequired: true,
          complianceStatus: "NOT_ASSESSED",
          reviewStatus: "AI_EXTRACTED",
          sourcePage: 5,
          projectionStatus: "NOT_PROJECTED",
        },
        select: { id: true },
      });
      await db.tenderAnalysisSourceRef.create({
        data: {
          runId: run.id,
          documentId: doc.id,
          pageNumber: 5,
          originalTextSnippet: "…",
          extractionMethod: "llm",
          confidence: "HIGH",
          requirementId: req.id,
        },
      });
    }
    if (input.withRisks) {
      await db.tenderAnalysisSection.create({
        data: {
          runId: run.id,
          sectionKey: "RISKS",
          contentZh: "风险清单",
          structuredJson: CANONICAL_RISKS as never,
          confidence: "INFERRED",
          reviewStatus: "AI_DRAFT",
        },
      });
    }
    for (let i = 0; i < (input.clarifications ?? 0); i++) {
      await db.tenderClarificationQuestion.create({
        data: {
          projectId: project.id,
          analysisRunId: run.id,
          question: `canonical 澄清问题 ${i + 1}`,
          reason: "文档未明确",
          priority: "HIGH",
          status: "OPEN",
        },
      });
    }
    return run.id;
  }

  const manifest = (runId: string) => ({
    analysisRunId: runId,
    projectId: project.id,
    fingerprint: `${TAG}-fp`,
    mode: "FULL",
    documents: [{ documentId: doc.id, filename: `${TAG}.pdf`, role: "MAIN", pageCount: 3 }],
    addendumCount: 0,
  });
  const canonicalMarker = (runId: string) => ({
    [TENDER_CANONICAL_V2_MARKER]: true,
    semanticEngine: TENDER_SEMANTIC_ENGINE_V2,
    canonicalPersisted: true,
    analysisRunId: runId,
  });
  const synthesisEvidence = {
    summary: "Job 级执行汇总",
    conclusions: ["已完成 canonical 分析"],
    synthesisOf: ["t3", "t4", "t5", "t6", "t7"],
    recommendations: ["人工复核"],
  };

  function ctx(
    runId: string,
    prior: Record<string, unknown>,
  ): AdapterContext {
    return {
      orgId: org.id,
      userId: user.id,
      role: "sales",
      runId: jobRun.id,
      stepKey: `s_${runId}`,
      operationKey: `op_${runId}`,
      priorEvidence: prior,
    };
  }

  const H = TENDER_WORKFORCE_TOOL_HANDLERS;

  try {
    /* ── A：证据覆盖投影 ── */
    {
      const runId = await seedRun({ requirements: ["REQ-001", "REQ-002"] });
      const res = await H.tender_evidence_compliance(
        ctx(runId, { s1: manifest(runId), s3: canonicalMarker(runId) }),
      );
      const d = (res.data ?? {}) as Record<string, unknown>;
      const rs = d.requirementsSummary as Record<string, number>;
      ok(
        res.ok && rs.total === 2 && rs.sourceLinked === 2 && d.canonicalProjection === true,
        "A: 证据覆盖投影读到 canonical 要求与来源引用（只读聚合）",
        { res: res.ok, rs },
      );
    }

    /* ── B：风险投影 + canonical 行不变 ── */
    {
      const runId = await seedRun({ requirements: ["REQ-001"], withRisks: true });
      const before = await db.tenderAnalysisSection.findFirstOrThrow({
        where: { runId, sectionKey: "RISKS" },
      });
      const res = await H.tender_risk_analysis(
        ctx(runId, { s1: manifest(runId), s3: canonicalMarker(runId) }),
      );
      const after = await db.tenderAnalysisSection.findFirstOrThrow({
        where: { runId, sectionKey: "RISKS" },
      });
      const d = (res.data ?? {}) as Record<string, unknown>;
      const counts = d.counts as Record<string, number>;
      ok(
        res.ok && counts.critical === 1 && counts.high === 1 && d.canonicalProjection === true,
        "B: canonical 风险投影计数正确（CRITICAL 1 / HIGH 1）",
        { ok: res.ok, counts, error: res.error },
      );
      ok(
        JSON.stringify(after.structuredJson) === JSON.stringify(before.structuredJson) &&
          after.contentZh === before.contentZh &&
          after.updatedAt.getTime() === before.updatedAt.getTime(),
        "B2: canonical RISKS 行前后逐字节未变（V2_RISK_CANONICAL_WRITES = 0）",
      );
      ok(
        (d.conflictCount as number) === 1,
        "B3: canonical 冲突一并投影",
        d.conflictCount,
      );
    }

    /* ── C：澄清投影 + canonical 行不变 ── */
    {
      const runId = await seedRun({ requirements: ["REQ-001"], clarifications: 3 });
      const before = await db.tenderClarificationQuestion.findMany({
        where: { analysisRunId: runId },
        orderBy: { createdAt: "asc" },
      });
      const res = await H.tender_clarification_draft(
        ctx(runId, { s1: manifest(runId), s3: canonicalMarker(runId) }),
      );
      const after = await db.tenderClarificationQuestion.findMany({
        where: { analysisRunId: runId },
        orderBy: { createdAt: "asc" },
      });
      const d = (res.data ?? {}) as Record<string, unknown>;
      ok(
        res.ok && d.clarificationCount === 3 && d.canonicalProjection === true,
        "C: canonical 澄清投影 3 条",
        { ok: res.ok, count: d.clarificationCount, error: res.error },
      );
      ok(
        after.length === before.length &&
          JSON.stringify(after.map((r) => [r.id, r.question, r.status])) ===
            JSON.stringify(before.map((r) => [r.id, r.question, r.status])),
        "C2: canonical 澄清行前后未变（零二次生成、零覆盖）",
      );
    }

    /* ── D / E：交付物物化 ── */
    {
      const runId = await seedRun({
        requirements: ["REQ-001", "REQ-002"],
        checklist: [
          { requirementId: "REQ-001", statement: "提交技术方案" },
          { requirementId: "REQ-002", statement: "提交价格表" },
        ],
      });
      const res = await H.tender_build_deliverables(
        ctx(runId, { s1: manifest(runId), s3: canonicalMarker(runId) }),
      );
      const rows = await db.tenderDeliverable.count({ where: { analysisRunId: runId } });
      ok(
        res.ok && rows === 2,
        "D: submissionChecklist 2 条 → 物化 2 条交付物",
        { ok: res.ok, rows, error: res.error },
      );

      const emptyRun = await seedRun({ requirements: ["REQ-001"], checklist: [] });
      const res2 = await H.tender_build_deliverables(
        ctx(emptyRun, { s1: manifest(emptyRun), s3: canonicalMarker(emptyRun) }),
      );
      const rows2 = await db.tenderDeliverable.count({ where: { analysisRunId: emptyRun } });
      ok(
        res2.ok && rows2 === 0,
        "E: submissionChecklist [] → 物化 0 条且判成功（不回落静态模板）",
        { ok: res2.ok, rows2 },
      );
    }

    /* ── F：canonical V2 终态化 + 深度保全 ── */
    {
      const runId = await seedRun({
        requirements: ["REQ-001"],
        checklist: [{ requirementId: "REQ-001", statement: "提交技术方案" }],
      });
      const before = await db.tenderAnalysisRun.findUniqueOrThrow({
        where: { id: runId },
        select: { summaryJson: true, summaryText: true },
      });
      const res = await H.tender_finalize_analysis(
        ctx(runId, {
          s1: manifest(runId),
          s3: canonicalMarker(runId),
          s8: synthesisEvidence,
        }),
      );
      const after = await db.tenderAnalysisRun.findUniqueOrThrow({ where: { id: runId } });
      const sj = (after.summaryJson ?? {}) as Record<string, unknown>;
      ok(
        res.ok && after.status === TENDER_AGENT_RUN_STATUS.reviewRequired,
        "F: canonical V2 终态化 → REVIEW_REQUIRED",
        { ok: res.ok, status: after.status, error: res.error },
      );
      ok(
        JSON.stringify(after.summaryJson) === JSON.stringify(before.summaryJson) &&
          after.summaryText === before.summaryText,
        "F2: summaryJson / summaryText 与终态化前逐字节一致",
      );
      ok(
        Array.isArray(sj.submissionChecklist) &&
          !!sj.analystSynthesis &&
          !!sj.brief &&
          !!sj.criticalFacts,
        "F3: submissionChecklist / analystSynthesis / brief / criticalFacts 全部存活",
        Object.keys(sj),
      );
      const d = (res.data ?? {}) as Record<string, unknown>;
      ok(
        d.canonicalProjection === true && typeof d.jobSummary === "string",
        "F4: 工具结果带 Job 级汇总，但未写回 canonical（§19）",
      );
    }

    /* ── G：兼容路径仍走 V1 finalize ── */
    {
      const runId = await seedRun({ requirements: ["REQ-001"] });
      const res = await H.tender_finalize_analysis(
        ctx(runId, { s1: manifest(runId), s8: synthesisEvidence }),
      );
      const after = await db.tenderAnalysisRun.findUniqueOrThrow({ where: { id: runId } });
      const sj = (after.summaryJson ?? {}) as Record<string, unknown>;
      ok(
        res.ok &&
          sj.contractVersion === "tender-analysis-result/v1" &&
          after.status === TENDER_AGENT_RUN_STATUS.reviewRequired,
        "G: 无 canonical 证据 → 仍写 V1 投影（回滚路径行为不变）",
        { ok: res.ok, version: sj.contractVersion, error: res.error },
      );
    }

    /* ── H：无 marker → 风险工具走兼容分支（模型桩） ── */
    {
      let stubCalls = 0;
      setTenderRiskModelForTests(async () => {
        stubCalls += 1;
        return JSON.stringify({
          risks: [
            {
              severity: "HIGH",
              kind: "SUBMISSION_RISK",
              statement: "兼容路径生成的风险",
              source: "REQ-001",
            },
          ],
          summary: "兼容路径风险摘要",
        });
      });
      const runId = await seedRun({ requirements: ["REQ-001"], withRisks: false });
      const res = await H.tender_risk_analysis(
        ctx(runId, { s1: manifest(runId) }),
      );
      const section = await db.tenderAnalysisSection.findFirst({
        where: { runId, sectionKey: "RISKS" },
        select: { structuredJson: true },
      });
      const sj = (section?.structuredJson ?? {}) as Record<string, unknown>;
      setTenderRiskModelForTests(null);
      ok(
        res.ok && stubCalls === 1 && sj.version === "tender-workforce-risks/v1",
        "H: 无 canonical marker → 兼容分支（生成 + upsert，行为不变）",
        { ok: res.ok, stubCalls, version: sj.version, error: res.error },
      );
      ok(
        (res.data as Record<string, unknown>).canonicalProjection === undefined,
        "H2: 兼容分支不冒充 canonical 投影",
      );
    }

    /* ── I：有 marker 但 canonical 行缺失 → fail closed ── */
    {
      const runId = await seedRun({ requirements: ["REQ-001"], withRisks: false });
      const res = await H.tender_risk_analysis(
        ctx(runId, { s1: manifest(runId), s3: canonicalMarker(runId) }),
      );
      ok(
        !res.ok && (res.error ?? "").startsWith("CANONICAL_MISSING"),
        "I: 声明 canonical 落库但 RISKS 章节不存在 → fail closed（不退回生成）",
        res,
      );

      // marker 指向别的 run → 拒绝
      const otherRun = await seedRun({ requirements: ["REQ-001"], withRisks: true });
      const res2 = await H.tender_risk_analysis(
        ctx(otherRun, { s1: manifest(otherRun), s3: canonicalMarker(`${otherRun}_x`) }),
      );
      ok(
        !res2.ok && (res2.error ?? "").includes("不一致"),
        "I2: canonical 证据指向其它分析记录 → 拒绝",
        res2,
      );

      // RISKS 是 Workforce 生成形状（模式串了）→ 拒绝
      const mixedRun = await seedRun({ requirements: ["REQ-001"] });
      await db.tenderAnalysisSection.create({
        data: {
          runId: mixedRun,
          sectionKey: "RISKS",
          contentZh: "workforce 风险",
          structuredJson: {
            version: "tender-workforce-risks/v1",
            risks: [{ severity: "HIGH", kind: "OTHER", statement: "x" }],
          } as never,
          confidence: "MEDIUM",
          reviewStatus: "AI_DRAFT",
        },
      });
      const res3 = await H.tender_risk_analysis(
        ctx(mixedRun, { s1: manifest(mixedRun), s3: canonicalMarker(mixedRun) }),
      );
      ok(
        !res3.ok && (res3.error ?? "").startsWith("CANONICAL_INVALID"),
        "I3: RISKS 是 Workforce 二次生成形状 → CANONICAL_INVALID（不混用两套语义）",
        res3,
      );
    }
  } finally {
    setTenderRiskModelForTests(null);
    await db.tenderDeliverable.deleteMany({ where: { projectId: project.id } });
    await db.tenderAnalysisSourceRef.deleteMany({
      where: { run: { orgId: org.id } },
    });
    await db.tenderClarificationQuestion.deleteMany({ where: { projectId: project.id } });
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: project.id } });
    await db.tenderAnalysisSection.deleteMany({ where: { run: { orgId: org.id } } });
    await db.tenderAnalysisRunDocument.deleteMany({ where: { run: { orgId: org.id } } });
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: org.id } });
    await db.projectDocument.deleteMany({ where: { projectId: project.id } });
    await db.agentRun.deleteMany({ where: { orgId: org.id } });
    await db.agentSession.deleteMany({ where: { orgId: org.id } });
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
