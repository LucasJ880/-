/**
 * 青砚邮件模块 — Gmail OAuth 授权 + 发送/草稿封装
 *
 * ## 设计决策：独立 Email OAuth flow
 *
 * 当前采用独立于 CalendarProvider 的 EmailProvider 进行 OAuth 授权。
 * 原因：
 * 1. 产品实现隔离 — 日历与邮件是两个独立功能模块，用户可能只启用其一，
 *    独立授权可以让用户精确控制自己授予的权限范围。
 * 2. 作用域最小化 — Email 仅需 gmail.compose + gmail.readonly + userinfo.email，
 *    不请求 gmail.modify / mail.google.com；Calendar 需要独立 calendar scopes。
 *    gmail.readonly 只给询价回信入站（P1-4，tender-rfq/inbound-sync）读信用，不改动/删除邮件。
 * 3. Token 生命周期独立 — 撤销日历不影响邮件，反之亦然。
 *
 * ## 关于 include_granted_scopes
 *
 * Google 官方推荐 include_granted_scopes=true 作为增量授权（incremental auth）
 * 最佳实践，使新旧 scope 合并到同一个 token 中，减少用户重复授权。
 *
 * 我们此处显式使用 include_granted_scopes=false，原因：
 * 1. 邮件与日历使用独立的 EmailProvider / CalendarProvider 存储，
 *    合并 scope 会导致任一模块 token 可访问另一模块 API，破坏隔离设计。
 * 2. 独立 flow 让 grantedScopes 字段清晰记录该模块真正被授予的权限，
 *    方便后续权限审查与诊断。
 * 3. 重新授权必须重新弹出 consent，并要求新的 refresh_token，
 *    避免旧 send-only token 被误判为已具备草稿能力。
 *
 * ## AI 草稿路径约束
 *
 * AI / PendingAction 执行路径只允许 drafts.create，禁止 messages.send。
 * 手动业务发信（报价等）仍可走 sendGmail → messages.send（compose scope 含发送能力）。
 */

import { google } from "googleapis";
import { db } from "@/lib/db";
import { encryptField, decryptField } from "@/lib/crypto";
import { isGmailDraftAllowed } from "@/lib/env/runtime-isolation";

// ── Scopes ──────────────────────────────────────────────────

export const GMAIL_COMPOSE_SCOPE =
  "https://www.googleapis.com/auth/gmail.compose";

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

export const EMAIL_SCOPES = [
  GMAIL_COMPOSE_SCOPE,
  GMAIL_READONLY_SCOPE,
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

export type GmailOAuthErrorCode =
  | "GMAIL_COMPOSE_SCOPE_NOT_GRANTED"
  | "GMAIL_REFRESH_TOKEN_MISSING_REAUTHORIZE"
  | "GMAIL_REAUTH_REQUIRED"
  | "GMAIL_DRAFT_DISABLED"
  | "GMAIL_NOT_CONNECTED";

export class GmailOAuthError extends Error {
  readonly code: GmailOAuthErrorCode;

  constructor(code: GmailOAuthErrorCode, message: string) {
    super(message);
    this.name = "GmailOAuthError";
    this.code = code;
  }
}

/** Gmail 草稿功能总开关；统一走 runtime-isolation（未知 runtime 默认不允许） */
export function isGmailDraftEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isGmailDraftAllowed(env);
}

/** 解析 OAuth scope 字符串是否包含目标 scope（支持完整 URL 或短名） */
export function hasGmailComposeScope(
  grantedScopes: string | null | undefined,
): boolean {
  if (!grantedScopes?.trim()) return false;
  const parts = grantedScopes.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return parts.some(
    (s) =>
      s === GMAIL_COMPOSE_SCOPE ||
      s === "gmail.compose" ||
      s.endsWith("/auth/gmail.compose"),
  );
}

/**
 * 是否含 gmail.readonly（询价回信入站读信用）。
 * 旧授权只有 compose → false；用户在 getGmailReauthUrl 重新授权（EMAIL_SCOPES 已含 readonly）后为 true。
 * 不把 readonly 列为授权必需项：拒绝读信权限的用户仍可正常发信/建草稿。
 */
export function hasGmailReadScope(
  grantedScopes: string | null | undefined,
): boolean {
  if (!grantedScopes?.trim()) return false;
  const parts = grantedScopes.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return parts.some(
    (s) =>
      s === GMAIL_READONLY_SCOPE ||
      s === "gmail.readonly" ||
      s.endsWith("/auth/gmail.readonly") ||
      // 更宽的 scope 同样可读
      s === "https://mail.google.com/" ||
      s.endsWith("/auth/gmail.modify"),
  );
}

/**
 * 校验 Google token 响应：必须用 tokens.scope（不得用请求 scope 伪造），
 * 且必须含 gmail.compose + 新的 refresh_token。
 */
export function validateEmailOAuthTokens(tokens: {
  scope?: string | null;
  refresh_token?: string | null;
  access_token?: string | null;
}):
  | { ok: true; grantedScopes: string }
  | { ok: false; code: GmailOAuthErrorCode; message: string } {
  const grantedScopes = tokens.scope?.trim() ?? "";
  if (!grantedScopes || !hasGmailComposeScope(grantedScopes)) {
    return {
      ok: false,
      code: "GMAIL_COMPOSE_SCOPE_NOT_GRANTED",
      message:
        "Google 未授予 gmail.compose。请重新授权并勾选草稿/撰写权限后重试。",
    };
  }
  if (!tokens.refresh_token?.trim()) {
    return {
      ok: false,
      code: "GMAIL_REFRESH_TOKEN_MISSING_REAUTHORIZE",
      message:
        "未返回 refresh_token。请使用「重新授权」入口（prompt=consent）后重试，旧绑定不会被覆盖。",
    };
  }
  return { ok: true, grantedScopes };
}

/**
 * 草稿确认/执行前能力检查：功能开关 + compose scope。
 * 在调用 Gmail API 之前失败，避免 insufficient scopes。
 */
export function assertGmailDraftReady(provider: {
  accessToken?: string | null;
  grantedScopes?: string | null;
} | null): void {
  if (!isGmailDraftEnabled()) {
    throw new GmailOAuthError(
      "GMAIL_DRAFT_DISABLED",
      "Gmail 草稿功能未开启（GMAIL_DRAFT_ENABLED）。",
    );
  }
  if (!provider?.accessToken) {
    throw new GmailOAuthError(
      "GMAIL_NOT_CONNECTED",
      "未找到 Gmail 授权，邮件草稿未创建。请到『设置 → 邮箱绑定』连接 Google 后重试。",
    );
  }
  if (!hasGmailComposeScope(provider.grantedScopes)) {
    throw new GmailOAuthError(
      "GMAIL_REAUTH_REQUIRED",
      "当前 Gmail 授权缺少 gmail.compose。请到设置页重新授权后再确认草稿。",
    );
  }
}

// ── OAuth 基础设施（复用 Calendar 的 Client ID/Secret，独立 redirect） ──

function getEmailOAuthEnv() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
    redirectUri: process.env.GOOGLE_EMAIL_REDIRECT_URI?.trim() ?? "",
  };
}

function getOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = getEmailOAuthEnv();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ── 授权 URL ────────────────────────────────────────────────

/**
 * Gmail OAuth / 重新授权入口。
 * 强制：access_type=offline、prompt=consent、include_granted_scopes=false。
 */
export function getEmailAuthUrl(state?: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...EMAIL_SCOPES],
    // 见文件顶部注释：独立 flow，不合并已有 scope
    include_granted_scopes: false,
    ...(state ? { state } : {}),
  });
}

/** 与 getEmailAuthUrl 相同策略，语义上标明「重新授权覆盖旧 EmailProvider」 */
export function getGmailReauthUrl(state?: string): string {
  return getEmailAuthUrl(state);
}

// ── OAuth Callback ──────────────────────────────────────────

export type EmailCallbackDeps = {
  getToken?: (code: string, redirectUri: string) => Promise<{
    tokens: {
      scope?: string | null;
      refresh_token?: string | null;
      access_token?: string | null;
      expiry_date?: number | null;
    };
  }>;
  getUserEmail?: (accessToken: string) => Promise<string>;
  findProvider?: (userId: string) => Promise<{ id: string } | null>;
  createProvider?: (data: Record<string, unknown>) => Promise<void>;
  updateProvider?: (id: string, data: Record<string, unknown>) => Promise<void>;
};

export async function handleEmailCallback(
  code: string,
  userId: string,
  deps: EmailCallbackDeps = {},
) {
  const { redirectUri } = getEmailOAuthEnv();
  if (!redirectUri) {
    throw new Error("GOOGLE_EMAIL_REDIRECT_URI is not set");
  }

  const getToken =
    deps.getToken ??
    (async (c: string, uri: string) => {
      const client = getOAuth2Client();
      return client.getToken({ code: c, redirect_uri: uri });
    });

  const { tokens } = await getToken(code, redirectUri);

  const validated = validateEmailOAuthTokens(tokens);
  if (!validated.ok) {
    // 校验失败：绝不更新 EmailProvider（不覆盖旧绑定）
    throw new GmailOAuthError(validated.code, validated.message);
  }

  let accountEmail = "";
  if (deps.getUserEmail) {
    accountEmail = await deps.getUserEmail(tokens.access_token ?? "");
  } else {
    const client = getOAuth2Client();
    client.setCredentials({
      access_token: tokens.access_token ?? undefined,
      refresh_token: tokens.refresh_token ?? undefined,
      scope: tokens.scope ?? undefined,
      expiry_date: tokens.expiry_date ?? undefined,
    });
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();
    accountEmail = userInfo.email ?? "";
  }

  const providerData = {
    type: "gmail" as const,
    accessToken: encryptField(tokens.access_token ?? ""),
    refreshToken: encryptField(tokens.refresh_token!),
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    accountEmail,
    // 只记录 Google 实际返回的 scope，绝不回填请求 scope
    grantedScopes: validated.grantedScopes,
  };

  const findProvider =
    deps.findProvider ??
    ((uid: string) =>
      db.emailProvider.findUnique({
        where: { userId_type: { userId: uid, type: "gmail" } },
        select: { id: true },
      }));

  const existing = await findProvider(userId);

  if (existing) {
    if (deps.updateProvider) {
      await deps.updateProvider(existing.id, providerData);
    } else {
      await db.emailProvider.update({
        where: { id: existing.id },
        data: providerData,
      });
    }
  } else if (deps.createProvider) {
    await deps.createProvider(providerData);
  } else {
    await db.emailProvider.create({
      data: { ...providerData, userId },
    });
  }

  return { email: accountEmail };
}

// ── Token 管理 ──────────────────────────────────────────────

export async function getEmailProvider(userId: string) {
  return db.emailProvider.findUnique({
    where: { userId_type: { userId, type: "gmail" } },
  });
}

async function getAuthedGmailClient(provider: {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date | null;
}) {
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: decryptField(provider.accessToken),
    refresh_token: provider.refreshToken
      ? decryptField(provider.refreshToken)
      : undefined,
    expiry_date: provider.tokenExpiry?.getTime(),
  });

  client.on("tokens", async (tokens) => {
    await db.emailProvider.update({
      where: { id: provider.id },
      data: {
        accessToken: tokens.access_token
          ? encryptField(tokens.access_token)
          : undefined,
        tokenExpiry: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : undefined,
      },
    });
  });

  return client;
}

// ── Gmail 发送 ──────────────────────────────────────────────

export interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  body: string;
  replyTo?: string;
  /** 线程回复（P1-7 催单/追问）：Gmail threadId，进 messages.send 的 body，让回信留在原询价线程 */
  threadId?: string;
  /** 线程回复：原始邮件的 RFC 822 Message-ID 头（不是 Gmail 的 message id），写进 In-Reply-To */
  inReplyTo?: string;
  /** 线程回复：References 头；缺省同 inReplyTo */
  references?: string;
  /** 正文类型：缺省 "html"（既有调用方）；纯文本正文（询价 / 催单模板）传 "text"，换行原样保留 */
  contentType?: "text" | "html";
}

export type GmailSendApi = {
  users: {
    messages: {
      send: (args: {
        userId: string;
        requestBody: { raw: string; threadId?: string };
      }) => Promise<{ data: { id?: string | null; threadId?: string | null } }>;
    };
  };
};

export type SendGmailDeps = {
  getProvider?: typeof getEmailProvider;
  getGmail?: (provider: {
    id: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiry: Date | null;
  }) => Promise<GmailSendApi>;
};

/**
 * 通过 Gmail API 发送邮件（非 AI 草稿路径）。
 *
 * 需要 gmail.compose（或历史 gmail.send）。AI 路径禁止调用本函数。
 * Wave1.5：messages.send 前 fail-closed（非生产默认 SIDE_EFFECT_DISABLED）。
 */
export async function sendGmail(
  userId: string,
  params: SendEmailParams,
  deps: SendGmailDeps = {},
): Promise<{ messageId: string; threadId: string }> {
  const { assertSideEffectOrThrow } = await import(
    "@/lib/env/runtime-isolation"
  );
  assertSideEffectOrThrow("email");

  const getProvider = deps.getProvider ?? getEmailProvider;
  const provider = await getProvider(userId);
  if (!provider) {
    throw new Error("用户未绑定 Gmail 邮件服务");
  }

  const getGmail =
    deps.getGmail ??
    (async (p: NonNullable<Awaited<ReturnType<typeof getEmailProvider>>>) => {
      const client = await getAuthedGmailClient(p);
      return google.gmail({ version: "v1", auth: client }) as unknown as GmailSendApi;
    });

  const gmail = await getGmail(provider);
  const rawMessage = buildRawEmail(params);

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: params.threadId ? { raw: rawMessage, threadId: params.threadId } : { raw: rawMessage },
  });

  return { messageId: res.data.id ?? "", threadId: res.data.threadId ?? "" };
}

/** 可注入的 Gmail API 客户端（测试用）—— 仅暴露 drafts.create */
export type GmailDraftApi = {
  users: {
    drafts: {
      create: (args: {
        userId: string;
        requestBody: { message: { raw: string } };
      }) => Promise<{ data: { id?: string | null } }>;
    };
    messages?: {
      send?: (args: unknown) => Promise<unknown>;
    };
  };
};

export type CreateGmailDraftDeps = {
  getProvider?: typeof getEmailProvider;
  getGmail?: (provider: {
    id: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiry: Date | null;
  }) => Promise<GmailDraftApi>;
};

/**
 * 通过 Gmail API 创建草稿（drafts.create）—— 仅创建，不发送。
 *
 * 用于 AI Grader / Agent 生成的邮件草稿沉淀：用户后续在 Gmail 草稿箱
 * 自行检查、修改、发送。本函数绝不调用 messages.send。
 * 允许 to 为空（草稿可无收件人）。
 */
export async function createGmailDraft(
  userId: string,
  params: SendEmailParams,
  deps: CreateGmailDraftDeps = {},
): Promise<{ draftId: string }> {
  const getProvider = deps.getProvider ?? getEmailProvider;
  const provider = await getProvider(userId);

  assertGmailDraftReady(provider);

  const getGmail =
    deps.getGmail ??
    (async (p: NonNullable<Awaited<ReturnType<typeof getEmailProvider>>>) => {
      const client = await getAuthedGmailClient(p);
      return google.gmail({ version: "v1", auth: client }) as unknown as GmailDraftApi;
    });

  const gmail = await getGmail(provider!);
  const rawMessage = buildRawEmail({ ...params, to: params.to ?? "" });

  // AI 路径唯一写入口：drafts.create（禁止 messages.send）
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: rawMessage } },
  });

  return { draftId: res.data.id ?? "" };
}

// ── Gmail 读信（P1-4 询价回信入站；需 gmail.readonly） ─────────

type GmailMessagePart = {
  partId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
  body?: { attachmentId?: string | null; size?: number | null; data?: string | null } | null;
  parts?: GmailMessagePart[] | null;
};

/** 可注入的只读 Gmail API（测试用）—— 仅 history / threads / messages 的读接口 */
export type GmailReadApi = {
  users: {
    getProfile: (args: { userId: string }) => Promise<{ data: { historyId?: string | null } }>;
    history: {
      list: (args: {
        userId: string;
        startHistoryId: string;
        historyTypes?: string[];
        pageToken?: string;
      }) => Promise<{
        data: {
          history?: Array<{
            messagesAdded?: Array<{ message?: { id?: string | null; threadId?: string | null } | null }> | null;
          }> | null;
          historyId?: string | null;
          nextPageToken?: string | null;
        };
      }>;
    };
    threads: {
      get: (args: { userId: string; id: string; format?: string }) => Promise<{
        data: { messages?: Array<{ id?: string | null; threadId?: string | null }> | null };
      }>;
    };
    messages: {
      get: (args: { userId: string; id: string; format?: string; metadataHeaders?: string[] }) => Promise<{
        data: {
          id?: string | null;
          threadId?: string | null;
          labelIds?: string[] | null;
          internalDate?: string | null;
          payload?: GmailMessagePart | null;
        };
      }>;
      attachments: {
        get: (args: { userId: string; messageId: string; id: string }) => Promise<{
          data: { data?: string | null; size?: number | null };
        }>;
      };
    };
  };
};

export type GmailReadDeps = {
  getProvider?: typeof getEmailProvider;
  getGmail?: (provider: {
    id: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiry: Date | null;
  }) => Promise<GmailReadApi>;
};

async function getGmailReader(userId: string, deps: GmailReadDeps): Promise<GmailReadApi> {
  const getProvider = deps.getProvider ?? getEmailProvider;
  const provider = await getProvider(userId);
  if (!provider) throw new Error("用户未绑定 Gmail 邮件服务");
  const getGmail =
    deps.getGmail ??
    (async (p: NonNullable<Awaited<ReturnType<typeof getEmailProvider>>>) => {
      const client = await getAuthedGmailClient(p);
      return google.gmail({ version: "v1", auth: client }) as unknown as GmailReadApi;
    });
  return getGmail(provider);
}

export type ThreadReplyRef = { messageId: string; threadId: string };

/** history.list 最多翻页数（每 10 分钟一次，正常远用不到；防异常长循环） */
const HISTORY_MAX_PAGES = 20;

/**
 * 自 sinceHistoryId 以来新增的邮件（只返回 id + threadId，线程过滤由调用方做）。
 * - sinceHistoryId 为空 → 不回溯，只返回当前 historyId 作为起点；
 * - 游标过期（Gmail 只保留约一周历史，history.list 返回 404）→ expired=true，由调用方重建游标。
 */
export async function listThreadReplies(
  userId: string,
  opts: { sinceHistoryId: string | null },
  deps: GmailReadDeps = {},
): Promise<{ messages: ThreadReplyRef[]; historyId: string | null; expired: boolean }> {
  const gmail = await getGmailReader(userId, deps);
  if (!opts.sinceHistoryId) {
    const { data } = await gmail.users.getProfile({ userId: "me" });
    return { messages: [], historyId: data.historyId ?? null, expired: false };
  }

  const messages: ThreadReplyRef[] = [];
  const seen = new Set<string>();
  let historyId: string | null = opts.sinceHistoryId;
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
      const { data } = await gmail.users.history.list({
        userId: "me",
        startHistoryId: opts.sinceHistoryId,
        historyTypes: ["messageAdded"],
        ...(pageToken ? { pageToken } : {}),
      });
      for (const h of data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          const id = added.message?.id;
          const threadId = added.message?.threadId;
          if (id && threadId && !seen.has(id)) {
            seen.add(id);
            messages.push({ messageId: id, threadId });
          }
        }
      }
      if (data.historyId) historyId = data.historyId;
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
  } catch (err) {
    const code = (err as { code?: number; status?: number } | null)?.code ?? (err as { status?: number } | null)?.status;
    if (code === 404) return { messages: [], historyId: null, expired: true };
    throw err;
  }
  return { messages, historyId, expired: false };
}

/** 线程内全部邮件 id（游标首次建立 / 过期重建时，按已知询价线程补扫用） */
export async function listThreadMessages(
  userId: string,
  threadId: string,
  deps: GmailReadDeps = {},
): Promise<ThreadReplyRef[]> {
  const gmail = await getGmailReader(userId, deps);
  const { data } = await gmail.users.threads.get({ userId: "me", id: threadId, format: "minimal" });
  return (data.messages ?? [])
    .filter((m): m is { id: string; threadId: string } => !!m.id)
    .map((m) => ({ messageId: m.id, threadId: m.threadId ?? threadId }));
}

/**
 * 一封已发邮件的 RFC 822 Message-ID 头（P1-7：线程回复的 In-Reply-To / References）。
 * P1-3 发信时只留了 Gmail 的 messageId，这里按需取一次；取不到 → null（调用方只带 threadId 发）。
 */
export async function getMessageIdHeader(
  userId: string,
  messageId: string,
  deps: GmailReadDeps = {},
): Promise<string | null> {
  const gmail = await getGmailReader(userId, deps);
  const { data } = await gmail.users.messages.get({ userId: "me", id: messageId, format: "metadata", metadataHeaders: ["Message-ID"] });
  const v = (data.payload?.headers ?? []).find((h) => h.name?.toLowerCase() === "message-id")?.value?.trim();
  return v ? v : null;
}

export type GmailAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  /** null = 超过大小上限未下载 */
  data: Buffer | null;
};

export type GmailMessageContent = {
  messageId: string;
  threadId: string;
  labelIds: string[];
  date: Date;
  from: string;
  subject: string;
  /** 正文纯文本（text/plain 优先；只有 HTML 时去标签） */
  bodyText: string;
  attachments: GmailAttachment[];
};

/** 单个附件下载上限；超出只记录不下载 */
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 读取单封邮件：正文文本 + 附件 buffer（base64url 解码）。 */
export async function getMessageWithAttachments(
  userId: string,
  messageId: string,
  deps: GmailReadDeps = {},
): Promise<GmailMessageContent> {
  const gmail = await getGmailReader(userId, deps);
  const { data } = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });

  const headers = data.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  const plain: string[] = [];
  const html: string[] = [];
  const pendingAttachments: Array<{ part: GmailMessagePart; filename: string }> = [];
  const walk = (part: GmailMessagePart | null | undefined) => {
    if (!part) return;
    const mime = (part.mimeType ?? "").toLowerCase();
    const filename = part.filename?.trim() ?? "";
    if (filename) {
      pendingAttachments.push({ part, filename });
    } else if (mime === "text/plain" && part.body?.data) {
      plain.push(decodeBase64Url(part.body.data).toString("utf-8"));
    } else if (mime === "text/html" && part.body?.data) {
      html.push(decodeBase64Url(part.body.data).toString("utf-8"));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(data.payload);

  const attachments: GmailAttachment[] = [];
  for (const { part, filename } of pendingAttachments) {
    const size = part.body?.size ?? 0;
    const mimeType = (part.mimeType ?? "application/octet-stream").toLowerCase();
    if (size > ATTACHMENT_MAX_BYTES) {
      attachments.push({ filename, mimeType, size, data: null });
      continue;
    }
    let raw = part.body?.data ?? null;
    if (!raw && part.body?.attachmentId) {
      const res = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: part.body.attachmentId,
      });
      raw = res.data.data ?? null;
    }
    attachments.push({ filename, mimeType, size, data: raw ? decodeBase64Url(raw) : null });
  }

  const internal = Number(data.internalDate ?? "");
  return {
    messageId: data.id ?? messageId,
    threadId: data.threadId ?? "",
    labelIds: data.labelIds ?? [],
    date: Number.isFinite(internal) && internal > 0 ? new Date(internal) : new Date(),
    from: header("From"),
    subject: header("Subject"),
    bodyText: plain.length ? plain.join("\n").trim() : htmlToText(html.join("\n")),
    attachments,
  };
}

// ── MIME 构建 ───────────────────────────────────────────────

/** 头字段值：去掉换行（防头注入），空串 → undefined */
function headerSafe(v: string | undefined): string | undefined {
  const t = v?.replace(/[\r\n]+/g, " ").trim();
  return t ? t : undefined;
}

export function buildRawEmail(params: SendEmailParams): string {
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: ${params.contentType === "text" ? "text/plain" : "text/html"}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
  ];

  if (params.replyTo) {
    lines.push(`Reply-To: ${params.replyTo}`);
  }
  const inReplyTo = headerSafe(params.inReplyTo);
  const references = headerSafe(params.references) ?? inReplyTo;
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);

  lines.push("", Buffer.from(params.body).toString("base64"));

  const raw = lines.join("\r\n");
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
