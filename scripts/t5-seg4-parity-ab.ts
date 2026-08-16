/**
 * T5-P1 Segment 4 Final Closure — Legacy A vs Workforce B canonical parity（真实模型）
 *
 * 存储：**非生产 Blob**——`PRODUCT_CONTENT_LOCAL_STORE=1` 的本地磁盘 store，
 * 零凭据、零生产对象。绝不读取/复制生产 Blob token。
 *
 * 流程：
 *   1. 在同一 org 下建两个独立 tender project（A=legacy，B=workforce）
 *   2. 用**同一批真实标书文件**分别走上传链（validate → putPrivateBlob →
 *      projectDocument.create → maybeEnqueueTenderAnalysisAfterUpload），
 *      不 seed 文档行、不 seed 页、不 seed V2 结果
 *   3. 断言两边文件 sha256 100% 一致，否则直接 STOP
 *   4. A：legacy 队列 → ENSURE_PAGES → 真实 Blob 下载 → 解析 → analyzeAndPersistV2
 *   5. B：Start AI Analysis → 确定性 server plan → canonical V2 → 投影 → 终态化
 *   6. 比对 canonical 领域完整性 + 抽样语义 parity
 *
 * 用法：
 *   DATABASE_URL=… DIRECT_URL=… PRODUCT_CONTENT_LOCAL_STORE=1 \
 *   npx tsx scripts/t5-seg4-parity-ab.ts <orgId> <ownerUserId> <file1> <file2> …
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";

const [orgId, ownerUserId, ...files] = process.argv.slice(2);
if (!orgId || !ownerUserId || files.length < 2) {
  console.error("usage: t5-seg4-parity-ab.ts <orgId> <ownerUserId> <file...>（至少 2 个文件）");
  process.exit(1);
}

const TAG = `t5parity_${Date.now()}`;
let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) {
    pass++;
    console.log(`  ✓ ${n}`);
  } else {
    fail++;
    console.error(`  ✗ ${n}`, d ?? "");
  }
};
const log = (m: string, x?: unknown) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`, x === undefined ? "" : JSON.stringify(x));

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function createProject(name: string) {
  return db.project.create({
    data: { name, ownerId: ownerUserId, orgId, workDomain: "tender" },
    select: { id: true, name: true },
  });
}

/** 复刻 /api/projects/[id]/files 的上传链（同函数、同字段；只跳过 HTTP/鉴权层） */
async function uploadPackage(projectId: string, autoEnqueue: boolean) {
  const { validateUploadedFileAsync } = await import("@/lib/files/upload-guard");
  const { putPrivateBlob } = await import("@/lib/files/blob-access");
  const { canParseFileType } = await import("@/lib/files/parse-content");
  const out: Array<{ id: string; title: string; sha: string; size: number }> = [];

  for (const f of files) {
    const buf = fs.readFileSync(f);
    const name = path.basename(f);
    const file = new File([new Uint8Array(buf)], name, { type: "application/pdf" });
    const check = await validateUploadedFileAsync(file, {
      maxSize: 50 * 1024 * 1024,
      allowedExtensions: ["pdf", "docx", "xlsx"],
      checkMagicBytes: true,
    });
    if (!check.ok) throw new Error(`上传校验失败 ${name}: ${check.reason}`);
    const { ext, safeName, buffer, mime } = check;
    const pathname = `projects/${projectId}/${Date.now()}_${safeName}`;
    const blob = await putPrivateBlob({ pathname, body: buffer, contentType: mime });
    const doc = await db.projectDocument.create({
      data: {
        projectId,
        title: name.slice(0, 240),
        url: blob.proxyUrl,
        blobUrl: blob.proxyUrl,
        fileType: ext,
        fileSize: file.size,
        source: "upload",
        uploadedById: ownerUserId,
        parseStatus: canParseFileType(ext) ? "pending" : "done",
      },
      select: { id: true, title: true },
    });
    if (autoEnqueue) {
      const { maybeEnqueueTenderAnalysisAfterUpload } = await import(
        "@/lib/tender-auto-analysis/enqueue"
      );
      await maybeEnqueueTenderAnalysisAfterUpload({
        projectId,
        documentId: doc.id,
        buffer,
        fileType: ext,
        title: doc.title,
        userId: ownerUserId,
        orgId,
      }).catch((e) => log("auto-enqueue 失败（不阻断）", String(e).slice(0, 120)));
    }
    out.push({ id: doc.id, title: doc.title, sha: sha256(buffer), size: file.size });
  }
  return out;
}

async function canonicalSnapshot(runId: string) {
  const run = await db.tenderAnalysisRun.findUniqueOrThrow({
    where: { id: runId },
    select: { id: true, status: true, model: true, promptVersion: true, analysisVersion: true, summaryJson: true },
  });
  const sj = (run.summaryJson ?? {}) as Record<string, unknown>;
  const [facts, requirements, sourceRefs, sections, clarifications, changes, deliverables] =
    await Promise.all([
      db.tenderAnalysisFact.findMany({
        where: { runId },
        select: { statementKind: true, contentZh: true, sourceRefs: { select: { documentId: true, pageNumber: true } } },
      }),
      db.tenderExtractedRequirement.findMany({
        where: { analysisRunId: runId },
        select: { requirementCode: true, category: true, originalRequirement: true, mandatory: true, evidenceRequired: true, sourcePage: true },
      }),
      db.tenderAnalysisSourceRef.count({ where: { runId } }),
      db.tenderAnalysisSection.findMany({ where: { runId }, select: { sectionKey: true, structuredJson: true } }),
      db.tenderClarificationQuestion.findMany({ where: { analysisRunId: runId }, select: { question: true, priority: true } }),
      db.tenderAnalysisChangeCandidate.count({ where: { runId } }),
      db.tenderDeliverable.findMany({ where: { analysisRunId: runId }, select: { deliverableKey: true, title: true, mandatory: true, sourcePage: true } }),
    ]);
  const risksSection = sections.find((s) => s.sectionKey === "RISKS");
  const rs = (risksSection?.structuredJson ?? {}) as Record<string, unknown>;
  const risks = Array.isArray(rs.risks) ? (rs.risks as Array<Record<string, unknown>>) : [];
  return {
    runId: run.id, status: run.status, model: run.model,
    promptVersion: run.promptVersion, analysisVersion: run.analysisVersion,
    summaryKeys: Object.keys(sj),
    checklist: Array.isArray(sj.submissionChecklist) ? (sj.submissionChecklist as Array<Record<string, unknown>>) : null,
    criticalFacts: sj.criticalFacts ?? null,
    conflicts: Array.isArray(sj.conflicts) ? (sj.conflicts as unknown[]).length : null,
    addendumChanges: Array.isArray(sj.addendumChanges) ? (sj.addendumChanges as unknown[]).length : null,
    unknowns: Array.isArray(sj.unknowns) ? (sj.unknowns as unknown[]).length : null,
    evidenceCoverage: sj.evidenceCoverage ?? null,
    analystSynthesis: sj.analystSynthesis ? "PRESENT" : null,
    brief: sj.brief ? "PRESENT" : null,
    counts: {
      facts: facts.length, requirements: requirements.length, sourceRefs,
      sections: sections.length, clarifications: clarifications.length,
      changes, deliverables: deliverables.length, risks: risks.length,
    },
    facts, requirements, clarifications, deliverables, risks,
  };
}

async function main() {
  console.log(`T5 Segment 4 Final — Legacy A vs Workforce B canonical parity（${TAG}）`);
  log("非生产存储", { PRODUCT_CONTENT_LOCAL_STORE: process.env.PRODUCT_CONTENT_LOCAL_STORE });

  const A = await createProject(`${TAG}-A-legacy`);
  const B = await createProject(`${TAG}-B-workforce`);
  log("projects", { A: A.id, B: B.id });

  const docsA = await uploadPackage(A.id, true); // A：上传即触发 legacy 自动入队（真实链路）
  const docsB = await uploadPackage(B.id, false); // B：由 Start AI Analysis 触发
  log("uploaded", { A: docsA.length, B: docsB.length });

  const shaA = docsA.map((d) => d.sha).sort();
  const shaB = docsB.map((d) => d.sha).sort();
  ok(
    shaA.length === shaB.length && shaA.every((s, i) => s === shaB[i]),
    `INPUT_DOCUMENT_HASH_PARITY = 100%（${shaA.length} 个文件 sha256 完全一致）`,
    { shaA: shaA.map((s) => s.slice(0, 12)), shaB: shaB.map((s) => s.slice(0, 12)) },
  );
  if (fail > 0) {
    console.error("文件 hash 不一致 → STOP，不比较结果");
    await db.$disconnect();
    process.exit(1);
  }

  /* ═════ A 路：legacy full V2（真实 Blob 下载 + 页解析） ═════ */
  const { processQueuedTenderAnalysisRuns } = await import("@/lib/tender-auto-analysis/worker");
  let legacyRunId = "";
  {
    const r = await db.tenderAnalysisRun.findFirst({
      where: { projectId: A.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true },
    });
    ok(!!r, "A：上传自动入队产生 legacy 分析 run", r);
    legacyRunId = r?.id ?? "";
  }
  if (!legacyRunId) { await db.$disconnect(); process.exit(1); }

  const legacyStart = Date.now();
  for (let i = 0; i < 80; i++) {
    const swept = await processQueuedTenderAnalysisRuns(1);
    const row = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: legacyRunId },
      select: { status: true, workerStep: true, errorCode: true, errorMessageSanitized: true },
    });
    log(`legacy slice ${i}`, { processed: swept.processed, status: row.status, step: row.workerStep, err: row.errorCode });
    if (["REVIEW_REQUIRED", "APPROVED", "FAILED"].includes(row.status)) break;
    if (Date.now() - legacyStart > 40 * 60_000) break;
  }
  const legacyRow = await db.tenderAnalysisRun.findUniqueOrThrow({
    where: { id: legacyRunId },
    select: { status: true, errorCode: true, errorMessageSanitized: true },
  });
  const legacyPages = await db.projectDocumentPage.count({
    where: { documentId: { in: docsA.map((d) => d.id) } },
  });
  ok(legacyPages > 0, `LEGACY_BLOB_DOWNLOAD / ENSURE_PAGES = PASS（解析出 ${legacyPages} 页）`, legacyPages);
  ok(
    legacyRow.status === "REVIEW_REQUIRED",
    `LEGACY_FULL_V2 = ${legacyRow.status === "REVIEW_REQUIRED" ? "PASS" : "FAIL"}`,
    legacyRow,
  );

  /* ═════ B 路：确定性 Workforce canonical V2 ═════ */
  const { startTenderWorkforceAnalysis } = await import("@/lib/tender-workforce/trigger-service");
  const { processWorkforceJobSlice } = await import("@/lib/workforce-runtime/processor");
  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerUserId }, select: { role: true } });
  const startedB = await startTenderWorkforceAnalysis({
    orgId, projectId: B.id, projectName: B.name, userId: ownerUserId,
    role: owner.role, requestId: `${TAG}-B`, restart: true,
  });
  ok(startedB.ok, "B：Start AI Analysis 成功创建 Workforce Job", startedB);
  if (!startedB.ok) { await db.$disconnect(); process.exit(1); }
  const jobId = startedB.jobId;
  const jobMeta = ((await db.agentRun.findUniqueOrThrow({ where: { id: jobId }, select: { metadata: true } })).metadata ?? {}) as Record<string, unknown>;

  const bStart = Date.now();
  let terminal = "";
  for (let i = 0; i < 80; i++) {
    await processWorkforceJobSlice(jobId, { sliceBudgetMs: 240_000, maxRounds: 6 });
    const row = await db.agentRun.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } });
    const steps = await db.agentRunStep.findMany({ where: { runId: jobId }, select: { stepKey: true, status: true }, orderBy: { createdAt: "asc" } });
    log(`workforce slice ${i}`, { run: row.status, steps: steps.map((s) => `${s.stepKey}:${s.status}`).join(",") });
    if (["completed", "failed", "cancelled", "needs_human", "awaiting_approval"].includes(row.status)) { terminal = row.status; break; }
    if (Date.now() - bStart > 40 * 60_000) { terminal = `TIMEOUT:${row.status}`; break; }
    await new Promise((r) => setTimeout(r, 1200));
  }
  const wfRun = await db.tenderAnalysisRun.findFirstOrThrow({
    where: { projectId: B.id, analysisVersion: "tender-workforce-analysis-v1" },
    orderBy: { createdAt: "desc" }, select: { id: true, status: true },
  });
  const wfSteps = await db.agentRunStep.findMany({ where: { runId: jobId }, select: { stepKey: true, status: true, outputJson: true, startedAt: true, completedAt: true } });
  const wfEvents = await db.agentRunEvent.count({ where: { runId: jobId, eventType: "job.lease_renewed" } });
  const t3 = wfSteps.find((s) => s.stepKey === "t3_analyze_package_v2");
  const t3Out = (t3?.outputJson ?? {}) as Record<string, unknown>;
  const verifs = await db.agentRunVerification.findMany({ where: { runId: jobId }, select: { verdict: true, satisfiedCriteriaJson: true } });

  ok(terminal === "completed", `WORKFORCE_STATUS = ${terminal}`, terminal);
  ok(wfSteps.filter((s) => s.status === "completed").length === 9, `WORKFORCE_TASKS = ${wfSteps.filter((s) => s.status === "completed").length}/9`);
  ok(wfRun.status === "REVIEW_REQUIRED", `WORKFORCE_TENDER_STATUS = ${wfRun.status}`);
  ok(jobMeta.planSource === "SERVER_AUTHORED" && jobMeta.planTaskCount === 9 && jobMeta.plannerLlmCalls === 0,
    "PLAN_SOURCE=SERVER_AUTHORED / 9 tasks / PLANNER_LLM_CALLS=0", jobMeta);
  ok(verifs.some((v) => v.verdict === "PASS"), "verifier PASS（VERIFIER_MODEL_CALLS=0，确定性标准）", verifs.map((v) => v.verdict));

  /* ═════ canonical parity ═════ */
  const a = await canonicalSnapshot(legacyRunId);
  const b = await canonicalSnapshot(wfRun.id);
  console.log("\nA(legacy) counts:", JSON.stringify(a.counts));
  console.log("B(workforce) counts:", JSON.stringify(b.counts));

  const DOMAINS = ["facts", "requirements", "sourceRefs", "sections", "clarifications", "deliverables", "risks"] as const;
  const missingInB = DOMAINS.filter((d) => a.counts[d] > 0 && b.counts[d] === 0);
  const missingInA = DOMAINS.filter((d) => b.counts[d] > 0 && a.counts[d] === 0);
  ok(missingInB.length === 0 && missingInA.length === 0,
    "CANONICAL_CONTRACT_PARITY：无任一 canonical domain 单边整体缺失", { missingInB, missingInA });

  const SUMMARY_FIELDS = ["submissionChecklist", "criticalFacts", "conflicts", "addendumChanges", "unknowns", "evidenceCoverage", "analystSynthesis", "brief", "metadata"];
  const aMissing = SUMMARY_FIELDS.filter((f) => !a.summaryKeys.includes(f));
  const bMissing = SUMMARY_FIELDS.filter((f) => !b.summaryKeys.includes(f));
  ok(aMissing.length === 0 && bMissing.length === 0,
    "summaryJson 语义字段两路齐备", { aMissing, bMissing });

  console.log("\nRESULT_JSON " + JSON.stringify({
    tag: TAG,
    projectA: A.id, projectB: B.id,
    documents: docsA.map((d, i) => ({ title: d.title, size: d.size, shaA: d.sha.slice(0, 16), shaB: docsB[i].sha.slice(0, 16) })),
    legacy: { runId: a.runId, status: a.status, model: a.model, promptVersion: a.promptVersion, analysisVersion: a.analysisVersion, pages: legacyPages, counts: a.counts, summaryKeys: a.summaryKeys, checklistCount: a.checklist?.length ?? null },
    workforce: { jobId, runId: b.runId, status: b.status, model: b.model, terminal, counts: b.counts, summaryKeys: b.summaryKeys, checklistCount: b.checklist?.length ?? null, leaseRenewals: wfEvents, t3DurationMs: t3?.startedAt && t3?.completedAt ? t3.completedAt.getTime() - t3.startedAt.getTime() : null, t3Telemetry: { llmCalls: t3Out.llmCalls, llmFailures: t3Out.llmFailures, model: t3Out.model } },
    samples: {
      legacyRequirements: a.requirements.slice(0, 10),
      workforceRequirements: b.requirements.slice(0, 10),
      legacyRisks: a.risks.slice(0, 10).map((r) => ({ severity: r.severity, description: String(r.description ?? "").slice(0, 140) })),
      workforceRisks: b.risks.slice(0, 10).map((r) => ({ severity: r.severity, description: String(r.description ?? "").slice(0, 140) })),
      legacyChecklist: (a.checklist ?? []).slice(0, 10),
      workforceChecklist: (b.checklist ?? []).slice(0, 10),
      legacyClarifications: a.clarifications.slice(0, 10),
      workforceClarifications: b.clarifications.slice(0, 10),
      legacyFacts: a.facts.slice(0, 10).map((f) => ({ kind: f.statementKind, content: f.contentZh.slice(0, 120), refs: f.sourceRefs.length })),
      workforceFacts: b.facts.slice(0, 10).map((f) => ({ kind: f.statementKind, content: f.contentZh.slice(0, 120), refs: f.sourceRefs.length })),
      workforceDeliverables: b.deliverables.slice(0, 10),
    },
  }));

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("PARITY_ERROR", e instanceof Error ? e.stack : e);
  await db.$disconnect();
  process.exit(1);
});
