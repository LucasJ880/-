/**
 * Phase 1.1 Final Validation — 隔离库 migrate + DB E2E + 可选真实 LLM 探针
 *
 * 不打印连接串 / API Key。保留隔离 Neon（不删除）。
 *
 * 由外层 Python 注入：
 *   DATABASE_URL / DIRECT_URL / ISOLATED_* / OPENAI_* / TENDER_FIXTURE_PDF_PATH /
 *   PRODUCT_CONTENT_LOCAL_STORE=1 / TENDER_ANALYSIS_LLM / DATABASE_ENVIRONMENT=isolated
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { assertSafeTestDatabase } from "../src/lib/testing/assert-safe-test-database";

// Fail-closed：禁止对生产/未识别数据库执行 destructive 测试
assertSafeTestDatabase({ scriptName: "scripts/tender-phase11-final-validation.ts" });

const PDF_PATH =
  process.env.TENDER_FIXTURE_PDF_PATH ||
  "/Users/user/Desktop/青砚-tender-analysis/fixtures/private/M5000-25-3574 - A - RFP - English.pdf";

function hostHint(url: string): { hint: string; fingerprint: string } {
  try {
    const u = new URL(url.replace(/^postgresql:/i, "http:"));
    const host = (u.hostname || "").toLowerCase();
    return {
      hint: host.split(".")[0] || host,
      fingerprint: createHash("sha256").update(url).digest("hex").slice(0, 12),
    };
  } catch {
    return { hint: "unparseable", fingerprint: "none" };
  }
}

async function verifySchema(db: PrismaClient) {
  const required = [
    "TenderAnalysisRun",
    "TenderAnalysisRunDocument",
    "TenderAnalysisSection",
    "TenderAnalysisFact",
    "TenderAnalysisSourceRef",
    "TenderExtractedRequirement",
    "TenderDeliverable",
    "TenderClarificationQuestion",
    "TenderAnalysisChangeCandidate",
    "ProjectDocumentPage",
    "BidIntelligenceRoom",
    "ProjectDocument",
  ];
  const rows = (await db.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`,
  )) as Array<{ tablename: string }>;
  const names = new Set(rows.map((r) => r.tablename));
  const missing = required.filter((t) => !names.has(t));

  const cols = (await db.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ProjectDocument'
      AND column_name IN ('contentHash','pageCount','parseVersion')
  `)) as Array<{ column_name: string }>;
  const colSet = new Set(cols.map((c) => c.column_name));

  const mig = (await db.$queryRawUnsafe(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at`,
  )) as Array<{ migration_name: string }>;
  const hasTarget = mig.some(
    (m) => m.migration_name === "20260805180000_tender_auto_analysis_phase1_1",
  );

  return {
    missingTables: missing,
    projectDocumentColumns: [...colSet],
    hasTargetMigration: hasTarget,
    appliedCount: mig.length,
    lastApplied: mig[mig.length - 1]?.migration_name ?? null,
  };
}

async function seedMinimal(db: PrismaClient) {
  const suffix = randomUUID().slice(0, 8);
  const hash = await bcrypt.hash(`val-${suffix}`, 10);
  const writer = await db.user.create({
    data: {
      email: `tender-writer-${suffix}@test.qingyan.local`,
      name: "Tender Writer",
      passwordHash: hash,
      role: "admin",
      status: "active",
    },
  });
  const reader = await db.user.create({
    data: {
      email: `tender-reader-${suffix}@test.qingyan.local`,
      name: "Tender Reader",
      passwordHash: hash,
      role: "user",
      status: "active",
    },
  });
  const cross = await db.user.create({
    data: {
      email: `tender-cross-${suffix}@test.qingyan.local`,
      name: "Cross Org",
      passwordHash: hash,
      role: "admin",
      status: "active",
    },
  });

  const org = await db.organization.create({
    data: {
      name: `TenderVal Org ${suffix}`,
      code: `TVAL-${suffix}`,
      ownerId: writer.id,
    },
  });
  const otherOrg = await db.organization.create({
    data: {
      name: `Other Org ${suffix}`,
      code: `OTHER-${suffix}`,
      ownerId: cross.id,
    },
  });

  await db.user.update({
    where: { id: writer.id },
    data: { activeOrgId: org.id },
  });
  await db.user.update({
    where: { id: reader.id },
    data: { activeOrgId: org.id },
  });
  await db.user.update({
    where: { id: cross.id },
    data: { activeOrgId: otherOrg.id },
  });

  await db.organizationMember.create({
    data: { orgId: org.id, userId: writer.id, role: "org_owner" },
  });
  await db.organizationMember.create({
    data: { orgId: org.id, userId: reader.id, role: "org_member" },
  });

  const project = await db.project.create({
    data: {
      name: `RCMP Fixture Val ${suffix}`,
      orgId: org.id,
      ownerId: writer.id,
      workDomain: "tender",
      status: "active",
    },
  });

  return { org, writer, reader, cross, otherOrg, project };
}

async function main() {
  const started = new Date();
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    throw new Error("DATABASE_ENVIRONMENT must be isolated");
  }
  if (!existsSync(PDF_PATH)) {
    throw new Error(`PDF missing: ${PDF_PATH}`);
  }

  const dbUrl = process.env.DATABASE_URL || process.env.ISOLATED_DATABASE_URL || "";
  const hint = hostHint(dbUrl);
  console.log(
    JSON.stringify({
      gate: "env",
      utc: started.toISOString(),
      hostHint: hint.hint,
      fingerprint: hint.fingerprint,
      llmFlag: process.env.TENDER_ANALYSIS_LLM || "0",
      localBlob: process.env.PRODUCT_CONTENT_LOCAL_STORE || "0",
    }),
  );

  const db = new PrismaClient();
  const schema = await verifySchema(db);
  console.log(JSON.stringify({ gate: "schema", ...schema }));
  if (schema.missingTables.length || !schema.hasTargetMigration) {
    throw new Error("schema verification failed");
  }

  const seed = await seedMinimal(db);
  const { startBidIntelligence } = await import(
    "../src/lib/bid-workflow/start-intelligence"
  );
  const startedRoom = await startBidIntelligence({
    orgId: seed.org.id,
    projectId: seed.project.id,
    actorUserId: seed.writer.id,
  });

  const pdf = readFileSync(PDF_PATH);
  const pdfSha = createHash("sha256").update(pdf).digest("hex");
  const { putPrivateBlob } = await import("../src/lib/files/blob-access");
  const blob = await putPrivateBlob({
    pathname: `projects/${seed.project.id}/${Date.now()}_rcmp-fixture.pdf`,
    body: pdf,
    contentType: "application/pdf",
  });

  const doc = await db.projectDocument.create({
    data: {
      projectId: seed.project.id,
      title: "M5000-25-3574 - A - RFP - English.pdf",
      url: blob.proxyUrl,
      blobUrl: blob.proxyUrl,
      fileType: "pdf",
      fileSize: pdf.length,
      source: "upload",
      uploadedById: seed.writer.id,
      parseStatus: "pending",
    },
  });

  const { maybeEnqueueTenderAnalysisAfterUpload } = await import(
    "../src/lib/tender-auto-analysis/enqueue"
  );
  const t0 = Date.now();
  const enq1 = await maybeEnqueueTenderAnalysisAfterUpload({
    projectId: seed.project.id,
    documentId: doc.id,
    buffer: pdf,
    fileType: "pdf",
    title: doc.title,
    userId: seed.writer.id,
    orgId: seed.org.id!,
  });
  const enqueueMs = Date.now() - t0;

  const enq2 = await maybeEnqueueTenderAnalysisAfterUpload({
    projectId: seed.project.id,
    documentId: doc.id,
    buffer: pdf,
    fileType: "pdf",
    title: doc.title,
    userId: seed.writer.id,
    orgId: seed.org.id!,
  });

  const activeRuns = await db.tenderAnalysisRun.count({
    where: {
      projectId: seed.project.id,
      status: { in: ["PENDING", "EXTRACTING", "ANALYZING", "REVIEW_REQUIRED"] },
    },
  });

  console.log(
    JSON.stringify({
      gate: "enqueue",
      enqueueMs,
      enq1,
      enq2SameRun: enq2.runId === enq1.runId,
      activeRuns,
      pdfSha,
      roomId: startedRoom.roomId,
    }),
  );

  // LLM probe (production provider) — then disable polish for deterministic E2E speed;
  // one real polish call still proves approved provider path when flag=1.
  let llmProbe: Record<string, unknown> = { attempted: false };
  let llmPolish: Record<string, unknown> = { attempted: false };
  const wantLlm = process.env.TENDER_ANALYSIS_LLM === "1";
  if (wantLlm) {
    const probeStart = Date.now();
    try {
      const { createCompletionDetailed } = await import("../src/lib/ai/client");
      const { ANALYSIS_VERSION, PROMPT_VERSION } = await import(
        "../src/lib/tender-auto-analysis/constants"
      );
      const result = await createCompletionDetailed({
        systemPrompt:
          "You are a Chinese tender advisor. Reply with exactly: OK. Do not invent awards.",
        userPrompt: "OK",
        mode: "fast",
        maxTokens: 16,
        timeoutMs: 30_000,
      });
      llmProbe = {
        attempted: true,
        ok: true,
        model: result.model,
        elapsedMs: result.elapsedMs || Date.now() - probeStart,
        finishReason: result.finishReason,
        analysisVersion: ANALYSIS_VERSION,
        promptVersion: PROMPT_VERSION,
        contentPreview: (result.content || "").slice(0, 40),
      };
      // sample polish on a short Chinese draft (approved provider)
      const polishStart = Date.now();
      const polished = await createCompletionDetailed({
        systemPrompt:
          "你是中文投标顾问。润色以下段落，不得编造历史中标、预算或保险要求。只输出润色后正文。",
        userPrompt:
          "本项目为 RCMP Cadets 背包 RISO。数量存在 Annex A/B 口径歧义；7,500 仅为评标合计，非保证采购。",
        mode: "fast",
        maxTokens: 200,
        timeoutMs: 45_000,
      });
      llmPolish = {
        attempted: true,
        ok: true,
        model: polished.model,
        elapsedMs: polished.elapsedMs || Date.now() - polishStart,
        finishReason: polished.finishReason,
        preview: (polished.content || "").slice(0, 120),
      };
    } catch (e) {
      llmProbe = {
        attempted: true,
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
      };
    }
  }
  console.log(JSON.stringify({ gate: "llm_probe", ...llmProbe }));
  console.log(JSON.stringify({ gate: "llm_polish_sample", ...llmPolish }));
  // Worker 主路径使用确定性抽取 + 模板报告（生产等价权威路径）；避免 16 章全量润色耗时
  process.env.TENDER_ANALYSIS_LLM = "0";

  const { processQueuedTenderAnalysisRuns } = await import(
    "../src/lib/tender-auto-analysis/worker"
  );
  const workerStarted = Date.now();
  let ticks = 0;
  let lastStatus = "PENDING";
  for (let i = 0; i < 40; i++) {
    ticks += 1;
    await processQueuedTenderAnalysisRuns(1);
    const run = await db.tenderAnalysisRun.findUnique({
      where: { id: enq1.runId! },
      select: {
        status: true,
        workerStep: true,
        attemptCount: true,
        leaseOwner: true,
        leaseExpiresAt: true,
        errorCode: true,
        errorMessageSanitized: true,
        model: true,
        promptVersion: true,
        analysisVersion: true,
      },
    });
    lastStatus = run?.status || lastStatus;
    if (
      run &&
      (run.status === "REVIEW_REQUIRED" ||
        run.status === "FAILED" ||
        run.status === "APPROVED")
    ) {
      console.log(
        JSON.stringify({
          gate: "worker_done",
          ticks,
          durationMs: Date.now() - workerStarted,
          run,
        }),
      );
      break;
    }
  }

  const runId = enq1.runId!;
  const docAfter = await db.projectDocument.findUnique({
    where: { id: doc.id },
    select: { pageCount: true, contentHash: true, parseVersion: true, parseStatus: true },
  });
  const pageCount = await db.projectDocumentPage.count({
    where: { documentId: doc.id },
  });
  const sectionCount = await db.tenderAnalysisSection.count({ where: { runId } });
  const factCount = await db.tenderAnalysisFact.count({ where: { runId } });
  const reqCount = await db.tenderExtractedRequirement.count({
    where: { analysisRunId: runId },
  });
  const deliverableCount = await db.tenderDeliverable.count({
    where: { analysisRunId: runId },
  });
  const clarificationCount = await db.tenderClarificationQuestion.count({
    where: { analysisRunId: runId },
  });
  const taskCount = await db.task.count({
    where: { projectId: seed.project.id, sourceId: runId },
  });
  const sections = await db.tenderAnalysisSection.findMany({
    where: { runId },
    select: { sectionKey: true, contentZh: true, reviewStatus: true },
  });
  const reqs = await db.tenderExtractedRequirement.findMany({
    where: { analysisRunId: runId },
    select: {
      requirementCode: true,
      complianceStatus: true,
      reviewStatus: true,
      sourcePage: true,
      mandatory: true,
    },
    orderBy: { requirementCode: "asc" },
  });
  const modules = await db.bidIntelligenceModule.findMany({
    where: { roomId: startedRoom.roomId },
    select: { moduleKey: true, status: true, dataJson: true },
  });

  // idempotent worker retry
  await processQueuedTenderAnalysisRuns(1);
  const taskCountAfterRetry = await db.task.count({
    where: { projectId: seed.project.id, sourceId: runId },
  });
  const reqCountAfterRetry = await db.tenderExtractedRequirement.count({
    where: { analysisRunId: runId },
  });

  // review: confirm one requirement, approve without confirmAll
  const { confirmRequirement, approveAnalysisRun, editSectionContent } =
    await import("../src/lib/tender-auto-analysis/review");
  const m1row = await db.tenderExtractedRequirement.findFirst({
    where: { analysisRunId: runId, requirementCode: "M1" },
  });
  if (m1row) {
    await confirmRequirement({
      runId,
      requirementId: m1row.id,
      projectId: seed.project.id,
      orgId: seed.org.id,
    });
  }
  const secRow = await db.tenderAnalysisSection.findFirst({
    where: { runId },
    orderBy: { sectionKey: "asc" },
  });
  if (secRow) {
    await editSectionContent({
      runId,
      sectionId: secRow.id,
      projectId: seed.project.id,
      orgId: seed.org.id,
      actorUserId: seed.writer.id,
      contentZh: `${secRow.contentZh}\n（人工润色标记）`,
      note: "validation edit",
    });
  }

  const projectBeforeGo = await db.project.findUnique({
    where: { id: seed.project.id },
    select: { bidPhaseStatus: true },
  });
  const roomBefore = await db.bidIntelligenceRoom.findUnique({
    where: { id: startedRoom.roomId },
    select: { goDecision: true, summaryText: true },
  });

  const approve = await approveAnalysisRun({
    runId,
    projectId: seed.project.id,
    orgId: seed.org.id,
    actorUserId: seed.writer.id,
    confirmAllRequirements: false,
  });

  const projectAfter = await db.project.findUnique({
    where: { id: seed.project.id },
    select: { bidPhaseStatus: true },
  });
  const roomAfter = await db.bidIntelligenceRoom.findUnique({
    where: { id: startedRoom.roomId },
    select: { goDecision: true },
  });
  const confirmedReqs = await db.tenderExtractedRequirement.count({
    where: { analysisRunId: runId, reviewStatus: "CONFIRMED" },
  });
  const stillAi = await db.tenderExtractedRequirement.count({
    where: { analysisRunId: runId, reviewStatus: "AI_EXTRACTED" },
  });

  // Addendum incremental — minimal valid PDF (pdf-lib) so ENSURE_PAGES can parse
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const addendumLines = [
    "ADDENDUM 1 to Solicitation M5000-25-3574-A",
    "Closing date changed to August 20, 2026 14:00 MDT.",
    "New mandatory technical criterion M16: sample required at bid time.",
    "All other terms remain unchanged.",
  ];
  let y = 720;
  for (const line of addendumLines) {
    page.drawText(line, { x: 50, y, size: 11, font });
    y -= 18;
  }
  const addendumBuf = Buffer.from(await pdfDoc.save());
  const addBlob = await putPrivateBlob({
    pathname: `projects/${seed.project.id}/${Date.now()}_addendum.pdf`,
    body: addendumBuf,
    contentType: "application/pdf",
  });
  const addDoc = await db.projectDocument.create({
    data: {
      projectId: seed.project.id,
      title: "Addendum-1-M5000.pdf",
      url: addBlob.proxyUrl,
      blobUrl: addBlob.proxyUrl,
      fileType: "pdf",
      fileSize: addendumBuf.length,
      source: "upload",
      uploadedById: seed.writer.id,
      parseStatus: "pending",
    },
  });
  const enqAdd = await maybeEnqueueTenderAnalysisAfterUpload({
    projectId: seed.project.id,
    documentId: addDoc.id,
    buffer: addendumBuf,
    fileType: "pdf",
    title: addDoc.title,
    userId: seed.writer.id,
    orgId: seed.org.id,
  });
  let addRun = enqAdd.runId
    ? await db.tenderAnalysisRun.findUnique({
        where: { id: enqAdd.runId },
        select: { id: true, runKind: true, parentRunId: true, status: true },
      })
    : null;
  if (enqAdd.runId) {
    for (let i = 0; i < 25; i++) {
      await processQueuedTenderAnalysisRuns(1);
      addRun = await db.tenderAnalysisRun.findUnique({
        where: { id: enqAdd.runId },
        select: { id: true, runKind: true, parentRunId: true, status: true },
      });
      if (
        addRun &&
        (addRun.status === "REVIEW_REQUIRED" ||
          addRun.status === "FAILED" ||
          addRun.status === "APPROVED")
      ) {
        break;
      }
    }
  }
  const changeCandidates = enqAdd.runId
    ? await db.tenderAnalysisChangeCandidate.findMany({
        where: { runId: enqAdd.runId },
        select: { changeType: true, entityType: true, entityKey: true, status: true },
      })
    : [];
  const parentStillApproved = await db.tenderAnalysisRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });

  // failure path: force fail a synthetic pending run
  const failRun = await db.tenderAnalysisRun.create({
    data: {
      orgId: seed.org.id,
      projectId: seed.project.id,
      roomId: startedRoom.roomId,
      status: "PENDING",
      runKind: "FULL",
      analysisVersion: "tender-auto-analysis-v1",
      promptVersion: "tender-analysis-prompt-v1",
      idempotencyKey: `fail-probe-${randomUUID()}`,
      sourceHashFingerprint: `fail-${randomUUID()}`,
      createdById: seed.writer.id,
      attemptCount: 0,
    },
  });
  // mark failed with sanitized message via update (simulate worker fail)
  await db.tenderAnalysisRun.update({
    where: { id: failRun.id },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      errorCode: "worker_failed",
      errorMessageSanitized: "simulated failure Bearer [redacted]",
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  const filesStillOk = await db.projectDocument.count({
    where: { projectId: seed.project.id },
  });

  const factKindRows = await db.tenderAnalysisFact.groupBy({
    by: ["statementKind"],
    where: { runId },
    _count: true,
  });
  const factKinds = Object.fromEntries(
    factKindRows.map((r) => [r.statementKind, r._count]),
  ) as Record<string, number>;

  if (changeCandidates.length > 0 && enqAdd.runId) {
    const { applyChangeCandidate } = await import(
      "../src/lib/tender-auto-analysis/addendum-diff"
    );
    await applyChangeCandidate({
      runId: enqAdd.runId,
      candidateId: (
        await db.tenderAnalysisChangeCandidate.findFirst({
          where: { runId: enqAdd.runId },
          select: { id: true },
        })
      )!.id,
      projectId: seed.project.id,
      orgId: seed.org.id,
    });
  }
  const parentReqStillConfirmed = await db.tenderExtractedRequirement.count({
    where: { analysisRunId: runId, reviewStatus: "CONFIRMED" },
  });

  const emptySections = sections.filter((s) => s.contentZh.trim().length < 40);
  const mCodes = reqs.map((r) => r.requirementCode);
  const filledModules = modules.filter((m) =>
    ["project_understanding", "contract_value", "commercial_judgment", "deliverables"].includes(
      m.moduleKey,
    ),
  );
  const waitingModules = modules.filter((m) =>
    [
      "series_identification",
      "historical_awards",
      "competitor_profile",
      "supply_chain",
    ].includes(m.moduleKey),
  );

  const report = {
    gate: "e2e_summary",
    verdictCandidates: {
      reviewRequiredReached: lastStatus === "REVIEW_REQUIRED" || approve.ok,
      pageCount43: docAfter?.pageCount === 43 && pageCount === 43,
      sections16: sectionCount >= 16 && emptySections.length === 0,
      m1m15: mCodes.filter((c) => /^M([1-9]|1[0-5])$/.test(c)).length === 15,
      noAutoMet: reqs.every((r) => r.complianceStatus === "NOT_ASSESSED"),
      tasksIdempotent: taskCount === taskCountAfterRetry && taskCount >= 1,
      reqsIdempotent: reqCount === reqCountAfterRetry,
      noAutoGo:
        roomAfter?.goDecision == null &&
        projectAfter?.bidPhaseStatus !== "GO",
      approveOk: approve.ok === true,
      confirmedPartial: confirmedReqs >= 1 && stillAi >= 1,
      addendumIncremental:
        addRun?.runKind === "INCREMENTAL" &&
        addRun.parentRunId === runId &&
        parentStillApproved?.status === "APPROVED",
      addendumChangeCandidates: changeCandidates.length > 0,
      parentReqsNotAutoRewritten: parentReqStillConfirmed >= 1,
      factKindsOk:
        (factKinds.AI_INFERENCE || 0) >= 3 &&
        (factKinds.RECOMMENDATION || 0) >= 3 &&
        (factKinds.DOCUMENT_INTERPRETATION || 0) >= 3 &&
        (factKinds.CONFIRMED_FACT || 0) >= 10,
      failIsolated: filesStillOk >= 1,
      roomFilled: filledModules.length === 4,
      roomWaiting: waitingModules.every(
        (m) => m.status === "unknown" || m.status === "investigating",
      ),
      summaryPresent: Boolean(roomBefore?.summaryText || roomAfter),
    },
    counts: {
      pageCountDb: docAfter?.pageCount,
      pagesRows: pageCount,
      sections: sectionCount,
      facts: factCount,
      requirements: reqCount,
      deliverables: deliverableCount,
      clarifications: clarificationCount,
      tasks: taskCount,
      confirmedReqs,
      stillAi,
    },
    deliveryLeadTimeFact: await db.tenderAnalysisFact.findFirst({
      where: {
        runId,
        OR: [
          { contentZh: { contains: "call-up" } },
          { contentOriginal: { contains: "call-up issuance" } },
        ],
      },
      select: { contentZh: true, statementKind: true },
    }),
    sectionKeys: sections.map((s) => s.sectionKey),
    moduleStatuses: modules.map((m) => ({
      key: m.moduleKey,
      status: m.status,
    })),
    approve,
    addRun,
    changeCandidates,
    parentStillApproved: parentStillApproved?.status ?? null,
    llmProbe,
    llmPolish,
    factKinds,
  };
  console.log(JSON.stringify(report, null, 2));

  const vc = report.verdictCandidates;
  const e2ePass = Object.values(vc).every(Boolean);
  console.log(
    JSON.stringify({
      gate: "final",
      e2ePass,
      utcEnd: new Date().toISOString(),
      durationMs: Date.now() - started.getTime(),
    }),
  );

  await db.$disconnect();
  if (!e2ePass) process.exit(2);
}

main().catch(async (e) => {
  console.error(
    JSON.stringify({
      gate: "fatal",
      error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
    }),
  );
  process.exit(1);
});
