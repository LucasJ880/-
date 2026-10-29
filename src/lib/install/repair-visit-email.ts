/**
 * INSTALL-2j：返修时间确认邮件（纯函数）
 *
 * - 英文；首次排期 / 改期两种主题；正文与 HTML 同一份内容；同样输入得到同样邮件
 * - 只用对客户安全的字段（design D3）：客户名、单号、工艺单号、地址、企业时区的日期与到达时间段、
 *   各行位置 + 问题类型英文说明、报修联系方式；不含金额、备注、问题描述原文、照片、出单、员工姓名
 * - 联系方式取质保设置 contact（2g 起有种子）
 */

import type { IssueType } from "./repair";
import type { WarrantyContact } from "./warranty";

export const REPAIR_VISIT_EMAIL_ACTION_TYPE = "install.send_repair_visit_email" as const;
export const INSTALL_REPAIR_VISIT_EMAIL_SENT = "install.repair_visit_email.sent" as const;

/** 问题类型的对客户说明（不带"客户原因"等内部归因） */
export const ISSUE_TYPE_LABEL_EN: Record<IssueType, string> = {
  wrong_size: "Size adjustment / remake",
  missing_parts: "Missing parts",
  damaged: "Damaged product repair / replacement",
  wrong_color: "Colour / fabric correction",
  motor: "Motor / remote / charging",
  site_condition: "Site follow-up",
  customer: "Follow-up visit",
  other: "Adjustment",
};

// 新版 ICU 在 "10:00 AM" 中间用窄不换行空格，邮件与测试统一成普通空格
const plain = (s: string) => s.replace(/[  ]/g, " ");

/** 企业时区的长日期：Thursday, November 5, 2026 */
export function formatVisitDate(iso: string, timeZone: string): string {
  return plain(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(iso)));
}

/** 企业时区的 12 小时制时间：10:00 AM */
export function formatVisitTime(iso: string, timeZone: string): string {
  return plain(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)));
}

export type RepairVisitEmailInput = {
  repairNo: string;
  orderCode: string;
  customerName: string;
  address: string | null;
  startAt: string;
  endAt: string;
  timeZone: string;
  rows: Array<{ location: string; itemNumber: number; issueType: IssueType }>;
  contact: WarrantyContact;
  /** 该维修单此前已有发送记录（任一时间）→ 改期主题 */
  rescheduled: boolean;
};

export type RepairVisitEmail = { subject: string; text: string; html: string };

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[A-Za-z]{2,}$/;

/** 生成条件（spec「返修时间确认邮件的生成」）：返回全部原因；空数组 = 可生成 */
export function repairVisitEmailBlockers(input: { customerEmail: string | null | undefined; contact: WarrantyContact }): string[] {
  const out: string[] = [];
  const email = (input.customerEmail ?? "").trim();
  if (!email) out.push("客户没有邮箱");
  else if (!EMAIL_RE.test(email)) out.push(`客户邮箱格式不对：${email}`);
  if (!input.contact.phone) out.push("缺报修电话");
  if (!input.contact.email) out.push("缺报修邮箱");
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 确定性渲染（spec「返修时间确认邮件内容」）；调用方须先确认 repairVisitEmailBlockers 为空 */
export function renderRepairVisitEmail(input: RepairVisitEmailInput): RepairVisitEmail {
  const c = input.contact;
  const date = formatVisitDate(input.startAt, input.timeZone);
  const arrival = `${formatVisitTime(input.startAt, input.timeZone)} – ${formatVisitTime(input.endAt, input.timeZone)}`;
  const address = (input.address ?? "").trim() || "—";
  const subject = input.rescheduled
    ? `Your repair visit has been rescheduled — ${date} (Repair ${input.repairNo})`
    : `Your repair visit is scheduled — ${date} (Repair ${input.repairNo})`;
  const intro = input.rescheduled
    ? "Your repair visit has been rescheduled. Here are the new details:"
    : "We've scheduled a visit to take care of the items below.";
  const items = [...input.rows]
    .sort((a, b) => a.itemNumber - b.itemNumber)
    .map((r) => `${r.location || `Item ${r.itemNumber}`} — ${ISSUE_TYPE_LABEL_EN[r.issueType]}`);
  const change = `If this time doesn't work for you, please call ${c.phone} or email ${c.email} and we'll find a better time.`;

  const text = [
    `Hi ${input.customerName},`,
    "",
    intro,
    "",
    "REPAIR VISIT",
    `  Date:        ${date}`,
    `  Arrival:     ${arrival}`,
    `  Address:     ${address}`,
    `  Repair No.:  ${input.repairNo}`,
    `  Order No.:   ${input.orderCode}`,
    "",
    "WHAT WE'LL TAKE CARE OF",
    ...items.map((t, i) => `  ${i + 1}. ${t}`),
    "",
    "Please make sure someone is home and the windows are accessible.",
    change,
    "",
    "Thank you,",
    c.companyName,
    ...(c.address ? [c.address] : []),
    `${c.phone} · ${c.email}`,
  ].join("\n");

  const row = (k: string, v: string) =>
    `<tr><td style="padding:2px 16px 2px 0;color:#6b6b6b;white-space:nowrap;">${esc(k)}</td><td style="padding:2px 0;">${esc(v)}</td></tr>`;
  const h2 = (s: string) => `<h2 style="margin:20px 0 8px;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:#2e5e4e;">${esc(s)}</h2>`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f4ef;font-family:'Helvetica Neue',Arial,sans-serif;color:#1c1c1c;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f4ef;padding:24px 12px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e8e3d9;border-radius:6px;">
<tr><td style="padding:24px 28px 8px;border-bottom:3px solid #2e5e4e;"><div style="font-size:20px;font-weight:700;color:#2e5e4e;">${esc(c.companyName)}</div><div style="margin-top:4px;font-size:13px;color:#6b6b6b;">${input.rescheduled ? "Repair visit rescheduled" : "Repair visit confirmation"}</div></td></tr>
<tr><td style="padding:16px 28px 28px;font-size:14px;line-height:1.6;">
<p style="margin:0 0 12px;">Hi ${esc(input.customerName)},</p>
<p style="margin:0 0 12px;">${esc(intro)}</p>
${h2("Repair visit")}
<table cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">${row("Date", date)}${row("Arrival", arrival)}${row("Address", address)}${row("Repair No.", input.repairNo)}${row("Order No.", input.orderCode)}</table>
${h2("What we'll take care of")}
<ol style="margin:0;padding-left:20px;">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
<p style="margin:16px 0 6px;">Please make sure someone is home and the windows are accessible.</p>
<p style="margin:0;">${esc(change)}</p>
<p style="margin:20px 0 0;">Thank you,</p>
</td></tr>
<tr><td style="padding:16px 28px;background:#faf8f3;border-top:1px solid #e8e3d9;font-size:12px;color:#6b6b6b;">${esc(c.companyName)}${c.address ? ` · ${esc(c.address)}` : ""}<br>${esc(c.phone)} · ${esc(c.email)}</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
