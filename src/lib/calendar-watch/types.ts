/**
 * CAL-1 日历观察（OpenSpec change calendar-watch-attribution）的类型。
 *
 * 配置与游标存 Organization.settingsJson.calendarWatch；账本是 AuditLog（action = calendar.watch.observed），
 * afterData 形状见 LedgerAfterData。
 */

export type CalendarCursorPhase = "full" | "incremental";

/** 每个观察日历的游标（系统维护，PUT 不覆盖） */
export interface CalendarCursor {
  phase: CalendarCursorPhase;
  syncToken: string | null;
  pageToken: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  /** 本轮全量的基线起点（ISO）；全量开始时定下，转入增量后保留供参考 */
  baselineFrom: string | null;
}

export interface CalendarWatchConfig {
  enabled: boolean;
  readerUserId: string | null;
  calendarIds: string[];
  /** 小写 */
  websiteBookerEmails: string[];
  websiteMarkers: string[];
  /** 小写邮箱 → userId */
  memberEmailAliases: Record<string, string>;
  notifyPositions: string[];
  baselineFromDays: number;
  cursor: Record<string, CalendarCursor>;
}

/** PUT 接受的用户字段（全部可选，合并到现有配置） */
export type CalendarWatchUserFields = Omit<CalendarWatchConfig, "cursor">;

/** 从 Google events.list 映射出的一条变更 */
export interface CalendarChange {
  id: string;
  /** confirmed / tentative / cancelled */
  status: string;
  created: string | null;
  updated: string | null;
  creatorEmail: string | null;
  organizerEmail: string | null;
  summary: string | null;
  description: string | null;
  /** 定时事件为 ISO 时刻；全天事件为 YYYY-MM-DD */
  start: string | null;
  end: string | null;
  allDay: boolean;
  htmlLink: string | null;
  recurringEventId: string | null;
}

export type CalendarSource = "qingyan" | "member" | "website" | "unknown";
export type CalendarRule = "R1" | "R2" | "R3" | "R4";
export type CalendarBucket = "management" | "sales" | "ops" | "other";

export interface Attribution {
  source: CalendarSource;
  rule: CalendarRule;
  userId: string | null;
  bucket: CalendarBucket | null;
  appointmentId: string | null;
}

export interface AppointmentRef {
  appointmentId: string;
  createdById: string;
  assignedToId: string | null;
  googleSyncedAt: Date | null;
}

/** 执行器一次准备好的查表上下文 */
export interface AttributionContext {
  /** googleEventId → 预约（只含本轮涉及的事件） */
  appointmentsByEventId: Map<string, AppointmentRef>;
  /** 小写邮箱 → userId（账号邮箱、日历连接邮箱、别名） */
  memberByEmail: Map<string, string>;
  bucketByUserId: Map<string, CalendarBucket>;
  /** 小写 */
  websiteBookerEmails: Set<string>;
  /** 小写 */
  websiteMarkers: string[];
}

export type CalendarChangeKind = "created" | "updated" | "cancelled";

export interface FieldDiff {
  field: "start" | "end" | "summary";
  before: string | null;
  after: string | null;
}

/** 账本一行的 afterData（不含描述） */
export interface LedgerAfterData {
  v: 1;
  calendarId: string;
  eventId: string;
  kind: CalendarChangeKind;
  baseline: boolean;
  googleCreated: string | null;
  googleUpdated: string;
  creatorEmail: string | null;
  organizerEmail: string | null;
  summary: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
  recurringEventId: string | null;
  htmlLink: string | null;
  attribution: Attribution;
  editedVia: "qingyan" | null;
  diff: FieldDiff[] | null;
  /** 修改 / 删除时此前没有账本（基线前创建或重复系列单次例外）；无从比较前后值 */
  firstObserved?: boolean;
}

export interface CalendarNotificationDraft {
  title: string;
  summary: string;
}

export interface CalendarActorRow {
  userId: string;
  name: string;
  bucket: CalendarBucket | null;
  created: number;
  updated: number;
  cancelled: number;
}

export interface CalendarUnknownSample {
  eventId: string;
  creatorEmail: string | null;
  summary: string | null;
  googleCreated: string | null;
}

export interface CalendarAttributionSummary {
  scope: "org" | "own";
  /** 只在 org 范围给出 */
  bySource?: { qingyan: number; member: number; website: number; unknown: number };
  byActor: CalendarActorRow[];
  /** 只在 org 范围给出 */
  unknownSamples?: CalendarUnknownSample[];
  truncated: boolean;
}
