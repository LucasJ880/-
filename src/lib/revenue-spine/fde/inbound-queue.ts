/**
 * Revenue Spine — Inbound FDE 队列：真实状态读取 + 原子认领 + 执行 + cron 兜底
 *
 * 一条来信的 FDE（SalesAction.signalKey = inbound:<interactionId>）可能被 after() 回调、站点重发、cron、
 * 同步录入与人工入口同时想执行；任何一处都必须先经 claimInboundFde 认领（按 updatedAt 比较并交换，并发认领
 * 只有一个命中），认领成功者才调用 runInboundSalesFde，失败者什么都不做。认领条件、写入与计数
 * （fdeAttempts / fdeBlockedAttempts）见 docs/QINGYAN_WEBSITE_INTAKE_ASYNC.md §5、§5.1。
 *
 * 时间耦合：FDE_CLAIM_STALE_MS（10 min）> 任何持有认领者的最长寿命 = 路由 maxDuration（最长 300 s）。
 * 架构定位：带过期认领的领域级队列面，已在 runtime-architecture 基线 engineSurfaceFiles 登记（决定见 ASYNC §5.4）。
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { FDE_EMPLOYEE_KEY } from "./actions";
import { INQUIRY_REPLY_ACTION_TYPE, runInboundSalesFde, type FdeTrigger, type InboundFdeResult } from "./inbound-sales";

export interface FdeState {
  /** not_run | queued | running | stale_running | completed | failed | run_blocked | cancelled | already_sent | human_rejected | superseded | action_closed */
  status: string;
  /** true = 接收端不会再自行推进（全链已完成或已被人工/系统终结）；false = 仍需恢复 */
  terminal: boolean;
  /** 判定依据（供站点与排障读取，不由 HTTP 状态推断） */
  reason: string;
  agentRunId: string | null;
  pendingActionId: string | null;
  salesActionId: string | null;
}

/** 来信 FDE 行动的 signalKey 前缀（inquiry-intake / recreateFdeAction 写入；next_action 等其它行动不是） */
export const INBOUND_FDE_SIGNAL_PREFIX = "inbound:";

/**
 * FDE 处于 running 且超过此时长没有任何写入，视为执行者已中断（函数被硬杀等），可被再次认领；
 * loadFdeState 同时据此把它报告为 stale_running。必须大于持有认领者的最长寿命（路由 maxDuration 300 s）。
 */
export const FDE_STALE_RUNNING_MS = 10 * 60 * 1000;
/** 认领过期时长：与 stale_running 判定是同一个常量（认领即把 fdeStatus 写为 running） */
export const FDE_CLAIM_STALE_MS = FDE_STALE_RUNNING_MS;

/** 可重跑的 FDE 状态（其余状态要么已完成，要么已被人工/系统终结） */
export const FDE_RERUNNABLE: ReadonlySet<string> = new Set(["not_run", "queued", "failed", "run_blocked", "stale_running"]);

/**
 * cron 自动重试上限：
 *   - failed / 过期 running：按 fdeAttempts（可能花了 LLM 的执行次数；run_blocked 的认领不计）。
 *   - 非配额原因的 run_blocked：按 fdeBlockedAttempts（否则它们会永远排在候选前面）。
 * queued（从未执行）与配额原因的 run_blocked 不受此限。站点重发安排的执行也不受此限（站点自己有跟进次数上限）。
 */
export const FDE_CRON_MAX_ATTEMPTS = 3;

const OPEN_ACTION_STATUSES = ["open", "in_progress"];
/** 认领前 SalesAction.inputContext.fdeStatus 允许的存储值（running 另按过期判定） */
const CLAIMABLE_STORED_STATUSES: ReadonlySet<string> = new Set(["queued", "failed", "run_blocked", "not_run"]);
/** runInboundSalesFde 在建 AgentRun 失败时返回的错误码（此时它自己写 fdeStatus=run_blocked） */
const RUN_BLOCKED_CODES: ReadonlySet<string> = new Set(["QUOTA", "RUN_CREATE_FAILED"]);

export type FdeClaimant = "after" | "replay" | "cron" | "inline" | "manual";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function storedFdeStatus(ctx: Record<string, unknown>): string {
  return typeof ctx.fdeStatus === "string" && ctx.fdeStatus ? ctx.fdeStatus : "queued";
}

/** 新的 updatedAt 必须严格大于读到的值，否则同一毫秒内的两次写入会让比较并交换失效 */
function bumpedAfter(prev: Date): Date {
  return new Date(Math.max(Date.now(), prev.getTime() + 1));
}

/**
 * FDE 真实状态：SalesAction.inputContext.fdeStatus 为主，再用 AgentRun / PendingAction 的
 * 真实终态覆盖。恢复不得复活已取消、已人工拒绝、已发送、已被系统作废或已被关闭的动作。只读。
 */
export async function loadFdeState(orgId: string, interactionId: string, now: Date = new Date()): Promise<FdeState> {
  const action = await db.salesAction.findFirst({
    where: { orgId, signalKey: `${INBOUND_FDE_SIGNAL_PREFIX}${interactionId}` },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, agentRunId: true, pendingActionId: true, inputContext: true, updatedAt: true },
  });
  if (!action) {
    return { status: "not_run", terminal: false, reason: "no SalesAction for this inbound", agentRunId: null, pendingActionId: null, salesActionId: null };
  }
  const ctx = asRecord(action.inputContext);
  let status = storedFdeStatus(ctx);
  if (status === "running" && now.getTime() - action.updatedAt.getTime() > FDE_STALE_RUNNING_MS) status = "stale_running";
  const base = { agentRunId: action.agentRunId, pendingActionId: action.pendingActionId, salesActionId: action.id };

  // 1) 该来信的审批草稿真实状态优先（人工决策与系统作废都是终态，不得靠恢复复活）
  const drafts = await db.pendingAction.findMany({
    where: { orgId, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["replyToInteractionId"], equals: interactionId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, decidedById: true, failureReason: true, expiresAt: true },
  });
  const executed = drafts.find((d) => d.status === "executed");
  if (executed) return { ...base, status: "already_sent", terminal: true, reason: "reply already sent (PendingAction executed)", pendingActionId: executed.id };
  const pending = drafts.find((d) => d.status === "pending" && d.expiresAt > now);
  if (pending) return { ...base, status: "completed", terminal: true, reason: "draft awaiting human approval", pendingActionId: pending.id };
  const rejected = drafts.find((d) => d.status === "rejected" && d.decidedById);
  if (rejected) return { ...base, status: "human_rejected", terminal: true, reason: "draft rejected by a human", pendingActionId: rejected.id };
  const superseded = drafts.find((d) => d.status === "failed" && (d.failureReason ?? "").startsWith("SUPERSEDED_"));
  if (superseded) return { ...base, status: "superseded", terminal: true, reason: "draft superseded by a newer event", pendingActionId: superseded.id };

  // 2) run 被 supervisor 取消 → 终态，恢复不得重跑
  if (action.agentRunId) {
    const run = await db.agentRun.findUnique({ where: { id: action.agentRunId }, select: { status: true } });
    if (run?.status === "cancelled") return { ...base, status: "cancelled", terminal: true, reason: "AgentRun cancelled by supervisor" };
  }

  if (status === "completed") return { ...base, status, terminal: true, reason: "FDE completed" };
  // 3) 行动在 FDE 完成前已被关闭（人工忽略 / 手动完成）→ 终态：任何执行者都不得再认领它
  if (!OPEN_ACTION_STATUSES.includes(action.status)) {
    return { ...base, status: "action_closed", terminal: true, reason: `SalesAction ${action.status} before the FDE finished` };
  }
  if (status === "running") return { ...base, status, terminal: false, reason: "FDE currently running" };
  return { ...base, status, terminal: false, reason: `FDE not finished (${status})` };
}

export interface FdeClaimResult {
  claimed: boolean;
  /** claimed | not_found | action_closed | in_flight | not_rerunnable | terminal | superseded_action | lost_race */
  reason: string;
  token: string | null;
  opportunityId: string | null;
  /** 认领前的真实状态（loadFdeState）；早退时可能为 null */
  state: FdeState | null;
  /** 本次认领后的 fdeAttempts（认领时 +1；若结果是 run_blocked 会再退回） */
  attempts: number;
}

/**
 * 原子认领一个来信 FDE。成功者独占执行权直到它写出终态（completed / failed / run_blocked），
 * 或者超过 FDE_CLAIM_STALE_MS 没有任何写入（视为中断，允许再次认领）。
 */
export async function claimInboundFde(
  orgId: string,
  salesActionId: string,
  opts: { by: FdeClaimant; now?: Date },
): Promise<FdeClaimResult> {
  const now = opts.now ?? new Date();
  const no = (reason: string, extra: Partial<FdeClaimResult> = {}): FdeClaimResult => ({
    claimed: false, reason, token: null, opportunityId: null, state: null, attempts: 0, ...extra,
  });
  const action = await db.salesAction.findFirst({
    where: { id: salesActionId, orgId, signalKey: { startsWith: INBOUND_FDE_SIGNAL_PREFIX } },
    select: { id: true, status: true, opportunityId: true, signalKey: true, inputContext: true, updatedAt: true },
  });
  if (!action || !action.opportunityId) return no("not_found");
  if (!OPEN_ACTION_STATUSES.includes(action.status)) return no("action_closed", { opportunityId: action.opportunityId });

  const ctx = asRecord(action.inputContext);
  const stored = storedFdeStatus(ctx);
  const stale = now.getTime() - action.updatedAt.getTime() > FDE_CLAIM_STALE_MS;
  if (stored === "running" && !stale) return no("in_flight", { opportunityId: action.opportunityId });
  if (stored !== "running" && !CLAIMABLE_STORED_STATUSES.has(stored)) return no("not_rerunnable", { opportunityId: action.opportunityId });

  // 其它表里的终态（草稿 / run）只有 loadFdeState 看得到：任何一项终态都不认领
  const interactionId = action.signalKey.slice(INBOUND_FDE_SIGNAL_PREFIX.length);
  const state = await loadFdeState(orgId, interactionId, now);
  if (state.salesActionId !== action.id) return no("superseded_action", { opportunityId: action.opportunityId, state });
  if (state.terminal) return no("terminal", { opportunityId: action.opportunityId, state });
  if (!FDE_RERUNNABLE.has(state.status)) return no("not_rerunnable", { opportunityId: action.opportunityId, state });

  const token = randomUUID();
  const attempts = count(ctx.fdeAttempts) + 1;
  const next = {
    ...ctx,
    fdeStatus: "running",
    fdeClaim: { token, by: opts.by, claimedAt: now.toISOString(), from: state.status },
    fdeAttempts: attempts,
  };
  const won = await db.salesAction.updateMany({
    where: { id: action.id, orgId, status: { in: OPEN_ACTION_STATUSES }, updatedAt: action.updatedAt },
    data: { inputContext: toJson(next), updatedAt: bumpedAfter(action.updatedAt), lastObservedAt: new Date() },
  });
  if (won.count !== 1) return no("lost_race", { opportunityId: action.opportunityId, state });
  return { claimed: true, reason: "claimed", token, opportunityId: action.opportunityId, state, attempts };
}

/**
 * 只改写自己持有的认领：inputContext.fdeClaim.token 仍是本 token、fdeStatus 在 expect 之中才写，
 * 否则说明 FDE 已写出别的状态或已被他人接管，不动。比较并交换（updatedAt），竞争失败重读重试。
 */
async function patchOwnClaim(
  orgId: string,
  salesActionId: string,
  token: string,
  expect: readonly string[],
  patch: (ctx: Record<string, unknown>) => Record<string, unknown>,
): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const cur = await db.salesAction.findFirst({ where: { id: salesActionId, orgId }, select: { inputContext: true, updatedAt: true } });
    if (!cur) return false;
    const ctx = asRecord(cur.inputContext);
    if (asRecord(ctx.fdeClaim).token !== token || !expect.includes(String(ctx.fdeStatus))) return false;
    const r = await db.salesAction.updateMany({
      where: { id: salesActionId, orgId, updatedAt: cur.updatedAt },
      data: { inputContext: toJson({ ...ctx, ...patch(ctx) }), updatedAt: bumpedAfter(cur.updatedAt) },
    });
    if (r.count === 1) return true;
  }
  return false;
}

/**
 * run_blocked（建 AgentRun 失败：配额 / 会话等）后的记账（纯函数）：
 *   - 这次认领没花 LLM → fdeAttempts 退回认领前的值，不占 failed / 过期 running 的重试上限；
 *   - 非配额原因 → fdeBlockedAttempts + 1（有上限，避免永远排在 cron 候选前面）；配额原因不计；
 *   - 记下 fdeErrorCode（runInboundSalesFde 只写 fdeError 文本）。
 */
export function runBlockedClaimPatch(
  ctx: Record<string, unknown>,
  claimAttempts: number,
  result: Pick<InboundFdeResult, "errorCode" | "error">,
): Record<string, unknown> {
  const code = result.errorCode ?? "RUN_CREATE_FAILED";
  return {
    fdeStatus: "run_blocked",
    fdeErrorCode: code,
    fdeError: result.error ?? (typeof ctx.fdeError === "string" ? ctx.fdeError : code),
    fdeAttempts: Math.max(0, claimAttempts - 1),
    ...(code === "QUOTA" ? {} : { fdeBlockedAttempts: count(ctx.fdeBlockedAttempts) + 1 }),
  };
}

export interface QueuedFdeRun {
  /** 本次认领成功并调用了 runInboundSalesFde */
  ran: boolean;
  claim: FdeClaimResult;
  result: InboundFdeResult | null;
}

export interface RunQueuedFdeOptions {
  by: FdeClaimant;
  trigger: FdeTrigger;
  now?: Date;
  /** 人工入口：记录在 AgentRun.metadata.actorUserId */
  actorUserId?: string | null;
}

/**
 * 认领 → 执行 → （必要时）释放 / 记账。所有来信 FDE 执行入口（after() 回调 / 重发 / cron / 同步录入 / 人工入口）共用。
 * 同一 FDE 不会被并发执行：没认领到的调用直接返回 ran=false。
 */
export async function runQueuedInboundFde(orgId: string, salesActionId: string, opts: RunQueuedFdeOptions): Promise<QueuedFdeRun> {
  const claim = await claimInboundFde(orgId, salesActionId, { by: opts.by, now: opts.now });
  if (!claim.claimed || !claim.token || !claim.opportunityId) return { ran: false, claim, result: null };
  const token = claim.token;
  // FDE 没有自行写出终态时释放自己的认领：仍是本 token 且仍为 running 才改写（否则已写终态或已被他人接管，不动）
  const releaseFailed = (patch: { fdeError: string; fdeErrorCode: string }) =>
    patchOwnClaim(orgId, salesActionId, token, ["running"], () => ({ fdeStatus: "failed", ...patch }));
  let result: InboundFdeResult;
  try {
    result = await runInboundSalesFde({
      orgId,
      opportunityId: claim.opportunityId,
      salesActionId,
      trigger: opts.trigger,
      now: opts.now,
      actorUserId: opts.actorUserId ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await releaseFailed({ fdeError: message, fdeErrorCode: "FDE_THREW" }).catch(() => undefined);
    throw err;
  }
  if (!result.agentRunId) {
    if (result.errorCode && RUN_BLOCKED_CODES.has(result.errorCode)) {
      // runInboundSalesFde 已写 run_blocked（写失败时仍是 running）：退回本次认领的执行计数，非配额原因另计
      await patchOwnClaim(orgId, salesActionId, token, ["run_blocked", "running"], (ctx) => runBlockedClaimPatch(ctx, claim.attempts, result)).catch(() => undefined);
    } else {
      // 在建 AgentRun 之前返回（NOT_FOUND / LEGACY_STAGE / TERMINAL / NO_INBOUND）时 runInboundSalesFde 不写 SalesAction；
      // 不释放的话 running 会一直挂到过期。这些条件不会自行消失，计入 fdeAttempts（cron 至多再试几次就停）。
      await releaseFailed({ fdeError: result.error ?? "FDE did not start", fdeErrorCode: result.errorCode ?? "NOT_STARTED" }).catch(() => undefined);
    }
  }
  return { ran: true, claim, result };
}

function notRunResult(opportunityId: string, errorCode: string, error: string): InboundFdeResult {
  return {
    ok: false,
    agentRunId: null,
    opportunityId,
    stage: "",
    score: null,
    grade: null,
    missing: [],
    questions: [],
    rfqId: null,
    assessmentId: null,
    draft: null,
    pendingActionId: null,
    approvalRequired: false,
    error,
    errorCode,
  };
}

/** 认领被拒是因为别处正在执行（不是终态） */
const IN_FLIGHT_REASONS: ReadonlySet<string> = new Set(["in_flight", "lost_race"]);

/**
 * 人工入口（POST /api/revenue/inquiries、POST /api/revenue/opportunities/[id]/run-fde）的 FDE 执行。
 *   - 有该商机的来信行动（inbound:*）→ 经认领执行，与 after() 回调 / 重发 / cron 互斥：
 *       · 别处正在执行（in_flight / lost_race）→ 不并行，返回 FDE_IN_FLIGHT（结果由正在执行者产出）；
 *       · 已终结（草稿待审批 / 已发送 / 已拒绝 / 行动已关闭 …）→ rerunFinished 时按原行为直接重跑
 *         （人工明确要求重跑；自动路径从不认领终态的 FDE，且重跑一开始就把 fdeStatus 写成 running，不会与之并行），
 *         否则不跑，返回 FDE_FINISHED。
 *   - 没有来信行动（未传 salesActionId，或不是该商机的来信行动）→ 按原行为直接跑：没有可认领的对象。
 */
export async function runInboundFdeForHuman(input: {
  orgId: string;
  opportunityId: string;
  salesActionId: string | null;
  trigger: FdeTrigger;
  by: FdeClaimant;
  actorUserId: string | null;
  rerunFinished: boolean;
}): Promise<InboundFdeResult> {
  const direct = () =>
    runInboundSalesFde({
      orgId: input.orgId,
      opportunityId: input.opportunityId,
      salesActionId: input.salesActionId,
      trigger: input.trigger,
      actorUserId: input.actorUserId,
    });
  if (!input.salesActionId) return direct();
  const inbound = await db.salesAction.findFirst({
    where: { id: input.salesActionId, orgId: input.orgId, opportunityId: input.opportunityId, signalKey: { startsWith: INBOUND_FDE_SIGNAL_PREFIX } },
    select: { id: true },
  });
  if (!inbound) return direct();
  const run = await runQueuedInboundFde(input.orgId, inbound.id, { by: input.by, trigger: input.trigger, actorUserId: input.actorUserId });
  if (run.ran && run.result) return run.result;
  if (IN_FLIGHT_REASONS.has(run.claim.reason)) {
    return notRunResult(input.opportunityId, "FDE_IN_FLIGHT", "这条来信的 FDE 正在执行，请稍后刷新查看结果");
  }
  if (input.rerunFinished) return direct();
  const status = run.claim.state?.status ?? run.claim.reason;
  return notRunResult(input.opportunityId, "FDE_FINISHED", `这条来信的 FDE 已结束（${status}），未重复执行`);
}

/**
 * cron 候选：本组织内开放的来信 FDE 行动——queued；run_blocked（配额原因不限次，其它原因按 fdeBlockedAttempts 限次）；
 * failed / 过期 running 且 fdeAttempts 未到上限。没有 fdeAttempts 的历史 failed / running 行（本改动之前产生）不在候选里，
 * 与改动前 cron 只取未建 run 的行为一致。按 updatedAt 升序：刚被认领过的行（认领会推进 updatedAt）排到后面，
 * 反复失败的行不会一直挡住新来的排队 FDE。exclude：本轮已经处理过的行。最终是否执行仍由 claimInboundFde 判定。
 */
export async function listInboundFdeCandidates(orgId: string, now: Date, take: number, exclude: readonly string[] = []) {
  const staleBefore = new Date(now.getTime() - FDE_CLAIM_STALE_MS);
  const status = (v: string) => ({ inputContext: { path: ["fdeStatus"], equals: v } });
  const underCap = { inputContext: { path: ["fdeAttempts"], lt: FDE_CRON_MAX_ATTEMPTS } };
  const blockedUnderCap = {
    OR: [
      { inputContext: { path: ["fdeBlockedAttempts"], equals: Prisma.DbNull } },
      { inputContext: { path: ["fdeBlockedAttempts"], lt: FDE_CRON_MAX_ATTEMPTS } },
    ],
  };
  return db.salesAction.findMany({
    where: {
      orgId,
      employeeKey: FDE_EMPLOYEE_KEY,
      status: { in: OPEN_ACTION_STATUSES },
      opportunityId: { not: null },
      signalKey: { startsWith: INBOUND_FDE_SIGNAL_PREFIX },
      ...(exclude.length ? { id: { notIn: [...exclude] } } : {}),
      OR: [
        status("queued"),
        { AND: [status("run_blocked"), blockedUnderCap] },
        { AND: [status("failed"), underCap] },
        { AND: [status("running"), { updatedAt: { lt: staleBefore } }, underCap] },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take,
    select: { id: true, opportunityId: true },
  });
}

export interface DrainOrgResult {
  orgId: string;
  /** 本轮读到的候选数（去重） */
  fdeQueued: number;
  /** 认领成功并执行的次数 */
  fdeExecuted: number;
  /** 执行且 FDE ok 的次数（与改动前 cron 结果里 fdeRan 的含义一致） */
  fdeRan: number;
  /** 没认领到（被他人执行中 / 已终态 / 竞争失败）的次数 */
  fdeSkipped: number;
  /** 组织 AgentRun 配额耗尽：本轮不再启动该组织的 FDE */
  quotaBlocked: boolean;
  error?: string;
}

export interface DrainOptions {
  orgIds: string[];
  /** 墙钟截止（epoch ms）：到点后不再启动新的 FDE；已启动的跑完 */
  deadlineAt: number;
  now?: Date;
  /** 每个组织每次读取的候选数（读完再读下一批，直到截止或没有未处理的候选；不是执行上限） */
  perOrgCandidates?: number;
  /** 每次实际执行后的回调（例如回填网站询盘收据）；失败不影响队列 */
  afterRun?: (orgId: string, salesActionId: string, run: QueuedFdeRun) => Promise<void>;
}

/**
 * cron 兜底：按组织轮转（每轮每个组织最多处理一个候选），直到截止时间或所有组织都没有未处理的候选。
 * 每个候选本轮最多处理一次；一批处理完再读下一批（排除本轮处理过的），快速跳过的行不会挡住后面的排队 FDE。
 * 所有执行都经 runQueuedInboundFde 认领，与 after() 回调 / 重发互斥。
 */
export async function drainInboundFdeQueue(opts: DrainOptions): Promise<{ results: DrainOrgResult[]; deadlineReached: boolean }> {
  const now = opts.now ?? new Date();
  const take = opts.perOrgCandidates ?? 25;
  const queues = opts.orgIds.map((orgId) => ({
    result: { orgId, fdeQueued: 0, fdeExecuted: 0, fdeRan: 0, fdeSkipped: 0, quotaBlocked: false } as DrainOrgResult,
    pending: [] as string[],
    tried: new Set<string>(),
    exhausted: false,
  }));
  const refill = async (q: (typeof queues)[number]) => {
    if (q.exhausted || q.pending.length > 0) return;
    try {
      const rows = await listInboundFdeCandidates(q.result.orgId, now, take, [...q.tried]);
      if (rows.length === 0) {
        q.exhausted = true;
        return;
      }
      q.result.fdeQueued += rows.length;
      q.pending.push(...rows.map((r) => r.id));
    } catch (err) {
      q.result.error = err instanceof Error ? err.message : String(err);
      q.exhausted = true;
    }
  };

  let deadlineReached = false;
  for (;;) {
    let progressed = false;
    for (const q of queues) {
      if (q.result.quotaBlocked) continue;
      await refill(q);
      if (q.pending.length === 0) continue;
      if (Date.now() >= opts.deadlineAt) {
        deadlineReached = true;
        break;
      }
      const id = q.pending.shift()!;
      q.tried.add(id);
      progressed = true;
      try {
        const run = await runQueuedInboundFde(q.result.orgId, id, { by: "cron", trigger: "cron" });
        if (!run.ran) {
          q.result.fdeSkipped += 1;
          continue;
        }
        q.result.fdeExecuted += 1;
        if (run.result?.ok) q.result.fdeRan += 1;
        if (run.result?.errorCode === "QUOTA") q.result.quotaBlocked = true;
        if (opts.afterRun) await opts.afterRun(q.result.orgId, id, run).catch((err) => console.warn("[inbound-fde-queue] afterRun failed:", err instanceof Error ? err.message : err));
      } catch (err) {
        q.result.error = err instanceof Error ? err.message : String(err);
      }
    }
    if (deadlineReached || !progressed) break;
  }
  return { results: queues.map((q) => q.result), deadlineReached };
}
