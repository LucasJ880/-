/**
 * MAIL-1 助手只读读信 —— 纯函数（spec mail/assistant-read；change mail-read-tools）
 *
 * 不访问数据库、不访问 Gmail、不调用模型。这里放：搜索条件拼装、正文截断、错误码、
 * 读信意图判定、助手回复落库前的原文省略、邮件绑定状态里的读信字段。
 */

// ── 常量 ────────────────────────────────────────────────────

/** 一次搜索最多返回的邮件数 */
export const MAIL_SEARCH_MAX_RESULTS = 10;
export const MAIL_DEFAULT_NEWER_THAN_DAYS = 30;
export const MAIL_MAX_NEWER_THAN_DAYS = 365;
/** 关键词原文上限（切词之前） */
export const MAIL_QUERY_MAX_CHARS = 200;
/** 关键词个数上限 */
export const MAIL_QUERY_MAX_TERMS = 10;
/** 单封正文上限（字） */
export const MAIL_MESSAGE_CHAR_LIMIT = 6_000;
/** 整线程正文合计上限（字） */
export const MAIL_THREAD_CHAR_LIMIT = 20_000;
/** 助手回复与邮件正文连续重合达到这个字数（去掉空白与行首引用符后）即在落库版本里省略 */
export const MAIL_VERBATIM_OVERLAP_MIN = 120;
export const MAIL_VERBATIM_OMITTED = "〔邮件原文已省略，需要时请让助手重新读取〕";
/** 邮箱绑定页：缺授权时指给用户的去处 */
export const MAIL_SETTINGS_HREF = "/settings/email";
/** 读信工具名前缀：入口门、模块映射、写入封锁都按它识别 */
export const MAIL_TOOL_PREFIX = "mail_";

export function isMailToolName(name: string): boolean {
  return name.startsWith(MAIL_TOOL_PREFIX);
}

// ── 错误码 ──────────────────────────────────────────────────

export type MailReadErrorCode =
  | "MAIL_READ_UNAVAILABLE"
  | "MAIL_NOT_CONNECTED"
  | "MAIL_READ_SCOPE_MISSING"
  | "MAIL_REAUTH_REQUIRED"
  | "MAIL_PROVIDER_ERROR"
  | "MAIL_CUSTOMER_NOT_FOUND"
  | "MAIL_CUSTOMER_NO_EMAIL"
  | "MAIL_THREAD_NOT_FOUND"
  | "MAIL_AUDIT_FAILED";

const MAIL_ERROR_MESSAGES: Record<MailReadErrorCode, string> = {
  MAIL_READ_UNAVAILABLE: "当前入口不能读取邮箱",
  MAIL_NOT_CONNECTED: "还没有绑定 Gmail，请到邮箱绑定页完成 Google 授权",
  MAIL_READ_SCOPE_MISSING: "当前 Gmail 授权没有读信权限，请到邮箱绑定页重新授权",
  MAIL_REAUTH_REQUIRED: "Gmail 授权已失效，请到邮箱绑定页重新授权",
  MAIL_PROVIDER_ERROR: "Gmail 暂时无法读取，请稍后再试",
  MAIL_CUSTOMER_NOT_FOUND: "客户不存在或无权限",
  MAIL_CUSTOMER_NO_EMAIL: "这位客户的档案里没有邮箱，无法按客户搜索",
  MAIL_THREAD_NOT_FOUND: "线程不存在",
  MAIL_AUDIT_FAILED: "读信记录写入失败，本次没有读取邮件",
};

const CODES_WITH_SETTINGS_HREF: ReadonlySet<MailReadErrorCode> = new Set([
  "MAIL_NOT_CONNECTED",
  "MAIL_READ_SCOPE_MISSING",
  "MAIL_REAUTH_REQUIRED",
]);

export type MailReadErrorData = {
  code: MailReadErrorCode;
  message: string;
  settingsHref?: string;
};

/** 结构化错误（放进工具返回的 data：引擎只把 data 交给模型） */
export function mailReadError(code: MailReadErrorCode): MailReadErrorData {
  return {
    code,
    message: MAIL_ERROR_MESSAGES[code],
    ...(CODES_WITH_SETTINGS_HREF.has(code) ? { settingsHref: MAIL_SETTINGS_HREF } : {}),
  };
}

/** Gmail 调用抛错 → 错误码（不重试；404 由调用方按「线程不存在」单独处理） */
export function classifyGmailError(err: unknown): MailReadErrorCode {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; message?: unknown; response?: { status?: unknown } };
  const status = Number(e.code ?? e.status ?? e.response?.status);
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (message.includes("invalid_grant") || status === 401) return "MAIL_REAUTH_REQUIRED";
  if (status === 403 && /insufficient|scope/.test(message)) return "MAIL_READ_SCOPE_MISSING";
  return "MAIL_PROVIDER_ERROR";
}

// ── 搜索条件 ────────────────────────────────────────────────

/** 天数：缺省 30；小于 1 按 1；大于 365 按 365；非数字按缺省 */
export function clampNewerThanDays(value: unknown): number {
  if (value === undefined || value === null || value === "") return MAIL_DEFAULT_NEWER_THAN_DAYS;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return MAIL_DEFAULT_NEWER_THAN_DAYS;
  if (n < 1) return 1;
  if (n > MAIL_MAX_NEWER_THAN_DAYS) return MAIL_MAX_NEWER_THAN_DAYS;
  return n;
}

/**
 * 关键词 → 字面词：按空白切开，去掉引号、括号、反斜杠与控制字符，冒号换成空格
 * （这样 `in:spam`、`from:x` 不会被 Gmail 当作运算符），每个词之后由调用方加双引号。
 */
export function literalKeywords(query: unknown): string[] {
  if (typeof query !== "string") return [];
  return query
    .slice(0, MAIL_QUERY_MAX_CHARS)
    .split(/\s+/)
    .map((token) =>
      token
        .replace(/[\u0000-\u001f\u007f"'`\\(){}\[\]]/g, "")
        .replace(/[:：]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, MAIL_QUERY_MAX_TERMS);
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** 客户档案里的邮箱字段 → 合法地址（最多 3 个；一个字段里写了多个地址时按空白、逗号、分号切开） */
export function customerEmailAddresses(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,;，；]+/)) {
    const addr = part.trim().toLowerCase();
    if (EMAIL_RE.test(addr)) seen.add(addr);
    if (seen.size >= 3) break;
  }
  return [...seen];
}

export type MailSearchInput = {
  query?: unknown;
  /** 服务端从客户档案取出的地址（模型不提供） */
  customerEmails?: readonly string[];
  newerThanDays?: unknown;
  unreadOnly?: unknown;
};

/** 拼 Gmail 查询串：时间范围、未读、客户地址由服务端生成；关键词只作字面词 */
export function buildMailSearchQuery(input: MailSearchInput): string {
  const parts: string[] = [`newer_than:${clampNewerThanDays(input.newerThanDays)}d`];
  const emails = (input.customerEmails ?? []).filter((e) => EMAIL_RE.test(e));
  if (emails.length > 0) {
    parts.push(`(${emails.flatMap((e) => [`from:${e}`, `to:${e}`]).join(" OR ")})`);
  }
  if (input.unreadOnly === true) parts.push("is:unread");
  for (const word of literalKeywords(input.query)) parts.push(`"${word}"`);
  return parts.join(" ");
}

/** Gmail 的线程 / 邮件 id：十六进制串。格式不对的直接按「不存在」处理，不发请求 */
export function isValidGmailId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-fA-F]{8,32}$/.test(id.trim());
}

// ── 正文截断 ────────────────────────────────────────────────

/** 按字数截断，不把一个代理对切成两半 */
export function clipText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let cut = text.slice(0, Math.max(0, limit));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

export type BudgetedBody = {
  bodyText: string;
  /** 这一封的正文被截短 */
  truncated: boolean;
  /** 线程额度用完，这一封只留元数据 */
  bodyOmitted: boolean;
};

/**
 * 线程正文额度：每封最多 perMessage 字；合计最多 total 字，额度从最新一封往前分，
 * 分不到的旧邮件只留元数据。输入、输出都按时间正序。
 */
export function applyThreadBudget<T extends { bodyText: string }>(
  messages: readonly T[],
  perMessage: number = MAIL_MESSAGE_CHAR_LIMIT,
  total: number = MAIL_THREAD_CHAR_LIMIT,
): { messages: Array<Omit<T, "bodyText"> & BudgetedBody>; truncated: boolean; returnedChars: number } {
  const out: Array<Omit<T, "bodyText"> & BudgetedBody> = new Array(messages.length);
  let remaining = total;
  let anyCut = false;
  let returnedChars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const original = messages[i].bodyText ?? "";
    let body = clipText(original, perMessage);
    let truncated = body.length < original.length;
    let bodyOmitted = false;
    if (remaining <= 0 && original.length > 0) {
      body = "";
      bodyOmitted = true;
      truncated = true;
    } else if (body.length > remaining) {
      body = clipText(body, remaining);
      truncated = true;
    }
    remaining -= body.length;
    returnedChars += body.length;
    if (truncated) anyCut = true;
    out[i] = { ...messages[i], bodyText: body, truncated, bodyOmitted };
  }
  return { messages: out, truncated: anyCut, returnedChars };
}

// ── 读信意图（网页助手路由用）──────────────────────────────

const MAILBOX_KEYWORDS = ["邮件", "邮箱", "来信", "回信", "信件", "封信", "收件箱", "email", "e-mail", "inbox", "gmail"] as const;

/** 消息里提到邮件 / 邮箱。只在读信对当前用户可用时参与路由（见 mailIntentForcesTools） */
export function mentionsMailbox(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return MAILBOX_KEYWORDS.some((kw) => lower.includes(kw));
}

/** 读信可用（入口门 mail === true）且消息提到邮箱 → 本轮带工具运行；不可用时这些词不改变路由 */
export function mailIntentForcesTools(mailGate: boolean | undefined, text: string | null | undefined): boolean {
  return mailGate === true && mentionsMailbox(text);
}

// ── 助手回复落库前省略长段邮件原文 ──────────────────────────

/** 去掉空白与行首引用符（`>`），并记下每个保留字符在原文里的位置 */
function skeleton(text: string): { chars: string; index: number[] } {
  const chars: string[] = [];
  const index: number[] = [];
  let lineStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n" || ch === "\r") {
      lineStart = true;
      continue;
    }
    if (/\s/.test(ch)) continue;
    if (lineStart && ch === ">") continue;
    lineStart = false;
    chars.push(ch);
    index.push(i);
  }
  return { chars: chars.join(""), index };
}

/**
 * 把回复里与任一封邮件正文连续重合 minOverlap 字及以上的段落换成省略标记。
 * 比较前两边都去掉空白与行首引用符；短引用与转述原样保留。
 */
export function redactVerbatimMail(
  reply: string,
  bodies: readonly string[],
  minOverlap: number = MAIL_VERBATIM_OVERLAP_MIN,
): { text: string; redactedSegments: number } {
  if (!reply || bodies.length === 0 || minOverlap < 1) return { text: reply, redactedSegments: 0 };
  const windows = new Set<string>();
  for (const body of bodies) {
    const s = skeleton(body ?? "").chars;
    for (let i = 0; i + minOverlap <= s.length; i++) windows.add(s.slice(i, i + minOverlap));
  }
  if (windows.size === 0) return { text: reply, redactedSegments: 0 };

  const { chars, index } = skeleton(reply);
  // 命中的窗口合并成区间（骨架坐标，左闭右开）
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i + minOverlap <= chars.length; i++) {
    if (!windows.has(chars.slice(i, i + minOverlap))) continue;
    const last = ranges[ranges.length - 1];
    if (last && i <= last[1]) last[1] = i + minOverlap;
    else ranges.push([i, i + minOverlap]);
  }
  if (ranges.length === 0) return { text: reply, redactedSegments: 0 };

  let out = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    const from = index[start];
    const to = index[end - 1] + 1;
    out += reply.slice(cursor, from) + MAIL_VERBATIM_OMITTED;
    cursor = to;
  }
  out += reply.slice(cursor);
  return { text: out, redactedSegments: ranges.length };
}

/** 从读信工具的成功返回里取出各封正文（消息接口在当轮内存里留着，用于落库前省略） */
export function mailBodiesFromToolData(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { untrusted?: unknown; source?: unknown; messages?: unknown };
  if (d.untrusted !== true || d.source !== "gmail" || !Array.isArray(d.messages)) return [];
  const bodies: string[] = [];
  for (const m of d.messages) {
    const body = (m as { bodyText?: unknown } | null)?.bodyText;
    if (typeof body === "string" && body.length > 0) bodies.push(body);
  }
  return bodies;
}

// ── 邮件绑定状态里的读信字段（GET /api/sales/email-status）──

/**
 * 开关关：不加任何字段（响应与上线前逐字段相同）。
 * 开关开：已连接的 gmail 多 hasReadScope，顶层多 mailRead: { enabled: true }。
 */
export function withMailReadStatus<G extends { connected: boolean }, R extends { gmail: G }>(
  response: R,
  input: { enabled: boolean; hasReadScope: boolean },
): R | (Omit<R, "gmail"> & { gmail: G | (G & { hasReadScope: boolean }); mailRead: { enabled: true } }) {
  if (!input.enabled) return response;
  return {
    ...response,
    gmail: response.gmail.connected ? { ...response.gmail, hasReadScope: input.hasReadScope } : response.gmail,
    mailRead: { enabled: true as const },
  };
}

export type MailReadPanelState = "enabled" | "needs_reauth" | "needs_google" | "hidden";

/** 邮箱绑定页「读信权限」一项显示哪种状态 */
export function mailReadPanelState(status: {
  mailRead?: { enabled?: boolean } | null;
  gmail?: { connected?: boolean; hasReadScope?: boolean } | null;
} | null | undefined): MailReadPanelState {
  if (!status?.mailRead?.enabled) return "hidden";
  if (!status.gmail?.connected) return "needs_google";
  return status.gmail.hasReadScope ? "enabled" : "needs_reauth";
}
