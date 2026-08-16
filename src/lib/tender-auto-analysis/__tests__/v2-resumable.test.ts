/**
 * V2 分片续跑（P0：serverless 硬超时下的可续跑分析）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts
 *
 * 断言矩阵：
 *   RESUME-01 单 tick 预算充足 → 一次跑完，调用数 = 窗口数 + 澄清数 + Analyst 2
 *   RESUME-02 预算极小 → 多 tick 续跑，**每次 LLM 调用只发生一次**（零重复烧钱）
 *   RESUME-03 PARITY：同一批 LLM 输出，分片跑 == 单次跑（mapped 结果逐字段相等）
 *   RESUME-04 进程被硬杀（丢弃未落盘的一段）→ 从最后检查点恢复，只重跑那一批
 *   RESUME-05 窗口失败重试：失败 2 次后成功 → 内容纳入且不记 limitation
 *   RESUME-06 窗口失败耗尽（3 次）→ 停止重试并计入 limitations
 *   RESUME-07 检查点被 lease fence 拒绝 → TenderV2LeaseLostError，且立即停手
 *   RESUME-08 Analyst PASS A 失败一次 → 下个 tick 重试成功（中文综合层不因单次抖动消失）
 *   RESUME-09 Analyst PASS B 失败耗尽 → 仍落库（qa=NEEDS_HUMAN_REVIEW），不阻断
 *   CURSOR-01..04 游标解析/指纹作废/进展时间
 *   BUDGET-01..03 阶段准入与超时裁剪
 */

import assert from "node:assert";

import type {
  AnalyzerDocument,
  AnalyzerInput,
  ExtractionOutputV2,
} from "@/lib/tender-understanding/contract";
import type { LlmInvoker, LlmCallRequest } from "@/lib/tender-understanding/llm";
import { analyzeTender } from "@/lib/tender-understanding/analyzer";
import {
  ANALYST_PROMPT_NAME,
  ANALYST_QA_PROMPT_NAME,
  type AnalystLlmOutput,
} from "@/lib/tender-analyst/contract";
import { mapV2Result } from "../v2-map";
import { advanceV2Analysis, fingerprintAnalyzerInput } from "../v2-resumable";
import {
  callTimeoutFor,
  canStartPhase,
  createV2Cursor,
  parseV2Cursor,
  readCursorProgressAt,
  computeV2Fingerprint,
  V2_PHASE_MIN_MS,
  type V2CursorState,
} from "../v2-cursor";
import { TenderV2LeaseLostError } from "../v2-errors";

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

/* ------------------------------ fixture ------------------------------ */

const PAGE_COUNT = 6;
const WINDOW_OPTIONS = { maxCharsPerWindow: 120, maxPagesPerWindow: 1, overlapPages: 0 };

/** 每页主题彼此不同：避免被去重（相似度）合并，从而能逐窗断言内容归属 */
const SUBJECTS = [
  "mattress covers",
  "curtain rails",
  "workshop benches",
  "reading lamps",
  "corridor carpets",
  "storage shelving",
];

function pageText(i: number): string {
  return `Page ${i} — Section ${i}. The vendor must supply ${SUBJECTS[i - 1]} and complete installation within ${i * 3} days.`;
}
function snippet(i: number): string {
  return `The vendor must supply ${SUBJECTS[i - 1]} and complete installation within ${i * 3} days.`;
}

function buildInput(): AnalyzerInput {
  const pages = Array.from({ length: PAGE_COUNT }, (_, k) => ({
    pageNumber: k + 1,
    contentText: pageText(k + 1),
  }));
  const d: AnalyzerDocument = {
    documentId: "d1",
    name: "Main.pdf",
    type: "pdf",
    sourceRole: "BASE_TENDER",
    pages,
    contentHash: "hash-d1",
  };
  return { projectId: "proj_resumable", documents: [d] };
}

function extractionFor(pageNumbers: number[]): ExtractionOutputV2 {
  return {
    // 只让首窗产出 delivery 事实：同类型多值会被判为矛盾（V2 的正确行为），
    // 那属于 precedence/conflict 套件的断言面，本套件测的是"分片 == 单次"。
    facts: pageNumbers.filter((i) => i === 1).map((i) => ({
      factType: "delivery" as const,
      claim: `${SUBJECTS[i - 1]} installed within ${i * 3} days`,
      rawValue: `${i * 3} days`,
      sourceDocumentId: "d1",
      pageNumber: i,
      sourceSnippet: snippet(i),
      confidence: "HIGH" as const,
    })),
    requirements: pageNumbers.map((i) => ({
      category: "DELIVERY" as const,
      statement: `Vendor must supply ${SUBJECTS[i - 1]} and install within ${i * 3} days.`,
      actor: "Vendor",
      action: "supply",
      object: `${SUBJECTS[i - 1]}`,
      mandatory: true as const,
      mandatorySignal: "must",
      deadline: null,
      quantity: null,
      unit: null,
      submissionStage: null,
      technicalArea: null,
      revisionAction: null,
      revisionTargetHint: null,
      sourceDocumentId: "d1",
      pageNumber: i,
      sourceSnippet: snippet(i),
      confidence: "HIGH" as const,
    })),
    potentialRisks: [],
    ambiguities: pageNumbers.map((i) => ({
      topic: `${SUBJECTS[i - 1]} packaging`,
      description: `Packaging for ${SUBJECTS[i - 1]} is not specified anywhere.`,
      whatIsUnknown: `packaging spec for ${SUBJECTS[i - 1]}`,
      sourceDocumentId: "d1",
      pageNumber: i,
      sourceSnippet: snippet(i),
      confidence: "MEDIUM" as const,
    })),
  };
}

const ANALYST_OUTPUT: AnalystLlmOutput = {
  executiveBrief: {
    oneLinerZh: "合成招标：按期交付若干物项。",
    whatIsBeingBoughtZh: "若干物项的供货与交付。",
    bidderTakeawayZh: "交期是主要约束。",
    keyPoints: ["交期严格"],
  },
  scope: {
    overviewZh: "供货范围为合成测试物项。",
    deliverables: ["物项若干"],
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
    summaryZh: "需澄清包装规格后方可报价。",
    reasons: ["包装规格缺失"],
    mustResolveBeforePricing: ["包装规格"],
  },
  nextActions: [
    { order: 1, actionZh: "发出澄清函", reasonZh: "包装规格未定义", targetArea: "clarifications" },
  ],
};

type InvokerLog = { promptName: string; userPrompt: string };

/** 脚本化 invoker：记录每次调用；可按 promptName/窗口注入失败。 */
function makeInvoker(opts: {
  failWindowPages?: Map<number, number>; // pageNumber → 还需失败的次数
  failAnalyst?: number;
  failAnalystQa?: number;
  onCall?: (req: LlmCallRequest) => void;
} = {}): { invoker: LlmInvoker; calls: InvokerLog[] } {
  const calls: InvokerLog[] = [];
  const failWindows = opts.failWindowPages ?? new Map<number, number>();
  let analystFailsLeft = opts.failAnalyst ?? 0;
  let qaFailsLeft = opts.failAnalystQa ?? 0;

  const invoker: LlmInvoker = async (req) => {
    calls.push({ promptName: req.promptName, userPrompt: req.userPrompt });
    opts.onCall?.(req);

    if (req.promptName.includes("extract")) {
      const pages = [...req.userPrompt.matchAll(/Page (\d+) — Section/g)].map((m) =>
        Number(m[1]),
      );
      const uniquePages = Array.from(new Set(pages));
      for (const p of uniquePages) {
        const left = failWindows.get(p) ?? 0;
        if (left > 0) {
          failWindows.set(p, left - 1);
          throw new Error(`scripted window failure p${p}`);
        }
      }
      return {
        content: JSON.stringify(extractionFor(uniquePages)),
        model: "scripted-test-model",
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
        model: "scripted-test-model",
        elapsedMs: 1,
      };
    }

    if (req.promptName === ANALYST_PROMPT_NAME) {
      if (analystFailsLeft > 0) {
        analystFailsLeft -= 1;
        throw new Error("scripted analyst failure");
      }
      return {
        content: JSON.stringify(ANALYST_OUTPUT),
        model: "scripted-test-model",
        elapsedMs: 1,
      };
    }

    if (req.promptName === ANALYST_QA_PROMPT_NAME) {
      if (qaFailsLeft > 0) {
        qaFailsLeft -= 1;
        throw new Error("scripted qa failure");
      }
      return {
        content: JSON.stringify({
          verdict: "APPROVE",
          issues: [],
          needsHumanReview: false,
          revised: null,
        }),
        model: "scripted-test-model",
        elapsedMs: 1,
      };
    }

    throw new Error(`unexpected prompt: ${req.promptName}`);
  };

  return { invoker, calls };
}

const COVERAGE = { uploaded: 1, eligible: 1, analyzed: 1, excluded: [] };

function freshCursor(input: AnalyzerInput, now = new Date("2026-08-16T00:00:00.000Z")) {
  return createV2Cursor({
    fingerprint: fingerprintAnalyzerInput(input),
    analysisDate: "2026-08-16T00:00:00.000Z",
    now,
  });
}

/** 用固定预算反复推进，直到 READY；返回 tick 数与最终 inference。 */
async function driveToReady(args: {
  input: AnalyzerInput;
  invoker: LlmInvoker;
  budgetPerTick: number;
  maxTicks?: number;
  cursor?: V2CursorState;
  saveCursor?: (c: V2CursorState) => Promise<boolean>;
  /** 每个 tick 的"时钟推进量"：模拟调用耗时 */
  msPerCall?: number;
}) {
  let cursor = args.cursor ?? freshCursor(args.input);
  const maxTicks = args.maxTicks ?? 60;
  let ticks = 0;
  for (;;) {
    ticks += 1;
    assert.ok(ticks <= maxTicks, `too many ticks (${ticks})`);
    // 每 tick 一条新的时间线：起点 0，预算 budgetPerTick，每次 LLM 调用推进 msPerCall
    let clock = 0;
    const msPerCall = args.msPerCall ?? 0;
    const now = () => clock;
    const outcome = await advanceV2Analysis({
      input: args.input,
      coverage: COVERAGE,
      cursor,
      deadlineAt: args.budgetPerTick,
      tickBudgetMs: args.budgetPerTick,
      invoker: async (req) => {
        clock += msPerCall;
        return args.invoker(req);
      },
      windowOptions: WINDOW_OPTIONS,
      now,
      saveCursor: args.saveCursor,
    });
    cursor = outcome.cursor;
    if (outcome.status === "READY") {
      return { ticks, inference: outcome.inference, cursor };
    }
  }
}

async function main(): Promise<void> {
  const input = buildInput();
  const windowCount = 6; // maxPagesPerWindow=1, overlap=0 → 每页一窗

  /* ---------------- RESUME-01 ---------------- */
  {
    const { invoker, calls } = makeInvoker();
    const { ticks, inference } = await driveToReady({
      input,
      invoker,
      budgetPerTick: Number.POSITIVE_INFINITY,
    });
    const extractCalls = calls.filter((c) => c.promptName.includes("extract")).length;
    const resolveCalls = calls.filter((c) => c.promptName.includes("resolve")).length;
    const analystCalls = calls.filter((c) => c.promptName === ANALYST_PROMPT_NAME).length;
    const qaCalls = calls.filter((c) => c.promptName === ANALYST_QA_PROMPT_NAME).length;
    ok(ticks === 1, "RESUME-01 预算充足 → 一个 tick 跑完");
    ok(extractCalls === windowCount, `RESUME-01 窗口调用 = ${windowCount}（实得 ${extractCalls}）`);
    ok(resolveCalls > 0, "RESUME-01 澄清解决检查被调用");
    ok(analystCalls === 1 && qaCalls === 1, "RESUME-01 Analyst PASS A/B 各一次");
    ok(inference.mapped.facts.length > 0, "RESUME-01 产出 facts");
    ok(
      inference.llmCalls === calls.length,
      `RESUME-01 telemetry 计数 = 实际调用数（${inference.llmCalls} vs ${calls.length}）`,
    );
  }

  /* ---------------- RESUME-02 / RESUME-03 ---------------- */
  {
    // 单次编排（基准）
    const single = makeInvoker();
    const { result } = await analyzeTender(input, {
      invoker: single.invoker,
      analysisDate: "2026-08-16T00:00:00.000Z",
      windowOptions: WINDOW_OPTIONS,
      maxConcurrency: 3,
    });
    const singleMapped = mapV2Result(result);

    // 分片编排：每 tick 只够一批窗口 / 一条澄清
    const sliced = makeInvoker();
    const saved: string[] = [];
    const { ticks, inference } = await driveToReady({
      input,
      invoker: sliced.invoker,
      // 预算 = 刚好过 WINDOWS/CLARIFY 门槛，Analyst 门槛更高 → 必然多 tick
      budgetPerTick: V2_PHASE_MIN_MS.ANALYST_A + 1_000,
      msPerCall: 40_000,
      saveCursor: async (c) => {
        saved.push(c.phase);
        return true;
      },
    });

    ok(ticks > 1, `RESUME-02 小预算 → 多 tick 续跑（${ticks} ticks）`);
    ok(saved.length > 0, "RESUME-02 每步都写检查点");

    const slicedExtract = sliced.calls.filter((c) =>
      c.promptName.includes("extract"),
    ).length;
    ok(
      slicedExtract === windowCount,
      `RESUME-02 零重复抽取：窗口调用 ${slicedExtract} == ${windowCount}`,
    );
    ok(
      sliced.calls.filter((c) => c.promptName === ANALYST_PROMPT_NAME).length === 1,
      "RESUME-02 Analyst PASS A 只跑一次",
    );

    // PARITY：同一批 LLM 输出 → 结果逐字段相等（时间戳/耗时字段除外）
    const norm = (m: typeof singleMapped) => ({
      facts: m.facts,
      requirements: m.requirements,
      clarifications: m.clarifications,
      sections: m.sections,
      changeCandidates: m.changeCandidates,
      summaryText: m.summaryText,
    });
    assert.deepStrictEqual(norm(inference.mapped), norm(singleMapped));
    ok(true, "RESUME-03 PARITY：分片跑与单次跑的 mapped 结果完全一致");
    // analyzeTender 只做 grounding（Analyst 层在其之上），因此比 grounding 调用数
    const grounding = (c: InvokerLog[]) =>
      c.filter(
        (x) => x.promptName.includes("extract") || x.promptName.includes("resolve"),
      ).length;
    ok(
      grounding(sliced.calls) === grounding(single.calls) &&
        inference.llmCalls === sliced.calls.length,
      `RESUME-03 PARITY：grounding 调用数一致（${grounding(sliced.calls)} vs ${grounding(single.calls)}）且 telemetry 无漏计`,
    );
  }

  /* ---------------- RESUME-04（硬杀恢复） ---------------- */
  {
    const { invoker, calls } = makeInvoker();
    const input2 = buildInput();
    let cursor = freshCursor(input2);
    let persistedSnapshot: string | null = null;

    // tick 1：只允许两批窗口，落盘后"进程被杀"（我们丢弃内存态，只保留已落盘快照）
    let clock = 0;
    let batches = 0;
    await advanceV2Analysis({
      input: input2,
      coverage: COVERAGE,
      cursor,
      deadlineAt: 200_000,
      tickBudgetMs: 200_000,
      invoker: async (req) => {
        clock += 30_000;
        return invoker(req);
      },
      windowOptions: WINDOW_OPTIONS,
      now: () => clock,
      saveCursor: async (c) => {
        batches += 1;
        if (batches <= 2) {
          persistedSnapshot = JSON.stringify(c);
          return true;
        }
        // 第三次检查点之后模拟被硬杀：抛出以中断本 tick，且该次不落盘
        throw new Error("SIMULATED_FUNCTION_KILL");
      },
    }).catch((e) => {
      assert.ok(String(e).includes("SIMULATED_FUNCTION_KILL"));
    });

    const callsBeforeKill = calls.length;
    ok(persistedSnapshot !== null, "RESUME-04 硬杀前已有检查点落盘");

    // tick 2：从落盘快照恢复（内存态全丢）
    const restored = parseV2Cursor(
      JSON.parse(persistedSnapshot!),
      fingerprintAnalyzerInput(input2),
    );
    ok(restored !== null, "RESUME-04 落盘快照可被解析恢复");
    cursor = restored!;
    const { inference } = await driveToReady({
      input: input2,
      invoker,
      budgetPerTick: Number.POSITIVE_INFINITY,
      cursor,
    });
    const extractCalls = calls.filter((c) => c.promptName.includes("extract")).length;
    ok(
      extractCalls < callsBeforeKill + windowCount,
      `RESUME-04 恢复后不重跑已落盘窗口（总抽取 ${extractCalls} < 从零重来的 ${callsBeforeKill + windowCount}）`,
    );
    ok(inference.mapped.facts.length > 0, "RESUME-04 恢复后仍产出完整结果");
  }

  /* ---------------- RESUME-05 / RESUME-06（窗口重试） ---------------- */
  {
    const failMap = new Map<number, number>([[3, 2]]); // 第 3 页窗口失败两次后成功
    const { invoker } = makeInvoker({ failWindowPages: failMap });
    const { inference, cursor } = await driveToReady({
      input,
      invoker,
      budgetPerTick: Number.POSITIVE_INFINITY,
    });
    const limitations = (inference.mapped.summaryJson.limitations ?? []) as string[];
    ok(
      !limitations.some((l) => l.includes("窗口 LLM 抽取失败")),
      "RESUME-05 失败窗口重试成功后不留 limitation",
    );
    ok(
      Object.keys(cursor.windows.outputs).length === windowCount,
      "RESUME-05 全部窗口最终成功缓存",
    );
    ok(
      inference.mapped.requirements.some((r) =>
        (r.originalRequirement ?? "").toLowerCase().includes("workshop benches"),
      ),
      "RESUME-05 重试成功的窗口内容被纳入结果",
    );
  }
  {
    const failMap = new Map<number, number>([[2, 99]]); // 第 2 页窗口永远失败
    const { invoker, calls } = makeInvoker({ failWindowPages: failMap });
    const { inference } = await driveToReady({
      input,
      invoker,
      budgetPerTick: Number.POSITIVE_INFINITY,
    });
    const limitations = (inference.mapped.summaryJson.limitations ?? []) as string[];
    ok(
      limitations.some((l) => l.includes("窗口 LLM 抽取失败")),
      "RESUME-06 窗口重试耗尽 → 计入 limitations（不静默丢内容）",
    );
    const p2Calls = calls.filter(
      (c) => c.promptName.includes("extract") && /Page 2 — Section/.test(c.userPrompt),
    ).length;
    // MAX_WINDOW_ATTEMPTS=3，callStructured 内部对 transient 还会重试一次 → 每次尝试最多 2 次调用
    ok(p2Calls <= 6, `RESUME-06 失败窗口尝试次数有界（${p2Calls} ≤ 6）`);
    ok(
      inference.mapped.facts.length > 0,
      "RESUME-06 单窗口永久失败不拖垮整体",
    );
  }

  /* ---------------- RESUME-07（检查点 lease fence） ---------------- */
  {
    const { invoker, calls } = makeInvoker();
    let threw: unknown = null;
    try {
      await driveToReady({
        input,
        invoker,
        budgetPerTick: Number.POSITIVE_INFINITY,
        saveCursor: async () => false, // 租约已被接管
      });
    } catch (e) {
      threw = e;
    }
    ok(
      threw instanceof TenderV2LeaseLostError,
      "RESUME-07 检查点 fence 失败 → TenderV2LeaseLostError",
    );
    ok(
      calls.filter((c) => c.promptName.includes("extract")).length <= 3,
      "RESUME-07 fence 失败后立即停手（不继续烧调用）",
    );
  }

  /* ---------------- RESUME-08 / RESUME-09（Analyst 抖动） ---------------- */
  {
    const { invoker, calls } = makeInvoker({ failAnalyst: 2 }); // 一次 pass 内部 2 次调用（含 transient 重试）
    const { inference } = await driveToReady({
      input,
      invoker,
      budgetPerTick: Number.POSITIVE_INFINITY,
    });
    const analystCalls = calls.filter((c) => c.promptName === ANALYST_PROMPT_NAME).length;
    ok(analystCalls > 2, `RESUME-08 PASS A 失败后跨 tick 重试（调用 ${analystCalls} 次）`);
    ok(
      inference.mapped.summaryJson.analystSynthesis != null,
      "RESUME-08 重试成功 → 中文综合层仍然产出",
    );
  }
  {
    const { invoker } = makeInvoker({ failAnalystQa: 99 });
    const { inference } = await driveToReady({
      input,
      invoker,
      budgetPerTick: Number.POSITIVE_INFINITY,
    });
    const syn = inference.mapped.summaryJson.analystSynthesis as
      | { qa?: { status?: string; needsHumanReview?: boolean } }
      | undefined;
    ok(syn != null, "RESUME-09 QA 全失败仍保留 PASS A 结果");
    ok(
      syn?.qa?.needsHumanReview === true,
      "RESUME-09 QA 缺席 → needsHumanReview=true（不冒充已审校）",
    );
  }

  /* ---------------- CURSOR-01..04 ---------------- */
  {
    const c = freshCursor(input);
    const fp = fingerprintAnalyzerInput(input);
    ok(parseV2Cursor(JSON.parse(JSON.stringify(c)), fp) !== null, "CURSOR-01 往返可解析");
    ok(parseV2Cursor(JSON.parse(JSON.stringify(c)), "other-fp") === null, "CURSOR-02 指纹不符 → 作废");
    ok(parseV2Cursor({ kind: "something-else" }, fp) === null, "CURSOR-03 异形游标 → 作废");
    ok(parseV2Cursor(null, fp) === null, "CURSOR-03 空游标 → 作废");

    const progress = readCursorProgressAt(JSON.parse(JSON.stringify(c)));
    ok(progress instanceof Date, "CURSOR-04 可读出检查点时间");
    ok(readCursorProgressAt({ foo: 1 }) === null, "CURSOR-04 非本模块游标 → null");

    // 文档内容变化 → 指纹变化 → 旧检查点作废（防混版结果）
    const changed: AnalyzerInput = {
      ...input,
      documents: [{ ...input.documents[0]!, contentHash: "hash-changed" }],
    };
    ok(
      fingerprintAnalyzerInput(changed) !== fp,
      "CURSOR-02 文档内容哈希变化 → 指纹变化",
    );
    ok(
      computeV2Fingerprint({
        documents: [{ documentId: "a", contentHash: "x", pageCount: 1 }],
        promptVersions: ["p@1"],
      }) !==
        computeV2Fingerprint({
          documents: [{ documentId: "a", contentHash: "x", pageCount: 1 }],
          promptVersions: ["p@2"],
        }),
      "CURSOR-02 prompt 版本变化 → 指纹变化",
    );
  }

  /* ---------------- BUDGET-01..03 ---------------- */
  {
    ok(
      canStartPhase("ANALYST_A", V2_PHASE_MIN_MS.ANALYST_A + 1, 240_000),
      "BUDGET-01 预算够 → 允许开工",
    );
    ok(
      !canStartPhase("ANALYST_A", V2_PHASE_MIN_MS.ANALYST_A - 1, 240_000),
      "BUDGET-01 预算不足 → 让出本 tick",
    );
    ok(
      canStartPhase("ANALYST_A", 11_000, 20_000),
      "BUDGET-02 tick 预算本身很小 → 退化为 HARD_MIN，仍尝试推进（不死锁）",
    );
    ok(canStartPhase("WINDOWS", Number.POSITIVE_INFINITY, 1), "BUDGET-02 无限预算恒允许");
    ok(callTimeoutFor(Number.POSITIVE_INFINITY) === undefined, "BUDGET-03 无限预算不裁剪超时");
    ok(
      (callTimeoutFor(60_000) ?? 0) < 60_000 && (callTimeoutFor(60_000) ?? 0) > 0,
      "BUDGET-03 有限预算裁剪超时并留安全余量",
    );
  }

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
