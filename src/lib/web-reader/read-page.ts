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
 *      同一支里不再向那个站及其子域名发请求；超时 / 中断 / 5xx 最多重试 2 次（等 1 秒、3 秒）；429 只在对方给出
 *      ≤30 秒的等待时间时等够再试一次。
 *   5. 限量：每次读页在真正发出第一个页面请求前扣这一支 1 次额度（跳转、重试、robots 不另扣；每支最多 12 次）；
 *      每支发起取 robots 最多 12 次；每支最多记 24 个被挡站；每棵树最多 24 支。这些账按 Job 记在进程内的
 *      「树账本」里（同一 Job 的多个会话共用），建会话时再与审计历史取大，重建会话、并发会话都不会清零或翻倍；
 *      同一站点两次请求的开始时间间隔 ≥2 秒（进程内所有会话共享）。
 *   6. 同一读页会话（一棵树的一次处理）内同一网址只读一次（并发合并）；跨处理的去重靠调用方传入的持久缓存。
 * 另：内网 / 回环 / 链路本地地址不读（请求前解析一次、连接时由传输层再校验一次）；IP 地址的网址不读；最多跟 3 次
 * 跳转、每跳重新校验；单次请求 15 秒；正文 2 MB 截断；只读 HTML（PDF 不在本层解析：见 design D7；其它类型拒绝）；
 * 被挡后不经抓取代理 / 快照 / 翻译代理换地址读同一个站（这类服务预置不碰；网址里嵌着被挡站的也按被挡）；
 * 审计只记网址、状态、字数，不记正文。
 *
 * 所有影响判断的状态都在本文件内部（WeakMap）：调用方拿到的会话与上下文是冻结的只读外观，改不了额度、
 * 站点名单、被挡站点、截止时间与审计归属。读到的内容一律是不可信资料（untrusted: true），结果对象是冻结的。
 */

import { toStorableText } from "@/lib/files/extracted-text";
import { htmlToText } from "@/lib/text/html-to-text";
import { isResearchTreeEnabledForOrgWithEnv } from "@/lib/tender-research-tree/flags";
import {
  PRESET_SITE_POLICY,
  RATE_LIMIT_MAX_WAIT_SECONDS,
  ROBOTS_MAX_BYTES,
  checkPublicUrl,
  classifySite,
  detectAccessWall,
  embeddedHostsOf,
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
  normalizeHost,
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
  /** 每棵树的分支数上限（任务书拍板第 5 项） */
  MAX_BRANCHES_PER_TREE: 24,
  /**
   * 每支在「没发出页面请求的读页」里取 robots 的次数上限（防止只取 robots 不读页地无限发请求）。发出了页面请求的
   * 读页里取的 robots 不计（那次读页已经扣了读页额度，robots 次数受跳转次数约束），所以它不会提前用完读页额度
   */
  MAX_ROBOTS_FETCHES_PER_BRANCH: 12,
  /** 正文上限（解压后字节） */
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
  /** 每支最多记这么多个被挡站；到了就不再读页（被挡站多到这个数，这一支已经查不下去） */
  MAX_BLOCKED_SITES_PER_BRANCH: 24,
  /**
   * 建会话时从审计读这棵树的历史，最多读这么多行。正常一棵树最多 24 支 ×（12 行读页 + 12 行只取 robots +
   * 24 行缓存被挡）= 1152 行；超过即判为历史不可信，这棵树不再读页（不按部分历史放行）
   */
  HISTORY_MAX_ROWS: 2000,
  /** 进程内最多记这么多棵树的账本（最久没用的先丢；丢了的下次建会话从审计历史恢复——见 design D14 的例外） */
  LEDGER_MAX_TREES: 4096,
  /** 站点节拍表超过这么多项就清掉已经过期的 */
  PACER_PRUNE_AT: 1000,
});

export const WEB_READER_USER_AGENT = "QingyanResearchBot/1.0 (+https://qingyan.ca)";
const PAGE_ACCEPT = "text/html,application/xhtml+xml";
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
  /** 这次读页里这一支发起取 robots 的次数（重建会话时据此恢复「每支取 robots 最多 12 次」） */
  robotsFetches: number;
  site: string;
  /** 被挡时真正挡住我们的站（重建会话时据此恢复这一支的被挡站） */
  blockedSite: string | null;
  /** 这一条是「从缓存拿到被挡结果、这一支记下被挡站」：没有发请求 */
  fromCache: boolean;
};

/** 这棵树过去的读页审计（建会话时读出，用来恢复每支的已用额度、取 robots 次数与被挡站、数分支） */
export type TreeHistoryRow = { branchKey: string; attempts: number; robotsFetches: number; blockedSite: string | null };

export type WebReaderDeps = {
  net: WebReaderNet;
  clock: WebReaderClock;
  /** 写审计；失败自己吞掉，不影响读页 */
  audit: (entry: WebReadAuditEntry) => Promise<void>;
};

/** 同一读页会话内的缓存（TREE-2 可传入用 Job 步骤结果实现的持久缓存；默认进程内） */
export interface TreePageCache {
  get(key: string): PageReadResult | undefined | Promise<PageReadResult | undefined>;
  set(key: string, value: PageReadResult): void | Promise<void>;
}

/* ───────────────────────────── 会话与分支（内部状态） ───────────────────────────── */

const SESSION_BRAND: unique symbol = Symbol("research-read-session");
const BRANCH_BRAND: unique symbol = Symbol("research-read-branch");

export type ReadBudget = { remaining: number; used: number };

type TreeState = {
  cache: TreePageCache;
  inflight: Map<string, Promise<PageReadResult>>;
  robots: Map<string, Promise<RobotsVerdict>>;
};

/**
 * 一支的账（同一 Job 的所有会话共用这一份）。cap：这一支的读页上限（调用方给的剩余 + 已用，取各次里最小的，
 * 组织调低的额度并发或重建也不会翻倍）；robotsFetches：没发出页面请求的读页里取 robots 的次数；
 * blocked：这一支被挡过的主机（小写、去末尾的点，保留 www.）
 */
type BranchLedger = { used: number; cap: number; robotsFetches: number; blocked: Set<string> };

function newBranchLedger(): BranchLedger {
  return { used: 0, cap: WEB_READER_LIMITS.MAX_READS_PER_BRANCH, robotsFetches: 0, blocked: new Set<string>() };
}

/** 一棵树（一条调研 Job）的账本 */
type TreeLedger = {
  branches: Map<string, BranchLedger>;
  /** 审计历史超过上限：历史不可信，这棵树不再读页 */
  overflow: boolean;
};

/**
 * 进程内的树账本：按时钟对象分开（生产是一个模块级时钟 → 全进程共享；测试每个假世界各一份），
 * 按「组织 + Job」记。同一 Job 同时开几个会话也只有一份账（额度、分支数、取 robots 次数、被挡站都不会翻倍）。
 */
const treeLedgers = new WeakMap<WebReaderClock, Map<string, TreeLedger>>();

function ledgerFor(clock: WebReaderClock, orgId: string, jobId: string): TreeLedger {
  let m = treeLedgers.get(clock);
  if (!m) {
    m = new Map();
    treeLedgers.set(clock, m);
  }
  const k = `${orgId}\u0000${jobId}`;
  const found = m.get(k);
  if (found) {
    m.delete(k);
    m.set(k, found); // 最近用过的放到最后
    return found;
  }
  const l: TreeLedger = { branches: new Map(), overflow: false };
  m.set(k, l);
  while (m.size > WEB_READER_LIMITS.LEDGER_MAX_TREES) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
  return l;
}

type SessionState = {
  tree: TreeState;
  deps: WebReaderDeps;
  env: Record<string, string | undefined>;
  orgId: string;
  jobId: string;
  initiatedByUserId: string;
  sitePolicy: SitePolicy;
  /** 本会话里已经建过上下文的分支 */
  usedBranchKeys: Set<string>;
  ledger: TreeLedger;
};

type BranchState = {
  sess: SessionState;
  branchKey: string;
  /** 这一支的共用账 */
  led: BranchLedger;
  deadlineAt: number | null;
  allowUrl: (url: URL) => unknown;
};

const sessionStates = new WeakMap<object, SessionState>();
const branchStates = new WeakMap<object, BranchState>();

/** 这一支现在还能读几次 */
function remainingReads(st: BranchState): number {
  if (st.sess.ledger.overflow) return 0;
  if (st.led.blocked.size >= WEB_READER_LIMITS.MAX_BLOCKED_SITES_PER_BRANCH) return 0;
  return Math.max(0, Math.min(st.led.cap, WEB_READER_LIMITS.MAX_READS_PER_BRANCH) - st.led.used);
}

export type ForBranchInput = {
  branchKey: string;
  budget: ReadBudget;
  /** 这一支里已经被挡过的主机（调用方可持久化后传回，按主机名归一；审计里的历史会自动并进来；最多 1000 个，超了拒绝建上下文） */
  blockedSites?: Iterable<string>;
  /** 绝对截止时间（毫秒时间戳，有限数）；不传或 null 则只受单次请求超时约束 */
  deadlineAt?: number | null;
  /**
   * 必填：调用方对「要读的网址」的检查（只查调用方给出的网址，不查对方给的跳转目标）。网址本身就是外发数据：
   * TREE-2 用它保证网址只来自本支搜索结果 / 已读页面 / 标书 / 人工提供，且不含我方成本、毛利、目标价。
   * 只有返回 true 才读；返回别的（false、Promise、undefined…）→ 不读（url_not_allowed）。
   */
  allowUrl: (url: URL) => boolean;
};

export type ResearchReadSession = {
  readonly [SESSION_BRAND]: true;
  readonly orgId: string;
  readonly jobId: string;
  readonly initiatedByUserId: string;
  readonly trigger: HumanResearchTrigger;
  readonly sitePolicy: SitePolicy;
  /** 为这棵树的某一支造读页上下文（同一会话里同一支只能造一次；额度等记在这条 Job 的共用账上） */
  forBranch(input: ForBranchInput): ResearchReadContext;
};

/** 调用方看到的分支上下文：冻结的只读外观；额度与被挡站点是快照（处理结束时读出来持久化） */
export type ResearchReadContext = {
  readonly [BRANCH_BRAND]: true;
  readonly session: ResearchReadSession;
  readonly branchKey: string;
  readonly budget: Readonly<ReadBudget>;
  readonly blockedSites: ReadonlySet<string>;
  readonly deadlineAt: number | null;
};

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
  /** 这棵树过去的读页审计（按 jobId） */
  loadTreeHistory: (orgId: string, jobId: string) => Promise<TreeHistoryRow[]>;
  /** 只给测试用；生产入口不传（读 process.env） */
  env?: Record<string, string | undefined>;
  reader: WebReaderDeps;
};

function deepFreezePolicy(p: SitePolicy): SitePolicy {
  return Object.freeze({
    deny: Object.freeze([...p.deny]),
    humanInitiated: Object.freeze([...p.humanInitiated]),
    allow: Object.freeze([...p.allow]),
  });
}

/**
 * 把审计历史并进树账本：历史里每支的已用读页数、取 robots 次数与进程内的账取大（进程内的账本来就包含本进程
 * 写过的审计，取大不会重复计）；被挡站取并集。历史行数超过上限 → 这棵树不再读页。
 */
function mergeHistory(ledger: TreeLedger, rows: readonly TreeHistoryRow[]): void {
  if (rows.length > WEB_READER_LIMITS.HISTORY_MAX_ROWS) {
    ledger.overflow = true;
    return;
  }
  const hist = new Map<string, BranchLedger>();
  for (const r of rows) {
    if (!r || typeof r.branchKey !== "string" || !r.branchKey) continue;
    const e = hist.get(r.branchKey) ?? newBranchLedger();
    const sentPage = typeof r.attempts === "number" && r.attempts > 0;
    if (sentPage) e.used += 1;
    // 只有没发出页面请求的读页里取的 robots 计入上限
    if (!sentPage && typeof r.robotsFetches === "number" && r.robotsFetches > 0) e.robotsFetches += Math.floor(r.robotsFetches);
    if (typeof r.blockedSite === "string" && r.blockedSite) e.blocked.add(normalizeHost(r.blockedSite));
    hist.set(r.branchKey, e);
  }
  for (const [key, h] of hist) {
    const led = ledger.branches.get(key) ?? newBranchLedger();
    led.used = Math.max(led.used, h.used);
    led.robotsFetches = Math.max(led.robotsFetches, h.robotsFetches);
    for (const b of h.blocked) led.blocked.add(b);
    ledger.branches.set(key, led);
  }
}

/**
 * 从一条调研 Job 建读页会话（规则 1）。任何一项不满足都抛 WebReaderContextError，不发请求。
 * 生产代码只经 index.ts 的 createResearchReadSession 调用（守卫测试拦住别处直接 import 本文件）。
 * 会话只活一个处理切片：Job 被取消后，下一切片建会话时就会被拒。
 */
export async function createResearchReadSessionWithDeps(
  input: CreateResearchReadContextInput,
  deps: CreateResearchReadContextDeps,
): Promise<ResearchReadSession> {
  const env = deps.env ?? process.env;
  const orgId = typeof input.orgId === "string" ? input.orgId : "";
  if (input.scheduled === true) {
    throw new WebReaderContextError("SCHEDULED_CONTEXT", "定时任务里不读网页");
  }
  if (!isResearchTreeEnabledForOrgWithEnv(orgId, env)) {
    throw new WebReaderContextError("FEATURE_DISABLED", "情报调研树未对该组织开启");
  }
  const jobId = typeof input.jobId === "string" ? input.jobId.trim() : "";
  if (!jobId) throw new WebReaderContextError("MISSING_JOB", "读网页必须属于一条调研 Job");
  const job = await deps.loadJob(jobId);
  if (!job) throw new WebReaderContextError("JOB_NOT_FOUND", "调研 Job 不存在");
  if (job.orgId !== orgId) throw new WebReaderContextError("JOB_ORG_MISMATCH", "调研 Job 不属于该组织");
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
  const settings = await deps.loadOrgSettings(orgId);
  const sitePolicy = deepFreezePolicy(mergeSitePolicy(PRESET_SITE_POLICY, readOrgSiteOverride(settings)));
  const historyRows = await deps.loadTreeHistory(orgId, jobId);
  const ledger = ledgerFor(deps.reader.clock, orgId, jobId);
  mergeHistory(ledger, Array.isArray(historyRows) ? historyRows : []);
  const sess: SessionState = {
    tree: { cache: input.cache ?? createMemoryPageCache(), inflight: new Map(), robots: new Map() },
    deps: deps.reader,
    env,
    orgId,
    jobId,
    initiatedByUserId,
    sitePolicy,
    usedBranchKeys: new Set(),
    ledger,
  };
  const session: ResearchReadSession = Object.freeze({
    [SESSION_BRAND]: true as const,
    orgId,
    jobId,
    initiatedByUserId,
    trigger: trigger as HumanResearchTrigger,
    sitePolicy,
    forBranch: (b: ForBranchInput) => openBranch(sess, session, b),
  });
  sessionStates.set(session, sess);
  return session;
}

function openBranch(sess: SessionState, session: ResearchReadSession, b: ForBranchInput): ResearchReadContext {
  // 每个原始值只读一次：防止 getter 前后返回不同的值
  const input = (b ?? {}) as Partial<ForBranchInput>;
  const rawKey = input.branchKey;
  const rawBudget = input.budget;
  const rawRemaining = rawBudget ? rawBudget.remaining : undefined;
  const rawUsed = rawBudget ? rawBudget.used : undefined;
  const rawDeadline = input.deadlineAt;
  const rawAllow = input.allowUrl;
  const rawBlocked = input.blockedSites;
  const fail = (why: string): never => {
    throw new WebReaderContextError("INVALID_CONTEXT", `分支读页上下文无效：${why}`);
  };
  const branchKey = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!branchKey || branchKey.length > 100) fail("缺分支标识或过长");
  if (sess.usedBranchKeys.has(branchKey)) fail("同一会话里每支只建一次");
  const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
  if (!isCount(rawRemaining) || !isCount(rawUsed)) fail("额度要是非负整数");
  const remainingIn = rawRemaining as number;
  const usedIn = rawUsed as number;
  if (remainingIn + usedIn > WEB_READER_LIMITS.MAX_READS_PER_BRANCH) fail(`额度合计不能超过 ${WEB_READER_LIMITS.MAX_READS_PER_BRANCH} 次`);
  if (rawDeadline != null && !(typeof rawDeadline === "number" && Number.isFinite(rawDeadline))) fail("截止时间要是有限的毫秒数或不给");
  if (typeof rawAllow !== "function") fail("必须给网址检查");
  const passedBlocked: string[] = [];
  if (rawBlocked != null) {
    for (const s of rawBlocked as Iterable<unknown>) {
      if (passedBlocked.length >= 1000) fail("被挡站太多");
      if (typeof s === "string" && s.trim()) passedBlocked.push(normalizeHost(s));
    }
  }
  const ledger = sess.ledger;
  if (!ledger.branches.has(branchKey) && ledger.branches.size >= WEB_READER_LIMITS.MAX_BRANCHES_PER_TREE) {
    fail(`每棵树最多 ${WEB_READER_LIMITS.MAX_BRANCHES_PER_TREE} 个分支`);
  }
  const led = ledger.branches.get(branchKey) ?? newBranchLedger();
  ledger.branches.set(branchKey, led);
  led.used = Math.min(WEB_READER_LIMITS.MAX_READS_PER_BRANCH, Math.max(led.used, usedIn));
  // 调用方给的上限（剩余 + 已用）取各次里最小的：组织调低的额度在并发会话与重建会话之间也不会翻倍
  led.cap = Math.min(led.cap, remainingIn + usedIn);
  for (const s of passedBlocked) if (s) led.blocked.add(s);
  sess.usedBranchKeys.add(branchKey);
  const st: BranchState = {
    sess,
    branchKey,
    led,
    deadlineAt: rawDeadline == null ? null : (rawDeadline as number),
    allowUrl: rawAllow as (url: URL) => unknown,
  };
  const ctx = Object.freeze({
    [BRANCH_BRAND]: true as const,
    session,
    branchKey,
    get budget(): Readonly<ReadBudget> {
      return Object.freeze({ remaining: remainingReads(st), used: st.led.used });
    },
    get blockedSites(): ReadonlySet<string> {
      return new Set(st.led.blocked);
    },
    deadlineAt: st.deadlineAt,
  });
  branchStates.set(ctx, st);
  return ctx;
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

type ReadState = { attempts: number; robotsRequests: number; robotsFetches: number; charged: boolean; lastRequested: URL | null };

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
    r.reason === "robots_limit" ||
    r.reason === "blocked_sites_limit" ||
    r.reason === "history_overflow" ||
    r.reason === "site_blocked_in_branch" ||
    r.reason === "deadline" ||
    r.reason === "url_not_allowed"
  );
}

const OUTCOMES: ReadonlySet<string> = new Set(["ok", "blocked", "unreachable", "refused", "limit"]);

/** 调用方的持久缓存返回的对象：形状不对就当没命中；命中的一律重新标成不可信、冻结 */
function sanitizeCached(raw: unknown, key: string): PageReadResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== "string" || r.url !== key) return null;
  if (typeof r.text !== "string" || typeof r.fetchedAt !== "string" || typeof r.outcome !== "string" || !OUTCOMES.has(r.outcome)) {
    return null;
  }
  const blk = r.blocked && typeof r.blocked === "object" ? (r.blocked as Record<string, unknown>) : null;
  const reason = (typeof r.reason === "string" ? r.reason : null) as PageReadReason | null;
  return freezeResult({
    untrusted: true,
    url: key,
    finalUrl: typeof r.finalUrl === "string" ? r.finalUrl : null,
    fetchedAt: r.fetchedAt,
    text: r.text,
    truncated: r.truncated === true,
    blocked:
      blk && reason && isBlockedReason(reason)
        ? { reason: reason as BlockedReason, messageZh: reasonMessageZh(reason), site: typeof blk.site === "string" ? normalizeHost(blk.site) : "" }
        : null,
    outcome: r.outcome as PageReadOutcome,
    reason,
    messageZh: reasonMessageZh(reason),
    httpStatus: typeof r.httpStatus === "number" ? r.httpStatus : null,
    attempts: typeof r.attempts === "number" ? r.attempts : 0,
    robotsRequests: typeof r.robotsRequests === "number" ? r.robotsRequests : 0,
    fromCache: true,
  });
}

const wwwless = (h: string) => h.replace(/^www\./, "");

/**
 * 主机 host 是否落在被挡的主机 b 里：同一个站（只差 www.）；b 的子域名（被挡后不靠换子域名绕过）；
 * 或以 b 打头的代理式主机名（`gov.example.mirror.example`、`gov-example.proxy.example`）。
 * www.canada.ca 被挡不连带 canadabuys.canada.ca（兄弟子域名不是同一个站，第四轮挑错 D）。
 */
function hostInBlocked(host: string, b: string): boolean {
  if (wwwless(host) === wwwless(b)) return true;
  if (host.endsWith(`.${b}`)) return true;
  const core = wwwless(b);
  return host.startsWith(`${core}.`) || host.startsWith(`${core.replace(/\./g, "-")}.`);
}

/** 这一支里挡住这个主机的那个被挡主机；没有返回 null */
function blockedSiteFor(st: BranchState, host: string): string | null {
  for (const b of st.led.blocked) if (hostInBlocked(host, b)) return b;
  return null;
}

/** 这个网址的主机、或网址里嵌着的主机（经抓取代理 / 快照换地址）在这一支里被挡过：返回那个被挡主机 */
function blockedSiteForUrl(st: BranchState, url: URL): string | null {
  if (st.led.blocked.size === 0) return null;
  const own = blockedSiteFor(st, hostOf(url));
  if (own) return own;
  for (const h of embeddedHostsOf(url).hosts) {
    const b = blockedSiteFor(st, h);
    if (b) return b;
  }
  return null;
}

/** 网址的主机在「不碰」名单里 → site_denied；嵌着的主机在名单里 → embedded_site_denied；嵌着的网址认不清 → embedded_url_unclear */
function deniedUrl(url: URL, policy: SitePolicy): "site_denied" | "embedded_site_denied" | "embedded_url_unclear" | null {
  if (classifySite(hostOf(url), policy) === "deny") return "site_denied";
  const emb = embeddedHostsOf(url);
  if (emb.hosts.some((h) => classifySite(h, policy) === "deny")) return "embedded_site_denied";
  if (!emb.complete) return "embedded_url_unclear";
  return null;
}

function remainingMs(st: BranchState): number {
  if (st.deadlineAt == null) return Number.POSITIVE_INFINITY;
  return st.deadlineAt - st.sess.deps.clock.now() - WEB_READER_LIMITS.DEADLINE_MARGIN_MS;
}

/* ───────────────────────────── 读页入口 ───────────────────────────── */

/**
 * 读一个公开网页。只接受 createResearchReadSessionWithDeps(...).forBranch(...) 造出的上下文。
 */
export async function readPublicPage(rawUrl: string, ctx: ResearchReadContext): Promise<PageReadResult> {
  const st = ctx && typeof ctx === "object" ? branchStates.get(ctx) : undefined;
  if (!st) throw new WebReaderContextError("INVALID_CONTEXT", "读网页的上下文无效（必须由调研 Job 建出）");
  const sess = st.sess;
  if (!isResearchTreeEnabledForOrgWithEnv(sess.orgId, sess.env)) {
    throw new WebReaderContextError("FEATURE_DISABLED", "情报调研树未对该组织开启");
  }
  const { tree, deps } = sess;
  const nowIso = () => new Date(deps.clock.now()).toISOString();

  const raw = String(rawUrl ?? "");
  const checked = checkPublicUrl(raw);
  if (!checked.ok) return nonRequest(raw.slice(0, WEB_READER_LIMITS.AUDIT_URL_MAX_CHARS), "refused", checked.reason, nowIso());
  const key = normalizePageUrl(checked.url);
  const site = siteKeyOf(checked.url);
  // 只有明确返回 true 才算放行（返回 Promise / 别的值一律不读）
  if (st.allowUrl(new URL(key)) !== true) return nonRequest(key, "refused", "url_not_allowed", nowIso());
  // 不碰名单（含网址里嵌着的站：抓取代理 / 快照 / 翻译代理）先于缓存与被挡判断：不读
  const denied = deniedUrl(checked.url, sess.sitePolicy);
  if (denied) return nonRequest(key, "refused", denied, nowIso());

  // 规则 6：同一会话内同址只读一次（含并发合并）。别的支正在读同一网址时等它的结果（受本支截止约束）；
  // 那个结果若与它自己的状态有关（到上限等），本支再按自己的状态读。同一个等候对象只等一次（不会空转）。
  const seen = new Set<Promise<PageReadResult>>();
  for (;;) {
    const cached = sanitizeCached(await tree.cache.get(key), key);
    if (cached) return markBranchFromCache(st, cached, site);
    const pending = tree.inflight.get(key);
    if (!pending || seen.has(pending)) break;
    seen.add(pending);
    const shared = await waitWithinDeadline(pending, st);
    if (shared === null) return nonRequest(key, "unreachable", "deadline", nowIso());
    if (!isContextual(shared)) return markBranchFromCache(st, shared, site);
  }

  const blockedAs = blockedSiteForUrl(st, checked.url);
  if (blockedAs) return nonRequest(key, "blocked", "site_blocked_in_branch", nowIso(), blockedAs);
  if (sess.ledger.overflow) return nonRequest(key, "limit", "history_overflow", nowIso());
  if (st.led.blocked.size >= WEB_READER_LIMITS.MAX_BLOCKED_SITES_PER_BRANCH) return nonRequest(key, "limit", "blocked_sites_limit", nowIso());
  if (remainingReads(st) <= 0) return nonRequest(key, "limit", "budget_exhausted", nowIso());

  const state: ReadState = { attempts: 0, robotsRequests: 0, robotsFetches: 0, charged: false, lastRequested: null };
  const p = readUncached(checked.url, key, st, state).then(async (r) => {
    // 调用方的持久缓存写失败不影响结果与审计
    if (!isContextual(r)) await Promise.resolve().then(() => tree.cache.set(key, r)).catch(() => undefined);
    return r;
  });
  // 等候方拿到结果时这一项已经删掉（finally 在等候方的续行之前跑），不会在同一个已完成的对象上空转
  const shared: Promise<PageReadResult> = p.finally(() => {
    if (tree.inflight.get(key) === shared) tree.inflight.delete(key);
  });
  tree.inflight.set(key, shared);
  const r = await shared;
  if (r.blocked?.site) st.led.blocked.add(r.blocked.site);
  // 发出了页面请求的读页里取的 robots 不计入「没读页只取 robots」的上限
  if (state.attempts > 0 && state.robotsFetches > 0) st.led.robotsFetches = Math.max(0, st.led.robotsFetches - state.robotsFetches);
  // 发过请求，或这一支发起过取 robots（哪怕没发出请求）：都写审计，重建会话时据此恢复账
  if (r.attempts + r.robotsRequests + state.robotsFetches > 0) {
    await writeAudit(st, r, site, { robotsFetches: state.robotsFetches, fromCache: false });
  }
  return r;
}

async function writeAudit(
  st: BranchState,
  r: PageReadResult,
  site: string,
  extra: { robotsFetches: number; fromCache: boolean },
): Promise<void> {
  const sess = st.sess;
  const cut = (u: string | null) => (u == null ? null : u.slice(0, WEB_READER_LIMITS.AUDIT_URL_MAX_CHARS));
  await sess.deps
    .audit({
      orgId: sess.orgId,
      userId: sess.initiatedByUserId,
      jobId: sess.jobId,
      branchKey: st.branchKey,
      url: cut(r.url) ?? "",
      finalUrl: extra.fromCache ? null : cut(r.finalUrl),
      outcome: r.outcome,
      httpStatus: extra.fromCache ? null : r.httpStatus,
      chars: extra.fromCache ? 0 : r.text.length,
      truncated: extra.fromCache ? false : r.truncated,
      reason: r.reason,
      attempts: extra.fromCache ? 0 : r.attempts,
      robotsRequests: extra.fromCache ? 0 : r.robotsRequests,
      robotsFetches: extra.robotsFetches,
      site,
      blockedSite: r.blocked?.site || null,
      fromCache: extra.fromCache,
    })
    .catch(() => undefined);
}

async function waitWithinDeadline(p: Promise<PageReadResult>, st: BranchState): Promise<PageReadResult | null> {
  const left = remainingMs(st);
  if (!Number.isFinite(left)) return p;
  if (left <= 0) return null;
  return raceTimer(p, left, st.sess.deps.clock);
}

/**
 * 从缓存（或别的支的同址结果）拿到结果。是被挡结果时这一支记下被挡站，并写一条不含请求的审计
 * （重建会话时据此恢复；每支最多记 MAX_BLOCKED_SITES_PER_BRANCH 个，到了这一支就不再读页）。
 */
async function markBranchFromCache(st: BranchState, r: PageReadResult, site: string): Promise<PageReadResult> {
  const out = freezeResult({ ...r, untrusted: true, fromCache: true });
  const b = r.blocked?.site;
  if (b && !st.led.blocked.has(b) && st.led.blocked.size < WEB_READER_LIMITS.MAX_BLOCKED_SITES_PER_BRANCH) {
    st.led.blocked.add(b);
    await writeAudit(st, out, site, { robotsFetches: 0, fromCache: true });
  }
  return out;
}

/* ───────────────────────────── 请求 ───────────────────────────── */

type AttemptBudget = { transientLeft: number; rateLimitRetryLeft: number };

type ReqStop = { kind: "stop"; outcome: PageReadOutcome; reason: PageReadReason; status: number | null; blockedSite?: string };
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
async function reserveSiteSlot(site: string, st: BranchState): Promise<boolean> {
  const clock = st.sess.deps.clock;
  let m = pacers.get(clock);
  if (!m) {
    m = new Map();
    pacers.set(clock, m);
  }
  const now = clock.now();
  if (m.size > WEB_READER_LIMITS.PACER_PRUNE_AT) {
    for (const [k, v] of m) if (v <= now) m.delete(k);
  }
  const start = Math.max(now, m.get(site) ?? 0);
  if (start - now > remainingMs(st) - WEB_READER_LIMITS.MIN_ATTEMPT_MS) return false;
  m.set(site, start + WEB_READER_LIMITS.SAME_SITE_INTERVAL_MS);
  if (start > now) await clock.sleep(start - now);
  return true;
}

/** 解析并校验地址（请求前这一层；传输层连接时还会再校验） */
async function addressCheck(url: URL, st: BranchState): Promise<"ok" | "private" | "dns" | "deadline"> {
  const literal = ipLiteralOf(url);
  if (literal) return isBlockedAddress(literal) ? "private" : "ok";
  const left = remainingMs(st);
  if (left < WEB_READER_LIMITS.MIN_ATTEMPT_MS) return "deadline";
  const limit = Math.min(WEB_READER_LIMITS.DNS_TIMEOUT_MS, left);
  try {
    const addrs = await raceTimer(st.sess.deps.net.resolve(hostOf(url)), limit, st.sess.deps.clock);
    if (!addrs || addrs.length === 0) return "dns";
    return addrs.some((a) => isBlockedAddress(a.address)) ? "private" : "ok";
  } catch {
    return "dns";
  }
}

/** 发一个请求（含临时故障重试与 429 等待），不跟跳转 */
async function requestWithRetry(url: URL, accept: string, st: BranchState, retry: AttemptBudget, hooks: SendHooks): Promise<ReqResult> {
  const { deps } = st.sess;
  const site = siteKeyOf(url);
  const stop = (outcome: PageReadOutcome, reason: PageReadReason, status: number | null = null): ReqStop => ({
    kind: "stop",
    outcome,
    reason,
    status,
  });
  for (;;) {
    if (!(await reserveSiteSlot(site, st))) return stop("unreachable", "deadline");
    // 排到时段之后再查一次：同一支里别的并发读可能刚刚被这个站（或网址里嵌着的站）挡了；记真正命中的被挡主机
    const hit = blockedSiteForUrl(st, url);
    if (hit) return { ...stop("blocked", "site_blocked_in_branch"), blockedSite: hit };
    const left = remainingMs(st);
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
        if (remainingMs(st) - wait * 1000 < WEB_READER_LIMITS.MIN_ATTEMPT_MS) return stop("unreachable", "deadline", 429);
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
    if (remainingMs(st) - delay < WEB_READER_LIMITS.MIN_ATTEMPT_MS) return stop("unreachable", "deadline", res ? res.status : null);
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
  /** 这一支发起取 robots 的次数到上限：与本支状态有关 */
  | { kind: "limit" }
  /** 跳到了这一支被挡过的站：与本支状态有关，不缓存、不给别的支共用 */
  | { kind: "branch_blocked"; site: string };

/** 与取 robots 那一支自己的状态有关的结论：不记进会话缓存 */
function isContextualVerdict(v: RobotsVerdict): boolean {
  return v.kind === "deadline" || v.kind === "branch_blocked" || v.kind === "limit";
}

async function robotsFor(url: URL, st: BranchState, state: ReadState): Promise<RobotsVerdict> {
  const { tree } = st.sess;
  const origin = url.origin;
  for (let tries = 0; tries < 2; tries++) {
    const existing = tree.robots.get(origin);
    if (existing) {
      // 等别的支取 robots 也受本支截止约束
      const left = remainingMs(st);
      const v = Number.isFinite(left) ? await raceTimer(existing, Math.max(0, left), st.sess.deps.clock) : await existing;
      if (v === null) return { kind: "deadline" };
      // 别的支取到的结论与它自己的状态有关：本支自己再取一次
      if (isContextualVerdict(v)) {
        if (tree.robots.get(origin) === existing) tree.robots.delete(origin);
        if (v.kind === "deadline" && remainingMs(st) < WEB_READER_LIMITS.MIN_ATTEMPT_MS) return v;
        continue;
      }
      return v;
    }
    if (st.led.robotsFetches >= WEB_READER_LIMITS.MAX_ROBOTS_FETCHES_PER_BRANCH) return { kind: "limit" };
    st.led.robotsFetches += 1;
    state.robotsFetches += 1;
    const p: Promise<RobotsVerdict> = fetchRobots(new URL("/robots.txt", origin), st, state).then((v) => {
      // 与这一次调用自己的状态有关的结论不记下
      if (isContextualVerdict(v) && tree.robots.get(origin) === p) tree.robots.delete(origin);
      return v;
    });
    tree.robots.set(origin, p);
    return p;
  }
  return { kind: "deadline" };
}

async function fetchRobots(start: URL, st: BranchState, state: ReadState): Promise<RobotsVerdict> {
  const retry: AttemptBudget = { transientLeft: WEB_READER_LIMITS.TRANSIENT_RETRY_DELAYS_MS.length, rateLimitRetryLeft: 0 };
  let url = start;
  for (let hop = 0; hop <= WEB_READER_LIMITS.ROBOTS_MAX_REDIRECTS; hop++) {
    const chk = checkPublicUrl(url.toString());
    if (!chk.ok) return { kind: "allow_all" }; // 跳到无效地址：视为没有 robots
    if (hop > 0) {
      // 只跟到别处的 /robots.txt；跳到别的页面、登录地址视为没有 robots，不请求；跳到 IP 地址按读取失败，不请求
      if (url.pathname !== "/robots.txt" || isLoginUrl(url)) return { kind: "allow_all" };
      if (ipLiteralOf(url)) return { kind: "unavailable" };
    }
    if (deniedUrl(url, st.sess.sitePolicy)) return { kind: "unavailable" };
    const blockedAs = blockedSiteForUrl(st, url);
    if (blockedAs) return { kind: "branch_blocked", site: blockedAs };
    const addr = await addressCheck(url, st);
    if (addr === "private") return { kind: "private" };
    if (addr === "deadline") return { kind: "deadline" };
    if (addr === "dns") return { kind: "unavailable" };
    const r = await requestWithRetry(url, "text/plain", st, retry, {
      onSent: () => {
        state.robotsRequests += 1;
      },
    });
    if (r.kind === "stop") {
      if (r.reason === "deadline") return { kind: "deadline" };
      if (r.reason === "private_address") return { kind: "private" };
      if (r.reason === "site_blocked_in_branch") return { kind: "branch_blocked", site: r.blockedSite ?? hostOf(url) };
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

/** 网址路径以 .pdf 结尾：不在本层解析，不发请求 */
function looksLikePdf(url: URL): boolean {
  return /\.pdf$/i.test(url.pathname);
}

/** 正文开头（跳过 BOM 与空白）是 %PDF-：按 PDF 处理 */
function bodyLooksLikePdf(body: Uint8Array): boolean {
  // 跳过开头的 UTF-8 BOM 与空白（最多看前 64 KiB）
  let i = 0;
  const end = Math.min(body.length, 64 * 1024);
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) i = 3;
  while (i < end && (body[i] === 0x20 || body[i] === 0x09 || body[i] === 0x0a || body[i] === 0x0d || body[i] === 0x0c || body[i] === 0x00)) i++;
  return new TextDecoder("latin1").decode(body.subarray(i, i + 5)) === "%PDF-";
}

async function readUncached(start: URL, key: string, st: BranchState, state: ReadState): Promise<PageReadResult> {
  const { deps } = st.sess;
  const nowIso = () => new Date(deps.clock.now()).toISOString();
  const policy = st.sess.sitePolicy;
  const retry: AttemptBudget = { transientLeft: WEB_READER_LIMITS.TRANSIENT_RETRY_DELAYS_MS.length, rateLimitRetryLeft: 1 };
  let url = start;
  let prev: URL | null = null;
  let lastStatus: number | null = null;
  const stop = (outcome: PageReadOutcome, reason: PageReadReason, status: number | null = lastStatus, blockedSite?: string): PageReadResult => {
    // 被挡站立刻记进这一支（不等写调用方的持久缓存，第四轮挑错 B）
    if (outcome === "blocked" && blockedSite) st.led.blocked.add(blockedSite);
    return finish(key, {
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
  };

  for (let hop = 0; ; hop++) {
    if (hop > WEB_READER_LIMITS.MAX_REDIRECTS) return stop("unreachable", "too_many_redirects");
    // 每一跳重新校验：网址、IP 地址、站点名单、登录地址、PDF、这一支里被挡过的站、地址、robots
    const chk = checkPublicUrl(url.toString());
    if (!chk.ok) return hop === 0 ? stop("refused", chk.reason) : stop("unreachable", "invalid_redirect");
    // 被挡记在主机上（保留 www.，见 hostInBlocked）
    const site = hostOf(url);
    // 主机名是 IP 地址的不读：被挡后不靠换成 IP 绕过，正常的公开网站也不用 IP 地址
    if (ipLiteralOf(url)) return hop === 0 ? stop("refused", "ip_literal") : stop("unreachable", "invalid_redirect");
    const cls = classifySite(hostOf(url), policy);
    // 网址的站或网址里嵌着的站（经抓取代理 / 快照 / 翻译代理）在不碰名单里：不读
    const denied = deniedUrl(url, policy);
    if (denied) return stop("refused", denied);
    // 直接给的登录地址：不碰（不读，不算该站被挡）；跳转到登录地址：发出跳转的那个站挡了我们
    if (isLoginUrl(url)) {
      return hop === 0 ? stop("refused", "login_url") : stop("blocked", "login_redirect", lastStatus, prev ? hostOf(prev) : site);
    }
    if (looksLikePdf(url)) return stop("refused", "pdf_not_read");
    const blockedHop = blockedSiteForUrl(st, url);
    if (blockedHop) return stop("blocked", "site_blocked_in_branch", lastStatus, blockedHop);
    const addr = await addressCheck(url, st);
    if (addr === "private") return stop("refused", "private_address");
    if (addr === "dns") return stop("unreachable", "dns_failed");
    if (addr === "deadline") return stop("unreachable", "deadline");
    if (cls !== "human_initiated") {
      const robots = await robotsFor(url, st, state);
      if (robots.kind === "deadline") return stop("unreachable", "deadline");
      if (robots.kind === "limit") return stop("limit", "robots_limit");
      if (robots.kind === "private") return stop("refused", "private_address");
      if (robots.kind === "branch_blocked") return stop("blocked", "site_blocked_in_branch", lastStatus, robots.site);
      if (robots.kind === "unavailable") return stop("blocked", "robots_unavailable", lastStatus, site);
      if (robots.kind === "rules" && !isAllowedByRobots(robots.groups, url.pathname + url.search)) {
        return stop("blocked", "robots_disallow", lastStatus, site);
      }
    }
    const requestUrl = url;
    const r = await requestWithRetry(url, PAGE_ACCEPT, st, retry, {
      // 规则 5：真正发出第一个页面请求前一刻才扣额度（并发时以这里为准）
      beforeSend: () => {
        if (state.charged) return true;
        if (remainingReads(st) <= 0) return false;
        st.led.used += 1;
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
      return stop(r.outcome, r.reason, r.status, r.outcome === "blocked" ? (r.blockedSite ?? site) : undefined);
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

    // 2xx：按类型抽文字。正文是 PDF（不管标的是什么类型）一律不在本层解析
    const { mime, charset } = parseContentType(res.headers["content-type"]);
    if (PDF_MIMES.has(mime) || bodyLooksLikePdf(res.body)) {
      // PDF 不在本层解析（design D7：进程内解析无法限住解析成本）；由人用「我来补一页」上传
      return stop("refused", "pdf_not_read", res.status);
    }
    let text: string;
    if (HTML_MIMES.has(mime)) {
      const html = toStorableText(decodeText(res.body, charset ?? sniffMetaCharset(res.body)));
      const refresh = metaRefreshTarget(html, url);
      if (refresh && isLoginUrl(refresh)) return stop("blocked", "login_redirect", res.status, site);
      text = htmlToText(html, { maxInputChars: WEB_READER_LIMITS.MAX_BODY_BYTES });
      const wall = detectAccessWall({ html, textChars: text.length });
      if (wall) return stop("blocked", wall, res.status, site);
    } else {
      // 只读 HTML；纯文本与其它类型拒绝（任务书 TREE-1「其它类型拒绝」）
      return stop("refused", "unsupported_type", res.status);
    }
    return finish(key, {
      finalUrl: url.toString(),
      fetchedAt: nowIso(),
      text: cleanText(text),
      truncated: res.truncated,
      outcome: "ok",
      reason: null,
      httpStatus: res.status,
      attempts: state.attempts,
      robotsRequests: state.robotsRequests,
    });
  }
}
