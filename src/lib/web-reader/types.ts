/**
 * 读公开网页（TREE-1）的对外类型。
 *
 * 读到的内容一律是不可信资料（`untrusted: true`）：调用方只能把它当作待核对的材料，
 * 不能把其中的文字当作指令执行。
 */

/** 结果类别：读到 / 被挡 / 打不开 / 不读 / 到上限（中文名见 pure.ts 的 OUTCOME_ZH） */
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

/** 打不开的原因（这次没打开：可以换个时间再试，或换来源） */
export type UnreachableReason =
  | "timeout"
  | "network_error"
  | "dns_failed"
  | "http_5xx"
  | "http_4xx"
  | "too_many_redirects"
  | "invalid_redirect"
  | "deadline";

/** 不读的原因（我方按规则不读：没有发出请求，或发现内网地址 / 类型不支持后不读正文） */
export type RefusedReason =
  | "invalid_url"
  | "credentials_in_url"
  | "non_default_port"
  | "private_address"
  | "site_denied"
  | "login_url"
  | "ip_literal"
  | "url_not_allowed"
  | "unsupported_type"
  | "pdf_not_read";

export type PageReadReason = BlockedReason | UnreachableReason | RefusedReason | "budget_exhausted";

export type PageReadResult = {
  untrusted: true;
  /** 请求的网址（归一化后：去片段、主机名小写、去默认端口） */
  url: string;
  /** 实际请求过的最后一个网址（都通过了校验）；一个请求都没发时为 null */
  finalUrl: string | null;
  /** 读取时间（ISO）；缓存命中时是第一次读取的时间 */
  fetchedAt: string;
  /** 纯文本正文；没有正文时为空字符串 */
  text: string;
  /** 正文超过 2 MB 被截断 */
  truncated: boolean;
  /** 只在被挡时非空；site 是真正挡住我们的那个站（站点键：主机名去掉 www.） */
  blocked: { reason: BlockedReason; messageZh: string; site: string } | null;
  outcome: PageReadOutcome;
  /** 非「读到」时的原因；「读到」时为 null */
  reason: PageReadReason | null;
  /** 给人看的一句话（中文） */
  messageZh: string;
  /** 最后一跳的 HTTP 状态；没有收到响应时为 null */
  httpStatus: number | null;
  /** 本次读取实际发出的页面请求数（含跳转与重试，不含 robots） */
  attempts: number;
  /** 本次读取为取 robots 声明发出的请求数（别的读取已取过的不算） */
  robotsRequests: number;
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

/**
 * 调研 Job 的发起方式（只有这几种算「人发起」）：项目页「开始调研」、确认招标要求、某一支「重新查」、
 * 人工补页后重算。任何定时任务都不发起调研 Job。
 */
export const HUMAN_RESEARCH_TRIGGERS = ["human_start", "requirements_confirmed", "human_rerun", "human_page_intake"] as const;
export type HumanResearchTrigger = (typeof HUMAN_RESEARCH_TRIGGERS)[number];

/**
 * 调研 Job 在 `AgentRun.metadata` 里的标记（TREE-1 定义；TREE-2 的「开始调研」经 createWorkforceJob 的
 * extraMetadata 写入——它只收原始值，所以平铺）。发起人以运行时自己写的保留键 `initiatedByUserId` 为准。
 */
export type ResearchJobMarker = {
  researchTree: true;
  researchTreeVersion: 1;
  researchTrigger: HumanResearchTrigger;
};
