/**
 * CAL-2 网站预约一键转入：取数、实时读取事件详情、转入事务、忽略。
 *
 * 对 Google 只读（事件详情读取可注入）；转入不调用 syncAppointmentToGoogle（事件已在共享日历里）。
 * 授权由接口层负责。
 */

import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { resolveOrgTimezone } from "@/lib/automation/registry";
import {
  GoogleTokenExpiredError,
  getGoogleEventDetail,
  getGoogleProvider,
  type GoogleEvent,
} from "@/lib/google-calendar";
import { addDaysYmd } from "@/lib/sales/period/summary-pure";
import { zonedLocalToUtc } from "@/lib/revenue-spine/business-days";
import {
  appointmentTimes,
  CONVERT_ACTION,
  CUSTOMER_SOURCE,
  derivePendingBookings,
  DISMISS_ACTION,
  intakeWindowStart,
  parseBookingDescription,
  samePhone,
  type BookingPrefill,
  type ConvertInput,
  type LedgerRow,
  type PendingBooking,
} from "./intake-pure";
import { LEDGER_ACTION, LEDGER_TARGET_TYPE, parseLedgerAfterData, readCalendarWatch, STATS_CAP } from "./pure";

export type ReadEventFn = (readerUserId: string, opts: { eventId: string; calendarId: string }) => Promise<GoogleEvent | null>;

/** 读取账号没有启用的 Google 连接也按授权失效处理 */
const defaultReadEvent: ReadEventFn = async (readerUserId, opts) => {
  const provider = await getGoogleProvider(readerUserId);
  if (!provider?.accessToken) throw new GoogleTokenExpiredError();
  return getGoogleEventDetail(readerUserId, opts);
};

export type IntakeErrorCode =
  | "NOT_PENDING"
  | "EVENT_NOT_FOUND"
  | "READER_NOT_CONNECTED"
  | "ALREADY_CONVERTED"
  | "CUSTOMER_EXISTS"
  | "CUSTOMER_NOT_FOUND";

export interface IntakeError {
  ok: false;
  status: number;
  code: IntakeErrorCode;
  message: string;
  existingCustomer?: { id: string; name: string; phone: string | null; address: string | null };
}

async function orgWatch(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  const settingsJson = org?.settingsJson ?? null;
  return { config: readCalendarWatch(settingsJson), timezone: resolveOrgTimezone(settingsJson) };
}

/** 待转入列表：CAL-1 账本 + 已转入（本企业预约记下的事件 ID）+ 已忽略（审计） */
export async function listWebsiteBookings(orgId: string, now: Date = new Date()): Promise<{ enabled: boolean; items: PendingBooking[] }> {
  const { config, timezone } = await orgWatch(orgId);
  if (!config.enabled) return { enabled: false, items: [] };
  const windowStart = intakeWindowStart(now, timezone);
  // 新建观察总在事件创建之后；列表只关心近期开始的事件，往前多取 366 天覆盖提前很久的预约
  const since = zonedLocalToUtc(addDaysYmd(windowStart, -366), 0, timezone);
  const raw = await db.auditLog.findMany({
    where: { orgId, action: LEDGER_ACTION, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    take: STATS_CAP,
    select: { afterData: true, createdAt: true },
  });
  const rows: LedgerRow[] = [];
  for (const r of raw) {
    const data = parseLedgerAfterData(r.afterData);
    if (data) rows.push({ createdAt: r.createdAt, data });
  }
  const ids = [...new Set(rows.filter((r) => r.data.attribution.source === "website").map((r) => r.data.eventId))];
  const [appts, dismissals] = ids.length
    ? await Promise.all([
        db.appointment.findMany({ where: { googleEventId: { in: ids }, customer: { orgId } }, select: { googleEventId: true } }),
        db.auditLog.findMany({ where: { orgId, action: DISMISS_ACTION, targetId: { in: ids } }, select: { targetId: true } }),
      ])
    : [[], []];
  return {
    enabled: true,
    items: derivePendingBookings({
      rows: rows.filter((r) => ids.includes(r.data.eventId)),
      convertedEventIds: new Set(appts.map((a) => a.googleEventId).filter((x): x is string => Boolean(x))),
      dismissedEventIds: new Set(dismissals.map((d) => d.targetId).filter((x): x is string => Boolean(x))),
      windowStart,
      timezone,
    }),
  };
}

async function findPending(orgId: string, eventId: string, now: Date): Promise<PendingBooking | null> {
  const { items } = await listWebsiteBookings(orgId, now);
  return items.find((b) => b.eventId === eventId) ?? null;
}

async function ownCustomersWithPhone(
  client: Pick<typeof db, "salesCustomer">,
  orgId: string,
  userId: string,
  phone: string | null,
) {
  if (!phone) return [];
  const rows = await client.salesCustomer.findMany({
    where: { orgId, createdById: userId, archivedAt: null, phone: { not: null } },
    select: { id: true, name: true, phone: true, address: true },
  });
  return rows.filter((c) => samePhone(c.phone, phone));
}

export interface WebsiteBookingDetail {
  booking: PendingBooking;
  event: { summary: string; start: string; end: string; allDay: boolean; location: string | null; description: string | null; htmlLink: string | null };
  prefill: BookingPrefill;
  existingCustomers: Array<{ id: string; name: string; phone: string | null; address: string | null }>;
}

/** 详情：只对待转入事件，用读取账号实时读取；描述与预填不落库 */
export async function getWebsiteBookingDetail(
  params: { orgId: string; userId: string; eventId: string; now?: Date },
  deps: { readEvent?: ReadEventFn } = {},
): Promise<{ ok: true; data: WebsiteBookingDetail } | IntakeError> {
  const now = params.now ?? new Date();
  const booking = await findPending(params.orgId, params.eventId, now);
  if (!booking) return { ok: false, status: 404, code: "NOT_PENDING", message: "该事件不在待转入列表中" };
  const { config } = await orgWatch(params.orgId);
  if (!config.readerUserId) return { ok: false, status: 409, code: "READER_NOT_CONNECTED", message: "日历观察没有读取账号" };
  let event: GoogleEvent | null;
  try {
    event = await (deps.readEvent ?? defaultReadEvent)(config.readerUserId, { eventId: params.eventId, calendarId: booking.calendarId });
  } catch (err) {
    if (err instanceof GoogleTokenExpiredError) {
      return { ok: false, status: 409, code: "READER_NOT_CONNECTED", message: "读取账号的 Google 日历未连接或授权已失效" };
    }
    throw err;
  }
  if (!event) return { ok: false, status: 404, code: "EVENT_NOT_FOUND", message: "Google 日历里已找不到该事件" };
  const prefill = parseBookingDescription(event.description ?? null, event.location);
  const existing = await ownCustomersWithPhone(db, params.orgId, params.userId, prefill.phone);
  return {
    ok: true,
    data: {
      booking,
      event: {
        summary: event.title,
        start: event.startTime,
        end: event.endTime,
        allDay: event.allDay,
        location: event.location,
        description: event.description ?? null,
        htmlLink: event.htmlLink ?? null,
      },
      prefill,
      existingCustomers: existing.slice(0, 3),
    },
  };
}

/**
 * 转入：事务内按企业 + 事件加锁 → 复查已转入 / 待转入 → 关联或新建客户（重复电话 409，零写入）→ 新建预约（记事件 ID）→ 审计。
 * 不推送 Google。
 */
export async function convertWebsiteBooking(params: {
  orgId: string;
  userId: string;
  eventId: string;
  input: ConvertInput;
  now?: Date;
}): Promise<{ ok: true; customerId: string; appointmentId: string; linkedExisting: boolean } | IntakeError> {
  const now = params.now ?? new Date();
  const { orgId, userId, eventId, input } = params;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`website-booking:${orgId}:${eventId}`}))) AS l`;
    const already = await tx.appointment.findFirst({ where: { googleEventId: eventId, customer: { orgId } }, select: { id: true } });
    if (already) return { ok: false as const, status: 409, code: "ALREADY_CONVERTED" as const, message: "该网站预约已被转入" };
    const booking = await findPending(orgId, eventId, now);
    if (!booking) return { ok: false as const, status: 404, code: "NOT_PENDING" as const, message: "该事件不在待转入列表中" };

    let customerId: string;
    let customerPhone: string | null = null;
    let customerAddress: string | null = null;
    const linkedExisting = input.customer.kind === "existing";
    if (input.customer.kind === "existing") {
      const c = await tx.salesCustomer.findFirst({
        where: { id: input.customer.customerId, orgId, createdById: userId, archivedAt: null },
        select: { id: true, phone: true, address: true },
      });
      if (!c) return { ok: false as const, status: 404, code: "CUSTOMER_NOT_FOUND" as const, message: "只能关联本人名下未归档的客户" };
      customerId = c.id;
      customerPhone = c.phone;
      customerAddress = c.address;
    } else {
      const dup = await ownCustomersWithPhone(tx, orgId, userId, input.customer.phone);
      if (dup.length) {
        return { ok: false as const, status: 409, code: "CUSTOMER_EXISTS" as const, message: "该电话号码已绑定到你名下的现有客户", existingCustomer: dup[0] };
      }
      const created = await tx.salesCustomer.create({
        data: {
          orgId,
          name: input.customer.name,
          phone: input.customer.phone,
          email: input.customer.email,
          address: input.customer.address,
          source: CUSTOMER_SOURCE,
          createdById: userId,
        },
        select: { id: true },
      });
      customerId = created.id;
      customerPhone = input.customer.phone;
      customerAddress = input.customer.address;
    }

    const times = appointmentTimes(booking, input.appointment);
    const appt = await tx.appointment.create({
      data: {
        customerId,
        type: input.appointment.type,
        title: input.appointment.title ?? booking.summary ?? "网站预约",
        description: input.appointment.description,
        startAt: times.startAt,
        endAt: times.endAt,
        allDay: times.allDay,
        address: input.appointment.address ?? customerAddress,
        contactPhone: input.appointment.contactPhone ?? customerPhone,
        assignedToId: input.appointment.assignedToId ?? userId,
        createdById: userId,
        googleEventId: eventId,
        googleSyncedAt: now,
      },
      select: { id: true },
    });

    // 只记 ID 与是否关联已有客户：不含电话、邮箱、地址与描述
    await writeAuditLog(tx, {
      userId,
      orgId,
      action: CONVERT_ACTION,
      targetType: LEDGER_TARGET_TYPE,
      targetId: eventId,
      afterData: { calendarId: booking.calendarId, customerId, appointmentId: appt.id, linkedExisting },
    });
    return { ok: true as const, customerId, appointmentId: appt.id, linkedExisting };
  });
}

/** 忽略：已忽略的直接返回（幂等）；否则须在待转入列表中 */
export async function dismissWebsiteBooking(params: {
  orgId: string;
  userId: string;
  eventId: string;
  reason: string | null;
  now?: Date;
}): Promise<{ ok: true; already: boolean } | IntakeError> {
  const prior = await db.auditLog.findFirst({ where: { orgId: params.orgId, action: DISMISS_ACTION, targetId: params.eventId }, select: { id: true } });
  if (prior) return { ok: true, already: true };
  const booking = await findPending(params.orgId, params.eventId, params.now ?? new Date());
  if (!booking) return { ok: false, status: 404, code: "NOT_PENDING", message: "该事件不在待转入列表中" };
  await writeAuditLog(db, {
    userId: params.userId,
    orgId: params.orgId,
    action: DISMISS_ACTION,
    targetType: LEDGER_TARGET_TYPE,
    targetId: params.eventId,
    afterData: { calendarId: booking.calendarId, reason: params.reason },
  });
  return { ok: true, already: false };
}
