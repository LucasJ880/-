/**
 * INSTALL-2d：维修单（纯函数）
 *
 * - 单元问题 = AuditLog 行：action "install.window.issue"，目标类型 / 目标与完工照相同（design D1）
 * - 维修单 = AuditLog 行：action "install.repair.submitted"，targetType "blinds_order"，targetId = 工艺单 id；
 *   维修单 id = 审计行 id（design D3）
 * - 问题类型 → 是否需工厂：查表（任务书 §4.3；纪律 7）
 */

import type { FulfillmentCategory } from "@/lib/fulfillment/category";
import type { UnitSection } from "./closeout";

export const INSTALL_WINDOW_ISSUE = "install.window.issue" as const;
export const INSTALL_REPAIR_SUBMITTED = "install.repair.submitted" as const;
export const REPAIR_TARGET_TYPE = "blinds_order" as const;
/** 提交维修单时 install.task.completed 的结果 */
export const REPAIR_OUTCOME = "needs_repair" as const;

/** 站内通知类型与实体 */
export const NOTIFY_REPAIR_SUBMITTED = "install_repair_submitted" as const;
/** 发给出单 / 运营 / 会计的通知实体：落到维修单详情 */
export const ENTITY_INSTALL_REPAIR = "install_repair" as const;

export const ISSUE_TYPES = [
  "wrong_size",
  "missing_parts",
  "damaged",
  "wrong_color",
  "motor",
  "site_condition",
  "customer",
  "other",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  wrong_size: "尺寸不符需重做",
  missing_parts: "部件缺失 / 漏发",
  damaged: "产品损坏 / 瑕疵",
  wrong_color: "颜色 / 面料不符",
  motor: "电机 / 遥控 / 充电问题",
  site_condition: "现场条件不具备",
  customer: "客户原因（不在家 / 改期 / 改方案）",
  other: "其他",
};

/** 是否需工厂出单（"其他"由安装工选择，见 needsFactoryFor） */
const NEEDS_FACTORY: Record<Exclude<IssueType, "other">, boolean> = {
  wrong_size: true,
  missing_parts: true,
  damaged: true,
  wrong_color: true,
  motor: true,
  site_condition: false,
  customer: false,
};

export function isIssueType(v: unknown): v is IssueType {
  return typeof v === "string" && (ISSUE_TYPES as readonly string[]).includes(v);
}

/** 查表；"其他"取安装工的选择，未选视为需工厂 */
export function needsFactoryFor(type: IssueType, chosen?: boolean | null): boolean {
  if (type === "other") return chosen ?? true;
  return NEEDS_FACTORY[type];
}

export const ISSUE_DESCRIPTION_MAX = 300;

function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

export type IssueInput = { issueType: IssueType; description: string; needsFactory: boolean };

/** 标记问题的入参（multipart 字段）校验；照片另行校验 */
export function validateIssueInput(raw: { issueType: unknown; description: unknown; needsFactory?: unknown }):
  | { ok: true; value: IssueInput }
  | { ok: false; error: string } {
  if (!isIssueType(raw.issueType)) return { ok: false, error: "请选择问题类型" };
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (!description) return { ok: false, error: "请写问题描述" };
  if (description.length > ISSUE_DESCRIPTION_MAX) return { ok: false, error: `问题描述不超过 ${ISSUE_DESCRIPTION_MAX} 字` };
  return {
    ok: true,
    value: { issueType: raw.issueType, description, needsFactory: needsFactoryFor(raw.issueType, parseBool(raw.needsFactory)) },
  };
}

// ─────────────────────────── 日期 / 单号 ───────────────────────────

export const REPAIR_DEFAULT_DAYS = 7;
export const PREFERRED_MAX_DAYS = 365;

function validYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** YYYY-MM-DD + n 个日历日 */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 目标日：客户期望日优先，否则填写日 + 7 个日历日（design D6；Q8） */
export function repairTargetDate(fillDate: string, preferred: string | null): string {
  return preferred ?? addDays(fillDate, REPAIR_DEFAULT_DAYS);
}

/** 单号 R-<工艺单号>-<该工艺单第几张维修单> */
export function repairNumber(orderCode: string, seq: number): string {
  return `R-${orderCode}-${seq}`;
}

/** 已过目标日（今天晚于目标日） */
export function isRepairOverdue(targetDate: string, today: string): boolean {
  return today > targetDate;
}

export type RepairHeaderInput = {
  customerName: string;
  phone: string;
  notes: string;
  customerPreferredDate: string | null;
  customerConfirmed: boolean;
};

const NAME_MAX = 100;
const PHONE_MAX = 40;
const NOTES_MAX = 1000;

/** 维修单表头校验（spec「提交维修单的条件」）；today = 企业时区当天 */
export function validateRepairHeader(raw: unknown, ctx: { today: string }):
  | { ok: true; value: RepairHeaderInput }
  | { ok: false; error: string } {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const customerName = typeof o.customerName === "string" ? o.customerName.trim() : "";
  if (!customerName) return { ok: false, error: "请填写客户名" };
  if (customerName.length > NAME_MAX) return { ok: false, error: `客户名不超过 ${NAME_MAX} 字` };
  const phone = typeof o.phone === "string" ? o.phone.trim() : "";
  if (phone.length > PHONE_MAX) return { ok: false, error: `电话不超过 ${PHONE_MAX} 字` };
  const notes = typeof o.notes === "string" ? o.notes.trim() : "";
  if (notes.length > NOTES_MAX) return { ok: false, error: `备注不超过 ${NOTES_MAX} 字` };
  const rawDate = typeof o.customerPreferredDate === "string" ? o.customerPreferredDate.trim() : "";
  let customerPreferredDate: string | null = null;
  if (rawDate) {
    if (!validYmd(rawDate)) return { ok: false, error: "客户期望日期格式应为 YYYY-MM-DD" };
    if (rawDate < ctx.today) return { ok: false, error: "客户期望日期不能早于今天" };
    if (rawDate > addDays(ctx.today, PREFERRED_MAX_DAYS)) return { ok: false, error: `客户期望日期不能晚于 ${PREFERRED_MAX_DAYS} 天后` };
    customerPreferredDate = rawDate;
  }
  return { ok: true, value: { customerName, phone, notes, customerPreferredDate, customerConfirmed: o.customerConfirmed === true } };
}

// ─────────────────────────── 记录 ───────────────────────────

export type RepairPhoto = { proxyUrl: string; at: string };

export type RepairRow = {
  n: number;
  unitId: string;
  itemNumber: number;
  section: UnitSection;
  location: string;
  description: string;
  issueType: IssueType;
  needsFactory: boolean;
  category: FulfillmentCategory | null;
  photos: RepairPhoto[];
};

/** install.repair.submitted 的 afterData */
export type RepairRecordData = {
  repairNo: string;
  seq: number;
  orderId: string;
  orderCode: string;
  appointmentId: string;
  header: { customerName: string; phone: string; notes: string; takenById: string };
  rows: RepairRow[];
  fillDate: string;
  customerPreferredDate: string | null;
  targetDate: string;
  customerConfirmed: boolean;
};

export type RepairRecord = RepairRecordData & { id: string; submittedAt: string; submittedById: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** 解析维修单审计行；坏数据 → null */
export function parseRepairRecord(row: { id: string; afterData: string | null; createdAt: Date | string; userId: string }): RepairRecord | null {
  if (!row.afterData) return null;
  try {
    const d = JSON.parse(row.afterData) as Record<string, unknown>;
    if (typeof d.repairNo !== "string" || typeof d.orderId !== "string" || !Array.isArray(d.rows)) return null;
    const h = (d.header ?? {}) as Record<string, unknown>;
    const rows: RepairRow[] = (d.rows as Array<Record<string, unknown>>)
      .filter((r) => r && isIssueType(r.issueType))
      .map((r, i) => ({
        n: typeof r.n === "number" ? r.n : i + 1,
        unitId: str(r.unitId),
        itemNumber: typeof r.itemNumber === "number" ? r.itemNumber : 0,
        section: (str(r.section) || "blinds") as UnitSection,
        location: str(r.location),
        description: str(r.description),
        issueType: r.issueType as IssueType,
        needsFactory: r.needsFactory === true,
        category: (typeof r.category === "string" ? r.category : null) as FulfillmentCategory | null,
        photos: Array.isArray(r.photos)
          ? (r.photos as Array<Record<string, unknown>>)
              .filter((p) => typeof p?.proxyUrl === "string")
              .map((p) => ({ proxyUrl: p.proxyUrl as string, at: str(p.at) }))
          : [],
      }));
    return {
      id: row.id,
      submittedAt: new Date(row.createdAt).toISOString(),
      submittedById: row.userId,
      repairNo: d.repairNo,
      seq: typeof d.seq === "number" ? d.seq : 1,
      orderId: d.orderId,
      orderCode: str(d.orderCode),
      appointmentId: str(d.appointmentId),
      header: { customerName: str(h.customerName), phone: str(h.phone), notes: str(h.notes), takenById: str(h.takenById) || row.userId },
      rows,
      fillDate: str(d.fillDate),
      customerPreferredDate: typeof d.customerPreferredDate === "string" ? d.customerPreferredDate : null,
      targetDate: str(d.targetDate),
      customerConfirmed: d.customerConfirmed === true,
    };
  } catch {
    return null;
  }
}

/** 需工厂行涉及的品类；有需工厂行但品类推不出 → unknown（发给三个品类岗，design D7） */
export function repairFactoryCategories(rows: Array<Pick<RepairRow, "needsFactory" | "category">>): {
  categories: FulfillmentCategory[];
  unknown: boolean;
  any: boolean;
} {
  const factory = rows.filter((r) => r.needsFactory);
  const categories = [...new Set(factory.map((r) => r.category).filter((c): c is FulfillmentCategory => !!c))];
  return { categories, unknown: factory.some((r) => !r.category), any: factory.length > 0 };
}

/** 打印版：不足 10 行补空行（null），超过全部列出 */
export const PRINT_MIN_ROWS = 10;
export function padPrintRows<T>(rows: T[], min: number = PRINT_MIN_ROWS): Array<T | null> {
  return [...rows, ...Array.from({ length: Math.max(0, min - rows.length) }, () => null)];
}

// ─────────────────────────── INSTALL-2e：维修单进度（事件流，design D1 / D2 / D9） ───────────────────────────

export const INSTALL_REPAIR_FACTORY_ISSUED = "install.repair.factory_issued" as const;
export const INSTALL_REPAIR_SCHEDULED = "install.repair.scheduled" as const;
export const INSTALL_REPAIR_COMPLETED = "install.repair.completed" as const;
export const REPAIR_EVENT_ACTIONS = [INSTALL_REPAIR_FACTORY_ISSUED, INSTALL_REPAIR_SCHEDULED, INSTALL_REPAIR_COMPLETED] as const;
/** 返修预约完成收口时 install.task.completed 的结果（算"完成收口记录"，区别于 needs_repair） */
export const RETURN_OUTCOME = "repair_completed" as const;

export const NOTIFY_REPAIR_FACTORY_ISSUED = "install_repair_factory_issued" as const;
export const NOTIFY_REPAIR_SCHEDULED = "install_repair_scheduled" as const;
/** INSTALL-2f：维修单作废 / 关闭不返修；维修单逾期 */
export const NOTIFY_REPAIR_CLOSED = "install_repair_closed" as const;
export const NOTIFY_REPAIR_OVERDUE = "install_repair_overdue" as const;
/** 发给安装工的通知实体：落到 /install/<预约 id> */
export const ENTITY_INSTALL_TASK = "install_task" as const;

/** 需工厂行的出单品类；品类推不出 → "unknown"（任一品类岗或伞键可登记） */
export const UNKNOWN_CATEGORY = "unknown" as const;
export type FactoryCategory = FulfillmentCategory | typeof UNKNOWN_CATEGORY;
export const FACTORY_CATEGORY_LABEL: Record<FactoryCategory, string> = {
  vinyl: "Vinyl",
  drapery: "布帘",
  shades: "Roller/Zebra/Roman",
  unknown: "品类待确认",
};
const FACTORY_ORDER: FactoryCategory[] = ["vinyl", "drapery", "shades", UNKNOWN_CATEGORY];
const isFactoryCategory = (v: unknown): v is FactoryCategory => typeof v === "string" && (FACTORY_ORDER as string[]).includes(v);

export type RepairEvent = {
  id: string;
  action: string;
  repairId: string;
  at: string;
  userId: string;
  data: Record<string, unknown>;
};

/** 解析维修单事件审计行（afterData 必须带 repairId）；坏数据 → null */
export function parseRepairEvent(row: { id: string; action: string; afterData: string | null; createdAt: Date | string; userId: string }): RepairEvent | null {
  if (!row.afterData || !(REPAIR_EVENT_ACTIONS as readonly string[]).includes(row.action)) return null;
  try {
    const d = JSON.parse(row.afterData) as Record<string, unknown>;
    if (typeof d.repairId !== "string" || !d.repairId) return null;
    return { id: row.id, action: row.action, repairId: d.repairId, at: new Date(row.createdAt).toISOString(), userId: row.userId, data: d };
  } catch {
    return null;
  }
}

export type FactoryIssue = { category: FactoryCategory; readyDate: string; note: string; byUserId: string; at: string; eventId: string };
export type RepairSchedule = { appointmentId: string; installAt: string; assignedToId: string; byUserId: string; at: string; eventId: string };
/** 关闭原因：返修完成 / 转入新单 / 已作废（INSTALL-2f）/ 关闭不返修（INSTALL-2f） */
export const CLOSE_REASONS = ["completed", "superseded", "voided", "waived"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];
export const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  completed: "返修已完成",
  superseded: "转入新单",
  voided: "已作废",
  waived: "关闭不返修",
};
const isCloseReason = (v: unknown): v is CloseReason => typeof v === "string" && (CLOSE_REASONS as readonly string[]).includes(v);
export type RepairClosed = { reason: CloseReason; supersededBy: string | null; note: string; byUserId: string; at: string };

export type RepairProgress = {
  /** 需工厂行涉及的出单品类（按 Vinyl / 布帘 / Roller / 待确认 排序） */
  factoryCategories: FactoryCategory[];
  issued: FactoryIssue[];
  pendingCategories: FactoryCategory[];
  /** 已登记品类里最晚的预计备好日 */
  readyDate: string | null;
  /** 最新一条排期（改期以最新为准） */
  schedule: RepairSchedule | null;
  closed: RepairClosed | null;
};

/** 需工厂行的出单品类（含"待确认"） */
export function factoryCategoriesOf(rows: Array<Pick<RepairRow, "needsFactory" | "category">>): FactoryCategory[] {
  const set = new Set<FactoryCategory>(rows.filter((r) => r.needsFactory).map((r) => r.category ?? UNKNOWN_CATEGORY));
  return FACTORY_ORDER.filter((c) => set.has(c));
}

/** 维修单进度（纯函数）：events 只取本维修单的，顺序不限 */
export function repairProgress(rec: Pick<RepairRecord, "id" | "rows">, events: RepairEvent[]): RepairProgress {
  const mine = events.filter((e) => e.repairId === rec.id).sort((a, b) => a.at.localeCompare(b.at));
  const factoryCategories = factoryCategoriesOf(rec.rows);
  const issued: FactoryIssue[] = [];
  let schedule: RepairSchedule | null = null;
  let closed: RepairClosed | null = null;
  for (const e of mine) {
    if (e.action === INSTALL_REPAIR_FACTORY_ISSUED) {
      const cats = Array.isArray(e.data.categories) ? (e.data.categories as unknown[]).filter(isFactoryCategory) : [];
      for (const c of cats) {
        if (issued.some((i) => i.category === c)) continue;
        issued.push({ category: c, readyDate: str(e.data.readyDate), note: str(e.data.note), byUserId: e.userId, at: e.at, eventId: e.id });
      }
    } else if (e.action === INSTALL_REPAIR_SCHEDULED) {
      if (typeof e.data.appointmentId === "string") {
        schedule = {
          appointmentId: e.data.appointmentId,
          installAt: str(e.data.installAt),
          assignedToId: str(e.data.assignedToId),
          byUserId: e.userId,
          at: e.at,
          eventId: e.id,
        };
      }
    } else if (e.action === INSTALL_REPAIR_COMPLETED && !closed) {
      closed = {
        reason: isCloseReason(e.data.reason) ? e.data.reason : "completed",
        supersededBy: typeof e.data.supersededBy === "string" ? e.data.supersededBy : null,
        note: str(e.data.note),
        byUserId: e.userId,
        at: e.at,
      };
    }
  }
  const issuedSet = new Set(issued.map((i) => i.category));
  const pendingCategories = factoryCategories.filter((c) => !issuedSet.has(c));
  const dates = issued.map((i) => i.readyDate).filter(Boolean).sort();
  return { factoryCategories, issued, pendingCategories, readyDate: dates[dates.length - 1] ?? null, schedule, closed };
}

export type RepairHolder = {
  /** 持有的品类修改键 orders.fulfillment.update.<品类> */
  categoryKeys: FulfillmentCategory[];
  /** 持全品类伞键 orders.fulfillment.update */
  umbrella: boolean;
  /** 持 install.task.assign（ORG） */
  canAssign: boolean;
};

/** 某人能登记的品类（"待确认"品类：任一品类岗或伞键） */
function canIssueCategory(c: FactoryCategory, h: RepairHolder): boolean {
  if (h.umbrella) return true;
  if (c === UNKNOWN_CATEGORY) return h.categoryKeys.length > 0;
  return h.categoryKeys.includes(c);
}

export type RepairActions = { issueCategories: FactoryCategory[]; canSchedule: boolean; canVoid: boolean; canClose: boolean };
/** 维修单所处情形：是否在返修预约上提交（INSTALL-2f：这种不能作废，design D2） */
export type RepairContext = { returnVisit: boolean };

/** 可执行操作（页面按钮与写接口共用，2e design D9 / 2f design D5） */
export function repairActions(p: RepairProgress, h: RepairHolder, ctx: RepairContext): RepairActions {
  if (p.closed) return { issueCategories: [], canSchedule: false, canVoid: false, canClose: false };
  return {
    issueCategories: p.pendingCategories.filter((c) => canIssueCategory(c, h)),
    canSchedule: h.canAssign,
    canVoid: h.canAssign && !ctx.returnVisit,
    canClose: h.canAssign,
  };
}

export type IssueDecision =
  | { ok: true; categories: FactoryCategory[] }
  | { ok: false; status: 403 | 409; code: "FORBIDDEN" | "NOT_NEEDED" | "CLOSED" | "ALREADY_ISSUED"; error: string };

/** 出单确认的判定（spec「出单确认按品类登记」）：与 repairActions 同口径 */
export function issueDecision(p: RepairProgress, h: RepairHolder): IssueDecision {
  if (!h.umbrella && h.categoryKeys.length === 0) return { ok: false, status: 403, code: "FORBIDDEN", error: "只有出单岗可以登记出单" };
  if (p.factoryCategories.length === 0) return { ok: false, status: 409, code: "NOT_NEEDED", error: "该维修单不需要工厂出单" };
  if (!p.factoryCategories.some((c) => canIssueCategory(c, h))) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "该维修单没有你负责的品类" };
  }
  if (p.closed) return { ok: false, status: 409, code: "CLOSED", error: "维修单已关闭" };
  const categories = p.pendingCategories.filter((c) => canIssueCategory(c, h));
  if (categories.length === 0) return { ok: false, status: 409, code: "ALREADY_ISSUED", error: "你负责的品类已登记出单" };
  return { ok: true, categories };
}

export const FACTORY_NOTE_MAX = 500;

/** 出单登记入参：预计备好日不早于填写日、不晚于 365 天后；备注 ≤ 500 */
export function validateFactoryIssue(raw: unknown, ctx: { fillDate: string }):
  | { ok: true; value: { readyDate: string; note: string } }
  | { ok: false; error: string } {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const readyDate = typeof o.readyDate === "string" ? o.readyDate.trim() : "";
  if (!validYmd(readyDate)) return { ok: false, error: "预计备好日格式应为 YYYY-MM-DD" };
  if (readyDate < ctx.fillDate) return { ok: false, error: "预计备好日不能早于维修单填写日" };
  if (readyDate > addDays(ctx.fillDate, PREFERRED_MAX_DAYS)) return { ok: false, error: `预计备好日不能晚于 ${PREFERRED_MAX_DAYS} 天后` };
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (note.length > FACTORY_NOTE_MAX) return { ok: false, error: `备注不超过 ${FACTORY_NOTE_MAX} 字` };
  return { ok: true, value: { readyDate, note } };
}

/** 排返修入参：时间可解析、不早于 1 天前、不晚于 365 天后；必须选安装工 */
export function validateRepairSchedule(raw: unknown, now: Date = new Date()):
  | { ok: true; value: { installAt: Date; assignedToId: string } }
  | { ok: false; code: "NO_INSTALL_DATE" | "NO_INSTALLER"; error: string } {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const installAt = typeof o.installAt === "string" && o.installAt.trim() ? new Date(o.installAt) : null;
  if (!installAt || Number.isNaN(installAt.getTime())) return { ok: false, code: "NO_INSTALL_DATE", error: "请选择返修时间" };
  if (installAt.getTime() < now.getTime() - 86_400_000 || installAt.getTime() > now.getTime() + PREFERRED_MAX_DAYS * 86_400_000) {
    return { ok: false, code: "NO_INSTALL_DATE", error: "返修时间应在今天到一年内" };
  }
  const assignedToId = typeof o.assignedToId === "string" ? o.assignedToId.trim() : "";
  if (!assignedToId) return { ok: false, code: "NO_INSTALLER", error: "必须选择安装岗位的人" };
  return { ok: true, value: { installAt, assignedToId } };
}

/** 排返修的提示：出单未全部登记 / 预计备好日晚于返修日（照常排，design D3） */
export function scheduleWarnings(p: RepairProgress, installDate: string): string[] {
  const out: string[] = [];
  if (p.pendingCategories.length > 0) {
    out.push(`出单尚未登记：${p.pendingCategories.map((c) => FACTORY_CATEGORY_LABEL[c]).join("、")}`);
  }
  if (p.readyDate && p.readyDate > installDate) out.push(`返修件预计 ${p.readyDate} 才备好，晚于返修日 ${installDate}`);
  return out;
}

// ─────────────────────────── INSTALL-2e：返修预约与任务收口范围（design D4） ───────────────────────────

/** 预约是不是某张维修单的返修预约（该维修单最新一条排期指向它）；是 → 该维修单 */
export function returnRepairFor<R extends Pick<RepairRecord, "id" | "rows">>(appointmentId: string, repairs: R[], events: RepairEvent[]): R | null {
  for (const r of repairs) {
    if (repairProgress(r, events).schedule?.appointmentId === appointmentId) return r;
  }
  return null;
}

/** 任务收口范围：返修预约 → 维修单各行对应的单元；普通预约（repair 为 null）→ 全部单元 */
export function scopeUnits<T extends { id: string }>(units: T[], repair: Pick<RepairRecord, "rows"> | null): T[] {
  if (!repair) return units;
  const ids = new Set(repair.rows.map((r) => r.unitId));
  return units.filter((u) => ids.has(u.id));
}

// ─────────────────────────── INSTALL-2f：作废 / 关闭不返修 / 逾期提醒 ───────────────────────────

/** 维修单是在返修预约上提交的：它的提交预约被另一张维修单的排期指向过（design D2） */
export function isReturnVisitRepair(rec: Pick<RepairRecord, "id" | "appointmentId">, events: RepairEvent[]): boolean {
  return events.some((e) => e.action === INSTALL_REPAIR_SCHEDULED && e.repairId !== rec.id && e.data.appointmentId === rec.appointmentId);
}

export type CloseDecision =
  | { ok: true }
  | { ok: false; status: 403 | 409; code: "FORBIDDEN" | "CLOSED" | "RETURN_VISIT"; error: string };

/** 作废判定（spec「维修单作废的条件」）：与 repairActions.canVoid 同口径；工艺单 / 预约状态在锁内另判 */
export function voidDecision(p: RepairProgress, h: RepairHolder, ctx: RepairContext): CloseDecision {
  if (!h.canAssign) return { ok: false, status: 403, code: "FORBIDDEN", error: "只有运营 / 会计 / 老板岗位可以作废维修单" };
  if (p.closed) return { ok: false, status: 409, code: "CLOSED", error: "维修单已关闭" };
  if (ctx.returnVisit) {
    return { ok: false, status: 409, code: "RETURN_VISIT", error: "返修时提交的维修单不能作废，请用「关闭不返修」" };
  }
  return { ok: true };
}

/** 关闭不返修判定（spec「关闭不返修」）：与 repairActions.canClose 同口径 */
export function closeDecision(p: RepairProgress, h: RepairHolder): CloseDecision {
  if (!h.canAssign) return { ok: false, status: 403, code: "FORBIDDEN", error: "只有运营 / 会计 / 老板岗位可以关闭维修单" };
  if (p.closed) return { ok: false, status: 409, code: "CLOSED", error: "维修单已关闭" };
  return { ok: true };
}

export const CLOSE_NOTE_MAX = 500;

/** 作废 / 关闭不返修的原因：必填、不超过 500 字 */
export function validateCloseReason(raw: unknown): { ok: true; value: { reason: string } } | { ok: false; error: string } {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  if (!reason) return { ok: false, error: "请填写原因" };
  if (reason.length > CLOSE_NOTE_MAX) return { ok: false, error: `原因不超过 ${CLOSE_NOTE_MAX} 字` };
  return { ok: true, value: { reason } };
}

/** 两个 YYYY-MM-DD 相差的天数（b − a） */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export type OverdueStuck = "factory" | "unscheduled" | "return_missed";
export type OverdueReminder = { daysOverdue: number; stuck: OverdueStuck; pendingCategories: FactoryCategory[]; returnDate: string | null };

/**
 * 逾期提醒选择（spec「维修单逾期提醒」，design D7）：目标日早于今天、未关闭、
 * 且没有"今天或以后、仍有效"的返修预约。returnAppt = 最新排期指向的预约（企业时区日期、是否仍有效）。
 */
export function overdueReminder(
  rec: Pick<RepairRecord, "targetDate">,
  p: RepairProgress,
  today: string,
  returnAppt: { date: string; active: boolean } | null,
): OverdueReminder | null {
  if (p.closed || !(rec.targetDate < today)) return null;
  const booked = !!p.schedule && !!returnAppt && returnAppt.active;
  if (booked && returnAppt!.date >= today) return null;
  const stuck: OverdueStuck = booked ? "return_missed" : p.pendingCategories.length > 0 ? "factory" : "unscheduled";
  return { daysOverdue: daysBetween(rec.targetDate, today), stuck, pendingCategories: p.pendingCategories, returnDate: booked ? returnAppt!.date : null };
}

/** 逾期提醒摘要（不含金额） */
export function overdueSummary(rec: Pick<RepairRecord, "targetDate">, r: OverdueReminder): string {
  const head = `目标 ${rec.targetDate}，已过 ${r.daysOverdue} 天`;
  if (r.stuck === "return_missed") return `${head}；返修日 ${r.returnDate} 已过仍未收口`;
  if (r.stuck === "factory") return `${head}；待登记出单：${r.pendingCategories.map((c) => FACTORY_CATEGORY_LABEL[c]).join("、")}`;
  return `${head}；未排返修`;
}

// ── INSTALL-2i：维修单列表分栏（进行中 / 已归档）、搜索、排序、分页 ────────────

export const REPAIR_LIST_TABS = ["open", "archived"] as const;
export type RepairListTab = (typeof REPAIR_LIST_TABS)[number];
export const REPAIR_LIST_PAGE_SIZE = 20;
export const REPAIR_LIST_PAGE_SIZE_MAX = 50;
const REPAIR_LIST_Q_MAX = 60;

export type RepairListQuery = { tab: RepairListTab; page: number; pageSize: number; q: string };

/** 列表参数容错（install-2i design D4）：非法栏按进行中，页码非正整数按 1，每页非数字按 20 再夹到 1–50 */
export function parseRepairListQuery(params: { get(name: string): string | null }): RepairListQuery {
  const tab: RepairListTab = params.get("tab") === "archived" ? "archived" : "open";
  const pageRaw = Number.parseInt(params.get("page") ?? "", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = Number.parseInt(params.get("pageSize") ?? "", 10);
  const pageSize = Number.isFinite(sizeRaw) ? Math.min(REPAIR_LIST_PAGE_SIZE_MAX, Math.max(1, sizeRaw)) : REPAIR_LIST_PAGE_SIZE;
  const q = (params.get("q") ?? "").trim().slice(0, REPAIR_LIST_Q_MAX);
  return { tab, page, pageSize, q };
}

/** 分栏所需的最少字段；closedAt 有值 = 已关闭（任何原因）= 已归档（design D1） */
export type RepairListEntry = { id: string; repairNo: string; orderCode: string; customerName: string; targetDate: string; closedAt: string | null };

/** 分栏 + 搜索 + 排序 + 分页（design D3）；两栏总数按同一搜索词计算 */
export function repairListPage<T extends RepairListEntry>(
  entries: T[],
  query: RepairListQuery,
): { items: T[]; total: number; counts: Record<RepairListTab, number> } {
  const needle = query.q.toLowerCase();
  const hit = (e: T) => !needle || [e.repairNo, e.orderCode, e.customerName].some((s) => s.toLowerCase().includes(needle));
  const matched = entries.filter(hit);
  const open = matched.filter((e) => !e.closedAt).sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.repairNo.localeCompare(b.repairNo));
  const archived = matched
    .filter((e) => !!e.closedAt)
    .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || a.repairNo.localeCompare(b.repairNo));
  const list = query.tab === "archived" ? archived : open;
  const start = (query.page - 1) * query.pageSize;
  return { items: list.slice(start, start + query.pageSize), total: list.length, counts: { open: open.length, archived: archived.length } };
}
