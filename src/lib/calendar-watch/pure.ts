/**
 * CAL-1 日历观察 — 纯函数核心（零 DB、零网络），供执行器、接口与测试共用。
 *
 * - 配置：readCalendarWatch / withCalendarWatch / validateCalendarWatchInput / applySettingsUpdate / publicView
 * - Google 事件映射：mapGoogleEvent
 * - 归因：attributeCalendarEvent（R1 青砚 → R2 网站 → R3 成员 → R4 不明）、bucketOfRole
 * - 账本：classifyKind / shouldRecord / diffEvent / toLedgerAfterData / parseLedgerAfterData
 * - 通知：shouldNotify / buildNotification / notificationRecipients
 * - 统计：summarizeCalendarAttribution
 */

import { getLocalTimeParts } from "@/lib/automation/local-time";
import { zonedLocalToUtc } from "@/lib/revenue-spine/business-days";
import { addDaysYmd } from "@/lib/sales/period/summary-pure";
import type {
  AppointmentRef,
  Attribution,
  AttributionContext,
  CalendarActorRow,
  CalendarAttributionSummary,
  CalendarBucket,
  CalendarChange,
  CalendarChangeKind,
  CalendarCursor,
  CalendarNotificationDraft,
  CalendarUnknownSample,
  CalendarWatchConfig,
  CalendarWatchUserFields,
  FieldDiff,
  LedgerAfterData,
} from "./types";

export const CALENDAR_WATCH_KEY = "calendarWatch";
export const LEDGER_ACTION = "calendar.watch.observed";
export const SETTINGS_AUDIT_ACTION = "calendar.watch.settings_updated";
export const LEDGER_TARGET_TYPE = "google_calendar_event";
export const NOTIFICATION_TYPE = "calendar_event";
export const NOTIFICATION_CATEGORY = "calendar_watch";

export const DEFAULT_NOTIFY_POSITIONS = ["owner", "ops_lead"] as const;
export const DEFAULT_BASELINE_DAYS = 60;
export const MAX_CALENDARS = 3;
export const PAGE_BUDGET = 4;
export const PAGE_SIZE = 2500;
export const EDITED_VIA_WINDOW_MS = 2 * 60 * 1000;
export const SUMMARY_MAX = 120;
export const STATS_CAP = 20_000;
export const UNKNOWN_SAMPLE_MAX = 10;

const MAX_EMAILS = 50;
const MAX_MARKERS = 20;
const MAX_MARKER_LEN = 100;
const MAX_ALIASES = 200;
const MAX_CALENDAR_ID_LEN = 300;

// ── 配置 ────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e ? e : null;
}

export function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v.trim());
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function readCursor(v: unknown): CalendarCursor | null {
  const r = obj(v);
  if (!r) return null;
  return {
    phase: r.phase === "incremental" ? "incremental" : "full",
    syncToken: str(r.syncToken),
    pageToken: str(r.pageToken),
    lastRunAt: str(r.lastRunAt),
    lastError: str(r.lastError),
    baselineFrom: str(r.baselineFrom),
  };
}

export function emptyCursor(): CalendarCursor {
  return { phase: "full", syncToken: null, pageToken: null, lastRunAt: null, lastError: null, baselineFrom: null };
}

/** 从 settingsJson 读配置（坏数据按缺省处理；未配置 = 关闭，通知岗位缺省 owner + ops_lead） */
export function readCalendarWatch(settingsJson: unknown): CalendarWatchConfig {
  const cw = obj(obj(settingsJson)?.[CALENDAR_WATCH_KEY]) ?? {};
  const aliases: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(cw.memberEmailAliases) ?? {})) {
    const e = normalizeEmail(k);
    if (e && typeof v === "string" && v) aliases[e] = v;
  }
  const cursor: Record<string, CalendarCursor> = {};
  for (const [k, v] of Object.entries(obj(cw.cursor) ?? {})) {
    const c = readCursor(v);
    if (c) cursor[k] = c;
  }
  const positions = strArray(cw.notifyPositions);
  const days = cw.baselineFromDays;
  return {
    enabled: cw.enabled === true,
    readerUserId: str(cw.readerUserId),
    calendarIds: strArray(cw.calendarIds).slice(0, MAX_CALENDARS),
    websiteBookerEmails: strArray(cw.websiteBookerEmails).map((e) => e.toLowerCase()),
    websiteMarkers: strArray(cw.websiteMarkers),
    memberEmailAliases: aliases,
    notifyPositions: positions.length ? positions : [...DEFAULT_NOTIFY_POSITIONS],
    baselineFromDays:
      typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 366 ? days : DEFAULT_BASELINE_DAYS,
    cursor,
  };
}

/** 写回配置（纯函数：返回新的 settingsJson，不动其它键） */
export function withCalendarWatch(settingsJson: unknown, config: CalendarWatchConfig): Record<string, unknown> {
  const base = obj(settingsJson) ? { ...(settingsJson as Record<string, unknown>) } : {};
  base[CALENDAR_WATCH_KEY] = { ...config };
  return base;
}

export type ValidateResult =
  | { ok: true; fields: CalendarWatchUserFields }
  | { ok: false; message: string };

function userFieldsOf(c: CalendarWatchConfig): CalendarWatchUserFields {
  const { cursor: _cursor, ...rest } = c;
  void _cursor;
  return rest;
}

/**
 * 校验 PUT 请求体并合并到现有用户字段（只认用户字段；cursor 等其它键忽略）。
 * 读取账号是否已连接、日历是否可见由接口另查（需要 DB / Google）。
 */
export function validateCalendarWatchInput(
  body: unknown,
  current: CalendarWatchConfig,
  ctx: { activeMemberIds: ReadonlySet<string>; positionKeys: ReadonlySet<string> },
): ValidateResult {
  const b = obj(body);
  if (!b) return { ok: false, message: "请求体必须是对象" };
  const next = userFieldsOf(current);

  if ("enabled" in b) {
    if (typeof b.enabled !== "boolean") return { ok: false, message: "enabled 必须是布尔值" };
    next.enabled = b.enabled;
  }
  if ("readerUserId" in b) {
    if (b.readerUserId !== null && typeof b.readerUserId !== "string") return { ok: false, message: "readerUserId 必须是字符串" };
    next.readerUserId = (b.readerUserId as string | null) || null;
  }
  if ("calendarIds" in b) {
    if (!Array.isArray(b.calendarIds)) return { ok: false, message: "calendarIds 必须是数组" };
    const ids: string[] = [];
    for (const raw of b.calendarIds) {
      if (typeof raw !== "string" || !raw.trim() || raw.length > MAX_CALENDAR_ID_LEN) {
        return { ok: false, message: "calendarIds 含不合法的日历 ID" };
      }
      if (!ids.includes(raw.trim())) ids.push(raw.trim());
    }
    next.calendarIds = ids;
  }
  if ("websiteBookerEmails" in b) {
    if (!Array.isArray(b.websiteBookerEmails) || b.websiteBookerEmails.length > MAX_EMAILS) {
      return { ok: false, message: `websiteBookerEmails 必须是不超过 ${MAX_EMAILS} 个邮箱的数组` };
    }
    const out: string[] = [];
    for (const e of b.websiteBookerEmails) {
      if (!isValidEmail(e)) return { ok: false, message: "websiteBookerEmails 含不合法的邮箱" };
      const n = e.trim().toLowerCase();
      if (!out.includes(n)) out.push(n);
    }
    next.websiteBookerEmails = out;
  }
  if ("websiteMarkers" in b) {
    if (!Array.isArray(b.websiteMarkers) || b.websiteMarkers.length > MAX_MARKERS) {
      return { ok: false, message: `websiteMarkers 必须是不超过 ${MAX_MARKERS} 个标记的数组` };
    }
    const out: string[] = [];
    for (const m of b.websiteMarkers) {
      if (typeof m !== "string" || !m.trim() || m.trim().length > MAX_MARKER_LEN) {
        return { ok: false, message: `websiteMarkers 每项须为 1–${MAX_MARKER_LEN} 字` };
      }
      if (!out.includes(m.trim())) out.push(m.trim());
    }
    next.websiteMarkers = out;
  }
  if ("memberEmailAliases" in b) {
    const a = obj(b.memberEmailAliases);
    if (!a || Object.keys(a).length > MAX_ALIASES) {
      return { ok: false, message: `memberEmailAliases 必须是不超过 ${MAX_ALIASES} 项的 { 邮箱: 成员ID } 对象` };
    }
    const out: Record<string, string> = {};
    for (const [e, uid] of Object.entries(a)) {
      if (!isValidEmail(e)) return { ok: false, message: "memberEmailAliases 含不合法的邮箱" };
      if (typeof uid !== "string" || !ctx.activeMemberIds.has(uid)) {
        return { ok: false, message: "memberEmailAliases 指向的不是本企业在职成员" };
      }
      out[e.trim().toLowerCase()] = uid;
    }
    next.memberEmailAliases = out;
  }
  if ("notifyPositions" in b) {
    if (!Array.isArray(b.notifyPositions) || b.notifyPositions.length === 0) {
      return { ok: false, message: "notifyPositions 至少要有一个岗位" };
    }
    const out: string[] = [];
    for (const k of b.notifyPositions) {
      if (typeof k !== "string" || !ctx.positionKeys.has(k)) return { ok: false, message: "notifyPositions 含本企业不存在的岗位" };
      if (!out.includes(k)) out.push(k);
    }
    next.notifyPositions = out;
  }
  if ("baselineFromDays" in b) {
    const d = b.baselineFromDays;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 366) {
      return { ok: false, message: "baselineFromDays 须为 1–366 的整数" };
    }
    next.baselineFromDays = d;
  }

  if (next.calendarIds.length > MAX_CALENDARS) return { ok: false, message: `最多观察 ${MAX_CALENDARS} 个日历` };
  if (next.readerUserId && !ctx.activeMemberIds.has(next.readerUserId)) {
    return { ok: false, message: "读取账号不是本企业在职成员" };
  }
  if (next.enabled) {
    if (!next.readerUserId) return { ok: false, message: "开启观察须指定读取账号" };
    if (next.calendarIds.length === 0) return { ok: false, message: "开启观察须至少指定一个日历" };
  }
  return { ok: true, fields: next };
}

/**
 * 合并用户字段，保留游标：移除日历的游标删除，新增日历没有游标（执行器从全量开始）；
 * 读取账号变了则全部游标清空重做全量（同步令牌与读取账号的授权绑定，账本幂等保证不重复记账）。
 */
export function applySettingsUpdate(current: CalendarWatchConfig, fields: CalendarWatchUserFields): CalendarWatchConfig {
  const readerChanged = (current.readerUserId ?? null) !== (fields.readerUserId ?? null);
  const cursor: Record<string, CalendarCursor> = {};
  if (!readerChanged) {
    for (const id of fields.calendarIds) {
      if (current.cursor[id]) cursor[id] = current.cursor[id];
    }
  }
  return { ...fields, cursor };
}

/** GET 返回的视图：不含同步令牌与分页令牌 */
export function publicView(config: CalendarWatchConfig) {
  return {
    ...userFieldsOf(config),
    calendars: config.calendarIds.map((calendarId) => {
      const c = config.cursor[calendarId];
      return {
        calendarId,
        phase: c?.phase ?? "full",
        lastRunAt: c?.lastRunAt ?? null,
        lastError: c?.lastError ?? null,
        baselineFrom: c?.baselineFrom ?? null,
      };
    }),
  };
}

/** 基线起点：组织当地今天减 days 天的 0 点 */
export function baselineFromIso(now: Date, timezone: string, days: number): string {
  const today = getLocalTimeParts(now, timezone).date;
  return zonedLocalToUtc(addDaysYmd(today, -days), 0, timezone).toISOString();
}

// ── Google 事件映射 ───────────────────────────────────────────────

interface GoogleTime {
  date?: string | null;
  dateTime?: string | null;
}

/** 把 events.list 的一项映射为 CalendarChange；没有 id 的返回 null */
export function mapGoogleEvent(raw: unknown): CalendarChange | null {
  const e = obj(raw);
  if (!e || typeof e.id !== "string" || !e.id) return null;
  const start = (obj(e.start) ?? {}) as GoogleTime;
  const end = (obj(e.end) ?? {}) as GoogleTime;
  const allDay = Boolean(start.date) && !start.dateTime;
  return {
    id: e.id,
    status: str(e.status) ?? "confirmed",
    created: str(e.created),
    updated: str(e.updated),
    creatorEmail: normalizeEmail(obj(e.creator)?.email),
    organizerEmail: normalizeEmail(obj(e.organizer)?.email),
    summary: str(e.summary),
    description: str(e.description),
    start: str(start.dateTime) ?? str(start.date),
    end: str(end.dateTime) ?? str(end.date),
    allDay,
    htmlLink: str(e.htmlLink),
    recurringEventId: str(e.recurringEventId),
  };
}

/**
 * events.list 参数：全量与增量必须一致（只差 syncToken / pageToken），不带任何时间过滤；
 * singleEvents = false（重复系列计一次，单次例外作为修改出现）；showDeleted 不设（带令牌时删除总会返回）。
 */
export function buildChangesListParams(input: { calendarId: string; syncToken?: string | null; pageToken?: string | null }) {
  return {
    calendarId: input.calendarId,
    singleEvents: false,
    maxResults: PAGE_SIZE,
    ...(input.syncToken ? { syncToken: input.syncToken } : {}),
    ...(input.pageToken ? { pageToken: input.pageToken } : {}),
  };
}

/** googleapis 错误的 HTTP 状态（code 为数字或 response.status） */
export function googleErrorStatus(err: unknown): number | null {
  const e = obj(err);
  if (!e) return null;
  if (typeof e.code === "number") return e.code;
  if (typeof e.code === "string" && /^\d+$/.test(e.code)) return Number(e.code);
  const status = obj(e.response)?.status;
  return typeof status === "number" ? status : null;
}

/** 删除事件在增量里通常只有 id 与 status：缺的字段沿用上一条账本 */
export function fillFromPrevious(change: CalendarChange, prev: LedgerAfterData | null): CalendarChange {
  if (!prev) return change;
  return {
    ...change,
    created: change.created ?? prev.googleCreated,
    creatorEmail: change.creatorEmail ?? prev.creatorEmail,
    organizerEmail: change.organizerEmail ?? prev.organizerEmail,
    summary: change.summary ?? prev.summary,
    start: change.start ?? prev.start,
    end: change.end ?? prev.end,
    allDay: change.start ? change.allDay : prev.allDay,
    htmlLink: change.htmlLink ?? prev.htmlLink,
    recurringEventId: change.recurringEventId ?? prev.recurringEventId,
  };
}

// ── 归因 ────────────────────────────────────────────────────────

/** 岗位派生平台角色 → 分桶（管理层含旧模式与保留角色里的管理口径） */
export function bucketOfRole(role: string | null | undefined): CalendarBucket {
  switch (role) {
    case "boss":
    case "manager":
    case "admin":
    case "super_admin":
      return "management";
    case "sales":
      return "sales";
    case "operations":
      return "ops";
    default:
      return "other";
  }
}

/** 确定性归因：R1 青砚预约 → R2 网站（账号或标记）→ R3 成员（邮箱 / 连接邮箱 / 别名）→ R4 不明 */
export function attributeCalendarEvent(change: CalendarChange, ctx: AttributionContext): Attribution {
  const appt = ctx.appointmentsByEventId.get(change.id);
  if (appt) {
    return {
      source: "qingyan",
      rule: "R1",
      userId: appt.createdById,
      bucket: ctx.bucketByUserId.get(appt.createdById) ?? "other",
      appointmentId: appt.appointmentId,
    };
  }
  const email = change.creatorEmail?.toLowerCase() ?? null;
  const text = `${change.summary ?? ""}\n${change.description ?? ""}`.toLowerCase();
  if ((email && ctx.websiteBookerEmails.has(email)) || ctx.websiteMarkers.some((m) => m && text.includes(m))) {
    return { source: "website", rule: "R2", userId: null, bucket: null, appointmentId: null };
  }
  const uid = email ? ctx.memberByEmail.get(email) : undefined;
  if (uid) {
    return { source: "member", rule: "R3", userId: uid, bucket: ctx.bucketByUserId.get(uid) ?? "other", appointmentId: null };
  }
  return { source: "unknown", rule: "R4", userId: null, bucket: null, appointmentId: null };
}

/**
 * 是否经青砚：
 * - 修改：R1 命中且预约 googleSyncedAt 与 Google updated 相差 ≤ 2 分钟（青砚推送）；
 * - 删除：上一条账本归因青砚、本轮已无预约持有该事件（青砚解除同步会清空 googleEventId）。
 */
export function editedViaQingyan(input: {
  kind: CalendarChangeKind;
  attribution: Attribution;
  appointment: AppointmentRef | null;
  updated: string | null;
  prev: LedgerAfterData | null;
}): boolean {
  if (input.kind === "updated") {
    if (input.attribution.rule !== "R1" || !input.appointment?.googleSyncedAt || !input.updated) return false;
    const t = Date.parse(input.updated);
    return Number.isFinite(t) && Math.abs(input.appointment.googleSyncedAt.getTime() - t) <= EDITED_VIA_WINDOW_MS;
  }
  if (input.kind === "cancelled") {
    return input.prev?.attribution.source === "qingyan" && input.attribution.rule !== "R1";
  }
  return false;
}

// ── 账本 ────────────────────────────────────────────────────────

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * 幂等：该事件没有账本，或上一条账本的 Google 更新时间早于本次才记。
 * 删除事件没有 updated 时：上一条已是删除则跳过，否则记。
 */
export function shouldRecord(prev: LedgerAfterData | null, change: CalendarChange): boolean {
  if (!prev) return true;
  const cur = ms(change.updated);
  if (cur === null) return !(change.status === "cancelled" && prev.kind === "cancelled");
  const last = ms(prev.googleUpdated);
  return last === null || cur > last;
}

/**
 * 变更类型；返回 null 表示不记账：
 * - 删除 → cancelled（全量阶段且没有账本的删除不记）；
 * - 有账本 → updated；
 * - 没有账本：Google 创建时间不早于基线起点 → created；更早 → 增量记 updated，全量不记。
 */
export function classifyKind(input: {
  change: CalendarChange;
  prev: LedgerAfterData | null;
  baselineFromMs: number;
  phase: "full" | "incremental";
}): CalendarChangeKind | null {
  const { change, prev, baselineFromMs, phase } = input;
  if (change.status === "cancelled") return prev || phase === "incremental" ? "cancelled" : null;
  if (prev) return "updated";
  const created = ms(change.created);
  if (created !== null && created >= baselineFromMs) return "created";
  return phase === "incremental" ? "updated" : null;
}

function truncSummary(s: string | null): string | null {
  if (s === null) return null;
  return [...s].length > SUMMARY_MAX ? [...s].slice(0, SUMMARY_MAX).join("") : s;
}

/** 标题与起止时间的前后差异（上一条账本 vs 本次） */
export function diffEvent(prev: LedgerAfterData | null, change: CalendarChange): FieldDiff[] {
  if (!prev) return [];
  const out: FieldDiff[] = [];
  const pairs: Array<[FieldDiff["field"], string | null, string | null]> = [
    ["start", prev.start, change.start],
    ["end", prev.end, change.end],
    ["summary", prev.summary, truncSummary(change.summary)],
  ];
  for (const [field, before, after] of pairs) {
    if (after === null) continue;
    const same = field === "summary" ? before === after : (ms(before) ?? before) === (ms(after) ?? after);
    if (!same) out.push({ field, before, after });
  }
  return out;
}

/** 账本 afterData：不含描述，标题截 120 字 */
export function toLedgerAfterData(input: {
  calendarId: string;
  change: CalendarChange;
  kind: CalendarChangeKind;
  baseline: boolean;
  attribution: Attribution;
  editedVia: "qingyan" | null;
  diff: FieldDiff[] | null;
  observedAt: Date;
}): LedgerAfterData {
  const c = input.change;
  return {
    v: 1,
    calendarId: input.calendarId,
    eventId: c.id,
    kind: input.kind,
    baseline: input.baseline,
    googleCreated: c.created,
    googleUpdated: c.updated ?? input.observedAt.toISOString(),
    creatorEmail: c.creatorEmail,
    organizerEmail: c.organizerEmail,
    summary: truncSummary(c.summary),
    start: c.start,
    end: c.end,
    allDay: c.allDay,
    recurringEventId: c.recurringEventId,
    htmlLink: c.htmlLink,
    attribution: input.attribution,
    editedVia: input.editedVia,
    diff: input.diff && input.diff.length ? input.diff : null,
  };
}

const KINDS: readonly string[] = ["created", "updated", "cancelled"];
const SOURCES: readonly string[] = ["qingyan", "member", "website", "unknown"];

/** 解析账本 afterData（字符串或对象）；形状不对返回 null */
export function parseLedgerAfterData(raw: unknown): LedgerAfterData | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const r = obj(v);
  if (!r || r.v !== 1 || typeof r.eventId !== "string" || typeof r.calendarId !== "string") return null;
  if (!KINDS.includes(r.kind as string) || typeof r.googleUpdated !== "string") return null;
  const a = obj(r.attribution);
  if (!a || !SOURCES.includes(a.source as string)) return null;
  return r as unknown as LedgerAfterData;
}

// ── 通知 ────────────────────────────────────────────────────────

/** 基线、青砚来源的新建、经青砚的修改 / 删除、标题与时间都没变的修改、既无标题又无时间的删除不发通知 */
export function shouldNotify(entry: LedgerAfterData): boolean {
  if (entry.baseline) return false;
  if (entry.editedVia === "qingyan") return false;
  if (entry.kind === "created" && entry.attribution.source === "qingyan") return false;
  if (entry.kind === "updated" && !entry.diff?.length) return false;
  if (entry.kind === "cancelled" && !entry.summary && !entry.start) return false;
  return true;
}

/** 收件人：岗位持有人（为空回落企业 owner）∪ 预约负责人；新建去掉归因到的创建者本人；去重 */
export function notificationRecipients(input: {
  positionHolderIds: readonly string[];
  fallbackOwnerId: string | null;
  appointmentAssigneeId: string | null;
  entry: LedgerAfterData;
}): string[] {
  const base = input.positionHolderIds.length ? [...input.positionHolderIds] : input.fallbackOwnerId ? [input.fallbackOwnerId] : [];
  if (input.appointmentAssigneeId) base.push(input.appointmentAssigneeId);
  const exclude = input.entry.kind === "created" ? input.entry.attribution.userId : null;
  return [...new Set(base)].filter((id) => id && id !== exclude);
}

export function notificationSourceKey(orgId: string, entry: LedgerAfterData, userId: string): string {
  return `calwatch:${orgId}:${entry.calendarId}:${entry.eventId}:${entry.googleUpdated}:${userId}`;
}

function md(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${m}/${d}`;
}

function localDayTime(iso: string, timezone: string): { day: string; time: string } {
  const p = getLocalTimeParts(new Date(iso), timezone);
  return { day: p.date, time: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` };
}

/** 单个时间点：全天为 M/D，定时为当地 HH:mm（跨日时带 M/D） */
function pointText(v: string | null, allDay: boolean, timezone: string, withDay: boolean): string {
  if (!v) return "?";
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(v)) return md(v.slice(0, 10));
  if (!Number.isFinite(Date.parse(v))) return v;
  const { day, time } = localDayTime(v, timezone);
  return withDay ? `${md(day)} ${time}` : time;
}

/** 日程时间：10/30 14:00–15:00；全天：10/30（全天）；跨日：10/30 14:00 – 10/31 09:00 */
export function formatEventWhen(start: string | null, end: string | null, allDay: boolean, timezone: string): string {
  if (!start) return "";
  if (allDay) return `${md(start.slice(0, 10))}（全天）`;
  if (!Number.isFinite(Date.parse(start))) return start;
  const s = localDayTime(start, timezone);
  if (!end || !Number.isFinite(Date.parse(end))) return `${md(s.day)} ${s.time}`;
  const e = localDayTime(end, timezone);
  if (e.day === s.day) return `${md(s.day)} ${s.time}–${e.time}`;
  return `${md(s.day)} ${s.time} – ${md(e.day)} ${e.time}`;
}

const SOURCE_LABEL: Record<string, string> = { qingyan: "青砚", member: "成员", website: "网站预约", unknown: "来源不明" };
const FIELD_LABEL: Record<FieldDiff["field"], string> = { start: "开始", end: "结束", summary: "标题" };

function diffText(entry: LedgerAfterData, timezone: string): string {
  return (entry.diff ?? [])
    .map((d) => {
      if (d.field === "summary") return `${FIELD_LABEL.summary}「${d.before ?? ""}」→「${d.after ?? ""}」`;
      const crossDay =
        Boolean(d.before && d.after) &&
        !entry.allDay &&
        Number.isFinite(Date.parse(d.before!)) &&
        Number.isFinite(Date.parse(d.after!)) &&
        localDayTime(d.before!, timezone).day !== localDayTime(d.after!, timezone).day;
      return `${FIELD_LABEL[d.field]} ${pointText(d.before, entry.allDay, timezone, crossDay)} → ${pointText(d.after, entry.allDay, timezone, crossDay)}`;
    })
    .join("，");
}

/** 通知文案（时间按组织时区）；actorName 为归因到的成员姓名 */
export function buildNotification(entry: LedgerAfterData, timezone: string, actorName: string | null): CalendarNotificationDraft {
  const when = formatEventWhen(entry.start, entry.end, entry.allDay, timezone);
  const subject = entry.summary ?? "（无标题）";
  const who =
    entry.attribution.source === "member" || entry.attribution.source === "qingyan"
      ? actorName ?? entry.creatorEmail ?? "成员"
      : SOURCE_LABEL[entry.attribution.source];
  const detail = `来源：${SOURCE_LABEL[entry.attribution.source]}（${entry.attribution.rule}）${
    entry.creatorEmail ? ` · 创建者 ${entry.creatorEmail}` : ""
  }`;
  if (entry.kind === "created") {
    if (entry.attribution.source === "website") {
      return { title: `【网站预约】${when} ${subject}（Google 侧新建）`, summary: detail };
    }
    return { title: `【日程新增】${when} ${subject}（${who}，Google 侧新建）`, summary: detail };
  }
  if (entry.kind === "updated") {
    const day = entry.start ? formatEventWhen(entry.start, null, entry.allDay, timezone).split(" ")[0].replace("（全天）", "") : "";
    return {
      title: `【日程改动】${day} ${subject} ${diffText(entry, timezone)}（Google 侧改动，修改人未知）`.replace(/\s+/g, " ").trim(),
      summary: detail,
    };
  }
  return { title: `【日程取消】${when} ${subject}（Google 侧删除）`.replace(/\s+/g, " ").trim(), summary: detail };
}

/** 读取账号授权失效：当天一条重连通知 */
export function reconnectNotification(orgId: string, readerUserId: string, localDate: string) {
  return {
    sourceKey: `calwatch:reconnect:${orgId}:${readerUserId}:${localDate}`,
    title: "【日历观察】Google 日历授权已失效，请重新连接",
    summary: "日历观察用你的 Google 日历授权读取共享日历；授权失效后观察暂停，请在青砚日历页重新连接 Google 日历。",
  };
}

// ── 统计 ────────────────────────────────────────────────────────

function inPeriod(iso: string | null, start: Date, end: Date): boolean {
  const t = ms(iso);
  return t !== null && t >= start.getTime() && t < end.getTime();
}

/**
 * 期间统计：新建按 Google 创建时间、修改 / 删除按 Google 更新时间落在 [start, end) 计。
 * 新建按 eventId 跨日历去重；修改 / 删除按 eventId + 类型 + 更新时间去重。
 * org：bySource、byActor（有归因人的）、unknownSamples（最多 10 条，按创建时间新到旧）；own：只给本人一行。
 */
export function summarizeCalendarAttribution(input: {
  rows: readonly LedgerAfterData[];
  period: { start: Date; end: Date };
  scope: { kind: "org" } | { kind: "own"; userId: string };
  names: ReadonlyMap<string, string>;
  truncated: boolean;
}): CalendarAttributionSummary {
  const { rows, period, scope, names } = input;
  const bySource = { qingyan: 0, member: 0, website: 0, unknown: 0 };
  const actors = new Map<string, CalendarActorRow>();
  const samples: CalendarUnknownSample[] = [];
  const seen = new Set<string>();

  const actor = (userId: string, bucket: CalendarBucket | null): CalendarActorRow => {
    let a = actors.get(userId);
    if (!a) {
      a = { userId, name: names.get(userId) ?? "（已离开成员）", bucket, created: 0, updated: 0, cancelled: 0 };
      actors.set(userId, a);
    }
    if (!a.bucket && bucket) a.bucket = bucket;
    return a;
  };

  for (const r of rows) {
    if (r.kind === "created") {
      if (!inPeriod(r.googleCreated, period.start, period.end)) continue;
      const key = `c:${r.eventId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bySource[r.attribution.source] += 1;
      if (r.attribution.userId) actor(r.attribution.userId, r.attribution.bucket).created += 1;
      if (r.attribution.source === "unknown") {
        samples.push({ eventId: r.eventId, creatorEmail: r.creatorEmail, summary: r.summary, googleCreated: r.googleCreated });
      }
    } else {
      if (!inPeriod(r.googleUpdated, period.start, period.end)) continue;
      const key = `${r.kind}:${r.eventId}:${ms(r.googleUpdated)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (r.attribution.userId) actor(r.attribution.userId, r.attribution.bucket)[r.kind] += 1;
    }
  }

  if (scope.kind === "own") {
    const own = actors.get(scope.userId) ?? {
      userId: scope.userId,
      name: names.get(scope.userId) ?? "",
      bucket: null,
      created: 0,
      updated: 0,
      cancelled: 0,
    };
    return { scope: "own", byActor: [own], truncated: input.truncated };
  }

  const byActor = [...actors.values()].sort((a, b) => b.created - a.created || a.name.localeCompare(b.name, "zh"));
  samples.sort((a, b) => (ms(b.googleCreated) ?? 0) - (ms(a.googleCreated) ?? 0));
  return {
    scope: "org",
    bySource,
    byActor,
    unknownSamples: samples.slice(0, UNKNOWN_SAMPLE_MAX),
    truncated: input.truncated,
  };
}
