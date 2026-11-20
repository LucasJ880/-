/**
 * FIX-12 招标分析切片的模型调用守住绝对截止时间
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts
 *
 * 用真实的切片推进器 + 真实的结构化输出层 + 真实的招标模型调用层（含同模型重试 / 换备用），
 * 只把最底层的「发请求」换成慢模型，时间用虚拟时钟（并行请求在虚拟时间里真并行）。
 *
 *   SD-01 慢模型撞截止：t+155s 起一批（剩 85 秒、超时 70 秒）→ t+225s 本方中止 → 零重试 / 零换模型，
 *         窗口各记一次 CALL_DEADLINE_EXCEEDED，以 call_deadline 让出；让出 ≤ 预算 + PHASE_SAFETY_MS
 *   SD-02 下一切片重跑截止失败的窗口
 *   SD-03 生产时间线（两批各 95 秒）：t+190s 剩 50 秒 < 80 秒门槛 → 不开第三批、零裁短
 *   SD-04 主模型 t+215s 限流 → 备用只用剩下的 10 秒，t+225s 截止后不再重试
 *   SD-05 澄清：阶段上限（60 秒）先到 → 照旧换备用但只用剩余 15 秒 → 截止 → 记未解决并让出
 *   SD-06 Analyst 第一遍撞截止 → 失败次数 +1、不在本切片再请求
 *   SD-07 中文化每批请求带截止时间
 */

import type { CompletionOptions, DetailedCompletionResult } from "@/lib/ai/client";
import {
  createPinnedTenderInvoker,
  resolveTenderModelPolicy,
} from "@/lib/ai/model-policy";
import type { AnalyzerInput } from "@/lib/tender-understanding/contract";
import type { LlmCallRequest, LlmInvoker } from "@/lib/tender-understanding/llm";
import {
  EXTRACT_SYSTEM_PROMPT,
  RESOLVE_SYSTEM_PROMPT,
} from "@/lib/tender-understanding/prompts";
import { ANALYST_SYSTEM_PROMPT } from "@/lib/tender-analyst/prompts";
import { advanceV2Analysis, fingerprintAnalyzerInput } from "../v2-resumable";
import { translateRequirementTexts } from "../requirement-translate";
import {
  createV2Cursor,
  PHASE_SAFETY_MS,
  type V2CursorState,
} from "../v2-cursor";

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

/* ------------------------------ 虚拟时钟 ------------------------------ */

/**
 * 极简确定性调度器：sleep() 登记到期点；run() 在微任务清空后把时钟拨到最近的到期点。
 * 同一时刻发起的多个请求在虚拟时间里并行（与生产的 Promise.all 批次一致）。
 */
class VirtualClock {
  private t: number;
  private seq = 0;
  private timers: { at: number; seq: number; fire: () => void }[] = [];
  constructor(start: number) {
    this.t = start;
  }
  now = (): number => this.t;
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.push({ at: this.t + Math.max(0, ms), seq: this.seq++, fire: resolve });
    });
  }
  async run<T>(p: Promise<T>): Promise<T> {
    let settled = false;
    let isErr = false;
    let value: T | undefined;
    let error: unknown;
    p.then(
      (v) => {
        settled = true;
        value = v;
      },
      (e) => {
        settled = true;
        isErr = true;
        error = e;
      },
    );
    let idle = 0;
    for (;;) {
      await new Promise((r) => setImmediate(r));
      if (settled) break;
      if (this.timers.length === 0) {
        if (++idle > 2_000) throw new Error("virtual clock stalled: no timers, promise pending");
        continue;
      }
      idle = 0;
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers.shift()!;
      this.t = Math.max(this.t, next.at);
      next.fire();
    }
    if (isErr) throw error;
    return value as T;
  }
}

/* ------------------------------ fixture ------------------------------ */

const T0 = Date.UTC(2026, 10, 20, 14, 46, 0);
const BUDGET = 240_000;
const WINDOW_OPTIONS = { maxCharsPerWindow: 120, maxPagesPerWindow: 1, overlapPages: 0 };
const COVERAGE = { uploaded: 1, eligible: 1, analyzed: 1, excluded: [] };

const SUBJECTS = [
  "mattress covers",
  "curtain rails",
  "workshop benches",
  "reading lamps",
  "corridor carpets",
  "storage shelving",
  "office chairs",
  "filing cabinets",
  "meeting tables",
  "window blinds",
  "entrance mats",
  "notice boards",
];

function snippet(i: number): string {
  return `The vendor must supply ${SUBJECTS[i - 1]} and complete installation within ${i * 3} days.`;
}

function buildInput(pageCount: number): AnalyzerInput {
  return {
    projectId: "proj_slice_deadline",
    documents: [
      {
        documentId: "d1",
        name: "Main.pdf",
        type: "pdf",
        sourceRole: "BASE_TENDER",
        contentHash: `hash-${pageCount}`,
        pages: Array.from({ length: pageCount }, (_, k) => ({
          pageNumber: k + 1,
          contentText: `Page ${k + 1} — Section ${k + 1}. ${snippet(k + 1)}`,
        })),
      },
    ],
  };
}

/** 带一条可核验歧义的抽取输出（用于澄清用例）；其余用例返回空抽取。 */
function extractionWithAmbiguity(i: number) {
  return {
    facts: [],
    requirements: [
      {
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
        sourceDocumentId: "d1",
        pageNumber: i,
        sourceSnippet: snippet(i),
        confidence: "HIGH",
      },
    ],
    potentialRisks: [],
    ambiguities: [
      {
        topic: `${SUBJECTS[i - 1]} packaging`,
        description: `Packaging for ${SUBJECTS[i - 1]} is not specified anywhere.`,
        whatIsUnknown: `packaging spec for ${SUBJECTS[i - 1]}`,
        sourceDocumentId: "d1",
        pageNumber: i,
        sourceSnippet: snippet(i),
        confidence: "MEDIUM",
      },
    ],
  };
}

type Kind = "window" | "resolve" | "analyst" | "other";
type ReqLog = {
  kind: Kind;
  page: number | null;
  model: string;
  retryCount: number | undefined;
  fallbackUsed: boolean | undefined;
  timeoutMs: number | undefined;
  /** 相对 T0 的毫秒 */
  start: number;
  end: number;
  outcome: "ok" | "aborted" | "error";
};

type Behavior = (r: {
  kind: Kind;
  page: number | null;
  model: string;
  primary: boolean;
}) => { latencyMs: number; error?: { status: number; message: string }; content?: string };

function kindOf(opts: CompletionOptions): { kind: Kind; page: number | null } {
  if (opts.systemPrompt === EXTRACT_SYSTEM_PROMPT) {
    const m = opts.userPrompt.match(/Page (\d+) — Section/);
    return { kind: "window", page: m ? Number(m[1]) : null };
  }
  if (opts.systemPrompt === RESOLVE_SYSTEM_PROMPT) return { kind: "resolve", page: null };
  if (opts.systemPrompt === ANALYST_SYSTEM_PROMPT) return { kind: "analyst", page: null };
  return { kind: "other", page: null };
}

const POLICY = resolveTenderModelPolicy({ env: {} });
const PRIMARY = POLICY.model;
const FALLBACK = POLICY.fallbackModel;

/** 慢模型：在 min(耗时, 超时) 之后结束；超时先到 → 抛与 OpenAI SDK 同文案的中止错误。 */
function makeSlowModel(clock: VirtualClock, behavior: Behavior) {
  const log: ReqLog[] = [];
  const complete = async (opts: CompletionOptions): Promise<DetailedCompletionResult> => {
    const { kind, page } = kindOf(opts);
    const model = opts.model ?? "unknown";
    const b = behavior({ kind, page, model, primary: model === PRIMARY });
    const start = clock.now();
    const timeout = opts.timeoutMs ?? Number.POSITIVE_INFINITY;
    const entry: ReqLog = {
      kind,
      page,
      model,
      retryCount: opts.retryCount,
      fallbackUsed: opts.fallbackUsed,
      timeoutMs: opts.timeoutMs,
      start: start - T0,
      end: Number.NaN,
      outcome: "ok",
    };
    log.push(entry);
    const waitMs = Math.min(b.latencyMs, timeout);
    if (!Number.isFinite(waitMs)) throw new Error("test model would never return (no timeout)");
    await clock.sleep(waitMs);
    entry.end = clock.now() - T0;
    if (b.latencyMs > timeout) {
      entry.outcome = "aborted";
      throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
    }
    if (b.error) {
      entry.outcome = "error";
      throw Object.assign(new Error(b.error.message), { status: b.error.status });
    }
    return {
      content: b.content ?? "{}",
      finishReason: "stop",
      model,
      elapsedMs: waitMs,
    };
  };
  return { complete, log };
}

type SliceResult = {
  outcome: Awaited<ReturnType<typeof advanceV2Analysis>>;
  endedAt: number;
  checkpoints: number[];
};

async function runSlice(args: {
  clock: VirtualClock;
  input: AnalyzerInput;
  cursor: V2CursorState;
  invoker: LlmInvoker;
  sliceStart: number;
}): Promise<SliceResult> {
  const checkpoints: number[] = [];
  const outcome = await args.clock.run(
    advanceV2Analysis({
      input: args.input,
      coverage: COVERAGE,
      cursor: args.cursor,
      deadlineAt: args.sliceStart + BUDGET,
      tickBudgetMs: BUDGET,
      invoker: args.invoker,
      maxConcurrency: 3,
      windowOptions: WINDOW_OPTIONS,
      now: args.clock.now,
      saveCursor: async () => {
        checkpoints.push(args.clock.now() - T0);
        return true;
      },
    }),
  );
  return { outcome, endedAt: args.clock.now() - T0, checkpoints };
}

function newCursor(input: AnalyzerInput, clock: VirtualClock): V2CursorState {
  return createV2Cursor({
    fingerprint: fingerprintAnalyzerInput(input),
    analysisDate: "2026-11-20",
    now: new Date(clock.now()),
  });
}

function invokerFor(clock: VirtualClock, complete: ReturnType<typeof makeSlowModel>["complete"]) {
  return createPinnedTenderInvoker({ env: {}, now: clock.now, complete }) as unknown as LlmInvoker;
}

const S = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/* ------------------------------ 用例 ------------------------------ */

async function main() {
  ok(PRIMARY !== FALLBACK, `前提：主模型 ${PRIMARY} 与备用 ${FALLBACK} 不同（生产 kill_switch 下为 terra → sol）`);

  /* ---------------- SD-01 / SD-02 慢模型撞截止 + 下一切片重跑 ---------------- */
  {
    const clock = new VirtualClock(T0);
    const input = buildInput(12);
    let secondSlice = false;
    const model = makeSlowModel(clock, ({ kind, page }) => {
      if (kind !== "window" || page == null) return { latencyMs: 1_000 };
      if (secondSlice) return { latencyMs: 30_000 };
      if (page <= 6) return { latencyMs: 77_500 };
      return { latencyMs: Number.POSITIVE_INFINITY }; // 慢模型：永远不在超时内返回
    });
    const invoker = invokerFor(clock, model.complete);
    const cursor = newCursor(input, clock);

    const r = await runSlice({ clock, input, cursor, invoker, sliceStart: T0 });
    const yieldReason = r.outcome.status === "YIELD" ? r.outcome.reason : "(READY)";
    console.log(`  · SD-01 让出于 ${S(r.endedAt)}，理由 ${yieldReason}，请求 ${model.log.length} 次`);
    for (const e of model.log.filter((x) => x.page != null && x.page >= 7)) {
      console.log(
        `    p${e.page} ${e.model} retryCount=${e.retryCount} ${S(e.start)}→${S(e.end)} timeout=${S(e.timeoutMs ?? 0)} ${e.outcome}`,
      );
    }

    ok(
      r.endedAt <= BUDGET + PHASE_SAFETY_MS,
      `SD-01 切片从开始到让出（含所有重试）≤ 预算 + PHASE_SAFETY_MS（${S(r.endedAt)} ≤ ${S(BUDGET + PHASE_SAFETY_MS)}）`,
    );
    ok(r.endedAt === 225_000, `SD-01 在调用截止 t+225s 让出（实际 ${S(r.endedAt)}）`);
    ok(
      r.outcome.status === "YIELD" && r.outcome.reason === "call_deadline" && r.outcome.phase === "WINDOWS",
      `SD-01 让出理由 call_deadline（实际 ${yieldReason}）`,
    );
    const batch3 = model.log.filter((e) => e.page != null && e.page >= 7 && e.page <= 9);
    ok(
      batch3.length === 3 && batch3.every((e) => e.model === PRIMARY && e.start === 155_000),
      `SD-01 第三批 p7–p9 在 t+155s 各只请求一次主模型（实际 ${batch3.length} 次）`,
    );
    ok(
      batch3.every((e) => e.timeoutMs === 70_000),
      "SD-01 剩余 85 秒照常开批，每个窗口超时 70 秒",
    );
    ok(
      !model.log.some((e) => e.model === FALLBACK),
      "SD-01 本方截止中止后不换备用模型",
    );
    ok(
      !model.log.some((e) => e.start > 155_000),
      "SD-01 t+155s 之后没有发起任何新请求（无同模型重试、无结构化重试）",
    );
    ok(
      model.log.every((e) => e.start + (e.timeoutMs ?? Number.POSITIVE_INFINITY) <= 225_000),
      "SD-01 每个请求的超时都不越过调用截止 t+225s",
    );
    ok(
      Object.keys(cursor.windows.failures).length === 3 && countDeadlineFailures(cursor) === 3,
      `SD-01 第三批 3 个窗口各记一次失败、错误码 CALL_DEADLINE_EXCEEDED（实际 ${countDeadlineFailures(cursor)} 个）`,
    );
    ok(Object.keys(cursor.windows.outputs).length === 6, "SD-01 前两批 6 个窗口的结果已落检查点");
    ok(r.checkpoints.includes(225_000), "SD-01 截止那一批的结果在 t+225s 写了检查点");

    // SD-02：下一个切片以完整预算开始，截止失败的窗口被重新请求
    secondSlice = true;
    const before = model.log.length;
    const r2 = await runSlice({ clock, input, cursor, invoker, sliceStart: clock.now() });
    const retried = model.log.slice(before).filter((e) => e.page != null && e.page >= 7 && e.page <= 9);
    ok(
      retried.length === 3 && retried.every((e) => e.outcome === "ok"),
      `SD-02 下一切片重新请求 p7–p9 并成功（${retried.length} 次）`,
    );
    ok(
      Object.keys(cursor.windows.outputs).length === 12,
      "SD-02 下一切片补齐全部 12 个窗口",
    );
    void r2;
  }

  /* ---------------- SD-03 生产时间线：t+190s 不再开批 ---------------- */
  {
    const clock = new VirtualClock(T0);
    const input = buildInput(12);
    const model = makeSlowModel(clock, ({ kind }) =>
      kind === "window" ? { latencyMs: 95_000 } : { latencyMs: 1_000 },
    );
    const invoker = invokerFor(clock, model.complete);
    const cursor = newCursor(input, clock);
    const r = await runSlice({ clock, input, cursor, invoker, sliceStart: T0 });
    const reason = r.outcome.status === "YIELD" ? r.outcome.reason : "(READY)";
    console.log(`  · SD-03 让出于 ${S(r.endedAt)}，理由 ${reason}，请求 ${model.log.length} 次`);
    ok(
      r.endedAt <= BUDGET + PHASE_SAFETY_MS,
      `SD-03 切片从开始到让出 ≤ 预算 + PHASE_SAFETY_MS（${S(r.endedAt)}）`,
    );
    ok(r.endedAt === 190_000, `SD-03 t+190s 剩 50 秒 < 80 秒门槛 → 当即让出（实际 ${S(r.endedAt)}）`);
    ok(model.log.length === 6, `SD-03 只开了两批、6 个请求（实际 ${model.log.length}）`);
    ok(
      model.log.every((e) => e.outcome === "ok"),
      "SD-03 没有任何请求被裁短中止",
    );
  }

  /* ---------------- SD-04 限流后换备用只用剩余时间 ---------------- */
  {
    const clock = new VirtualClock(T0);
    const input = buildInput(9);
    const model = makeSlowModel(clock, ({ kind, page, primary }) => {
      if (kind !== "window" || page == null) return { latencyMs: 1_000 };
      if (page <= 6) return { latencyMs: 77_500 };
      if (primary) return { latencyMs: 60_000, error: { status: 429, message: "429 Rate limit reached" } };
      return { latencyMs: Number.POSITIVE_INFINITY };
    });
    const invoker = invokerFor(clock, model.complete);
    const cursor = newCursor(input, clock);
    const r = await runSlice({ clock, input, cursor, invoker, sliceStart: T0 });
    const fb = model.log.filter((e) => e.model === FALLBACK);
    console.log(
      `  · SD-04 让出于 ${S(r.endedAt)}；备用请求 ${fb.map((e) => `p${e.page} ${S(e.start)} timeout=${S(e.timeoutMs ?? 0)}`).join("，")}`,
    );
    ok(
      fb.length === 3 && fb.every((e) => e.start === 215_000 && e.timeoutMs === 10_000),
      "SD-04 主模型 t+215s 限流 → 备用请求只用剩余的 10 秒",
    );
    ok(
      !model.log.some((e) => e.start > 215_000),
      "SD-04 备用在 t+225s 截止中止后不再重试",
    );
    ok(r.endedAt === 225_000, `SD-04 t+225s 让出（实际 ${S(r.endedAt)}）`);
  }

  /* ---------------- SD-05 澄清：阶段上限先到 → 备用只用剩余 → 截止 ---------------- */
  {
    const clock = new VirtualClock(T0);
    const input = buildInput(3);
    const model = makeSlowModel(clock, ({ kind, page }) => {
      if (kind === "window" && page != null) {
        return { latencyMs: 150_000, content: JSON.stringify(extractionWithAmbiguity(page)) };
      }
      if (kind === "resolve") return { latencyMs: Number.POSITIVE_INFINITY };
      return { latencyMs: 1_000 };
    });
    const invoker = invokerFor(clock, model.complete);
    const cursor = newCursor(input, clock);
    const r = await runSlice({ clock, input, cursor, invoker, sliceStart: T0 });
    const resolves = model.log.filter((e) => e.kind === "resolve");
    const reason = r.outcome.status === "YIELD" ? `${r.outcome.phase}/${r.outcome.reason}` : "(READY)";
    console.log(
      `  · SD-05 让出于 ${S(r.endedAt)}（${reason}）；澄清请求 ${resolves.map((e) => `${e.model === PRIMARY ? "主" : "备"} ${S(e.start)} timeout=${S(e.timeoutMs ?? 0)}`).join("，")}`,
    );
    ok(resolves.length >= 1, "SD-05 前提：窗口产出可核验歧义，进入澄清并请求模型");
    ok(
      resolves.length === 2 &&
        resolves[0]!.model === PRIMARY &&
        resolves[0]!.timeoutMs === 60_000 &&
        resolves[1]!.model === FALLBACK &&
        resolves[1]!.start === 210_000 &&
        resolves[1]!.timeoutMs === 15_000,
      "SD-05 阶段上限 60 秒先到、还剩 15 秒 → 照旧换备用，备用超时 15 秒",
    );
    ok(
      r.outcome.status === "YIELD" && r.outcome.phase === "CLARIFY" && r.outcome.reason === "call_deadline",
      `SD-05 截止后以 call_deadline 让出（实际 ${reason}）`,
    );
    ok(r.endedAt === 225_000, `SD-05 t+225s 让出（实际 ${S(r.endedAt)}）`);
    const resolved = Object.values(cursor.clarify.resolutions);
    ok(resolved.length === 1 && resolved[0] === null, "SD-05 该条按既有保守方向记为未解决");
  }

  /* ---------------- SD-06 Analyst 第一遍撞截止 ---------------- */
  {
    const clock = new VirtualClock(T0);
    const input = buildInput(3);
    const model = makeSlowModel(clock, ({ kind }) => {
      if (kind === "analyst") return { latencyMs: Number.POSITIVE_INFINITY };
      return { latencyMs: 1_000 };
    });
    const invoker = invokerFor(clock, model.complete);
    const cursor = newCursor(input, clock);
    const r = await runSlice({ clock, input, cursor, invoker, sliceStart: T0 });
    const analyst = model.log.filter((e) => e.kind === "analyst");
    const reason = r.outcome.status === "YIELD" ? `${r.outcome.phase}/${r.outcome.reason}` : "(READY)";
    console.log(
      `  · SD-06 让出于 ${S(r.endedAt)}（${reason}）；Analyst 请求 ${analyst.map((e) => `${e.model === PRIMARY ? "主" : "备"} ${S(e.start)} timeout=${S(e.timeoutMs ?? 0)}`).join("，")}`,
    );
    ok(
      analyst.length === 1 && analyst[0]!.model === PRIMARY,
      `SD-06 Analyst 只请求一次主模型（实际 ${analyst.length} 次）`,
    );
    ok(
      cursor.analyst.passAAttempts === 1 && cursor.analyst.passAErrorCode === "CALL_DEADLINE_EXCEEDED",
      `SD-06 第一遍失败次数 1、错误码 CALL_DEADLINE_EXCEEDED（实际 ${cursor.analyst.passAAttempts} / ${cursor.analyst.passAErrorCode}）`,
    );
    ok(
      r.outcome.status === "YIELD" && r.outcome.phase === "ANALYST_A" && r.outcome.reason === "call_deadline",
      `SD-06 以 call_deadline 让出（实际 ${reason}）`,
    );
    ok(r.endedAt <= 225_000, `SD-06 不晚于调用截止 t+225s 让出（实际 ${S(r.endedAt)}）`);
  }

  /* ---------------- SD-07 中文化每批请求带截止时间 ---------------- */
  {
    const seen: LlmCallRequest[] = [];
    const startedAt = Date.now();
    const invoker: LlmInvoker = async (req) => {
      seen.push(req);
      return {
        content: JSON.stringify({ items: [{ i: 0, zh: "供应商须提供床垫套。" }] }),
        model: "scripted",
        elapsedMs: 1,
      };
    };
    await translateRequirementTexts(["Vendor must supply mattress covers."], {
      invoker,
      timeoutMs: 20_000,
      apply: () => undefined,
    });
    const d = seen[0]?.deadlineAt;
    ok(
      seen.length === 1 && typeof d === "number" && d <= Date.now() + 20_000 && d >= startedAt + 19_000,
      "SD-07 中文化以 20 秒总预算开始一批请求 → 请求带的截止时间不晚于开始后 20 秒",
    );
  }

  console.log(`\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

function countDeadlineFailures(cursor: V2CursorState): number {
  return Object.values(cursor.windows.failures).filter(
    (f) => f.attempts === 1 && f.lastErrorCode === "CALL_DEADLINE_EXCEEDED",
  ).length;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
