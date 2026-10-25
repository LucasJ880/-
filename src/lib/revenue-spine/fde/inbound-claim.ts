/**
 * Revenue Spine — Inbound FDE 队列：真实状态读取 + 原子认领 + 执行 + cron 兜底
 *
 * 一条来信的 FDE（SalesAction.signalKey = inbound:<interactionId>）可能被几处同时想执行：
 *   网站 webhook 响应后的 after() 回调、站点重发（replay）安排的 after() 回调、cron 兜底、
 *   以及展会速记卡 / 库调用方的同步（inline）路径。
 * 任何一处都必须先经 claimInboundFde 认领，认领成功者才调用 runInboundSalesFde：
 *   - 条件：SalesAction 仍开放（open / in_progress）；FDE 存储状态可重跑（queued / failed / run_blocked，
 *     或 running 但超过 FDE_CLAIM_STALE_MS 没有任何写入）；且 loadFdeState 判定该来信不在终态
 *     （草稿已发送 / 待审批 / 人工拒绝 / 系统作废、run 被取消、行动已被关闭）。
 *   - 写入：fdeStatus=running、fdeClaim{token, by, claimedAt, from}、fdeAttempts+1，并把 updatedAt 严格推进。
 *   - 比较并交换的依据是 updatedAt：读取之后任何写入都会改变它，updateMany 命中 0 行 = 认领失败。
 *     Postgres 在 READ COMMITTED 下会对被并发更新的行重新求值 WHERE，所以两个并发认领只有一个命中。
 * 认领失败者不做任何事；调用方读真实记录说明当前状态（running / completed / …）。
 *
 * 时间常量的耦合（改任何一个都要一起看）：
 *   FDE_CLAIM_STALE_MS（10 min）> 任何持有认领者的最长寿命 = 路由 maxDuration 300 s
 *   （webhook 的 after() 回调、展会速记卡同步录入、cron 都运行在 maxDuration = 300 的路由里）。
 *
 * 架构定位（待架构评审确认）：这里没有新建队列表或执行引擎——SalesAction.inputContext.fdeStatus 的
 * queued / running / completed 状态机与 stale_running 判定原本就有（原在 trade/website-inquiry.ts），
 * cron 原本也按 fdeStatus 补跑；本模块只是把状态迁移改成原子的比较并交换，FDE 本身仍经 agent-runtime
 * 建 AgentRun。但认领带过期时间，语义上接近租约，所以 runtime-architecture 的 NEW_ENGINE_SURFACE
 * 守卫若按语义评审可能要求改走 agent-runtime 的后台队列（agent-runtime/queue.ts）——那需要迁移，不在本次范围。
 */

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { RevenueSpinePolicy } from "../policy";
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
 * cron 自动重试上限：只约束已经花过 LLM 的 failed / 过期 running（按 fdeAttempts 计数，所有认领都计）。
 * queued（从未执行）与 run_blocked（未建 run，未花 LLM）不受此限。站点重发安排的执行也不受此限
 * （站点自己有跟进次数上限）。
 */
export const FDE_CRON_MAX_ATTEMPTS = 3;

const OPEN_ACTION_STATUSES = ["open", "in_progress"];
/** 认领前 SalesAction.inputContext.fdeStatus 允许的存储值（running 另按过期判定） */
const CLAIMABLE_STORED_STATUSES: ReadonlySet<string> = new Set(["queued", "failed", "run_blocked", "not_run"]);

export type FdeClaimant = "after" | "replay" | "cron" | "inline";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;
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
  /** 本次认领后的累计认领次数 */
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
  const attempts = (typeof ctx.fdeAttempts === "number" && Number.isFinite(ctx.fdeAttempts) ? ctx.fdeAttempts : 0) + 1;
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
 * 释放自己的认领（只在 FDE 没有自行写出终态时用）：仍是本 token 且仍为 running 才改写，
 * 否则说明 FDE 已写终态或已被他人接管，不动。
 */
export async function releaseInboundFdeClaim(
  orgId: string,
  salesActionId: string,
  token: string,
  patch: { fdeStatus: "failed"; fdeError: string; fdeErrorCode: string },
): Promise<boolean> {
  const cur = await db.salesAction.findFirst({ where: { id: salesActionId, orgId }, select: { inputContext: true, updatedAt: true } });
  if (!cur) return false;
  const ctx = asRecord(cur.inputContext);
  if (asRecord(ctx.fdeClaim).token !== token || ctx.fdeStatus !== "running") return false;
  const r = await db.salesAction.updateMany({
    where: { id: salesActionId, orgId, updatedAt: cur.updatedAt },
    data: { inputContext: toJson({ ...ctx, ...patch }), updatedAt: bumpedAfter(cur.updatedAt) },
  });
  return r.count === 1;
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
  policy?: RevenueSpinePolicy;
  useLlm?: boolean;
}

/**
 * 认领 → 执行 → （必要时）释放。所有来信 FDE 执行入口（after() 回调 / 重发 / cron / 同步录入）共用。
 * 同一 FDE 不会被并发执行：没认领到的调用直接返回 ran=false。
 */
export async function runQueuedInboundFde(orgId: string, salesActionId: string, opts: RunQueuedFdeOptions): Promise<QueuedFdeRun> {
  const claim = await claimInboundFde(orgId, salesActionId, { by: opts.by, now: opts.now });
  if (!claim.claimed || !claim.token || !claim.opportunityId) return { ran: false, claim, result: null };
  let result: InboundFdeResult;
  try {
    result = await runInboundSalesFde({
      orgId,
      opportunityId: claim.opportunityId,
      salesActionId,
      trigger: opts.trigger,
      now: opts.now,
      policy: opts.policy,
      useLlm: opts.useLlm,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await releaseInboundFdeClaim(orgId, salesActionId, claim.token, { fdeStatus: "failed", fdeError: message, fdeErrorCode: "FDE_THREW" }).catch(() => undefined);
    throw err;
  }
  if (!result.agentRunId) {
    // runInboundSalesFde 在建 AgentRun 之前返回（NOT_FOUND / LEGACY_STAGE / TERMINAL / NO_INBOUND）时不写 SalesAction；
    // 不释放的话 running 会一直挂到过期。RUN_CREATE_FAILED / QUOTA 已自行写 run_blocked（释放是空操作）。
    await releaseInboundFdeClaim(orgId, salesActionId, claim.token, {
      fdeStatus: "failed",
      fdeError: result.error ?? "FDE did not start",
      fdeErrorCode: result.errorCode ?? "NOT_STARTED",
    }).catch(() => undefined);
  }
  return { ran: true, claim, result };
}

/**
 * cron 候选：本组织内开放的来信 FDE 行动，状态为 queued / run_blocked，或 failed / 过期 running
 * 且累计认领次数未到上限。没有 fdeAttempts 的历史 failed / running 行（本改动之前产生）不在候选里，
 * 与改动前 cron 只取未建 run 的行为一致。最终是否执行仍由 claimInboundFde 判定。
 */
export async function listInboundFdeCandidates(orgId: string, now: Date, take: number) {
  const staleBefore = new Date(now.getTime() - FDE_CLAIM_STALE_MS);
  const status = (v: string) => ({ inputContext: { path: ["fdeStatus"], equals: v } });
  const underCap = { inputContext: { path: ["fdeAttempts"], lt: FDE_CRON_MAX_ATTEMPTS } };
  return db.salesAction.findMany({
    where: {
      orgId,
      employeeKey: FDE_EMPLOYEE_KEY,
      status: { in: OPEN_ACTION_STATUSES },
      opportunityId: { not: null },
      signalKey: { startsWith: INBOUND_FDE_SIGNAL_PREFIX },
      OR: [
        status("queued"),
        status("run_blocked"),
        { AND: [status("failed"), underCap] },
        { AND: [status("running"), { updatedAt: { lt: staleBefore } }, underCap] },
      ],
    },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true, opportunityId: true },
  });
}

export interface DrainOrgResult {
  orgId: string;
  /** 本轮读到的候选数 */
  fdeQueued: number;
  /** 认领成功并执行的次数 */
  fdeRan: number;
  /** 执行且 FDE ok 的次数 */
  fdeSucceeded: number;
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
  /** 每个组织本轮最多读取的候选数（不是执行上限，执行上限由截止时间决定） */
  perOrgCandidates?: number;
  policies?: Map<string, RevenueSpinePolicy>;
  /** 墙钟（测试注入） */
  clock?: () => number;
  /** 每次实际执行后的回调（例如回填网站询盘收据）；失败不影响队列 */
  afterRun?: (orgId: string, salesActionId: string, run: QueuedFdeRun) => Promise<void>;
  useLlm?: boolean;
}

/**
 * cron 兜底：按组织轮转（每轮每个组织最多启动一个），直到截止时间或候选耗尽。
 * 所有执行都经 runQueuedInboundFde 认领，与 after() 回调 / 重发互斥。
 */
export async function drainInboundFdeQueue(opts: DrainOptions): Promise<{ results: DrainOrgResult[]; deadlineReached: boolean }> {
  const clock = opts.clock ?? Date.now;
  const now = opts.now ?? new Date();
  const take = opts.perOrgCandidates ?? 25;
  const queues: Array<{ result: DrainOrgResult; pending: Array<{ id: string }> }> = [];
  for (const orgId of opts.orgIds) {
    const result: DrainOrgResult = { orgId, fdeQueued: 0, fdeRan: 0, fdeSucceeded: 0, fdeSkipped: 0, quotaBlocked: false };
    try {
      const rows = await listInboundFdeCandidates(orgId, now, take);
      result.fdeQueued = rows.length;
      queues.push({ result, pending: rows.map((r) => ({ id: r.id })) });
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      queues.push({ result, pending: [] });
    }
  }

  let deadlineReached = false;
  for (;;) {
    const active = queues.filter((q) => q.pending.length > 0 && !q.result.quotaBlocked);
    if (active.length === 0) break;
    for (const q of active) {
      if (clock() >= opts.deadlineAt) {
        deadlineReached = true;
        break;
      }
      const next = q.pending.shift()!;
      try {
        const run = await runQueuedInboundFde(q.result.orgId, next.id, {
          by: "cron",
          trigger: "cron",
          policy: opts.policies?.get(q.result.orgId),
          useLlm: opts.useLlm,
        });
        if (!run.ran) {
          q.result.fdeSkipped += 1;
          continue;
        }
        q.result.fdeRan += 1;
        if (run.result?.ok) q.result.fdeSucceeded += 1;
        if (run.result?.errorCode === "QUOTA") q.result.quotaBlocked = true;
        if (opts.afterRun) await opts.afterRun(q.result.orgId, next.id, run).catch((err) => console.warn("[inbound-fde-queue] afterRun failed:", err instanceof Error ? err.message : err));
      } catch (err) {
        q.result.error = err instanceof Error ? err.message : String(err);
      }
    }
    if (deadlineReached) break;
  }
  return { results: queues.map((q) => q.result), deadlineReached };
}
