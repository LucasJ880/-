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
  replyTo?: string;
  from?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
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
      replyTo: input.replyTo,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "发送失败",
    };
  }
}
