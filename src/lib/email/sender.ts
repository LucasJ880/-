/**
 * 统一邮件发送服务
 *
 * 用销售自己绑定的 SMTP 邮箱发信，
 * 收信人直接看到的是销售的个人邮箱。
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db } from "@/lib/db";

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function createTransport(binding: {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPass: string | null;
  useTls: boolean;
}): Transporter {
  return nodemailer.createTransport({
    host: binding.smtpHost || "smtp.gmail.com",
    port: binding.smtpPort || 587,
    secure: (binding.smtpPort || 587) === 465,
    auth: {
      user: binding.smtpUser || "",
      pass: binding.smtpPass || "",
    },
    tls: binding.useTls ? { rejectUnauthorized: false } : undefined,
  });
}

/**
 * 用指定用户的绑定邮箱发送邮件
 */
export async function sendMailAs(userId: string, opts: SendMailOptions): Promise<SendResult> {
  const binding = await db.emailBinding.findUnique({ where: { userId } });
  if (!binding || !binding.verified) {
    return { success: false, error: "邮箱未绑定或未验证" };
  }

  const transport = createTransport(binding);

  try {
    const info = await transport.sendMail({
      from: `"${binding.displayName}" <${binding.email}>`,
      to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      replyTo: opts.replyTo || binding.email,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });

    await db.emailBinding.update({
      where: { userId },
      data: { lastSentAt: new Date(), lastError: null },
    });

    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    const errorMsg = err?.message || "发送失败";
    await db.emailBinding.update({
      where: { userId },
      data: { lastError: errorMsg },
    }).catch(() => {});

    return { success: false, error: errorMsg };
  }
}

/**
 * 验证 SMTP 连接是否可用
 */
export async function verifySMTP(config: {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  useTls: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const transport = createTransport(config);
  try {
    await transport.verify();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "SMTP 连接失败" };
  }
}
