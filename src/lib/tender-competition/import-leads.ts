/**
 * TI-3a 进口线索（纯函数）
 *
 * 进口商 → 出口商候选的历史关联只是寻源线索：不代表独家、当前供货，也不代表对方的投标价。
 * 状态只有一条升级路径，且必须由人工用 12 个月内的证据确认；没有自动升级。
 */
import { parseClosingTime } from "@/lib/tender-price-schedule/closing-time";

export const IMPORT_LEAD_STATUSES = ["LEAD_UNVERIFIED", "CONFIRMED_CURRENT"] as const;
export type ImportLeadStatus = (typeof IMPORT_LEAD_STATUSES)[number];
export const IMPORT_LEAD_STATUS_ZH: Record<ImportLeadStatus, string> = {
  LEAD_UNVERIFIED: "线索，未证实当前供货",
  CONFIRMED_CURRENT: "已确认当前供货",
};

export const IMPORT_LEAD_SOURCES = ["LICENSED_TRADE_DATA", "PUBLIC_DATASET", "USER_ENTRY"] as const;
export type ImportLeadSource = (typeof IMPORT_LEAD_SOURCES)[number];

/** 证据或运单距今超过这个月数即视为历史。 */
export const CURRENT_EVIDENCE_MAX_AGE_MONTHS = 12;
export const IMPORT_LEAD_CAVEAT_ZH = "历史进口关联只是寻源线索：不代表独家、不代表当前供货，也不代表对方的投标价。";

export type ImportLeadInput = {
  importerName: string;
  exporterName: string;
  sourceKind: ImportLeadSource;
  providerLabel?: string | null;
  /** 带时区的采集时间 */
  capturedAt: string;
  /** YYYY-MM-DD */
  shipmentDate?: string | null;
  goodsDescription?: string | null;
  evidenceRef: string;
};

export type ImportLead = {
  importerName: string;
  exporterName: string;
  sourceKind: ImportLeadSource;
  providerLabel: string | null;
  capturedAt: string;
  shipmentDate: string | null;
  goodsDescription: string | null;
  evidenceRef: string;
  status: ImportLeadStatus;
  statusZh: string;
  /** 运单日期距今超过 12 个月；没有运单日期时为 null（未知） */
  isHistorical: boolean | null;
  caveatZh: string;
  confirmation: { confirmedBy: string; confirmedAt: string; evidenceRef: string; evidenceDate: string } | null;
};

type Fail<C extends string> = { ok: false; code: C; messageZh: string };

function parseDay(s: string | null | undefined): Date | null {
  const m = typeof s === "string" ? s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d : null;
}

/** date 是否早于 now 往前推 12 个月。 */
export function isOlderThanCurrentWindow(date: Date, now: Date): boolean {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - CURRENT_EVIDENCE_MAX_AGE_MONTHS, now.getUTCDate()));
  return date.getTime() < cutoff.getTime();
}

export function createImportLead(
  input: ImportLeadInput,
  now: Date,
): { ok: true; lead: ImportLead } | Fail<"IMPORTER_MISSING" | "EXPORTER_MISSING" | "SOURCE_INVALID" | "CAPTURED_AT_INVALID" | "EVIDENCE_MISSING" | "SHIPMENT_DATE_INVALID"> {
  if (!input.importerName?.trim()) return { ok: false, code: "IMPORTER_MISSING", messageZh: "缺少进口商名称" };
  if (!input.exporterName?.trim()) return { ok: false, code: "EXPORTER_MISSING", messageZh: "缺少出口商名称" };
  if (!(IMPORT_LEAD_SOURCES as readonly string[]).includes(input.sourceKind)) return { ok: false, code: "SOURCE_INVALID", messageZh: "来源类别无效" };
  if (!parseClosingTime(input.capturedAt).ok) return { ok: false, code: "CAPTURED_AT_INVALID", messageZh: "采集时间无效或缺少时区" };
  if (!input.evidenceRef?.trim()) return { ok: false, code: "EVIDENCE_MISSING", messageZh: "缺少证据引用：没有出处的线索不收" };
  let isHistorical: boolean | null = null;
  const rawShipment = input.shipmentDate?.trim() || null;
  if (rawShipment) {
    const d = parseDay(rawShipment);
    if (!d) return { ok: false, code: "SHIPMENT_DATE_INVALID", messageZh: "运单日期须为 YYYY-MM-DD" };
    isHistorical = isOlderThanCurrentWindow(d, now);
  }
  return {
    ok: true,
    lead: {
      importerName: input.importerName.trim(),
      exporterName: input.exporterName.trim(),
      sourceKind: input.sourceKind,
      providerLabel: input.providerLabel?.trim() || null,
      capturedAt: input.capturedAt,
      shipmentDate: rawShipment,
      goodsDescription: input.goodsDescription?.trim() || null,
      evidenceRef: input.evidenceRef.trim(),
      status: "LEAD_UNVERIFIED",
      statusZh: IMPORT_LEAD_STATUS_ZH.LEAD_UNVERIFIED,
      isHistorical,
      caveatZh: IMPORT_LEAD_CAVEAT_ZH,
      confirmation: null,
    },
  };
}

/** 唯一的升级路径：人工 + 12 个月内的证据 + 确认人。失败时原线索不变。 */
export function confirmCurrentSupply(
  lead: ImportLead,
  input: { evidenceDate: string; evidenceRef: string; confirmedBy: string; now: Date },
): { ok: true; lead: ImportLead } | Fail<"CONFIRMER_MISSING" | "EVIDENCE_MISSING" | "EVIDENCE_DATE_INVALID" | "EVIDENCE_TOO_OLD" | "EVIDENCE_IN_FUTURE"> {
  if (!input.confirmedBy?.trim()) return { ok: false, code: "CONFIRMER_MISSING", messageZh: "缺少确认人：只有人工可以确认当前供货" };
  if (!input.evidenceRef?.trim()) return { ok: false, code: "EVIDENCE_MISSING", messageZh: "缺少证据引用" };
  const d = parseDay(input.evidenceDate);
  if (!d) return { ok: false, code: "EVIDENCE_DATE_INVALID", messageZh: "证据日期须为 YYYY-MM-DD" };
  if (d.getTime() > input.now.getTime()) return { ok: false, code: "EVIDENCE_IN_FUTURE", messageZh: "证据日期在未来" };
  if (isOlderThanCurrentWindow(d, input.now)) {
    return { ok: false, code: "EVIDENCE_TOO_OLD", messageZh: `证据超过 ${CURRENT_EVIDENCE_MAX_AGE_MONTHS} 个月，不能用来确认当前供货` };
  }
  return {
    ok: true,
    lead: {
      ...lead,
      status: "CONFIRMED_CURRENT",
      statusZh: IMPORT_LEAD_STATUS_ZH.CONFIRMED_CURRENT,
      confirmation: { confirmedBy: input.confirmedBy.trim(), confirmedAt: input.now.toISOString(), evidenceRef: input.evidenceRef.trim(), evidenceDate: input.evidenceDate.trim() },
    },
  };
}
