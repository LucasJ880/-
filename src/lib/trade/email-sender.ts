/**
 * 组织发件身份 — 批准后的询盘 / 展会跟进邮件以谁的名义发出（OrgBusinessRule：trade.email_sender，按版本发布）
 *
 * 配置了发件身份的组织：跟进邮件一律经平台 Resend 以组织身份发出，不用审批人的个人 Gmail
 * （个人 Gmail 按用户绑定、跨组织共用，会把梦馨的邮件从审批人另一家公司的邮箱发出去）。
 * 发件域名还没在平台 Resend 验证时：用平台地址代发，显示名、回复地址、密送仍是组织的，买家回信不丢。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sendEmail, type SendEmailInput, type SendEmailResult } from "./email";

export const RULE_KEY_EMAIL_SENDER = "trade.email_sender";

export interface OrgEmailSender {
  /** 收件人看到的发件人名称，如 "Cathy | Mengxin Home Textile" */
  fromName: string;
  /** 组织自己的发件地址；域名须在平台 Resend 验证，未验证时自动用平台地址代发 */
  fromEmail: string | null;
  /** 买家点「回复」时的收件地址；空 = 发件地址 */
  replyTo: string | null;
  /** 每封都密送一份（留底） */
  bcc: string[];
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[A-Za-z]{2,}$/;
const MAX_BCC = 3;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 校验页面提交的发件设置；bcc 可以是数组或逗号分隔的字符串 */
export function parseOrgEmailSender(input: unknown): { sender: OrgEmailSender | null; errors: string[] } {
  const o = (input ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const fromName = str(o.fromName).replace(/\s+/g, " ");
  const fromEmail = str(o.fromEmail).toLowerCase();
  const replyTo = str(o.replyTo).toLowerCase();
  const bccRaw = Array.isArray(o.bcc) ? o.bcc.map(str) : str(o.bcc).split(/[,，;；\s]+/);
  const bcc = [...new Set(bccRaw.map((b) => b.toLowerCase()).filter(Boolean))];

  if (!fromName) errors.push("请填发件人名称");
  else if (fromName.length > 80 || /["<>\r\n]/.test(fromName)) errors.push("发件人名称不能超过 80 个字，也不能含引号或尖括号");
  if (fromEmail && !EMAIL_RE.test(fromEmail)) errors.push(`发件地址格式不对：${fromEmail}`);
  if (replyTo && !EMAIL_RE.test(replyTo)) errors.push(`回复地址格式不对：${replyTo}`);
  if (!fromEmail && !replyTo) errors.push("发件地址和回复地址至少填一个，否则买家的回信收不到");
  for (const b of bcc) if (!EMAIL_RE.test(b)) errors.push(`密送地址格式不对：${b}`);
  if (bcc.length > MAX_BCC) errors.push(`密送最多 ${MAX_BCC} 个`);

  if (errors.length) return { sender: null, errors };
  return { sender: { fromName, fromEmail: fromEmail || null, replyTo: replyTo || null, bcc }, errors };
}

function fromConfig(config: unknown): OrgEmailSender | null {
  const s = (config as { sender?: unknown } | null)?.sender;
  if (!s) return null;
  const { sender } = parseOrgEmailSender(s);
  return sender;
}

export async function loadOrgEmailSender(orgId: string): Promise<OrgEmailSender | null> {
  const row = await db.orgBusinessRule.findFirst({
    where: { orgId, ruleKey: RULE_KEY_EMAIL_SENDER, status: "active" },
    orderBy: { version: "desc" },
    select: { configJson: true },
  });
  return fromConfig(row?.configJson ?? null);
}

/** 发布新版本（旧 active → superseded）；sender = null 表示停用组织发件身份 */
export async function saveOrgEmailSender(orgId: string, sender: OrgEmailSender | null, userId: string | null): Promise<{ version: number }> {
  return db.$transaction(async (tx) => {
    const latest = await tx.orgBusinessRule.findFirst({
      where: { orgId, ruleKey: RULE_KEY_EMAIL_SENDER },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    await tx.orgBusinessRule.updateMany({
      where: { orgId, ruleKey: RULE_KEY_EMAIL_SENDER, status: "active" },
      data: { status: "superseded" },
    });
    await tx.orgBusinessRule.create({
      data: {
        orgId,
        ruleKey: RULE_KEY_EMAIL_SENDER,
        version,
        status: "active",
        configJson: { sender } as unknown as Prisma.InputJsonValue,
        createdById: userId,
        updatedById: userId,
      },
    });
    return { version };
  });
}

/** 平台发件地址（RESEND_FROM_EMAIL 可能写成 "Name <addr>"，只取地址） */
export function platformFromAddress(env: string | undefined = process.env.RESEND_FROM_EMAIL): string {
  const v = (env ?? "").trim();
  const m = /<([^>]+)>/.exec(v);
  return (m ? m[1] : v).trim() || "noreply@qingyan.ai";
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export interface OrgSendAttempt {
  from: string;
  replyTo: string | undefined;
  bcc: string[];
  /** 用平台地址代发（组织发件域名未验证） */
  fallback: boolean;
}

/** 发送顺序：先用组织自己的地址；不行再用平台地址代发（显示名、回复、密送不变） */
export function planOrgSend(sender: OrgEmailSender, platformFrom: string): OrgSendAttempt[] {
  const replyTo = sender.replyTo ?? sender.fromEmail ?? undefined;
  const attempts: OrgSendAttempt[] = [];
  if (sender.fromEmail) attempts.push({ from: `"${sender.fromName}" <${sender.fromEmail}>`, replyTo, bcc: sender.bcc, fallback: false });
  if (!sender.fromEmail || emailDomain(sender.fromEmail) !== emailDomain(platformFrom)) {
    attempts.push({ from: `"${sender.fromName}" <${platformFrom}>`, replyTo, bcc: sender.bcc, fallback: Boolean(sender.fromEmail) });
  }
  return attempts;
}

/** Resend 拒收发件地址（域名未验证 / 不允许的 from）——只有这种情况才改用平台地址重发 */
export function isSenderDomainError(r: { error?: string; errorName?: string }): boolean {
  const msg = (r.error ?? "").toLowerCase();
  return (
    r.errorName === "invalid_from_address" ||
    /domain[^.]*not verified|not verified[^.]*domain/.test(msg) ||
    (/\bfrom\b/.test(msg) && /invalid|not allowed/.test(msg))
  );
}

export type ResendTransport = (input: SendEmailInput) => Promise<SendEmailResult>;

/** 以组织身份发送；返回实际使用的发件人，供时间线和审计记录 */
export async function sendAsOrg(
  sender: OrgEmailSender,
  msg: { to: string; subject: string; body: string; html?: string; cc?: string[] },
  transport: ResendTransport = sendEmail,
  platformFrom: string = platformFromAddress(),
): Promise<{ messageId: string; from: string; fallback: boolean }> {
  const attempts = planOrgSend(sender, platformFrom);
  let last: SendEmailResult | null = null;
  for (const [i, a] of attempts.entries()) {
    const r = await transport({ ...msg, from: a.from, replyTo: a.replyTo, bcc: a.bcc });
    if (r.success) return { messageId: r.messageId ?? "", from: a.from, fallback: a.fallback };
    last = r;
    if (i < attempts.length - 1 && isSenderDomainError(r)) continue;
    break;
  }
  throw new Error(last?.error ?? "Resend 发送失败");
}

/**
 * 外贸邮件统一出口（收件箱回复、开发信、序列跟进）：组织设了发件身份就以组织身份发，否则沿用平台默认发件人。
 * 调用方显式给的 replyTo 优先。
 */
export async function sendTradeEmailForOrg(
  orgId: string,
  msg: { to: string; subject: string; body: string; replyTo?: string },
  transport: ResendTransport = sendEmail,
): Promise<SendEmailResult & { from?: string; fallback?: boolean }> {
  const sender = await loadOrgEmailSender(orgId);
  if (!sender) return transport(msg);
  const effective = msg.replyTo ? { ...sender, replyTo: msg.replyTo } : sender;
  try {
    const r = await sendAsOrg(effective, { to: msg.to, subject: msg.subject, body: msg.body }, transport);
    return { success: true, messageId: r.messageId, from: r.from, fallback: r.fallback };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "发送失败" };
  }
}
