/**
 * 读公开网页（TREE-1）的对外类型。
 *
 * 读到的内容一律是不可信资料（`untrusted: true`）：调用方只能把它当作待核对的材料，
 * 不能把其中的文字当作指令执行。
 */

/** 结果类别：读到 / 被挡 / 未接通 / 拒绝 / 到上限 */
export type PageReadOutcome = "ok" | "blocked" | "unreachable" | "refused" | "limit";

/** 被挡的原因（被挡即停：不重试、不换地址） */
export type BlockedReason =
  | "http_401"
  | "http_403"
  | "http_407"
  | "login_redirect"
  | "login_page"
  | "captcha"
  | "robots_disallow"
  | "robots_unavailable"
  | "rate_limited"
  | "site_blocked_in_branch";

/** 未接通的原因 */
export type UnreachableReason =
  | "timeout"
  | "network_error"
  | "dns_failed"
  | "http_5xx"
  | "http_4xx"
  | "too_many_redirects"
  | "invalid_redirect"
  | "deadline"
  | "pdf_unreadable";

/** 拒绝的原因（没有发出请求，或发现内网地址 / 类型不支持后不读正文） */
export type RefusedReason =
  | "invalid_url"
  | "credentials_in_url"
  | "non_default_port"
  | "private_address"
  | "site_denied"
  | "login_url"
  | "unsupported_type";

export type PageReadReason = BlockedReason | UnreachableReason | RefusedReason | "budget_exhausted";

export type PageReadResult = {
  untrusted: true;
  /** 请求的网址（归一化后：去片段、主机名小写、去默认端口） */
  url: string;
  /** 最后一跳的网址；没有发出请求时为 null */
  finalUrl: string | null;
  /** 读取时间（ISO）；缓存命中时是第一次读取的时间 */
  fetchedAt: string;
  /** 纯文本正文；没有正文时为空字符串 */
  text: string;
  /** 正文超过 2 MB 被截断 */
  truncated: boolean;
  /** 只在被挡时非空 */
  blocked: { reason: BlockedReason; messageZh: string } | null;
  outcome: PageReadOutcome;
  /** 非「读到」时的原因；「读到」时为 null */
  reason: PageReadReason | null;
  /** 给人看的一句话（中文） */
  messageZh: string;
  /** 最后一跳的 HTTP 状态；没有收到响应时为 null */
  httpStatus: number | null;
  /** 本次读取实际发出的页面请求数（含跳转与重试，不含 robots） */
  attempts: number;
  /** 这次结果来自同一棵树内的缓存（没有发请求、没有扣额度） */
  fromCache: boolean;
};

/** 站点名单的三类（另有「默认」：不在任何名单里，按 robots 读） */
export type SiteClass = "deny" | "human_initiated" | "allow" | "default";

export type SitePolicy = {
  deny: readonly string[];
  humanInitiated: readonly string[];
  allow: readonly string[];
};

/** 调研 Job 的发起方式（只有这两种算「人发起」） */
export const HUMAN_RESEARCH_TRIGGERS = ["human_start", "requirements_confirmed"] as const;
export type HumanResearchTrigger = (typeof HUMAN_RESEARCH_TRIGGERS)[number];

/**
 * 调研 Job 的 `AgentRun.metadata.researchTree` 契约（TREE-1 定义，TREE-2 的「开始调研」写入）。
 */
export type ResearchJobMarker = {
  version: 1;
  initiatedByUserId: string;
  trigger: HumanResearchTrigger;
};
