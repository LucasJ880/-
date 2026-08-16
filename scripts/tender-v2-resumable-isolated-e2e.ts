/**
 * V2 分片续跑 — 隔离库集成验证（无真实 LLM，无 Blob）
 *
 * 覆盖纯逻辑测不到的那层：Prisma jsonb 检查点往返、lease fence 的真实 SQL 语义、
 * canonical 落库、陈旧扫描的真实查询路径、以及 worker 状态机在真实 DB 上的续跑。
 *
 * 用法（必须指向**隔离** Neon 分支，绝不指生产）：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     npx tsx scripts/tender-v2-resumable-isolated-e2e.ts
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import { advanceAndPersistV2 } from "@/lib/tender-auto-analysis/v2-persist";
import { parseV2Cursor } from "@/lib/tender-auto-analysis/v2-cursor";
import { fingerprintAnalyzerInput } from "@/lib/tender-auto-analysis/v2-resumable";
import { buildAnalyzerInputForRun } from "@/lib/tender-auto-analysis/v2-persist";
import {
  processQueuedTenderAnalysisRuns,
  LEASE_MS,
} from "@/lib/tender-auto-analysis/worker";
import { PARSE_VERSION } from "@/lib/tender-auto-analysis/constants";
import {
  ANALYST_PROMPT_NAME,
  ANALYST_QA_PROMPT_NAME,
} from "@/lib/tender-analyst/contract";

const db = new PrismaClient();

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

function assertIsolated(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL 未设置");
  if (/ep-super-field-antfibsl/.test(url)) {
    throw new Error("拒绝在生产库上运行（fail-closed）");
  }
  if (process.env.DATABASE_ENVIRONMENT !== "isolated") {
    throw new Error("DATABASE_ENVIRONMENT 必须为 isolated");
  }
}

const SUBJECTS = ["mattress covers", "curtain rails", "workshop benches"];
const SHEET_UNIT_LABEL = "Sheet「Category A Pricing」";
const SHEET_UNIT_TEXT =
  "Sheet: Category A Pricing\nItem,Description,Qty\n1,Bedroom desk,120\n2,Study chair,240";
const pageText = (i: number) =>
  `Page ${i} — Section ${i}. The vendor must supply ${SUBJECTS[i - 1]} and complete installation within ${i * 3} days.`;
const snippet = (i: number) =>
  `The vendor must supply ${SUBJECTS[i - 1]} and complete installation within ${i * 3} days.`;

let llmCalls = 0;
let sheetPromptSeen: string | null = null;
const invoker: LlmInvoker = async (req) => {
  llmCalls += 1;
  if (req.promptName.includes("extract")) {
    // xlsx 单元窗口：prompt 里应出现 UNIT/sheet 定位而非 PAGE
    if (req.userPrompt.includes("Category A Pricing")) {
      sheetPromptSeen = req.userPrompt;
      return {
        content: JSON.stringify({
          facts: [],
          potentialRisks: [],
          ambiguities: [],
          requirements: [
            {
              category: "PRICING",
              statement: "Bidder must price 120 bedroom desks in Category A.",
              actor: "Bidder",
              action: "price",
              object: "bedroom desks",
              mandatory: true,
              mandatorySignal: "must",
              deadline: null,
              quantity: "120",
              unit: "EA",
              submissionStage: null,
              technicalArea: null,
              revisionAction: null,
              revisionTargetHint: null,
              sourceDocumentId: `doc-sheet-${TAG}`,
              pageNumber: 1,
              sourceSnippet: "1,Bedroom desk,120",
              confidence: "HIGH",
            },
          ],
        }),
        model: "scripted-e2e-model",
        elapsedMs: 1,
      };
    }
    const pages = [...req.userPrompt.matchAll(/Page (\d+) — Section/g)].map((m) =>
      Number(m[1]),
    );
    const uniq = Array.from(new Set(pages));
    return {
      content: JSON.stringify({
        facts: uniq
          .filter((i) => i === 1)
          .map((i) => ({
            factType: "delivery",
            claim: `${SUBJECTS[i - 1]} installed within ${i * 3} days`,
            rawValue: `${i * 3} days`,
            sourceDocumentId: `doc-${i}-${TAG}`,
            pageNumber: 1,
            sourceSnippet: snippet(i),
            confidence: "HIGH",
          })),
        requirements: uniq.map((i) => ({
          category: "DELIVERY",
          statement: `Vendor must supply ${SUBJECTS[i - 1]} and install within ${i * 3} days.`,
          actor: "Vendor",
          action: "supply",
          object: SUBJECTS[i - 1],
          mandatory: true,
          mandatorySignal: "must",
          deadline: null,
          quantity: null,
          unit: null,
          submissionStage: null,
          technicalArea: null,
          revisionAction: null,
          revisionTargetHint: null,
          sourceDocumentId: `doc-${i}-${TAG}`,
          pageNumber: 1,
          sourceSnippet: snippet(i),
          confidence: "HIGH",
        })),
        potentialRisks: [],
        ambiguities: uniq.map((i) => ({
          topic: `${SUBJECTS[i - 1]} packaging`,
          description: `Packaging for ${SUBJECTS[i - 1]} is not specified anywhere.`,
          whatIsUnknown: `packaging spec for ${SUBJECTS[i - 1]}`,
          sourceDocumentId: `doc-${i}-${TAG}`,
          pageNumber: 1,
          sourceSnippet: snippet(i),
          confidence: "MEDIUM",
        })),
      }),
      model: "scripted-e2e-model",
      elapsedMs: 1,
    };
  }
  if (req.promptName.includes("resolve")) {
    return {
      content: JSON.stringify({
        resolved: false,
        answerSummary: null,
        answerDocumentId: null,
        answerPageNumber: null,
        answerSnippet: null,
      }),
      model: "scripted-e2e-model",
      elapsedMs: 1,
    };
  }
  if (req.promptName === ANALYST_PROMPT_NAME) {
    return {
      content: JSON.stringify({
        executiveBrief: {
          oneLinerZh: "隔离库集成验证用合成结论。",
          whatIsBeingBoughtZh: "若干物项供货与安装。",
          bidderTakeawayZh: "交期是主要约束。",
          keyPoints: [],
        },
        scope: {
          overviewZh: "合成范围。",
          deliverables: [],
          quantities: [],
          deliveryScope: [],
          exclusionsOrUnknowns: [],
        },
        keyRequirements: [],
        technicalRequirements: [],
        commercialAndDelivery: [],
        risksAndGaps: [],
        clarifications: [],
        currentAssessment: {
          status: "NEEDS_CLARIFICATION",
          summaryZh: "需澄清包装规格。",
          reasons: [],
          mustResolveBeforePricing: [],
        },
        nextActions: [],
      }),
      model: "scripted-e2e-model",
      elapsedMs: 1,
    };
  }
  if (req.promptName === ANALYST_QA_PROMPT_NAME) {
    return {
      content: JSON.stringify({
        verdict: "APPROVE",
        issues: [],
        needsHumanReview: false,
        revised: null,
      }),
      model: "scripted-e2e-model",
      elapsedMs: 1,
    };
  }
  throw new Error(`unexpected prompt ${req.promptName}`);
};

const TAG = `v2res_${randomUUID().slice(0, 8)}`;

async function seed(): Promise<{ orgId: string; projectId: string; docIds: string[] }> {
  const user = await db.user.create({
    data: {
      email: `${TAG}@example.test`,
      name: `${TAG}`,
      role: "sales",
    },
    select: { id: true },
  });
  const org = await db.organization.create({
    data: { name: `${TAG}-org`, code: `${TAG}-org`, ownerId: user.id },
    select: { id: true },
  });
  const project = await db.project.create({
    data: {
      name: `${TAG} 招标包`,
      orgId: org.id,
      workDomain: "tender",
      ownerId: user.id,
    },
    select: { id: true },
  });

  const docIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const doc = await db.projectDocument.create({
      data: {
        id: `doc-${i}-${TAG}`,
        projectId: project.id,
        title: `Doc ${i}.pdf`,
        fileType: "pdf",
        url: `https://example.invalid/${TAG}/${i}.pdf`,
        blobUrl: `https://example.invalid/${TAG}/${i}.pdf`,
        contentText: pageText(i),
        contentHash: `hash-${i}`,
        pageCount: 1,
        parseStatus: "done",
        parseVersion: PARSE_VERSION,
        source: "upload",
      },
      select: { id: true },
    });
    await db.projectDocumentPage.create({
      data: {
        documentId: doc.id,
        pageNumber: 1,
        contentText: pageText(i),
        charCount: pageText(i).length,
        extractionMethod: "unpdf",
        parseStatus: "done",
      },
    });
    docIds.push(doc.id);
  }

  // 第 4 个文档：xlsx 报价表 —— 单元（sheet）而非页，验证引用不显示假页码
  const sheetDoc = await db.projectDocument.create({
    data: {
      id: `doc-sheet-${TAG}`,
      projectId: project.id,
      title: "Appendix C - Pricing Form.xlsx",
      fileType: "xlsx",
      url: `https://example.invalid/${TAG}/pricing.xlsx`,
      blobUrl: `https://example.invalid/${TAG}/pricing.xlsx`,
      contentText: SHEET_UNIT_TEXT,
      contentHash: "hash-4",
      pageCount: 1,
      parseStatus: "done",
      parseVersion: PARSE_VERSION,
      source: "upload",
    },
    select: { id: true },
  });
  await db.projectDocumentPage.create({
    data: {
      documentId: sheetDoc.id,
      pageNumber: 1,
      contentText: SHEET_UNIT_TEXT,
      charCount: SHEET_UNIT_TEXT.length,
      extractionMethod: "sheet-csv",
      parseStatus: "done",
      unitKind: "sheet",
      unitLabel: SHEET_UNIT_LABEL,
    },
  });
  docIds.push(sheetDoc.id);

  return { orgId: org.id, projectId: project.id, docIds };
}

async function createRun(args: {
  orgId: string;
  projectId: string;
  docIds: string[];
  suffix: string;
}): Promise<string> {
  const run = await db.tenderAnalysisRun.create({
    data: {
      orgId: args.orgId,
      projectId: args.projectId,
      status: "PENDING",
      runKind: "FULL",
      idempotencyKey: `${TAG}-${args.suffix}`,
      sourceHashFingerprint: `${TAG}-fp`,
      documents: {
        create: args.docIds.map((documentId, idx) => ({
          documentId,
          contentHash: `hash-${idx + 1}`,
          role: "PRIMARY",
        })),
      },
    },
    select: { id: true },
  });
  return run.id;
}

/** 复刻 worker 的 fenced 检查点写入（同一 SQL 语义） */
async function saveCursorFenced(
  runId: string,
  leaseOwner: string,
  cursor: unknown,
): Promise<boolean> {
  const updated = await db.tenderAnalysisRun.updateMany({
    where: { id: runId, leaseOwner, status: { in: ["EXTRACTING", "ANALYZING"] } },
    data: {
      workerCursor: JSON.parse(JSON.stringify(cursor)) as object,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    },
  });
  return updated.count > 0;
}

async function main(): Promise<void> {
  assertIsolated();
  const { orgId, projectId, docIds } = await seed();
  console.log(`\n[seed] org=${orgId} project=${projectId} docs=${docIds.length}`);

  /* ---------- A：真实 DB 上的分片续跑 ---------- */
  const runId = await createRun({ orgId, projectId, docIds, suffix: "A" });
  const leaseOwner = `e2e:${randomUUID()}`;
  await db.tenderAnalysisRun.update({
    where: { id: runId },
    data: {
      status: "EXTRACTING",
      leaseOwner,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      startedAt: new Date(),
      workerStep: "ENSURE_PAGES",
    },
  });

  let ticks = 0;
  let persisted = false;
  const phases: string[] = [];
  while (!persisted) {
    ticks += 1;
    if (ticks > 30) throw new Error("tick 数异常");
    const cur = await db.tenderAnalysisRun.findUnique({
      where: { id: runId },
      select: { workerCursor: true },
    });
    let clock = 0;
    const outcome = await advanceAndPersistV2({
      runId,
      projectId,
      leaseOwner,
      leaseMs: LEASE_MS,
      // 每 tick 只给 60s，且每次调用消耗 25s → 必然多 tick
      deadlineAt: 60_000,
      tickBudgetMs: 60_000,
      cursorRaw: cur?.workerCursor ?? null,
      saveCursor: (c) => saveCursorFenced(runId, leaseOwner, c),
      now: () => clock,
      opts: {
        invoker: async (req) => {
          clock += 25_000;
          return invoker(req);
        },
        windowOptions: { maxCharsPerWindow: 120, maxPagesPerWindow: 1, overlapPages: 0 },
      },
    });
    if (outcome.status === "YIELD") {
      phases.push(outcome.phase);
      continue;
    }
    persisted = true;
    ok(outcome.result.factCount >= 1, `A1 canonical facts 落库（${outcome.result.factCount}）`);
    ok(
      outcome.result.requirementCount >= 3,
      `A1 canonical requirements 落库（${outcome.result.requirementCount}）`,
    );
    ok(outcome.result.sectionCount > 0, "A1 sections 落库");
  }
  ok(ticks > 1, `A2 真实 DB 上跨 ${ticks} 个 tick 续跑（每 tick 60s 预算）`);
  ok(phases.length > 0, `A2 中途让出的阶段：${Array.from(new Set(phases)).join(",")}`);

  const rows = await db.tenderAnalysisRun.findUnique({
    where: { id: runId },
    select: { workerCursor: true, summaryJson: true, model: true },
  });
  const fp = fingerprintAnalyzerInput((await buildAnalyzerInputForRun(runId))!);
  const parsed = parseV2Cursor(rows?.workerCursor, fp);
  ok(parsed !== null, "A3 jsonb 检查点往返后仍可解析（Prisma Json ↔ 游标契约）");
  ok(parsed?.phase === "PERSIST", `A3 最终阶段=PERSIST（实得 ${parsed?.phase}）`);
  ok(
    Object.keys(parsed?.windows.outputs ?? {}).length === 4,
    `A3 全部窗口（3 PDF + 1 xlsx 单元）的抽取结果都在检查点里（${Object.keys(parsed?.windows.outputs ?? {}).length}）`,
  );
  const sj = (rows?.summaryJson ?? {}) as Record<string, unknown>;
  ok(sj.analystSynthesis != null, "A4 Analyst 中文综合层已落 summaryJson");

  /* ---------- A7：非 PDF 单元的引用链（不得出现假页码） ---------- */
  ok(
    sheetPromptSeen !== null && /UNIT 1 \(sheet: Sheet「Category A Pricing」\)/.test(sheetPromptSeen),
    "A7 抽取 prompt 对 xlsx 用 UNIT+真实标签定位（不称 PAGE）",
  );
  const sheetRefs = await db.tenderAnalysisSourceRef.findMany({
    where: { runId, documentId: `doc-sheet-${TAG}` },
    select: { pageNumber: true, sectionLabel: true, originalTextSnippet: true },
  });
  ok(sheetRefs.length > 0, `A7 xlsx 单元产生了 canonical 引用（${sheetRefs.length} 条）`);
  ok(
    sheetRefs.every((r) => r.sectionLabel === SHEET_UNIT_LABEL),
    "A7 引用带真实单元标签（sectionLabel=Sheet「…」）",
  );
  ok(
    sheetRefs.every((r) => r.originalTextSnippet.includes("Bedroom desk")),
    "A7 引用原文逐字可核验（证据硬门通过）",
  );
  {
    const { serializeSourceRef } = await import("@/lib/tender-auto-analysis/serializers");
    const view = serializeSourceRef(
      {
        id: "x",
        documentId: `doc-sheet-${TAG}`,
        pageNumber: sheetRefs[0]!.pageNumber,
        sectionLabel: sheetRefs[0]!.sectionLabel,
        originalTextSnippet: sheetRefs[0]!.originalTextSnippet,
        confidence: "CONFIRMED",
        extractionMethod: "v2-llm-extract",
      },
      {
        documentTitleById: new Map([
          [`doc-sheet-${TAG}`, "Appendix C - Pricing Form.xlsx"],
        ]),
      },
    );
    ok(
      view.locationLabel === `Appendix C - Pricing Form.xlsx · ${SHEET_UNIT_LABEL}`,
      `A7 展示定位=文件名 · 单元标签（实得 ${view.locationLabel}）`,
    );
    ok(
      !/p\.\d+/.test(view.locationLabel ?? ""),
      "A7 展示层不出现 p.N（表格没有页，绝不谎报）",
    );
  }

  const callsAfterFirstRun = llmCalls;
  ok(callsAfterFirstRun > 0, `A4 首轮 LLM 调用数=${callsAfterFirstRun}`);

  // 幂等重入：检查点已在 PERSIST → 再跑一次不得产生任何 LLM 调用
  const cur2 = await db.tenderAnalysisRun.findUnique({
    where: { id: runId },
    select: { workerCursor: true },
  });
  await db.tenderAnalysisRun.update({
    where: { id: runId },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  const again = await advanceAndPersistV2({
    runId,
    projectId,
    leaseOwner,
    leaseMs: LEASE_MS,
    deadlineAt: Number.POSITIVE_INFINITY,
    tickBudgetMs: Number.POSITIVE_INFINITY,
    cursorRaw: cur2?.workerCursor ?? null,
    saveCursor: (c) => saveCursorFenced(runId, leaseOwner, c),
    opts: {
      invoker,
      windowOptions: { maxCharsPerWindow: 120, maxPagesPerWindow: 1, overlapPages: 0 },
    },
  });
  ok(again.status === "PERSISTED", "A5 重入直接落库");
  ok(
    llmCalls === callsAfterFirstRun,
    `A5 重入零 LLM 调用（仍为 ${llmCalls}）——重试不再从零烧钱`,
  );

  // 租约被接管 → 检查点/落库都必须失败（stale worker 零写）
  await db.tenderAnalysisRun.update({
    where: { id: runId },
    data: { leaseOwner: "someone-else" },
  });
  let fenced = false;
  try {
    const cur3 = await db.tenderAnalysisRun.findUnique({
      where: { id: runId },
      select: { workerCursor: true },
    });
    await advanceAndPersistV2({
      runId,
      projectId,
      leaseOwner,
      leaseMs: LEASE_MS,
      deadlineAt: Number.POSITIVE_INFINITY,
      tickBudgetMs: Number.POSITIVE_INFINITY,
      cursorRaw: cur3?.workerCursor ?? null,
      saveCursor: (c) => saveCursorFenced(runId, leaseOwner, c),
      opts: { invoker },
    });
  } catch (e) {
    fenced = (e as Error).name === "TenderV2LeaseLostError";
  }
  ok(fenced, "A6 租约被接管 → TenderV2LeaseLostError（真实 SQL fence 生效）");

  /* ---------- B：陈旧扫描不再误杀"有进展"的 run ---------- */
  const runB = await createRun({ orgId, projectId, docIds, suffix: "B" });
  const ninetyMinAgo = new Date(Date.now() - 90 * 60_000);
  await db.tenderAnalysisRun.update({
    where: { id: runB },
    data: {
      status: "EXTRACTING",
      startedAt: ninetyMinAgo, // 老 run（旧逻辑必被判陈旧）
      leaseOwner: null,
      leaseExpiresAt: new Date(Date.now() - 1_000), // 租约已过期
      attemptCount: 1,
      workerStep: "ENSURE_PAGES",
      workerCursor: {
        kind: "tender-v2-resumable",
        startedAt: ninetyMinAgo.toISOString(),
        progressAt: new Date().toISOString(), // 刚刚还在推进
      },
    },
  });
  const runC = await createRun({ orgId, projectId, docIds, suffix: "C" });
  await db.tenderAnalysisRun.update({
    where: { id: runC },
    data: {
      status: "EXTRACTING",
      startedAt: ninetyMinAgo,
      leaseOwner: null,
      leaseExpiresAt: new Date(Date.now() - 1_000),
      attemptCount: 1,
      workerStep: "ENSURE_PAGES",
      workerCursor: {
        kind: "tender-v2-resumable",
        startedAt: ninetyMinAgo.toISOString(),
        progressAt: ninetyMinAgo.toISOString(), // 90 分钟没进展
      },
    },
  });

  // 只跑扫描逻辑：预算设为 0 → 不认领任何 run（processed=0），只做两轮 sweep
  await processQueuedTenderAnalysisRuns(2, {
    deadlineAt: Date.now(),
    tickBudgetMs: 0,
  });

  const [afterB, afterC] = await Promise.all([
    db.tenderAnalysisRun.findUnique({
      where: { id: runB },
      select: { status: true, errorCode: true },
    }),
    db.tenderAnalysisRun.findUnique({
      where: { id: runC },
      select: { status: true, errorCode: true },
    }),
  ]);
  ok(
    afterB?.status === "EXTRACTING",
    `B1 有检查点进展的 run 不被陈旧扫描误杀（实得 ${afterB?.status}/${afterB?.errorCode}）`,
  );
  ok(
    afterC?.status === "FAILED" && afterC?.errorCode === "stale_run",
    `B2 真正无进展的 run 仍被判陈旧（实得 ${afterC?.status}/${afterC?.errorCode}）`,
  );

  /* ---------- C：V1（flag OFF）全流程在真实 DB 上仍然走通 ---------- */
  const runD = await createRun({ orgId, projectId, docIds, suffix: "D" });
  const before = llmCalls;
  const outcomeD = await processQueuedTenderAnalysisRuns(2);
  const afterD = await db.tenderAnalysisRun.findUnique({
    where: { id: runD },
    select: { status: true, workerStep: true },
  });
  ok(
    outcomeD.processed > 0,
    `C1 legacy(V2 flag OFF) 队列消费成功（processed=${outcomeD.processed}）`,
  );
  ok(
    afterD?.status === "REVIEW_REQUIRED",
    `C2 legacy 全流程到达 REVIEW_REQUIRED（实得 ${afterD?.status}/${afterD?.workerStep}）`,
  );
  ok(llmCalls === before, "C3 legacy 路径未触碰脚本 invoker（隔离验证无外呼）");

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
