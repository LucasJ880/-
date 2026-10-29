/**
 * Trade 外贸获客 — 邮件发送服务
 *
 * 使用 Resend 发送开发信和跟进邮件
 * 需要配置 RESEND_API_KEY 和 RESEND_FROM_EMAIL
 */

import { Resend } from "resend";

let _client: Resend | null = null;

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[trade/email] RESEND_API_KEY not set");
    return null;
  }
  if (!_client) {
    _client = new Resend(process.env.RESEND_API_KEY);
  }
  return _client;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  /** 有就同时发 HTML 版（body 仍作为纯文本部分） */
  html?: string;
  replyTo?: string;
  from?: string;
  /** 抄送（收件人可见）；不传或空数组时不带 */
  cc?: string[];
  bcc?: string[];
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  /** Resend 错误名（如 validation_error），用于区分"发件域名未验证"与其它失败 */
  errorName?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client = getClient();
  if (!client) {
    return { success: false, error: "RESEND_API_KEY 未配置" };
  }

  const from = input.from ?? process.env.RESEND_FROM_EMAIL ?? "noreply@qingyan.ai";

  try {
    const { data, error } = await client.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.body,
      ...(input.html ? { html: input.html } : {}),
      replyTo: input.replyTo,
      ...(input.cc?.length ? { cc: input.cc } : {}),
      ...(input.bcc?.length ? { bcc: input.bcc } : {}),
    });

    if (error) {
      return { success: false, error: error.message, errorName: error.name };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "发送失败",
    };
  }
}

export type ResendDomainStatus = "verified" | "pending" | "failed" | "not_started" | "not_added" | "no_resend" | "unknown";

/** 平台 Resend 账号里某个发件域名的验证状态（只读；发送权限受限的 key 读不到时返回 unknown） */
export async function getResendDomainStatus(domain: string): Promise<ResendDomainStatus> {
  const client = getClient();
  if (!client) return "no_resend";
  try {
    const { data, error } = await client.domains.list();
    if (error || !data) return "unknown";
    const row = data.data.find((d) => d.name.toLowerCase() === domain.toLowerCase());
    if (!row) return "not_added";
    if (row.status === "temporary_failure") return "pending";
    return row.status;
  } catch {
    return "unknown";
  }
}
