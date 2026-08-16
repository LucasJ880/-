/**
 * T5-P1.1 §38 — **强制多切片** canonical V2 可续跑 E2E（隔离实库，无真实模型）
 *
 * 为什么不打真实模型：本门要证的是 **Runtime 续跑契约**——
 * 「预算耗尽 → 让出 → 下次 invocation 从断点续跑 → 已完成的窗口绝不重算」。
 * 真实模型只会让这件事更慢更贵，且把「模型能力」混进「运行时正确性」的判定里。
 * 真实模型的证据由 §39/§40 单独出具。
 *
 * 时间用**虚拟时钟**推进（每次读表前进 2s），因此预算耗尽是确定性的、瞬时的：
 * 不靠 sleep、不靠真实延迟，跑 100 次结果完全一致。
 *
 * 每轮循环 = 一次独立的 serverless invocation：新的绝对 deadline，
 * 进程内不保留任何跨轮状态——续跑信息只能来自 DB 里的 workerCursor。
 *
 * 用法（必须指向隔离 Neon 分支）：
 *   DATABASE_URL=... DIRECT_URL=... DATABASE_ENVIRONMENT=isolated \
 *     npx tsx scripts/t5-p11-forced-multislice-e2e.ts
 */

import { randomUUID, createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import { advanceV2ForWorkforce } from "@/lib/tender-workforce/v2-resumable-workforce";
import { parseV2Cursor, type V2Phase } from "@/lib/tender-auto-analysis/v2-cursor";
import { createRunFence, type RunLeaseHandle } from "@/lib/agent-runtime/lease";
import { PARSE_VERSION } from "@/lib/tender-auto-analysis/constants";
import {
  ANALYST_PROMPT_NAME,
  ANALYST_QA_PROMPT_NAME,
} from "@/lib/tender-analyst/contract";
import {
  TENDER_AGENT_RUN_STATUS,
  TENDER_WORKFORCE_ANALYSIS_VERSION,
  buildWorkforceTenderIdempotencyKey,
} from "@/lib/tender-workforce/analysis-run-service";
import { WORKFORCE_JOB_RUN_TYPE } from "@/lib/workforce-runtime/constants";

const TAG = `p11ms_${randomUUID().slice(0, 8)}`;
let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

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

/* ───────────────────── 虚拟时钟：确定性预算耗尽 ───────────────────── */
const CLOCK_STEP_MS = 2_000;
let virtualNow = Date.UTC(2026, 7, 16, 12, 0, 0);
const now = () => {
  virtualNow += CLOCK_STEP_MS;
  return virtualNow;
};

/* ───────────────────── 确定性 invoker + 重算探测 ───────────────────── */
const SUBJECTS = ["mattress covers", "curtain rails", "workshop benches"];
const pageText = (i: number) =>
  `Page ${i} — Section ${i}. The vendor must supply ${SUBJECTS[i - 1]} and complete installation within ${i * 3} days.`;
const snippet = (i: number) =>
  `The vendor must supply ${SUBJECTS[i - 1]} and complete installation within ${i * 3} days.`;
const FACT_TYPES = ["delivery", "warranty", "location"] as const;
const FACT_CLAIMS = [
  "Installation must complete within 3 days of award.",
  "Warranty period is 24 months from acceptance.",
  "Delivery location is the Regina central warehouse.",
];
const FACT_VALUES = ["3 days", "24 months", "Regina central warehouse"];

/** promptName → 该 prompt 被调用过几次（按内容指纹去重前的原始计数） */
const callsByKind: Record<string, number> = {};
/** 抽取窗口指纹 → 成功调用次数。任一 > 1 即为重算（本门的核心反例） */
const extractCallsByWindow = new Map<string, number>();

const invoker: LlmInvoker = async (req) => {
  callsByKind[req.promptName] = (callsByKind[req.promptName] ?? 0) + 1;

  if (req.promptName.includes("extract")) {
    const key = createHash("sha1").update(req.userPrompt).digest("hex").slice(0, 12);
    extractCallsByWindow.set(key, (extractCallsByWindow.get(key) ?? 0) + 1);
    const pages = [...req.userPrompt.matchAll(/Page (\d+) — Section/g)].map((m) => Number(m[1]));
    const uniq = Array.from(new Set(pages));
    return {
      content: JSON.stringify({
        // 每个窗口给**不同** factType：同类型不同取值会被判为 CONFLICT，
        // 而 v2-map 只把 ACTIVE 事实写进 canonical（冲突由 requirements/conflicts 表达）。
        // 这是产品的正确行为，不是本门要测的东西，所以造数据时避开它。
        facts: uniq.map((i) => ({
          factType: FACT_TYPES[i - 1],
          claim: FACT_CLAIMS[i - 1],
          rawValue: FACT_VALUES[i - 1],
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
      model: "scripted-p11-model",
      elapsedMs: 1,
    };
  }
  if (req.promptName.includes("resolve")) {
    return {
      content: JSON.stringify({
        resolved: false, answerSummary: null, answerDocumentId: null,
        answerPageNumber: null, answerSnippet: null,
      }),
      model: "scripted-p11-model", elapsedMs: 1,
    };
  }
  if (req.promptName === ANALYST_PROMPT_NAME) {
    return {
      content: JSON.stringify({
        executiveBrief: {
          oneLinerZh: "强制多切片验证用合成结论。",
          whatIsBeingBoughtZh: "若干物项供货与安装。",
          bidderTakeawayZh: "交期是主要约束。",
          keyPoints: [],
        },
        scope: {
          overviewZh: "合成范围。", deliverables: [], quantities: [],
          deliveryScope: [], exclusionsOrUnknowns: [],
        },
        keyRequirements: [], technicalRequirements: [], commercialAndDelivery: [],
        risksAndGaps: [], clarifications: [],
        currentAssessment: {
          status: "NEEDS_CLARIFICATION", summaryZh: "需澄清包装规格。",
          reasons: [], mustResolveBeforePricing: [],
        },
        nextActions: [],
      }),
      model: "scripted-p11-model", elapsedMs: 1,
    };
  }
  if (req.promptName === ANALYST_QA_PROMPT_NAME) {
    return {
      content: JSON.stringify({
        verdict: "APPROVE", issues: [], needsHumanReview: false, revised: null,
      }),
      model: "scripted-p11-model", elapsedMs: 1,
    };
  }
  throw new Error(`unexpected prompt ${req.promptName}`);
};

async function main() {
  assertIsolated();
  console.log(`T5-P1.1 §38 强制多切片 E2E（${TAG}）`);

  /* ───────── seed：3 个真实形状的文档（多窗口） ───────── */
  const user = await db.user.create({
    data: { email: `${TAG}@test.qingyan.local`, name: TAG, role: "sales", status: "active" },
    select: { id: true },
  });
  const org = await db.organization.create({
    data: { name: `${TAG}-org`, code: TAG, ownerId: user.id, status: "active" },
    select: { id: true },
  });
  const project = await db.project.create({
    data: { name: `${TAG} 招标包`, orgId: org.id, ownerId: user.id, workDomain: "tender" },
    select: { id: true },
  });
  const docIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const doc = await db.projectDocument.create({
      data: {
        id: `doc-${i}-${TAG}`, projectId: project.id, title: `Doc ${i}.pdf`,
        fileType: "pdf", url: `https://example.invalid/${TAG}/${i}.pdf`,
        blobUrl: `https://example.invalid/${TAG}/${i}.pdf`,
        contentText: pageText(i), contentHash: `hash-${i}-${TAG}`, pageCount: 1,
        parseStatus: "done", parseVersion: PARSE_VERSION, source: "upload",
      },
      select: { id: true },
    });
    await db.projectDocumentPage.create({
      data: {
        documentId: doc.id, pageNumber: 1, contentText: pageText(i),
        charCount: pageText(i).length, extractionMethod: "unpdf", parseStatus: "done",
      },
    });
    docIds.push(doc.id);
  }

  const session = await db.agentSession.create({
    data: { orgId: org.id, userId: user.id, channel: "web" },
    select: { id: true },
  });
  const jobRun = await db.agentRun.create({
    data: {
      orgId: org.id, sessionId: session.id, runType: WORKFORCE_JOB_RUN_TYPE,
      status: "running", runtimeVersion: "v2",
      leaseExpiresAt: new Date(Date.now() + 30 * 60_000),
      metadata: { workDomain: "tender", projectId: project.id } as never,
    },
    select: { id: true, leaseExpiresAt: true },
  });
  const domainRun = await db.tenderAnalysisRun.create({
    data: {
      orgId: org.id, projectId: project.id,
      status: TENDER_AGENT_RUN_STATUS.running, runKind: "FULL",
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
      promptVersion: "tender-workforce-prompt-v1",
      idempotencyKey: buildWorkforceTenderIdempotencyKey(jobRun.id),
      sourceHashFingerprint: `${TAG}-fp`, createdById: user.id,
      documents: {
        create: docIds.map((documentId, idx) => ({
          documentId, contentHash: `hash-${idx + 1}-${TAG}`, role: "PRIMARY",
        })),
      },
    },
    select: { id: true },
  });

  const own = {
    orgId: org.id, projectId: project.id,
    analysisRunId: domainRun.id, jobId: jobRun.id,
  };
  const runFence = createRunFence({
    lease: {
      runId: jobRun.id, leaseExpiresAt: jobRun.leaseExpiresAt!, leaseMs: 30 * 60_000,
    } satisfies RunLeaseHandle,
  });

  try {
    /* ───────── 强制多切片主循环：每轮 = 一次独立 invocation ───────── */
    const TICK_BUDGET_MS = 20_000; // < 所有阶段门槛 → 退化为 HARD_MIN 10s
    const yields: { phase: V2Phase; ticks: number }[] = [];
    const ticksSeen: number[] = [];
    const phaseSeq: string[] = [];
    let invocations = 0;
    let finalStatus = "";
    let persistedResult: { factCount?: number; requirementCount?: number; sectionCount?: number } | null = null;

    for (let i = 0; i < 40; i++) {
      invocations += 1;
      // 每次 invocation 重新计算绝对 deadline（模拟 HTTP 请求起点）
      const deadlineAt = now() + TICK_BUDGET_MS;
      const outcome = await advanceV2ForWorkforce({
        own, runFence, deadlineAt, tickBudgetMs: TICK_BUDGET_MS,
        opts: { invoker, maxConcurrency: 1 }, now,
      });

      // 每轮结束后**只**从 DB 读回游标——进程内不留续跑状态
      const row = await db.tenderAnalysisRun.findUniqueOrThrow({
        where: { id: domainRun.id },
        select: { workerCursor: true, status: true },
      });
      const cur = row.workerCursor as { ticks?: number; phase?: string } | null;
      if (cur?.ticks !== undefined) ticksSeen.push(cur.ticks);
      if (cur?.phase) phaseSeq.push(cur.phase);

      console.log(
        `  invocation ${i}: ${outcome.status}` +
          (outcome.status === "YIELD" ? ` phase=${outcome.phase} ticks=${outcome.ticks}` : "") +
          ` | dbPhase=${cur?.phase} dbTicks=${cur?.ticks} domainStatus=${row.status}`,
      );

      if (outcome.status === "YIELD") {
        yields.push({ phase: outcome.phase, ticks: outcome.ticks });
        continue;
      }
      finalStatus = outcome.status;
      if (outcome.status === "PERSISTED") persistedResult = outcome.result;
      break;
    }

    console.log("");
    ok(invocations >= 3, `P38-01: T3_INVOCATIONS = ${invocations} ≥ 3（强制多切片成立）`);
    ok(yields.length >= 2, `P38-02: 让出次数 = ${yields.length} ≥ 2`);
    ok(finalStatus === "PERSISTED", `P38-03: 最终 canonical 落库（${finalStatus}）`);

    const monotonic = ticksSeen.every((t, i) => i === 0 || t >= ticksSeen[i - 1]!);
    ok(monotonic, `P38-04: cursor ticks 单调不减 [${ticksSeen.join(",")}]`);

    const ORDER: V2Phase[] = ["WINDOWS", "CLARIFY", "ANALYST_A", "ANALYST_B", "PERSIST"];
    const idx = phaseSeq.map((p) => ORDER.indexOf(p as V2Phase));
    ok(
      idx.every((v, i) => v >= 0 && (i === 0 || v >= idx[i - 1]!)),
      `P38-05: phase 单调推进 [${phaseSeq.join(" → ")}]`,
    );
    ok(
      new Set(phaseSeq).size >= 2,
      `P38-06: 至少跨越 2 个阶段（实得 ${new Set(phaseSeq).size}）`,
    );

    const dupes = [...extractCallsByWindow.entries()].filter(([, n]) => n > 1);
    ok(
      dupes.length === 0,
      `P38-07: DUPLICATE_SUCCESSFUL_WINDOW_LLM_CALLS = 0（${extractCallsByWindow.size} 个窗口各调用 1 次）`,
      dupes,
    );
    ok(
      (callsByKind[ANALYST_PROMPT_NAME] ?? 0) === 1,
      `P38-08: Analyst PASS A 恰好 1 次（跨切片不重复长调用）`,
      callsByKind,
    );
    ok(
      (callsByKind[ANALYST_QA_PROMPT_NAME] ?? 0) === 1,
      `P38-09: Analyst PASS B（QA）恰好 1 次`,
      callsByKind,
    );

    ok(
      (persistedResult?.factCount ?? 0) > 0 && (persistedResult?.requirementCount ?? 0) > 0,
      `P38-10: canonical 事实/要求已落库（facts=${persistedResult?.factCount} reqs=${persistedResult?.requirementCount}）`,
    );
    const canonical = await db.$transaction([
      db.tenderAnalysisFact.count({ where: { runId: domainRun.id } }),
      db.tenderExtractedRequirement.count({ where: { analysisRunId: domainRun.id } }),
    ]);
    ok(
      canonical[0] > 0 && canonical[1] > 0,
      `P38-11: 真实 DB 行数核对（facts=${canonical[0]} requirements=${canonical[1]}）`,
    );

    /* ───────── §12：PERSIST 后重入不得重算模型 ───────── */
    const before = { ...callsByKind };
    const replay = await advanceV2ForWorkforce({
      own, runFence, deadlineAt: now() + 600_000, tickBudgetMs: 600_000,
      opts: { invoker, maxConcurrency: 1 }, now,
    });
    const noNewCalls = Object.keys(callsByKind).every(
      (k) => callsByKind[k] === (before[k] ?? 0),
    );
    ok(
      replay.status === "PERSISTED" && noNewCalls,
      `P38-12: PERSIST 后重入幂等重放，零新增模型调用（${replay.status}）`,
      { before, after: callsByKind },
    );
    const canonicalAfter = await db.tenderExtractedRequirement.count({
      where: { analysisRunId: domainRun.id },
    });
    ok(
      canonicalAfter === canonical[1],
      `P38-13: 重放未产生重复 canonical 行（${canonical[1]} → ${canonicalAfter}）`,
    );

    /* ───────── 让出不改域状态 ───────── */
    const finalRow = await db.tenderAnalysisRun.findUniqueOrThrow({
      where: { id: domainRun.id }, select: { status: true },
    });
    ok(
      finalRow.status === TENDER_AGENT_RUN_STATUS.running,
      `P38-14: 全程域状态保持 AGENT_ANALYZING（实得 ${finalRow.status}）——终态由 t9 决定，不由 t3 让出决定`,
    );
  } finally {
    // canonical 子表（facts/requirements/sections/clarifications/...）全部
    // onDelete: Cascade 挂在 TenderAnalysisRun 上，删父即可
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: org.id } });
    await db.agentRunStep.deleteMany({ where: { orgId: org.id } });
    await db.agentRunEvent.deleteMany({ where: { orgId: org.id } });
    await db.agentRun.deleteMany({ where: { orgId: org.id } });
    await db.agentSession.deleteMany({ where: { orgId: org.id } });
    await db.projectDocumentPage.deleteMany({ where: { documentId: { in: docIds } } });
    await db.projectDocument.deleteMany({ where: { projectId: project.id } });
    await db.project.deleteMany({ where: { id: project.id } });
    await db.organization.deleteMany({ where: { id: org.id } });
    await db.user.deleteMany({ where: { id: user.id } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERROR", e instanceof Error ? e.stack : e);
  await db.$disconnect();
  process.exit(1);
});
