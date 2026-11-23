/**
 * 读公开网页（TREE-1）：情报调研读网页的唯一入口。
 *
 * 六条读网页规则（全部在本文件里强制）：
 *   1. 只在人发起的调研 Job 里读：会话只能由 createResearchReadSessionWithDeps（生产入口是 index.ts 的
 *      createResearchReadSession）从库里核对过的调研 Job 建出；定时任务、没有 Job、不是调研 Job、Job 已结束、
 *      开关关着一律拒绝（抛错，不发请求）；每次读页再查一次开关（关开关即停）。
 *   2. 表明身份：用户代理写明青砚与联系网址，不冒充浏览器。
 *   3. 不登录：只发 GET，不带 cookie / Authorization / 任何凭证，不存 cookie，不提交表单。
 *   4. 被挡即停：登录页、人机验证、401 / 403 / 407、跳转到登录地址、robots 不许读 → blocked，不重试、不换地址，
 *      同一支里不再向那个站发请求；超时 / 中断 / 5xx 最多重试 2 次（等 1 秒、3 秒）；429 只在对方给出 ≤30 秒的
 *      等待时间时等够再试一次。
 *   5. 限量：每次读页在真正发出第一个页面请求前扣这一支 1 次额度（跳转、重试、robots 不另扣；每支最多 12 次）；
 *      同一站点两次请求的开始时间间隔 ≥2 秒（进程内所有会话共享）。
 *   6. 同一读页会话（一棵树的一次处理）内同一网址只读一次（并发合并）；跨处理的去重靠调用方传入的持久缓存。
 * 另：内网 / 回环 / 链路本地地址不读（请求前解析一次、连接时由传输层再校验一次）；最多跟 3 次跳转、每跳重新校验；
 * 单次请求 15 秒；正文 2 MB 截断；HTML / 纯文本 / PDF 之外的类型不读；审计只记网址、状态、字数，不记正文。
 *
 * 读到的内容一律是不可信资料（untrusted: true），结果对象是冻结的。
 */

import { toStorableText } from "@/lib/files/extracted-text";
import { htmlToText, normalizePlainText } from "@/lib/text/html-to-text";
import { isResearchTreeEnabledForOrgWithEnv } from "@/lib/tender-research-tree/flags";
import type { PdfExtractResult } from "./pdf";
import {
  PRESET_SITE_POLICY,
  RATE_LIMIT_MAX_WAIT_SECONDS,
  ROBOTS_MAX_BYTES,
  checkPublicUrl,
  classifySite,
  detectAccessWall,
  hostOf,
  ipLiteralOf,
  isAllowedByRobots,
  isBlockedAddress,
  isBlockedReason,
  isLoginUrl,
  mergeSitePolicy,
  metaRefreshTarget,
  normalizePageUrl,
  parseRetryAfterSeconds,
  parseRobotsLimited,
  readOrgSiteOverride,
  reasonMessageZh,
  type RobotsGroup,
} from "./pure";
import {
  HUMAN_RESEARCH_TRIGGERS,
  type BlockedReason,
  type HumanResearchTrigger,
  type PageReadOutcome,
  type PageReadReason,
  type PageReadResult,
  type SitePolicy,
} from "./types";

/* ───────────────────────────── 常量 ───────────────────────────── */

export const WEB_READER_LIMITS = Object.freeze({
  /** 每支读页次数上限（任务书拍板第 5 项；组织设置只能调低，由调用方传入更小的额度） */
  MAX_READS_PER_BRANCH: 12,
  /** 正文上限（解压后字节；抽出的文字也按这么多字截） */
  MAX_BODY_BYTES: 2 * 1024 * 1024,
  /** 单次请求（连接 + 收头 + 收正文）超时 */
  REQUEST_TIMEOUT_MS: 15_000,
  /** 域名解析超时 */
  DNS_TIMEOUT_MS: 5_000,
  /** 页面最多跟几次跳转 */
  MAX_REDIRECTS: 3,
  /** robots 最多跟几次跳转（RFC 9309 建议至少 5 次） */
  ROBOTS_MAX_REDIRECTS: 5,
  /** 临时故障最多重试几次，及每次重试前的等待（递增） */
  TRANSIENT_RETRY_DELAYS_MS: Object.freeze([1_000, 3_000]),
  /** 同一站点两次请求开始时间的最小间隔 */
  SAME_SITE_INTERVAL_MS: 2_000,
  /** 离截止时间还剩不到这么多毫秒就不再发起新的请求 / 等待 */
  DEADLINE_MARGIN_MS: 1_000,
  /** 一次尝试至少要有这么多毫秒才值得发出 */
  MIN_ATTEMPT_MS: 2_000,
  /** 审计里网址的长度上限 */
  AUDIT_URL_MAX_CHARS: 2048,
});

export const WEB_READER_USER_AGENT = "QingyanResearchBot/1.0 (+https://qingyan.ca)";
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8";
const ACCEPT_LANGUAGE = "en-CA,en;q=0.9,fr-CA;q=0.8,zh-CN;q=0.7";

/** 审计动作 */
export const WEB_READ_AUDIT_ACTION = "research.web_read" as const;

/** 已结束的 Job 状态：不再允许读网页 */
const FINISHED_JOB_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

/* ───────────────────────────── 注入的依赖 ───────────────────────────── */

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type NetRequest = {
  url: URL;
  headers: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxBytes: number;
};

export type NetResponse = {
  status: number;
  /** 小写键 */
  headers: Readonly<Record<string, string | undefined>>;
  /** 解压后的正文（最多 maxBytes） */
  body: Uint8Array;
  truncated: boolean;
};

/** 传输层抛出的错误类别 */
export class NetError extends Error {
  constructor(
    readonly kind: "timeout" | "network" | "private_address" | "dns",
    message: string,
  ) {
    super(message);
    this.name = "NetError";
  }
}

export interface WebReaderNet {
  /** 解析主机名的全部地址；解析失败抛 NetError("dns") */
  resolve(host: string): Promise<ResolvedAddress[]>;
  /** 发一个 GET；不跟跳转；连接时若地址不是公网地址抛 NetError("private_address") */
  request(req: NetRequest): Promise<NetResponse>;
}

export interface WebReaderClock {
  now(): number;
  /** 等 ms 毫秒；signal 中止时立即结束并清掉计时器（用于「和截止时间赛跑」，不留下悬着的计时器） */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** p 与一个 ms 毫秒的计时器赛跑；p 先完成就清掉计时器。计时器先到返回 null */
async function raceTimer<T>(p: Promise<T>, ms: number, clock: WebReaderClock): Promise<T | null> {
  const ac = new AbortController();
  try {
    return await Promise.race([p, clock.sleep(ms, ac.signal).then(() => null)]);
  } finally {
    ac.abort();
  }
}

export type WebReadAuditEntry = {
  orgId: string;
  userId: string;
  jobId: string;
  branchKey: string;
  url: string;
  finalUrl: string | null;
  outcome: PageReadOutcome;
  httpStatus: number | null;
  chars: number;
  truncated: boolean;
  reason: PageReadReason | null;
  attempts: number;
  robotsRequests: number;
  site: string;
};

export type WebReaderDeps = {
  net: WebReaderNet;
  clock: WebReaderClock;
  /** 写审计；失败自己吞掉，不影响读页 */
  audit: (entry: WebReadAuditEntry) => Promise<void>;
  /** PDF → 文字（带页数、时间、字数上限；见 pdf.ts） */
  extractPdf: (bytes: Uint8Array, opts: { maxChars: number; deadlineAt: number | null }) => Promise<PdfExtractResult>;
};

/** 同一读页会话内的缓存（TREE-2 可传入用 Job 步骤结果实现的持久缓存；默认进程内） */
export interface TreePageCache {
  get(key: string): PageReadResult | undefined | Promise<PageReadResult | undefined>;
  set(key: string, value: PageReadResult): void | Promise<void>;
}

/* ───────────────────────────── 上下文 ───────────────────────────── */

const SESSION_BRAND: unique symbol = Symbol("research-read-session");
const BRANCH_BRAND: unique symbol = Symbol("research-read-branch");

export type ReadBudget = { remaining: number; used: number };

type TreeState = {
  cache: TreePageCache;
  inflight: Map<string, Promise<PageReadResult>>;
  robots: Map<string, Promise<RobotsVerdict>>;
};

export type ResearchReadSession = {
  readonly [SESSION_BRAND]: true;
  readonly orgId: string;
  readonly jobId: string;
  readonly initiatedByUserId: string;
  readonly trigger: HumanResearchTrigger;
  readonly sitePolicy: SitePolicy;
  /** 为这棵树的某一支造读页上下文（同一会话里同一支只能造一次） */
  forBranch(input: {
    branchKey: string;
    budget: ReadBudget;
    /** 这一支里已经被挡过的站点（调用方可持久化后传回） */
    blockedSites?: Set<string>;
    /** 绝对截止时间（毫秒时间戳）；不传则只受单次请求超时约束 */
    deadlineAt?: number | null;
    /**
     * 必填：调用方对「要读的网址」的检查（只查调用方给出的网址，不查对方给的跳转目标）。网址本身就是外发数据：
     * TREE-2 用它保证网址只来自本支搜索结果 / 已读页面 / 标书 / 人工提供，且不含我方成本、毛利、目标价。
     * 返回 false → 不读（url_not_allowed）。
     */
    allowUrl: (url: URL) => boolean;
  }): ResearchReadContext;
};

export type ResearchReadContext = {
  readonly [BRANCH_BRAND]: true;
  readonly session: ResearchReadSession;
  readonly branchKey: string;
  /** 这一支读页额度的只读快照（额度由读页层内部记账；调用方持久化后下次传回 used） */
  readonly budget: Readonly<ReadBudget>;
  readonly blockedSites: Set<string>;
  readonly deadlineAt: number | null;
  readonly allowUrl: (url: URL) => boolean;
};

/** 读页层内部的额度记账（调用方拿到的只是快照，改不了） */
const branchBudgets = new WeakMap<object, ReadBudget>();

type SessionInternals = { tree: TreeState; deps: WebReaderDeps; env: Record<string, string | undefined> };
const internals = new WeakMap<ResearchReadSession, SessionInternals>();
const branchContexts = new WeakSet<object>();

export class WebReaderContextError extends Error {
  constructor(
    readonly code:
      | "SCHEDULED_CONTEXT"
      | "MISSING_JOB"
      | "JOB_NOT_FOUND"
      | "JOB_ORG_MISMATCH"
      | "NOT_RESEARCH_JOB"
      | "UNKNOWN_MARKER_VERSION"
      | "NOT_HUMAN_INITIATED"
      | "JOB_FINISHED"
      | "FEATURE_DISABLED"
      | "INVALID_CONTEXT",
    message: string,
  ) {
    super(message);
    this.name = "WebReaderContextError";
  }
}

export type ResearchJobRow = { id: string; orgId: string; status: string; metadata: unknown };

export type CreateResearchReadContextInput = {
  orgId: string;
  jobId: string | null | undefined;
  /** 调用方处在定时任务里时必须传 true（一律拒绝） */
  scheduled?: boolean;
  /** 会话缓存；不传用进程内的 */
  cache?: TreePageCache;
};

export type CreateResearchReadContextDeps = {
  loadJob: (jobId: string) => Promise<ResearchJobRow | null>;
  loadOrgSettings: (orgId: string) => Promise<unknown>;
  /** 只给测试用；生产入口不传（读 process.env） */
  env?: Record<string, string | undefined>;
  reader: WebReaderDeps;
};

/**
 * 从一条调研 Job 建读页会话（规则 1）。任何一项不满足都抛 WebReaderContextError，不发请求。
 * 生产代码只经 index.ts 的 createResearchReadSession 调用（守卫测试拦住别处直接 import 本文件）。
 */
export async function createResearchReadSessionWithDeps(
  input: CreateResearchReadContextInput,
  deps: CreateResearchReadContextDeps,
): Promise<ResearchReadSession> {
  const env = deps.env ?? process.env;
  if (input.scheduled === true) {
    throw new WebReaderContextError("SCHEDULED_CONTEXT", "定时任务里不读网页");
  }
  if (!isResearchTreeEnabledForOrgWithEnv(input.orgId, env)) {
    throw new WebReaderContextError("FEATURE_DISABLED", "情报调研树未对该组织开启");
  }
  const jobId = typeof input.jobId === "string" ? input.jobId.trim() : "";
  if (!jobId) throw new WebReaderContextError("MISSING_JOB", "读网页必须属于一条调研 Job");
  const job = await deps.loadJob(jobId);
  if (!job) throw new WebReaderContextError("JOB_NOT_FOUND", "调研 Job 不存在");
  if (job.orgId !== input.orgId) throw new WebReaderContextError("JOB_ORG_MISMATCH", "调研 Job 不属于该组织");
  const meta = job.metadata && typeof job.metadata === "object" ? (job.metadata as Record<string, unknown>) : {};
  if (meta.researchTree !== true || meta.workDomain !== "tender") {
    throw new WebReaderContextError("NOT_RESEARCH_JOB", "这不是一条调研 Job");
  }
  if (meta.researchTreeVersion !== 1) {
    throw new WebReaderContextError(
      "UNKNOWN_MARKER_VERSION",
      `调研标记版本不认识（researchTreeVersion=${String(meta.researchTreeVersion).slice(0, 20)}）`,
    );
  }
  const initiatedByUserId = typeof meta.initiatedByUserId === "string" ? meta.initiatedByUserId.trim() : "";
  if (!initiatedByUserId) throw new WebReaderContextError("NOT_HUMAN_INITIATED", "调研 Job 没有发起人");
  const trigger = typeof meta.researchTrigger === "string" ? meta.researchTrigger : "";
  if (!(HUMAN_RESEARCH_TRIGGERS as readonly string[]).includes(trigger)) {
    throw new WebReaderContextError("NOT_HUMAN_INITIATED", "调研 Job 不是由人发起的");
  }
  if (FINISHED_JOB_STATUSES.has(job.status)) throw new WebReaderContextError("JOB_FINISHED", "调研 Job 已结束");
  const settings = await deps.loadOrgSettings(input.orgId);
  const sitePolicy = mergeSitePolicy(PRESET_SITE_POLICY, readOrgSiteOverride(settings));
  const tree: TreeState = { cache: input.cache ?? createMemoryPageCache(), inflight: new Map(), robots: new Map() };
  const usedBranchKeys = new Set<string>();
  const session: ResearchReadSession = {
    [SESSION_BRAND]: true,
    orgId: input.orgId,
    jobId,
    initiatedByUserId,
    trigger: trigger as HumanResearchTrigger,
    sitePolicy,
    forBranch(b) {
      const branchKey = (b.branchKey ?? "").trim();
      const budget = b.budget;
      const okInt = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
      if (
        !branchKey ||
        usedBranchKeys.has(branchKey) ||
        !budget ||
        !okInt(budget.remaining) ||
        !okInt(budget.used) ||
        budget.remaining + budget.used > WEB_READER_LIMITS.MAX_READS_PER_BRANCH ||
        typeof b.allowUrl !== "function"
      ) {
        throw new WebReaderContextError(
          "INVALID_CONTEXT",
          `分支读页上下文无效（要有分支标识、同一会话里每支只建一次、额度为非负整数且合计不超过 ${WEB_READER_LIMITS.MAX_READS_PER_BRANCH} 次、必须给网址检查）`,
        );
      }
      usedBranchKeys.add(branchKey);
      const internalBudget: ReadBudget = { remaining: budget.remaining, used: budget.used };
      const ctx = {
        [BRANCH_BRAND]: true,
        session,
        branchKey,
        get budget(): Readonly<ReadBudget> {
          return Object.freeze({ remaining: internalBudget.remaining, used: internalBudget.used });
        },
        blockedSites: b.blockedSites ?? new Set<string>(),
        deadlineAt: b.deadlineAt ?? null,
        allowUrl: b.allowUrl,
      } as ResearchReadContext;
      branchBudgets.set(ctx, internalBudget);
      branchContexts.add(ctx);
      return ctx;
    },
  };
  internals.set(session, { tree, deps: deps.reader, env });
  return session;
}

export function createMemoryPageCache(): TreePageCache {
  const m = new Map<string, PageReadResult>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) };
}

/* ───────────────────────────── 结果 ───────────────────────────── */

/** 站点键：主机名去掉开头的 www.（间隔与「这一支里被挡过」按它算） */
export function siteKeyOf(url: URL): string {
  return hostOf(url).replace(/^www\./, "");
}

type ReadState = { attempts: number; robotsRequests: number; charged: boolean; lastRequested: URL | null };

type Built = {
  finalUrl: string | null;
  fetchedAt: string;
  text: string;
  truncated: boolean;
  outcome: PageReadOutcome;
  reason: PageReadReason | null;
  httpStatus: number | null;
  attempts: number;
  robotsRequests: number;
  blockedSite?: string;
};

function freezeResult(r: PageReadResult): PageReadResult {
  if (r.blocked) Object.freeze(r.blocked);
  return Object.freeze(r);
}

function finish(url: string, b: Built, fromCache = false): PageReadResult {
  const reason = b.reason;
  const blocked =
    reason && isBlockedReason(reason)
      ? { reason: reason as BlockedReason, messageZh: reasonMessageZh(reason), site: b.blockedSite ?? "" }
      : null;
  return freezeResult({
    untrusted: true,
    url,
    finalUrl: b.finalUrl,
    fetchedAt: b.fetchedAt,
    text: b.text,
    truncated: b.truncated,
    blocked,
    outcome: b.outcome,
    reason,
    messageZh: reasonMessageZh(reason),
    httpStatus: b.httpStatus,
    attempts: b.attempts,
    robotsRequests: b.robotsRequests,
    fromCache,
  });
}

function nonRequest(url: string, outcome: PageReadOutcome, reason: PageReadReason, nowIso: string, blockedSite?: string): PageReadResult {
  return finish(url, {
    finalUrl: null,
    fetchedAt: nowIso,
    text: "",
    truncated: false,
    outcome,
    reason,
    httpStatus: null,
    attempts: 0,
    robotsRequests: 0,
    blockedSite,
  });
}

/** 不记进缓存、也不给别的支共用的结果（与调用方当下状态有关） */
function isContextual(r: PageReadResult): boolean {
  return (
    r.reason === "budget_exhausted" ||
    r.reason === "site_blocked_in_branch" ||
    r.reason === "deadline" ||
    r.reason === "url_not_allowed"
  );
}

function budgetOf(ctx: ResearchReadContext): ReadBudget {
  const b = branchBudgets.get(ctx);
  if (!b) throw new WebReaderContextError("INVALID_CONTEXT", "读网页的上下文无效（必须由调研 Job 建出）");
  return b;
}

/** 这一支里被挡过的站：站点本身，或它的子域名（被挡后不靠换子域名绕过）；返回命中的那个被挡站 */
function blockedSiteFor(ctx: ResearchReadContext, site: string): string | null {
  if (ctx.blockedSites.has(site)) return site;
  for (const b of ctx.blockedSites) if (site.endsWith(`.${b}`)) return b;
  return null;
}

function remainingMs(ctx: ResearchReadContext, deps: WebReaderDeps): number {
  if (ctx.deadlineAt == null) return Number.POSITIVE_INFINITY;
  return ctx.deadlineAt - deps.clock.now() - WEB_READER_LIMITS.DEADLINE_MARGIN_MS;
}

/* ───────────────────────────── 读页入口 ───────────────────────────── */

/**
 * 读一个公开网页。只接受 createResearchReadSessionWithDeps(...).forBranch(...) 造出的上下文。
 */
export async function readPublicPage(rawUrl: string, ctx: ResearchReadContext): Promise<PageReadResult> {
  if (!ctx || typeof ctx !== "object" || !branchContexts.has(ctx)) {
    throw new WebReaderContextError("INVALID_CONTEXT", "读网页的上下文无效（必须由调研 Job 建出）");
  }
  const inner = internals.get(ctx.session);
  if (!inner) throw new WebReaderContextError("INVALID_CONTEXT", "读网页的上下文无效（必须由调研 Job 建出）");
  if (!isResearchTreeEnabledForOrgWithEnv(ctx.session.orgId, inner.env)) {
    throw new WebReaderContextError("FEATURE_DISABLED", "情报调研树未对该组织开启");
  }
  const { tree, deps } = inner;
  const nowIso = () => new Date(deps.clock.now()).toISOString();

  const raw = String(rawUrl ?? "");
  const checked = checkPublicUrl(raw);
  if (!checked.ok) return nonRequest(raw.slice(0, WEB_READER_LIMITS.AUDIT_URL_MAX_CHARS), "refused", checked.reason, nowIso());
  const key = normalizePageUrl(checked.url);
  const site = siteKeyOf(checked.url);
  if (!ctx.allowUrl(new URL(key))) return nonRequest(key, "refused", "url_not_allowed", nowIso());

  // 规则 6：同一会话内同址只读一次（含并发合并）。别的支正在读同一网址时等它的结果（受本支截止约束）；
  // 那个结果若与它自己的状态有关（到上限等），本支再按自己的状态读。同一个等候对象只等一次（不会空转）。
  const seen = new Set<Promise<PageReadResult>>();
  for (;;) {
    const cached = await tree.cache.get(key);
    if (cached) return markBranchFromCache(ctx, cached);
    const pending = tree.inflight.get(key);
    if (!pending || seen.has(pending)) break;
    seen.add(pending);
    const shared = await waitWithinDeadline(pending, ctx, deps);
    if (shared === null) return nonRequest(key, "unreachable", "deadline", nowIso());
    if (!isContextual(shared)) return markBranchFromCache(ctx, shared);
  }

  const blockedAs = blockedSiteFor(ctx, site);
  if (blockedAs) return nonRequest(key, "blocked", "site_blocked_in_branch", nowIso(), blockedAs);
  if (budgetOf(ctx).remaining <= 0) return nonRequest(key, "limit", "budget_exhausted", nowIso());

  const state: ReadState = { attempts: 0, robotsRequests: 0, charged: false, lastRequested: null };
  const p = readUncached(checked.url, key, ctx, inner, state).then(async (r) => {
    if (!isContextual(r)) await tree.cache.set(key, r);
    return r;
  });
  // 等候方拿到结果时这一项已经删掉（finally 在等候方的续行之前跑），不会在同一个已完成的对象上空转
  const shared: Promise<PageReadResult> = p.finally(() => {
    if (tree.inflight.get(key) === shared) tree.inflight.delete(key);
  });
  tree.inflight.set(key, shared);
  const r = await shared;
  if (r.blocked?.site) ctx.blockedSites.add(r.blocked.site);
  if (r.attempts + r.robotsRequests > 0) {
    const cut = (u: string | null) => (u == null ? null : u.slice(0, WEB_READER_LIMITS.AUDIT_URL_MAX_CHARS));
    await deps
      .audit({
        orgId: ctx.session.orgId,
        userId: ctx.session.initiatedByUserId,
        jobId: ctx.session.jobId,
        branchKey: ctx.branchKey,
        url: cut(r.url) ?? "",
        finalUrl: cut(r.finalUrl),
        outcome: r.outcome,
        httpStatus: r.httpStatus,
        chars: r.text.length,
        truncated: r.truncated,
        reason: r.reason,
        attempts: r.attempts,
        robotsRequests: r.robotsRequests,
        site,
      })
      .catch(() => undefined);
  }
  return r;
}

async function waitWithinDeadline(
  p: Promise<PageReadResult>,
  ctx: ResearchReadContext,
  deps: WebReaderDeps,
): Promise<PageReadResult | null> {
  const left = remainingMs(ctx, deps);
  if (!Number.isFinite(left)) return p;
  if (left <= 0) return null;
  return raceTimer(p, left, deps.clock);
}

function markBranchFromCache(ctx: ResearchReadContext, r: PageReadResult): PageReadResult {
  if (r.blocked?.site) ctx.blockedSites.add(r.blocked.site);
  return freezeResult({ ...r, fromCache: true });
}

/* ───────────────────────────── 请求 ───────────────────────────── */

type AttemptBudget = { transientLeft: number; rateLimitRetryLeft: number };

type ReqStop = { kind: "stop"; outcome: PageReadOutcome; reason: PageReadReason; status: number | null };
type ReqResult = { kind: "response"; res: NetResponse } | ReqStop;

type SendHooks = {
  /** 真正发出前一刻调用；返回 false = 不发（额度用完） */
  beforeSend?: () => boolean;
  /** 发出时调用（记次数与最后请求的网址） */
  onSent: () => void;
};

/** 进程内同站节拍：按时钟对象分开（生产是一个模块级时钟 → 全进程共享），按站点记下一次最早可以开始的时间 */
const pacers = new WeakMap<WebReaderClock, Map<string, number>>();

/**
 * 同步预约这个站的下一个时段：算出开始时间并立即占住（之后的预约至少再晚 2 秒），再等到开始时间。
 * 开始时间超过本支剩余时间就不预约、返回 false。
 */
async function reserveSiteSlot(site: string, ctx: ResearchReadContext, deps: WebReaderDeps): Promise<boolean> {
  let m = pacers.get(deps.clock);
  if (!m) {
    m = new Map();
    pacers.set(deps.clock, m);
  }
  const now = deps.clock.now();
  const start = Math.max(now, m.get(site) ?? 0);
  if (start - now > remainingMs(ctx, deps) - WEB_READER_LIMITS.MIN_ATTEMPT_MS) return false;
  m.set(site, start + WEB_READER_LIMITS.SAME_SITE_INTERVAL_MS);
  if (start > now) await deps.clock.sleep(start - now);
  return true;
}

/** 解析并校验地址（请求前这一层；传输层连接时还会再校验） */
async function addressCheck(url: URL, ctx: ResearchReadContext, deps: WebReaderDeps): Promise<"ok" | "private" | "dns" | "deadline"> {
  const literal = ipLiteralOf(url);
  if (literal) return isBlockedAddress(literal) ? "private" : "ok";
  const left = remainingMs(ctx, deps);
  if (left < WEB_READER_LIMITS.MIN_ATTEMPT_MS) return "deadline";
  const limit = Math.min(WEB_READER_LIMITS.DNS_TIMEOUT_MS, left);
  try {
    const addrs = await raceTimer(deps.net.resolve(hostOf(url)), limit, deps.clock);
    if (!addrs || addrs.length === 0) return "dns";
    return addrs.some((a) => isBlockedAddress(a.address)) ? "private" : "ok";
  } catch {
    return "dns";
  }
}

/** 发一个请求（含临时故障重试与 429 等待），不跟跳转 */
async function requestWithRetry(
  url: URL,
  accept: string,
  ctx: ResearchReadContext,
  deps: WebReaderDeps,
  retry: AttemptBudget,
  hooks: SendHooks,
): Promise<ReqResult> {
  const site = siteKeyOf(url);
  const stop = (outcome: PageReadOutcome, reason: PageReadReason, status: number | null = null): ReqStop => ({
    kind: "stop",
    outcome,
    reason,
    status,
  });
  for (;;) {
    if (!(await reserveSiteSlot(site, ctx, deps))) return stop("unreachable", "deadline");
    // 排到时段之后再查一次：同一支里别的并发读可能刚刚被这个站挡了
    if (blockedSiteFor(ctx, site)) return stop("blocked", "site_blocked_in_branch");
    const left = remainingMs(ctx, deps);
    if (left < WEB_READER_LIMITS.MIN_ATTEMPT_MS) return stop("unreachable", "deadline");
    if (hooks.beforeSend && !hooks.beforeSend()) return stop("limit", "budget_exhausted");
    hooks.onSent();
    const timeoutMs = Math.min(WEB_READER_LIMITS.REQUEST_TIMEOUT_MS, left);
    const shortened = timeoutMs < WEB_READER_LIMITS.REQUEST_TIMEOUT_MS;
    let res: NetResponse | null = null;
    let transient: "timeout" | "network_error" | null = null;
    try {
      res = await deps.net.request({
        url,
        headers: {
          "user-agent": WEB_READER_USER_AGENT,
          accept,
          "accept-encoding": "gzip, deflate, br",
          "accept-language": ACCEPT_LANGUAGE,
        },
        timeoutMs,
        maxBytes: WEB_READER_LIMITS.MAX_BODY_BYTES,
      });
    } catch (e) {
      if (e instanceof NetError && e.kind === "private_address") return stop("refused", "private_address");
      if (e instanceof NetError && e.kind === "dns") return stop("unreachable", "dns_failed");
      if (e instanceof NetError && e.kind === "timeout") {
        // 超时被本支的截止时间缩短过：这是本支的时间到了，不是对方的结论（不进缓存）
        if (shortened) return stop("unreachable", "deadline");
        transient = "timeout";
      } else {
        transient = "network_error";
      }
    }
    if (res && res.status === 429) {
      const wait = parseRetryAfterSeconds(res.headers["retry-after"], deps.clock.now());
      if (retry.rateLimitRetryLeft > 0 && wait != null && wait <= RATE_LIMIT_MAX_WAIT_SECONDS) {
        if (remainingMs(ctx, deps) - wait * 1000 < WEB_READER_LIMITS.MIN_ATTEMPT_MS) return stop("unreachable", "deadline", 429);
        retry.rateLimitRetryLeft -= 1;
        await deps.clock.sleep(wait * 1000);
        continue;
      }
      return stop("blocked", "rate_limited", 429);
    }
    const isTransient = transient != null || (res != null && res.status >= 500);
    if (!isTransient && res) return { kind: "response", res };
    if (retry.transientLeft <= 0) {
      return stop("unreachable", res ? "http_5xx" : (transient ?? "network_error"), res ? res.status : null);
    }
    const delays = WEB_READER_LIMITS.TRANSIENT_RETRY_DELAYS_MS;
    const delay = delays[delays.length - retry.transientLeft] ?? delays[delays.length - 1];
    if (remainingMs(ctx, deps) - delay < WEB_READER_LIMITS.MIN_ATTEMPT_MS) return stop("unreachable", "deadline", res ? res.status : null);
    retry.transientLeft -= 1;
    await deps.clock.sleep(delay);
  }
}

/* ───────────────────────────── robots ───────────────────────────── */

type RobotsVerdict =
  | { kind: "rules"; groups: RobotsGroup[] }
  | { kind: "allow_all" }
  | { kind: "unavailable" }
  | { kind: "private" }
  | { kind: "deadline" }
  /** 跳到了这一支被挡过的站：与本支状态有关，不缓存、不给别的支共用 */
  | { kind: "branch_blocked"; site: string };

/** 与取 robots 那一支自己的状态有关的结论：不记进会话缓存 */
function isContextualVerdict(v: RobotsVerdict): boolean {
  return v.kind === "deadline" || v.kind === "branch_blocked";
}

async function robotsFor(url: URL, ctx: ResearchReadContext, inner: SessionInternals, state: ReadState): Promise<RobotsVerdict> {
  const origin = url.origin;
  for (let tries = 0; tries < 2; tries++) {
    const existing = inner.tree.robots.get(origin);
    if (existing) {
      // 等别的支取 robots 也受本支截止约束
      const left = remainingMs(ctx, inner.deps);
      const v = Number.isFinite(left) ? await raceTimer(existing, Math.max(0, left), inner.deps.clock) : await existing;
      if (v === null) return { kind: "deadline" };
      // 别的支取到的结论与它自己的状态有关（它的时间到了、跳到它被挡过的站）：本支自己再取一次
      if (isContextualVerdict(v)) {
        if (inner.tree.robots.get(origin) === existing) inner.tree.robots.delete(origin);
        if (v.kind === "deadline" && remainingMs(ctx, inner.deps) < WEB_READER_LIMITS.MIN_ATTEMPT_MS) return v;
        continue;
      }
      return v;
    }
    const p: Promise<RobotsVerdict> = fetchRobots(new URL("/robots.txt", origin), ctx, inner, state).then((v) => {
      // 与这一次调用自己的状态有关的结论不记下
      if (isContextualVerdict(v) && inner.tree.robots.get(origin) === p) inner.tree.robots.delete(origin);
      return v;
    });
    inner.tree.robots.set(origin, p);
    return p;
  }
  return { kind: "deadline" };
}

async function fetchRobots(start: URL, ctx: ResearchReadContext, inner: SessionInternals, state: ReadState): Promise<RobotsVerdict> {
  const { deps } = inner;
  const retry: AttemptBudget = { transientLeft: WEB_READER_LIMITS.TRANSIENT_RETRY_DELAYS_MS.length, rateLimitRetryLeft: 0 };
  let url = start;
  for (let hop = 0; hop <= WEB_READER_LIMITS.ROBOTS_MAX_REDIRECTS; hop++) {
    const chk = checkPublicUrl(url.toString());
    if (!chk.ok) return { kind: "allow_all" }; // 跳到无效地址：视为没有 robots
    // 只跟到别处的 /robots.txt；跳到别的页面（登录页等）视为没有 robots，不请求
    if (hop > 0 && url.pathname !== "/robots.txt") return { kind: "allow_all" };
    const site = siteKeyOf(url);
    if (classifySite(hostOf(url), ctx.session.sitePolicy) === "deny") return { kind: "unavailable" };
    const blockedAs = blockedSiteFor(ctx, site);
    if (blockedAs) return { kind: "branch_blocked", site: blockedAs };
    const addr = await addressCheck(url, ctx, deps);
    if (addr === "private") return { kind: "private" };
    if (addr === "deadline") return { kind: "deadline" };
    if (addr === "dns") return { kind: "unavailable" };
    const r = await requestWithRetry(url, "text/plain", ctx, deps, retry, {
      onSent: () => {
        state.robotsRequests += 1;
      },
    });
    if (r.kind === "stop") {
      if (r.reason === "deadline") return { kind: "deadline" };
      if (r.reason === "private_address") return { kind: "private" };
      if (r.reason === "site_blocked_in_branch") return { kind: "branch_blocked", site };
      // 429 / 5xx / 超时 / 连接失败 → 视为全部不许读（RFC 9309 §2.3.1.4；429 同样按读取失败）
      return { kind: "unavailable" };
    }
    const { res } = r;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers["location"];
      if (!loc) return { kind: "allow_all" };
      try {
        url = new URL(loc, url);
      } catch {
        return { kind: "allow_all" };
      }
      continue;
    }
    if (res.status >= 400) return { kind: "allow_all" }; // RFC 9309：4xx（含 401 / 403）视为没有 robots
    const text = new TextDecoder("utf-8", { fatal: false }).decode(res.body.subarray(0, ROBOTS_MAX_BYTES));
    const groups = parseRobotsLimited(text);
    return groups ? { kind: "rules", groups } : { kind: "unavailable" };
  }
  return { kind: "allow_all" }; // 跳转过多：视为不可得
}

/* ───────────────────────────── 正文 ───────────────────────────── */

function parseContentType(v: string | undefined): { mime: string; charset: string | null } {
  const raw = (v ?? "").toLowerCase();
  const [mime, ...params] = raw.split(";").map((s) => s.trim());
  const cs = params.find((p) => p.startsWith("charset="));
  return { mime: mime ?? "", charset: cs ? cs.slice(8).replace(/^["']|["']$/g, "") || null : null };
}

function sniffMetaCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const m = /<meta[^>]{0,300}?charset\s*=\s*["']?([\w:.-]{1,40})/i.exec(head);
  return m ? m[1].toLowerCase() : null;
}

function decodeText(bytes: Uint8Array, charset: string | null): string {
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

/** 不可见字符：Unicode 标签字符、双向控制符、零宽字符（常被用来藏指令） */
const INVISIBLE_RE = /[\u{E0000}-\u{E007F}‪-‮⁦-⁩​-‏⁠﻿]/gu;

function cleanText(s: string): string {
  return toStorableText(s).replace(INVISIBLE_RE, "");
}

const HTML_MIMES = new Set(["text/html", "application/xhtml+xml"]);
const PDF_MIMES = new Set(["application/pdf", "application/x-pdf"]);

async function readUncached(
  start: URL,
  key: string,
  ctx: ResearchReadContext,
  inner: SessionInternals,
  state: ReadState,
): Promise<PageReadResult> {
  const { deps } = inner;
  const nowIso = () => new Date(deps.clock.now()).toISOString();
  const policy = ctx.session.sitePolicy;
  const retry: AttemptBudget = { transientLeft: WEB_READER_LIMITS.TRANSIENT_RETRY_DELAYS_MS.length, rateLimitRetryLeft: 1 };
  let url = start;
  let prev: URL | null = null;
  let lastStatus: number | null = null;
  const stop = (outcome: PageReadOutcome, reason: PageReadReason, status: number | null = lastStatus, blockedSite?: string): PageReadResult =>
    finish(key, {
      finalUrl: state.lastRequested ? state.lastRequested.toString() : null,
      fetchedAt: nowIso(),
      text: "",
      truncated: false,
      outcome,
      reason,
      httpStatus: status,
      attempts: state.attempts,
      robotsRequests: state.robotsRequests,
      blockedSite,
    });

  for (let hop = 0; ; hop++) {
    if (hop > WEB_READER_LIMITS.MAX_REDIRECTS) return stop("unreachable", "too_many_redirects");
    // 每一跳重新校验：网址、站点名单、登录地址、这一支里被挡过的站、地址、robots
    const chk = checkPublicUrl(url.toString());
    if (!chk.ok) return hop === 0 ? stop("refused", chk.reason) : stop("unreachable", "invalid_redirect");
    const site = siteKeyOf(url);
    // 主机名是 IP 地址的不读：被挡后不靠换成 IP 绕过，正常的公开网站也不用 IP 地址
    if (ipLiteralOf(url)) return hop === 0 ? stop("refused", "ip_literal") : stop("unreachable", "invalid_redirect");
    const cls = classifySite(hostOf(url), policy);
    if (cls === "deny") return stop("refused", "site_denied");
    // 直接给的登录地址：不碰（不读，不算该站被挡）；跳转到登录地址：发出跳转的那个站挡了我们
    if (isLoginUrl(url)) {
      return hop === 0 ? stop("refused", "login_url") : stop("blocked", "login_redirect", lastStatus, prev ? siteKeyOf(prev) : site);
    }
    const blockedHop = hop > 0 ? blockedSiteFor(ctx, site) : null;
    if (blockedHop) return stop("blocked", "site_blocked_in_branch", lastStatus, blockedHop);
    const addr = await addressCheck(url, ctx, deps);
    if (addr === "private") return stop("refused", "private_address");
    if (addr === "dns") return stop("unreachable", "dns_failed");
    if (addr === "deadline") return stop("unreachable", "deadline");
    if (cls !== "human_initiated") {
      const robots = await robotsFor(url, ctx, inner, state);
      if (robots.kind === "deadline") return stop("unreachable", "deadline");
      if (robots.kind === "private") return stop("refused", "private_address");
      if (robots.kind === "branch_blocked") return stop("blocked", "site_blocked_in_branch", lastStatus, robots.site);
      if (robots.kind === "unavailable") return stop("blocked", "robots_unavailable", lastStatus, site);
      if (robots.kind === "rules" && !isAllowedByRobots(robots.groups, url.pathname + url.search)) {
        return stop("blocked", "robots_disallow", lastStatus, site);
      }
    }
    const requestUrl = url;
    const r = await requestWithRetry(url, PAGE_ACCEPT, ctx, deps, retry, {
      // 规则 5：真正发出第一个页面请求前一刻才扣额度（并发时以这里为准）
      beforeSend: () => {
        if (state.charged) return true;
        const b = budgetOf(ctx);
        if (b.remaining <= 0) return false;
        b.remaining -= 1;
        b.used += 1;
        state.charged = true;
        return true;
      },
      onSent: () => {
        state.attempts += 1;
        state.lastRequested = requestUrl;
      },
    });
    if (r.kind === "stop") {
      lastStatus = r.status;
      return stop(r.outcome, r.reason, r.status, r.outcome === "blocked" ? site : undefined);
    }
    const { res } = r;
    lastStatus = res.status;
    if (res.status === 401) return stop("blocked", "http_401", 401, site);
    if (res.status === 403) return stop("blocked", "http_403", 403, site);
    if (res.status === 407) return stop("blocked", "http_407", 407, site);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers["location"];
      if (![301, 302, 303, 307, 308].includes(res.status) || !loc) return stop("unreachable", "invalid_redirect");
      let next: URL;
      try {
        next = new URL(loc, url);
      } catch {
        return stop("unreachable", "invalid_redirect");
      }
      prev = url;
      url = next;
      continue;
    }
    if (res.status >= 400 || res.status < 200) return stop("unreachable", "http_4xx");

    // 2xx：按类型抽文字
    const { mime, charset } = parseContentType(res.headers["content-type"]);
    let text: string;
    let truncated = res.truncated;
    if (HTML_MIMES.has(mime)) {
      const html = toStorableText(decodeText(res.body, charset ?? sniffMetaCharset(res.body)));
      const refresh = metaRefreshTarget(html, url);
      if (refresh && isLoginUrl(refresh)) return stop("blocked", "login_redirect", res.status, site);
      text = htmlToText(html, { maxInputChars: WEB_READER_LIMITS.MAX_BODY_BYTES });
      const wall = detectAccessWall({ html, textChars: text.length });
      if (wall) return stop("blocked", wall, res.status, site);
    } else if (mime === "text/plain") {
      text = normalizePlainText(toStorableText(decodeText(res.body, charset)), WEB_READER_LIMITS.MAX_BODY_BYTES);
    } else if (PDF_MIMES.has(mime)) {
      let ex: PdfExtractResult;
      try {
        ex = await deps.extractPdf(res.body, { maxChars: WEB_READER_LIMITS.MAX_BODY_BYTES, deadlineAt: ctx.deadlineAt });
      } catch {
        ex = { ok: false, reason: "pdf_unreadable" };
      }
      if (!ex.ok) {
        // 被 2 MB 截断的 PDF 最后一个流必然不完整，预扫描会估不出解压量：原因写「超过 2 MB」
        if (res.truncated) return stop("unreachable", "pdf_too_large", res.status);
        if (ex.reason === "pdf_too_complex") return stop("refused", "pdf_too_complex", res.status);
        if (ex.reason === "pdf_encrypted") return stop("refused", "pdf_encrypted", res.status);
        return stop("unreachable", "pdf_unreadable", res.status);
      }
      // FIX-13：U+0000 换成空格再整理（抽出的文字里勾选框常是 U+0000）
      text = toStorableText(ex.text).trim();
      truncated = truncated || ex.truncated;
      if (!text) return stop("unreachable", res.truncated ? "pdf_too_large" : "pdf_unreadable", res.status);
    } else {
      return stop("refused", "unsupported_type", res.status);
    }
    return finish(key, {
      finalUrl: url.toString(),
      fetchedAt: nowIso(),
      text: cleanText(text),
      truncated,
      outcome: "ok",
      reason: null,
      httpStatus: res.status,
      attempts: state.attempts,
      robotsRequests: state.robotsRequests,
    });
  }
}
