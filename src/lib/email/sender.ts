/**
 * 统一邮件发送服务
 *
 * 用销售自己绑定的 SMTP 邮箱发信，
 * 收信人直接看到的是销售的个人邮箱。
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db } from "@/lib/db";
import { decryptField } from "@/lib/crypto";
import { getEmailProvider, sendGmail } from "@/lib/google-email";

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

  const transport = createTransport({
    ...binding,
    smtpPass: decryptField(binding.smtpPass || ""),
  });

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
 * 用销售账号的邮箱发信 —— 统一入口
 *
 * 渠道优先级：
 *  1. Gmail OAuth（EmailProvider, type=gmail）—— 一键授权，用 Gmail API 发
 *  2. SMTP 绑定（EmailBinding）—— 老的 App Password 模式，非 Gmail 账号的兜底
 *
 * 两者都没绑定时返回明确错误，提示用户去设置页绑定。
 */
export async function sendSalesEmail(
  userId: string,
  opts: SendMailOptions,
): Promise<SendResult & { channel?: "gmail_oauth" | "smtp" }> {
  // —— 1. 优先使用 Gmail OAuth 一键授权通道 ——
  const provider = await getEmailProvider(userId);
  if (provider && provider.accessToken) {
    try {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const fromName = user?.name?.trim() || provider.accountEmail;
      const fromEmail = provider.accountEmail;
      const { messageId } = await sendGmail(userId, {
        to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
        from: `"${fromName}" <${fromEmail}>`,
        subject: opts.subject,
        body: opts.html,
        replyTo: opts.replyTo || fromEmail,
      });
      return { success: true, messageId, channel: "gmail_oauth" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gmail 发送失败";
      // Gmail 授权失效 / token 过期等情况：回落到 SMTP（若有绑定）
      console.error("[sendSalesEmail] Gmail OAuth failed, falling back to SMTP:", msg);
    }
  }

  // —— 2. 回落到 SMTP 绑定 ——
  const binding = await db.emailBinding.findUnique({ where: { userId } });
  if (binding && binding.verified) {
    const result = await sendMailAs(userId, opts);
    return { ...result, channel: "smtp" };
  }

  return {
    success: false,
    error: provider
      ? "Gmail 授权已失效且未配置 SMTP 兜底，请到设置页重新连接 Google 邮箱"
      : "尚未绑定发信邮箱，请先到『设置 → 邮箱绑定』连接 Google 或配置 SMTP",
  };
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
