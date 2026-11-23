/**
 * 读公开网页（TREE-1）：情报调研读网页的唯一入口。
 *
 * 六条读网页规则（全部在本文件里强制）：
 *   1. 只在人发起的调研 Job 里读：上下文只能由 createResearchReadContext 从库里核对过的调研 Job 建出；
 *      定时任务、没有 Job、不是调研 Job、开关关着一律拒绝（抛错，不发请求）。
 *   2. 表明身份：用户代理写明青砚与联系网址，不冒充浏览器。
 *   3. 不登录：只发 GET，不带 cookie / Authorization / 任何凭证，不存 cookie，不提交表单。
 *   4. 被挡即停：登录页、人机验证、401 / 403 / 407、跳转到登录地址、robots 不许读 → blocked，不重试、不换地址；
 *      超时 / 连接中断 / 5xx 最多重试 2 次（等 1 秒、3 秒）；429 只在对方给出 ≤30 秒的等待时间时等够再试一次。
 *   5. 限量：每次读页扣这一支 1 次额度（跳转、重试、robots 不另扣）；同一站点两次请求开始时间间隔 ≥2 秒。
 *   6. 同一棵树内同一网址只读一次（并发的同址读取合并成一次）。
 * 另：内网 / 回环 / 链路本地地址拒绝（请求前解析一次、连接时由传输层再校验一次）；最多跟 3 次跳转、每跳重新校验；
 * 单次请求 15 秒；正文 2 MB 截断；HTML / 纯文本 / PDF 之外的类型拒绝；审计只记网址、状态、字数，不记正文。
 *
 * 读到的内容一律是不可信资料（untrusted: true）。
 */

import { toStorableText } from "@/lib/files/extracted-text";
import { htmlToText, normalizePlainText } from "@/lib/text/html-to-text";
import { isResearchTreeEnabledForOrgWithEnv } from "@/lib/tender-research-tree/flags";
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
  normalizePageUrl,
  parseRetryAfterSeconds,
  parseRobots,
  readOrgSiteOverride,
  reasonMessageZh,
  type RobotsGroup,
} from "./pure";
import {
  HUMAN_RESEARCH_TRIGGERS,
  type HumanResearchTrigger,
  type PageReadReason,
  type PageReadResult,
  type SitePolicy,
} from "./types";

/* ───────────────────────────── 常量 ───────────────────────────── */

export const WEB_READER_LIMITS = Object.freeze({
  /** 正文上限（解压后字节） */
  MAX_BODY_BYTES: 2 * 1024 * 1024,
  /** 单次请求（连接 + 收头 + 收正文）超时 */
  REQUEST_TIMEOUT_MS: 15_000,
  /** 最多跟几次跳转 */
  MAX_REDIRECTS: 3,
  /** 临时故障最多重试几次，及每次重试前的等待（递增） */
  TRANSIENT_RETRY_DELAYS_MS: Object.freeze([1_000, 3_000]),
  /** 同一站点两次请求开始时间的最小间隔 */
  SAME_SITE_INTERVAL_MS: 2_000,
  /** 离截止时间还剩不到这么多毫秒就不再发起新的请求 / 等待 */
  DEADLINE_MARGIN_MS: 1_000,
  /** 一次尝试至少要有这么多毫秒才值得发出 */
  MIN_ATTEMPT_MS: 2_000,
});

export const WEB_READER_USER_AGENT = "QingyanResearchBot/1.0 (+https://qingyan.ca)";
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8";
const ACCEPT_LANGUAGE = "en-CA,en;q=0.9,fr-CA;q=0.8,zh-CN;q=0.7";

/** 审计动作 */
export const WEB_READ_AUDIT_ACTION = "research.web_read" as const;

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
  sleep(ms: number): Promise<void>;
}

export type WebReadAuditEntry = {
  orgId: string;
  userId: string;
  jobId: string;
  branchKey: string;
  url: string;
  finalUrl: string | null;
  outcome: PageReadResult["outcome"];
  httpStatus: number | null;
  chars: number;
  truncated: boolean;
  reason: PageReadReason | null;
  attempts: number;
  site: string;
};

export type WebReaderDeps = {
  net: WebReaderNet;
  clock: WebReaderClock;
  /** 写审计；失败自己吞掉，不影响读页 */
  audit: (entry: WebReadAuditEntry) => Promise<void>;
  /** PDF → 每页文字 */
  extractPdf: (bytes: Uint8Array) => Promise<string[]>;
};

/** 同一棵树内的缓存（TREE-2 用 Job 的步骤结果实现；默认进程内） */
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
  /** 站点 → 下一次请求最早可以开始的时间（串行排队） */
  pacer: Map<string, Promise<number>>;
};

export type ResearchReadSession = {
  readonly [SESSION_BRAND]: true;
  readonly orgId: string;
  readonly jobId: string;
  readonly initiatedByUserId: string;
  readonly trigger: HumanResearchTrigger;
  readonly sitePolicy: SitePolicy;
  /** 为这棵树的某一支造读页上下文 */
  forBranch(input: {
    branchKey: string;
    budget: ReadBudget;
    /** 这一支里已经被挡过的站点（调用方可持久化后传回） */
    blockedSites?: Set<string>;
    /** 绝对截止时间（毫秒时间戳）；不传则只受单次请求超时约束 */
    deadlineAt?: number | null;
  }): ResearchReadContext;
};

export type ResearchReadContext = {
  readonly [BRANCH_BRAND]: true;
  readonly session: ResearchReadSession;
  readonly branchKey: string;
  readonly budget: ReadBudget;
  readonly blockedSites: Set<string>;
  readonly deadlineAt: number | null;
};

type SessionInternals = { tree: TreeState; deps: WebReaderDeps };
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
      | "NOT_HUMAN_INITIATED"
      | "FEATURE_DISABLED"
      | "INVALID_CONTEXT",
    message: string,
  ) {
    super(message);
    this.name = "WebReaderContextError";
  }
}

export type ResearchJobRow = { id: string; orgId: string; metadata: unknown };

export type CreateResearchReadContextInput = {
  orgId: string;
  jobId: string | null | undefined;
  /** 调用方处在定时任务里时必须传 true（一律拒绝） */
  scheduled?: boolean;
  /** 树级缓存；不传用进程内的 */
  cache?: TreePageCache;
};

export type CreateResearchReadContextDeps = {
  loadJob: (jobId: string) => Promise<ResearchJobRow | null>;
  loadOrgSettings: (orgId: string) => Promise<unknown>;
  env?: Record<string, string | undefined>;
  reader: WebReaderDeps;
};

function readMarker(metadata: unknown): { initiatedByUserId: string; trigger: string } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const rt = (metadata as Record<string, unknown>).researchTree;
  if (!rt || typeof rt !== "object") return null;
  const r = rt as Record<string, unknown>;
  const initiatedByUserId = typeof r.initiatedByUserId === "string" ? r.initiatedByUserId.trim() : "";
  const trigger = typeof r.trigger === "string" ? r.trigger : "";
  if (r.version !== 1) return null;
  return { initiatedByUserId, trigger };
}

/**
 * 从一条调研 Job 建读页会话（规则 1）。任何一项不满足都抛 WebReaderContextError，不发请求。
 */
export async function createResearchReadSessionWithDeps(
  input: CreateResearchReadContextInput,
  deps: CreateResearchReadContextDeps,
): Promise<ResearchReadSession> {
  if (input.scheduled === true) {
    throw new WebReaderContextError("SCHEDULED_CONTEXT", "定时任务里不读网页");
  }
  if (!isResearchTreeEnabledForOrgWithEnv(input.orgId, deps.env ?? process.env)) {
    throw new WebReaderContextError("FEATURE_DISABLED", "情报调研树未对该组织开启");
  }
  const jobId = typeof input.jobId === "string" ? input.jobId.trim() : "";
  if (!jobId) throw new WebReaderContextError("MISSING_JOB", "读网页必须属于一条调研 Job");
  const job = await deps.loadJob(jobId);
  if (!job) throw new WebReaderContextError("JOB_NOT_FOUND", "调研 Job 不存在");
  if (job.orgId !== input.orgId) throw new WebReaderContextError("JOB_ORG_MISMATCH", "调研 Job 不属于该组织");
  const marker = readMarker(job.metadata);
  if (!marker) throw new WebReaderContextError("NOT_RESEARCH_JOB", "这不是一条调研 Job");
  if (!marker.initiatedByUserId) throw new WebReaderContextError("NOT_HUMAN_INITIATED", "调研 Job 没有发起人");
  if (!(HUMAN_RESEARCH_TRIGGERS as readonly string[]).includes(marker.trigger)) {
    throw new WebReaderContextError("NOT_HUMAN_INITIATED", "调研 Job 不是由人发起的");
  }
  const settings = await deps.loadOrgSettings(input.orgId);
  const sitePolicy = mergeSitePolicy(PRESET_SITE_POLICY, readOrgSiteOverride(settings));
  const tree: TreeState = {
    cache: input.cache ?? createMemoryPageCache(),
    inflight: new Map(),
    robots: new Map(),
    pacer: new Map(),
  };
  const session: ResearchReadSession = {
    [SESSION_BRAND]: true,
    orgId: input.orgId,
    jobId,
    initiatedByUserId: marker.initiatedByUserId,
    trigger: marker.trigger as HumanResearchTrigger,
    sitePolicy,
    forBranch(b) {
      const branchKey = (b.branchKey ?? "").trim();
      if (!branchKey) throw new WebReaderContextError("INVALID_CONTEXT", "缺分支标识");
      if (!b.budget || !Number.isFinite(b.budget.remaining) || !Number.isFinite(b.budget.used)) {
        throw new WebReaderContextError("INVALID_CONTEXT", "缺读页额度");
      }
      const ctx: ResearchReadContext = {
        [BRANCH_BRAND]: true,
        session,
        branchKey,
        budget: b.budget,
        blockedSites: b.blockedSites ?? new Set<string>(),
        deadlineAt: b.deadlineAt ?? null,
      };
      branchContexts.add(ctx);
      return ctx;
    },
  };
  internals.set(session, { tree, deps: deps.reader });
  return session;
}

export function createMemoryPageCache(): TreePageCache {
  const m = new Map<string, PageReadResult>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) };
}

/* ───────────────────────────── 读页 ───────────────────────────── */

/** 站点键：主机名去掉开头的 www.（间隔与「这一支里被挡过」按它算） */
export function siteKeyOf(url: URL): string {
  return hostOf(url).replace(/^www\./, "");
}

type Built = Omit<PageReadResult, "untrusted" | "url" | "fromCache" | "messageZh" | "blocked"> & {
  messageZh?: string;
};

function finish(url: string, b: Built, fromCache = false): PageReadResult {
  const reason = b.reason;
  return {
    untrusted: true,
    url,
    finalUrl: b.finalUrl,
    fetchedAt: b.fetchedAt,
    text: b.text,
    truncated: b.truncated,
    blocked: reason && isBlockedReason(reason) ? { reason, messageZh: reasonMessageZh(reason) } : null,
    outcome: b.outcome,
    reason,
    messageZh: b.messageZh ?? reasonMessageZh(reason),
    httpStatus: b.httpStatus,
    attempts: b.attempts,
    fromCache,
  };
}

function nonRequest(
  url: string,
  outcome: PageReadResult["outcome"],
  reason: PageReadReason,
  nowIso: string,
): PageReadResult {
  return finish(url, { finalUrl: null, fetchedAt: nowIso, text: "", truncated: false, outcome, reason, httpStatus: null, attempts: 0 });
}

/** 不记进树级缓存的结果（与调用方当下状态有关） */
function isContextual(r: PageReadResult): boolean {
  return r.reason === "budget_exhausted" || r.reason === "site_blocked_in_branch" || r.reason === "deadline";
}

/**
 * 读一个公开网页。只接受 createResearchReadSessionWithDeps(...).forBranch(...) 造出的上下文。
 */
export async function readPublicPage(rawUrl: string, ctx: ResearchReadContext): Promise<PageReadResult> {
  if (!ctx || typeof ctx !== "object" || !branchContexts.has(ctx)) {
    throw new WebReaderContextError("INVALID_CONTEXT", "读网页的上下文无效（必须由调研 Job 建出）");
  }
  const inner = internals.get(ctx.session);
  if (!inner) throw new WebReaderContextError("INVALID_CONTEXT", "读网页的上下文无效");
  const { tree, deps } = inner;
  const nowIso = () => new Date(deps.clock.now()).toISOString();

  const checked = checkPublicUrl(String(rawUrl ?? ""));
  if (!checked.ok) return nonRequest(String(rawUrl ?? "").slice(0, 2048), "refused", checked.reason, nowIso());
  const key = normalizePageUrl(checked.url);
  const site = siteKeyOf(checked.url);

  // 规则 6：同一棵树内同址只读一次（含并发合并）。别的支正在读同一网址时等它的结果；
  // 那个结果若与它自己的状态有关（到上限等），本支再按自己的状态读。
  for (;;) {
    const cached = await tree.cache.get(key);
    if (cached) return markBranchFromCache(ctx, site, cached);
    const pending = tree.inflight.get(key);
    if (!pending) break;
    const shared = await pending;
    if (!isContextual(shared)) return markBranchFromCache(ctx, site, shared);
  }

  if (ctx.blockedSites.has(site)) return nonRequest(key, "blocked", "site_blocked_in_branch", nowIso());
  if (ctx.budget.remaining <= 0) return nonRequest(key, "limit", "budget_exhausted", nowIso());

  const p = readUncached(checked.url, key, ctx, inner).then(async (r) => {
    if (!isContextual(r)) await tree.cache.set(key, r);
    return r;
  });
  tree.inflight.set(key, p);
  try {
    const r = await p;
    if (r.blocked) ctx.blockedSites.add(site);
    if (r.attempts > 0) {
      await deps
        .audit({
          orgId: ctx.session.orgId,
          userId: ctx.session.initiatedByUserId,
          jobId: ctx.session.jobId,
          branchKey: ctx.branchKey,
          url: r.url,
          finalUrl: r.finalUrl,
          outcome: r.outcome,
          httpStatus: r.httpStatus,
          chars: r.text.length,
          truncated: r.truncated,
          reason: r.reason,
          attempts: r.attempts,
          site,
        })
        .catch(() => undefined);
    }
    return r;
  } finally {
    tree.inflight.delete(key);
  }
}

function markBranchFromCache(ctx: ResearchReadContext, site: string, r: PageReadResult): PageReadResult {
  if (r.blocked) ctx.blockedSites.add(site);
  return { ...r, fromCache: true };
}

type AttemptBudget = { transientLeft: number; rateLimitRetryLeft: number };

type ReqResult =
  | { kind: "response"; res: NetResponse }
  | { kind: "stop"; outcome: PageReadResult["outcome"]; reason: PageReadReason; status: number | null };

function remainingMs(ctx: ResearchReadContext, deps: WebReaderDeps): number {
  if (ctx.deadlineAt == null) return Number.POSITIVE_INFINITY;
  return ctx.deadlineAt - deps.clock.now() - WEB_READER_LIMITS.DEADLINE_MARGIN_MS;
}

/** 等到该站点可以发下一个请求（串行排队，并发的多支共享） */
async function waitForSiteSlot(site: string, inner: SessionInternals): Promise<void> {
  const { tree, deps } = inner;
  const prev = tree.pacer.get(site) ?? Promise.resolve(0);
  let release!: (t: number) => void;
  const mine = new Promise<number>((r) => (release = r));
  tree.pacer.set(site, mine);
  const earliest = await prev;
  const wait = earliest - deps.clock.now();
  if (wait > 0) await deps.clock.sleep(wait);
  release(deps.clock.now() + WEB_READER_LIMITS.SAME_SITE_INTERVAL_MS);
}

/** 解析并校验地址（请求前这一层；传输层连接时还会再校验） */
async function addressCheck(url: URL, deps: WebReaderDeps): Promise<"ok" | "private" | "dns"> {
  const literal = ipLiteralOf(url);
  if (literal) return isBlockedAddress(literal) ? "private" : "ok";
  try {
    const addrs = await deps.net.resolve(hostOf(url));
    if (addrs.length === 0) return "dns";
    return addrs.some((a) => isBlockedAddress(a.address)) ? "private" : "ok";
  } catch {
    return "dns";
  }
}

/**
 * 发一个请求（含临时故障重试与 429 等待），不跟跳转。
 * attempts 计数由调用方通过 onAttempt 记。
 */
async function requestWithRetry(
  url: URL,
  accept: string,
  ctx: ResearchReadContext,
  inner: SessionInternals,
  retry: AttemptBudget,
  onAttempt: () => void,
): Promise<ReqResult> {
  const { deps } = inner;
  const site = siteKeyOf(url);
  for (;;) {
    await waitForSiteSlot(site, inner);
    const left = remainingMs(ctx, deps);
    if (left < WEB_READER_LIMITS.MIN_ATTEMPT_MS) return { kind: "stop", outcome: "unreachable", reason: "deadline", status: null };
    onAttempt();
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
        timeoutMs: Math.min(WEB_READER_LIMITS.REQUEST_TIMEOUT_MS, left),
        maxBytes: WEB_READER_LIMITS.MAX_BODY_BYTES,
      });
    } catch (e) {
      if (e instanceof NetError && e.kind === "private_address") {
        return { kind: "stop", outcome: "refused", reason: "private_address", status: null };
      }
      if (e instanceof NetError && e.kind === "dns") return { kind: "stop", outcome: "unreachable", reason: "dns_failed", status: null };
      transient = e instanceof NetError && e.kind === "timeout" ? "timeout" : "network_error";
    }
    if (res && res.status === 429) {
      const wait = parseRetryAfterSeconds(res.headers["retry-after"], deps.clock.now());
      if (retry.rateLimitRetryLeft > 0 && wait != null && wait <= RATE_LIMIT_MAX_WAIT_SECONDS) {
        if (remainingMs(ctx, deps) - wait * 1000 < WEB_READER_LIMITS.MIN_ATTEMPT_MS) {
          return { kind: "stop", outcome: "unreachable", reason: "deadline", status: 429 };
        }
        retry.rateLimitRetryLeft -= 1;
        await deps.clock.sleep(wait * 1000);
        continue;
      }
      return { kind: "stop", outcome: "blocked", reason: "rate_limited", status: 429 };
    }
    const isTransient = transient != null || (res != null && res.status >= 500);
    if (!isTransient && res) return { kind: "response", res };
    if (retry.transientLeft <= 0) {
      return {
        kind: "stop",
        outcome: "unreachable",
        reason: res ? "http_5xx" : (transient ?? "network_error"),
        status: res ? res.status : null,
      };
    }
    const delays = WEB_READER_LIMITS.TRANSIENT_RETRY_DELAYS_MS;
    const delay = delays[delays.length - retry.transientLeft] ?? delays[delays.length - 1];
    if (remainingMs(ctx, deps) - delay < WEB_READER_LIMITS.MIN_ATTEMPT_MS) {
      return { kind: "stop", outcome: "unreachable", reason: "deadline", status: res ? res.status : null };
    }
    retry.transientLeft -= 1;
    await deps.clock.sleep(delay);
  }
}

/* ───────────────────────────── robots ───────────────────────────── */

type RobotsVerdict = { kind: "rules"; groups: RobotsGroup[] } | { kind: "allow_all" } | { kind: "unavailable" } | { kind: "deadline" };

function robotsFor(url: URL, ctx: ResearchReadContext, inner: SessionInternals): Promise<RobotsVerdict> {
  const origin = url.origin;
  const hit = inner.tree.robots.get(origin);
  if (hit) return hit;
  const p = fetchRobots(new URL("/robots.txt", origin), ctx, inner).then((v) => {
    // 时间用完是这一次调用自己的状态，不记下（下一轮再取）
    if (v.kind === "deadline") inner.tree.robots.delete(origin);
    return v;
  });
  inner.tree.robots.set(origin, p);
  return p;
}

async function fetchRobots(start: URL, ctx: ResearchReadContext, inner: SessionInternals): Promise<RobotsVerdict> {
  const retry: AttemptBudget = { transientLeft: WEB_READER_LIMITS.TRANSIENT_RETRY_DELAYS_MS.length, rateLimitRetryLeft: 0 };
  let url = start;
  for (let hop = 0; hop <= WEB_READER_LIMITS.MAX_REDIRECTS; hop++) {
    const chk = checkPublicUrl(url.toString());
    if (!chk.ok) return { kind: "unavailable" };
    if (classifySite(hostOf(url), ctx.session.sitePolicy) === "deny") return { kind: "unavailable" };
    const addr = await addressCheck(url, inner.deps);
    if (addr !== "ok") return { kind: "unavailable" };
    const r = await requestWithRetry(url, "text/plain", ctx, inner, retry, () => undefined);
    if (r.kind === "stop") {
      if (r.reason === "deadline") return { kind: "deadline" };
      // 429 / 5xx / 超时 / 连接失败 / 内网地址 → 视为全部不许读；其余 4xx 不会走到这里
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
    return { kind: "rules", groups: parseRobots(text) };
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

const HTML_MIMES = new Set(["text/html", "application/xhtml+xml"]);
const PDF_MIMES = new Set(["application/pdf", "application/x-pdf"]);

async function readUncached(start: URL, key: string, ctx: ResearchReadContext, inner: SessionInternals): Promise<PageReadResult> {
  const { deps } = inner;
  const nowIso = () => new Date(deps.clock.now()).toISOString();
  const policy = ctx.session.sitePolicy;
  const retry: AttemptBudget = { transientLeft: WEB_READER_LIMITS.TRANSIENT_RETRY_DELAYS_MS.length, rateLimitRetryLeft: 1 };
  let attempts = 0;
  let charged = false;
  let url = start;
  let lastStatus: number | null = null;
  const stop = (outcome: PageReadResult["outcome"], reason: PageReadReason, status: number | null = lastStatus): PageReadResult =>
    finish(key, {
      finalUrl: attempts > 0 ? url.toString() : null,
      fetchedAt: nowIso(),
      text: "",
      truncated: false,
      outcome,
      reason,
      httpStatus: status,
      attempts,
    });

  for (let hop = 0; ; hop++) {
    if (hop > WEB_READER_LIMITS.MAX_REDIRECTS) return stop("unreachable", "too_many_redirects");
    // 每一跳重新校验：网址、站点名单、登录地址、这一支里被挡过的站、地址、robots
    const chk = checkPublicUrl(url.toString());
    if (!chk.ok) return stop(hop === 0 ? "refused" : "unreachable", hop === 0 ? chk.reason : "invalid_redirect");
    const site = siteKeyOf(url);
    const cls = classifySite(hostOf(url), policy);
    if (cls === "deny") return stop("refused", "site_denied");
    // 直接给的登录地址：不碰（拒绝，不算该站被挡）；跳转到登录地址：被挡
    if (isLoginUrl(url)) return hop === 0 ? stop("refused", "login_url") : stop("blocked", "login_redirect");
    if (hop > 0 && ctx.blockedSites.has(site)) return stop("blocked", "site_blocked_in_branch");
    const addr = await addressCheck(url, deps);
    if (addr === "private") return stop("refused", "private_address");
    if (addr === "dns") return stop("unreachable", "dns_failed");
    if (cls !== "human_initiated") {
      const robots = await robotsFor(url, ctx, inner);
      if (robots.kind === "deadline") return stop("unreachable", "deadline");
      if (robots.kind === "unavailable") return stop("blocked", "robots_unavailable");
      if (robots.kind === "rules" && !isAllowedByRobots(robots.groups, url.pathname + url.search)) {
        return stop("blocked", "robots_disallow");
      }
    }
    if (!charged) {
      // 规则 5：确定要发页面请求时才扣额度（并发时以这里为准）
      if (ctx.budget.remaining <= 0) return stop("limit", "budget_exhausted");
      ctx.budget.remaining -= 1;
      ctx.budget.used += 1;
      charged = true;
    }
    const r = await requestWithRetry(url, PAGE_ACCEPT, ctx, inner, retry, () => {
      attempts += 1;
    });
    if (r.kind === "stop") {
      lastStatus = r.status;
      return stop(r.outcome, r.reason, r.status);
    }
    const { res } = r;
    lastStatus = res.status;
    if (res.status === 401) return stop("blocked", "http_401");
    if (res.status === 403) return stop("blocked", "http_403");
    if (res.status === 407) return stop("blocked", "http_407");
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers["location"];
      if (![301, 302, 303, 307, 308].includes(res.status) || !loc) return stop("unreachable", "invalid_redirect");
      let next: URL;
      try {
        next = new URL(loc, url);
      } catch {
        return stop("unreachable", "invalid_redirect");
      }
      url = next;
      continue;
    }
    if (res.status >= 400 || res.status < 200) return stop("unreachable", "http_4xx");

    // 2xx：按类型抽文字
    const { mime, charset } = parseContentType(res.headers["content-type"]);
    let text: string;
    if (HTML_MIMES.has(mime)) {
      const html = toStorableText(decodeText(res.body, charset ?? sniffMetaCharset(res.body)));
      text = htmlToText(html, { maxInputChars: WEB_READER_LIMITS.MAX_BODY_BYTES });
      const wall = detectAccessWall({ html, textChars: text.length });
      if (wall) return stop("blocked", wall);
    } else if (mime === "text/plain") {
      text = normalizePlainText(toStorableText(decodeText(res.body, charset)), WEB_READER_LIMITS.MAX_BODY_BYTES);
    } else if (PDF_MIMES.has(mime)) {
      try {
        const pages = await deps.extractPdf(res.body);
        // FIX-13：先把 U+0000 换成空格再整理（抽出的文字里勾选框常是 U+0000）
        text = pages.map((p) => toStorableText(String(p ?? "")).trim()).join("\n\n").trim();
      } catch {
        return stop("unreachable", "pdf_unreadable");
      }
      if (!text) return stop("unreachable", "pdf_unreadable");
    } else {
      return stop("refused", "unsupported_type");
    }
    return finish(key, {
      finalUrl: url.toString(),
      fetchedAt: nowIso(),
      text: toStorableText(text),
      truncated: res.truncated,
      outcome: "ok",
      reason: null,
      httpStatus: res.status,
      attempts,
    });
  }
}
