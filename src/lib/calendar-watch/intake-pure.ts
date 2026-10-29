/**
 * CAL-2 网站预约一键转入（OpenSpec change website-booking-intake）— 纯函数核心（零 DB、零网络）。
 *
 * - 待转入推导：CAL-1 账本 + 已转入 / 已忽略事件集合 → 列表
 * - 描述解析：通用规则给预填建议（网站插件格式未知，最终以销售确认的表单为准）
 * - 转入 / 忽略请求体校验
 */

import { getLocalTimeParts } from "@/lib/automation/local-time";
import { normalizePhone } from "@/lib/revenue-spine/normalize";
import { addDaysYmd } from "@/lib/sales/period/summary-pure";
import { isValidEmail } from "./pure";
import type { LedgerAfterData } from "./types";

export const INTAKE_WINDOW_DAYS = 7;
export const MAX_PENDING = 200;
export const CONVERT_ACTION = "calendar.website_booking.converted";
export const DISMISS_ACTION = "calendar.website_booking.dismissed";
export const CUSTOMER_SOURCE = "website_booking";
export const APPOINTMENT_TYPES = ["measure", "install", "revisit", "consultation"] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
const MAX_FIELD = 200;
const MAX_DESCRIPTION = 2000;

// ── 待转入推导 ──────────────────────────────────────────────────

export interface LedgerRow {
  createdAt: Date;
  data: LedgerAfterData;
}

export interface PendingBooking {
  eventId: string;
  calendarId: string;
  summary: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
}

/** 开始时间的组织当地日期（全天事件就是日期本身） */
function localStartDay(start: string, allDay: boolean, timezone: string): string | null {
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(start)) return start.slice(0, 10);
  const t = Date.parse(start);
  if (!Number.isFinite(t)) return null;
  return getLocalTimeParts(new Date(t), timezone).date;
}

/** 时间窗起点：组织当地今天前 N 天 */
export function intakeWindowStart(now: Date, timezone: string, days = INTAKE_WINDOW_DAYS): string {
  return addDaysYmd(getLocalTimeParts(now, timezone).date, -days);
}

/**
 * 网站新建 = 该事件最早一条账本是新建且归因网站；排除最近一条为删除、已转入、已忽略、开始早于时间窗起点的；
 * 按事件 ID 跨日历去重（取最近一条账本的日历与标题）；按开始时间升序，最多 limit 条。
 */
export function derivePendingBookings(input: {
  rows: readonly LedgerRow[];
  convertedEventIds: ReadonlySet<string>;
  dismissedEventIds: ReadonlySet<string>;
  windowStart: string;
  timezone: string;
  limit?: number;
}): PendingBooking[] {
  const groups = new Map<string, LedgerRow[]>();
  for (const r of input.rows) {
    const g = groups.get(r.data.eventId);
    if (g) g.push(r);
    else groups.set(r.data.eventId, [r]);
  }
  const out: Array<PendingBooking & { sortKey: number }> = [];
  for (const [eventId, g] of groups) {
    g.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const first = g[0].data;
    const latest = g[g.length - 1].data;
    if (first.kind !== "created" || first.attribution.source !== "website") continue;
    if (latest.kind === "cancelled") continue;
    if (input.convertedEventIds.has(eventId) || input.dismissedEventIds.has(eventId)) continue;
    const start = latest.start ?? first.start;
    if (!start) continue;
    const allDay = latest.start ? latest.allDay : first.allDay;
    const day = localStartDay(start, allDay, input.timezone);
    if (!day || day < input.windowStart) continue;
    const sortKey = allDay ? Date.parse(`${day}T00:00:00Z`) : Date.parse(start);
    out.push({
      eventId,
      calendarId: latest.calendarId,
      summary: latest.summary ?? first.summary,
      start,
      end: latest.start ? latest.end : first.end,
      allDay,
      sortKey,
    });
  }
  out.sort((a, b) => a.sortKey - b.sortKey || a.eventId.localeCompare(b.eventId));
  return out.slice(0, input.limit ?? MAX_PENDING).map(({ sortKey: _k, ...b }) => {
    void _k;
    return b;
  });
}

// ── 描述解析 ────────────────────────────────────────────────────

export interface BookingPrefill {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

const LABELS: Record<keyof BookingPrefill, readonly string[]> = {
  name: ["name", "full name", "your name", "customer", "customer name", "client", "client name", "contact", "contact name", "姓名", "客户", "客户姓名", "名字", "联系人"],
  phone: ["phone", "phone number", "tel", "telephone", "mobile", "cell", "cell phone", "电话", "手机", "联系电话", "手机号"],
  email: ["email", "e-mail", "email address", "邮箱", "电子邮件", "电子邮箱"],
  address: ["address", "location", "service address", "home address", "地址", "服务地址", "上门地址"],
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const NA_PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

/** 去掉 HTML 标签与常见实体（Google 描述常含 <br>） */
export function stripHtml(s: string): string {
  return s
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function clip(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? [...t].slice(0, MAX_FIELD).join("") : null;
}

/** 标签行优先；无标签时用邮箱与北美电话正则；地址缺失用事件地点；姓名不猜 */
export function parseBookingDescription(description: string | null, location: string | null): BookingPrefill {
  const out: BookingPrefill = { name: null, phone: null, email: null, address: null };
  const text = stripHtml(description ?? "");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*•]\s*)?([A-Za-z一-龥][A-Za-z一-龥 ._-]{0,29}?)\s*[:：]\s*(.+?)\s*$/);
    if (!m) continue;
    const label = m[1].trim().toLowerCase();
    for (const key of Object.keys(LABELS) as Array<keyof BookingPrefill>) {
      if (!out[key] && LABELS[key].includes(label)) out[key] = clip(m[2]);
    }
  }
  if (!out.email) out.email = clip(text.match(EMAIL_RE)?.[0]);
  if (!out.phone) out.phone = clip(text.match(NA_PHONE_RE)?.[0]);
  if (out.email && !EMAIL_RE.test(out.email)) out.email = null;
  if (!out.address) out.address = clip(location);
  return out;
}

/** 电话末 10 位比对（容下 +1 前缀）；任一边无有效号码不算相同 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  return Boolean(x && y && x === y);
}

// ── 请求体校验 ──────────────────────────────────────────────────

export type ConvertCustomer =
  | { kind: "existing"; customerId: string }
  | { kind: "new"; name: string; phone: string | null; email: string | null; address: string | null };

export interface ConvertInput {
  calendarId: string;
  customer: ConvertCustomer;
  appointment: {
    type: AppointmentType;
    title: string;
    startAt: string | null;
    endAt: string | null;
    address: string | null;
    contactPhone: string | null;
    description: string | null;
    assignedToId: string | null;
  };
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function optText(v: unknown, max = MAX_FIELD): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if ([...t].length > max) return undefined;
  return t || null;
}

function optIso(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) return undefined;
  return v;
}

/** 客户二选一（关联已有 / 新建）；预约类型、标题、时间、负责人（须为在职成员） */
export function validateConvertInput(
  body: unknown,
  ctx: { activeMemberIds: ReadonlySet<string> },
): { ok: true; value: ConvertInput } | { ok: false; message: string } {
  const b = obj(body);
  if (!b) return { ok: false, message: "请求体必须是对象" };
  if (typeof b.calendarId !== "string" || !b.calendarId.trim()) return { ok: false, message: "calendarId 必填" };

  const c = obj(b.customer);
  if (!c) return { ok: false, message: "customer 必填" };
  let customer: ConvertCustomer;
  if (typeof c.existingCustomerId === "string" && c.existingCustomerId) {
    if (c.name !== undefined) return { ok: false, message: "关联已有客户时不要同时填写新客户信息" };
    customer = { kind: "existing", customerId: c.existingCustomerId };
  } else {
    const name = optText(c.name, 100);
    const phone = optText(c.phone, 50);
    const email = optText(c.email);
    const address = optText(c.address, 500);
    if (!name) return { ok: false, message: "新客户姓名必填（1–100 字）" };
    if (phone === undefined || address === undefined || email === undefined) return { ok: false, message: "客户字段格式不对" };
    if (email && !isValidEmail(email)) return { ok: false, message: "邮箱格式不对" };
    customer = { kind: "new", name, phone, email, address };
  }

  const a = obj(b.appointment) ?? {};
  const type = a.type === undefined ? "measure" : a.type;
  if (typeof type !== "string" || !(APPOINTMENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, message: "预约类型只能是 measure / install / revisit / consultation" };
  }
  const title = optText(a.title);
  const startAt = optIso(a.startAt);
  const endAt = optIso(a.endAt);
  const address = optText(a.address, 500);
  const contactPhone = optText(a.contactPhone, 50);
  const description = optText(a.description, MAX_DESCRIPTION);
  if (title === undefined || startAt === undefined || endAt === undefined || address === undefined || contactPhone === undefined || description === undefined) {
    return { ok: false, message: "预约字段格式不对" };
  }
  if ((startAt === null) !== (endAt === null)) return { ok: false, message: "开始与结束时间须同时填写或同时留空（留空取日历事件时间）" };
  if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) return { ok: false, message: "结束时间须晚于开始时间" };
  let assignedToId: string | null = null;
  if (a.assignedToId !== undefined && a.assignedToId !== null && a.assignedToId !== "") {
    if (typeof a.assignedToId !== "string" || !ctx.activeMemberIds.has(a.assignedToId)) return { ok: false, message: "负责人须为本企业在职成员" };
    assignedToId = a.assignedToId;
  }
  return {
    ok: true,
    value: {
      calendarId: b.calendarId.trim(),
      customer,
      appointment: { type: type as AppointmentType, title, startAt, endAt, address, contactPhone, description, assignedToId },
    },
  };
}

/** 忽略原因：可选，≤ 200 字 */
export function validateDismissInput(body: unknown): { ok: true; calendarId: string | null; reason: string | null } | { ok: false; message: string } {
  const b = obj(body) ?? {};
  const reason = optText(b.reason);
  if (reason === undefined) return { ok: false, message: "原因须为不超过 200 字的文字" };
  const calendarId = typeof b.calendarId === "string" && b.calendarId.trim() ? b.calendarId.trim() : null;
  return { ok: true, calendarId, reason };
}

/** 预约的默认起止：请求体留空时取事件时间；全天事件按当地日期 00:00 起整天 */
export function appointmentTimes(
  booking: Pick<PendingBooking, "start" | "end" | "allDay">,
  input: { startAt: string | null; endAt: string | null },
): { startAt: Date; endAt: Date; allDay: boolean } {
  if (input.startAt && input.endAt) return { startAt: new Date(input.startAt), endAt: new Date(input.endAt), allDay: false };
  if (booking.allDay) {
    const s = new Date(`${booking.start.slice(0, 10)}T00:00:00Z`);
    const e = booking.end ? new Date(`${booking.end.slice(0, 10)}T00:00:00Z`) : new Date(s.getTime() + 86_400_000);
    return { startAt: s, endAt: e, allDay: true };
  }
  const s = new Date(booking.start);
  const e = booking.end && Number.isFinite(Date.parse(booking.end)) ? new Date(booking.end) : new Date(s.getTime() + 3_600_000);
  return { startAt: s, endAt: e, allDay: false };
}
