/**
 * 青砚邮件模块 — Gmail OAuth 授权 + 发送封装
 *
 * ## 设计决策：独立 Email OAuth flow
 *
 * 当前采用独立于 CalendarProvider 的 EmailProvider 进行 OAuth 授权。
 * 原因：
 * 1. 产品实现隔离 — 日历与邮件是两个独立功能模块，用户可能只启用其一，
 *    独立授权可以让用户精确控制自己授予的权限范围。
 * 2. 作用域最小化 — Email 仅需 gmail.send + userinfo.email，
 *    Calendar 需要 calendar.events + calendar.readonly，两者互不依赖。
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
 * 3. 如果将来合并为统一 Provider，只需切换为 include_granted_scopes=true
 *    并合并表即可，当前设计不阻碍迁移。
 */

import { google } from "googleapis";
import { db } from "@/lib/db";
import { encryptField, decryptField } from "@/lib/crypto";

// ── Scopes ──────────────────────────────────────────────────

const EMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

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

export function getEmailAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: EMAIL_SCOPES,
    // 见文件顶部注释：独立 flow，不合并已有 scope
    include_granted_scopes: false,
  });
}

// ── OAuth Callback ──────────────────────────────────────────

export async function handleEmailCallback(code: string, userId: string) {
  const { redirectUri } = getEmailOAuthEnv();
  if (!redirectUri) {
    throw new Error("GOOGLE_EMAIL_REDIRECT_URI is not set");
  }

  const client = getOAuth2Client();
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: userInfo } = await oauth2.userinfo.get();

  const grantedScopes = tokens.scope ?? EMAIL_SCOPES.join(" ");

  const providerData = {
    type: "gmail" as const,
    accessToken: encryptField(tokens.access_token ?? ""),
    refreshToken: tokens.refresh_token ? encryptField(tokens.refresh_token) : null,
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    accountEmail: userInfo.email ?? "",
    grantedScopes,
  };

  const existing = await db.emailProvider.findUnique({
    where: { userId_type: { userId, type: "gmail" } },
  });

  if (existing) {
    await db.emailProvider.update({
      where: { id: existing.id },
      data: providerData,
    });
  } else {
    await db.emailProvider.create({
      data: { ...providerData, userId },
    });
  }

  return { email: userInfo.email };
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
    refresh_token: provider.refreshToken ? decryptField(provider.refreshToken) : undefined,
    expiry_date: provider.tokenExpiry?.getTime(),
  });

  client.on("tokens", async (tokens) => {
    await db.emailProvider.update({
      where: { id: provider.id },
      data: {
        accessToken: tokens.access_token ? encryptField(tokens.access_token) : undefined,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
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
}

/**
 * 通过 Gmail API 发送邮件。
 *
 * gmail.send scope 说明：
 * 这是 Google 的 restricted scope，要求：
 * - 应用需在 Google Workspace 管理员配置中被信任（内部应用 / OAuth 同意屏幕配置）
 * - 对于组织内使用，Workspace 管理员可在 Admin Console → Security → API controls
 *   → App access control 中将应用标记为"Trusted"
 * - 无需通过 Google 第三方安全评估（仅限组织内部使用场景）
 */
export async function sendGmail(
  userId: string,
  params: SendEmailParams
): Promise<{ messageId: string }> {
  const provider = await getEmailProvider(userId);
  if (!provider) {
    throw new Error("用户未绑定 Gmail 邮件服务");
  }

  const client = await getAuthedGmailClient(provider);
  const gmail = google.gmail({ version: "v1", auth: client });

  const rawMessage = buildRawEmail(params);

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: rawMessage },
  });

  return { messageId: res.data.id ?? "" };
}

// ── MIME 构建 ───────────────────────────────────────────────

function buildRawEmail(params: SendEmailParams): string {
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];

  if (params.replyTo) {
    lines.push(`Reply-To: ${params.replyTo}`);
  }

  lines.push("", Buffer.from(params.body).toString("base64"));

  const raw = lines.join("\r\n");
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
