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
