/**
 * 协作通知 COLLAB-2：发信层（design D16，spec notifications/email-reminders）
 *
 * 升级邮件与每日汇总共用：
 * - 收件地址只取收件人的青砚账号邮箱（User.email），过滤占位域名与保留域名；
 * - 发件人是平台发件地址，显示名"青砚"；不读组织的发件设置，不经邮箱授权通道；
 * - 非生产且没开 QINGYAN_ALLOW_REAL_EMAIL_NON_PROD 时只记一条日志（收件人 id 与主题），按已发处理；
 * - 链接根地址只用 NEXT_PUBLIC_APP_URL；真发环境缺它或 RESEND_API_KEY 时由调用方整轮跳过；
 * - 主题、正文与事项行按 spec 拼，每段文字发信时再脱敏一次（其他功能的通知标题也在这里脱敏）。
 * 纯函数为主；发送函数从参数注入，便于测试。
 */

import { isRealEmailSendAllowed } from "@/lib/env/runtime-isolation";
import { renderPlainEmailHtml, type EmailBrand } from "@/lib/revenue-spine/email-layout";
import { sendEmail } from "@/lib/trade/email";
import { platformFromAddress } from "@/lib/trade/email-sender";
import { notificationTypeLabel } from "@/lib/notifications/constants";
import { notificationHref, type NotificationLinkTarget } from "@/lib/notifications/href";
import { formatLocalDate } from "./events";
import { redactText } from "./redact";

export const EMAIL_FOOTER =
  "这封邮件由青砚自动发出，只发到你的青砚账号邮箱。不想再收：青砚 → 设置 → 通知，关闭「未读提醒与每日汇总邮件」。";
/** 主题里的对象超过这么多个字符就截断 */
export const EMAIL_SUBJECT_OBJECT_MAX = 40;
const EMAIL_BRAND: EmailBrand = { orgName: "青砚", accent: "#2F5D50" };
const NOTIFICATIONS_PATH = "/notifications";

// ── 收件地址 ──────────────────────────────────────────────────

/** 占位域名：微信注册的 wx_…@wechat.user、系统账号 system@qingyan.internal */
const PLACEHOLDER_DOMAINS = new Set(["wechat.user", "qingyan.internal"]);
const RESERVED_SUFFIXES = [".local", ".internal", ".invalid", ".test", ".example", ".localhost"];
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isDeliverableAddress(email: string | null | undefined): boolean {
  const value = (email ?? "").trim().toLowerCase();
  if (!EMAIL_FORMAT.test(value)) return false;
  const domain = value.slice(value.lastIndexOf("@") + 1);
  if (PLACEHOLDER_DOMAINS.has(domain)) return false;
  return !RESERVED_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}

// ── 发信配置 ──────────────────────────────────────────────────

export interface MailConfig {
  /** 生产，或已开 QINGYAN_ALLOW_REAL_EMAIL_NON_PROD 的非生产 */
  realSend: boolean;
  /** 站点根地址（NEXT_PUBLIC_APP_URL 规范化后）；只记日志的环境没设时为空串，链接不出站 */
  origin: string;
  /** 真发环境缺少的配置；非空时整轮跳过 */
  missingEnv: string[];
}

/** NEXT_PUBLIC_APP_URL → 站点根地址（只认 http / https）；无效视为缺失 */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function resolveMailConfig(
  env: NodeJS.ProcessEnv = process.env,
  realSend: boolean = isRealEmailSendAllowed(env),
): MailConfig {
  const origin = normalizeOrigin(env.NEXT_PUBLIC_APP_URL);
  const missingEnv: string[] = [];
  if (realSend) {
    if (!env.RESEND_API_KEY?.trim()) missingEnv.push("RESEND_API_KEY");
    if (!origin) missingEnv.push("NEXT_PUBLIC_APP_URL");
  }
  return { realSend, origin: origin ?? "", missingEnv };
}

// ── 通知 → 事项 ────────────────────────────────────────────────

/** Notification.metadata（JSON 文本）→ 对象；空 → {}；不是 JSON 对象 → null（调用方不处理、不覆盖） */
export function parseMetadataObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw == null || raw === "") return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface MailNotification extends NotificationLinkTarget {
  type: string;
  title: string;
  summary: string | null;
  orgId: string | null;
  metadata: Record<string, unknown>;
}

export interface MailItemContext {
  origin: string;
  /** 通知所属组织的时区；没有组织或没设时为 America/Toronto（由调用方给） */
  timeZone: string;
  /** entityType = task 的通知：任务当前的截止时间（每轮批量查一次） */
  taskDueDates: ReadonlyMap<string, Date | null>;
}

export interface MailItem {
  typeLabel: string;
  object: string;
  dueDate: string | null;
  link: string;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** 绝对链接：站点根地址 + 共用跳转表；没有跳转目标时回落通知页 */
export function notificationLink(origin: string, target: NotificationLinkTarget): string {
  return `${origin}${notificationHref(target) ?? NOTIFICATIONS_PATH}`;
}

export function notificationsPageLink(origin: string): string {
  return `${origin}${NOTIFICATIONS_PATH}`;
}

/** 对象：协作通知写入时算好的 objectLabel，其他通知用标题；发信时再脱敏一次 */
export function notificationObject(n: { title: string; metadata: Record<string, unknown> }): string {
  const label = typeof n.metadata.objectLabel === "string" ? n.metadata.objectLabel.trim() : "";
  return oneLine(redactText(label || n.title));
}

function validDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 截止日期：metadata.dueAt；没有时，任务通知取任务当前的截止时间；按通知所属组织的时区取日期 */
export function notificationDueDate(
  n: { entityType?: string | null; entityId?: string | null; metadata: Record<string, unknown> },
  ctx: Pick<MailItemContext, "timeZone" | "taskDueDates">,
): string | null {
  const due =
    validDate(n.metadata.dueAt) ??
    (n.entityType === "task" && n.entityId ? (ctx.taskDueDates.get(n.entityId) ?? null) : null);
  return due ? formatLocalDate(due, ctx.timeZone) : null;
}

export function buildMailItem(n: MailNotification, ctx: MailItemContext): MailItem {
  return {
    typeLabel: notificationTypeLabel(n.type),
    object: notificationObject(n),
    dueDate: notificationDueDate(n, ctx),
    link: notificationLink(ctx.origin, n),
  };
}

const noPipe = (text: string) => oneLine(text).replace(/｜/g, "/");

/** 事项行：`{类型名}｜{对象}｜截止 {YYYY-MM-DD}｜{链接}`；没有截止省略第三段；文字里原有的｜换成 / */
export function itemLine(item: MailItem): string {
  const parts = [noPipe(item.typeLabel), noPipe(item.object)];
  if (item.dueDate) parts.push(`截止 ${item.dueDate}`);
  parts.push(item.link);
  return parts.join("｜");
}

// ── 邮件 ──────────────────────────────────────────────────────

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

/** 纯文本按空行分段；HTML 用同一份文字套简单外框，内容相同 */
export function renderMail(subject: string, paragraphs: ReadonlyArray<string | null | undefined>): RenderedMail {
  const text = paragraphs.filter((p): p is string => !!p).join("\n\n");
  return { subject, text, html: renderPlainEmailHtml({ subject, body: text }, EMAIL_BRAND) };
}

/** 升级邮件：主题 `【青砚】{类型名} · {对象}`；正文为标题、摘要（没有则省略）、事项行、打开链接、页脚 */
export function escalationMail(n: { title: string; summary: string | null }, item: MailItem): RenderedMail {
  const object = Array.from(item.object).slice(0, EMAIL_SUBJECT_OBJECT_MAX).join("");
  return renderMail(`【青砚】${item.typeLabel} · ${object}`, [
    oneLine(redactText(n.title)),
    n.summary ? oneLine(redactText(n.summary)) : null,
    itemLine(item),
    `在青砚打开：${item.link}`,
    EMAIL_FOOTER,
  ]);
}

// ── 发送 ──────────────────────────────────────────────────────

export interface OutgoingMail extends RenderedMail {
  /** 收件人 id（只记日志时只记它与主题） */
  userId: string;
  /** 收件人的青砚账号邮箱 */
  to: string;
}

export interface MailDeps {
  send(mail: OutgoingMail): Promise<{ ok: boolean; error?: string }>;
  log(message: string): void;
}

export type MailOutcome = { status: "sent" } | { status: "dry_run" } | { status: "failed"; error: string };

const ERROR_MAX = 500;

/** 不向外抛错：发信服务失败或抛错都返回 failed */
export async function deliverMail(mail: OutgoingMail, realSend: boolean, deps: MailDeps): Promise<MailOutcome> {
  if (!realSend) {
    deps.log(`[collab-email] 非生产只记日志，未发送：收件人 ${mail.userId}，主题「${mail.subject}」`);
    return { status: "dry_run" };
  }
  try {
    const result = await deps.send(mail);
    return result.ok ? { status: "sent" } : { status: "failed", error: (result.error || "发送失败").slice(0, ERROR_MAX) };
  } catch (err) {
    return { status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX) };
  }
}

export const defaultMailDeps: MailDeps = {
  async send(mail) {
    const result = await sendEmail({
      from: `青砚 <${platformFromAddress()}>`,
      to: mail.to,
      subject: mail.subject,
      body: mail.text,
      html: mail.html,
    });
    return result.success ? { ok: true } : { ok: false, error: result.error ?? "发送失败" };
  },
  log(message) {
    console.log(message);
  },
};
