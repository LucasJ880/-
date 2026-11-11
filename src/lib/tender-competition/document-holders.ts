/**
 * TI-3a 文件领取方快照（纯函数）
 *
 * 文件领取方（Document Holder / Plan Taker）只表示「下载过招标文件」，不表示投标。
 * 领取方数与投标人数是两个字段：投标人数只来自开标或投标结果记录，没有就是未知（null），
 * 不是 0，也不取领取方数。
 */
import { parseClosingTime } from "@/lib/tender-price-schedule/closing-time";
import { normalizeCompanyName } from "./company-identity";

export const HOLDER_SNAPSHOT_SOURCES = ["USER_UPLOAD_SCREENSHOT", "USER_UPLOAD_TABLE", "OFFICIAL_PUBLIC_PAGE"] as const;
export type HolderSnapshotSource = (typeof HOLDER_SNAPSHOT_SOURCES)[number];

export type DocumentHolderSnapshot = {
  solicitationId: string;
  portal: string;
  sourceKind: HolderSnapshotSource;
  /** 带时区的采集时间 */
  capturedAt: string;
  entries: Array<{ name: string }>;
  evidenceRef?: string | null;
};

export const BID_RECORD_SOURCES = ["OFFICIAL_BID_RESULTS", "UNOFFICIAL_BID_RESULTS"] as const;
/** 开标 / 投标结果记录：投标人数唯一的来源。 */
export type BidOpeningRecord = {
  sourceKind: (typeof BID_RECORD_SOURCES)[number];
  capturedAt: string;
  bidders: Array<{ name: string }>;
  evidenceRef?: string | null;
};

export const HOLDER_ROLE = "DOCUMENT_HOLDER" as const;
export const HOLDER_NOTE_ZH = "领取文件不等于投标：这是下载过招标文件的名单，不是投标人名单，也不预示谁会投标。";

export type SnapshotIssue = { code: "SOLICITATION_MISSING" | "PORTAL_MISSING" | "SOURCE_INVALID" | "CAPTURED_AT_INVALID" | "ENTRY_NAME_MISSING"; messageZh: string };

export function validateHolderSnapshot(s: DocumentHolderSnapshot): { ok: true; capturedAt: Date } | { ok: false; issues: SnapshotIssue[] } {
  const issues: SnapshotIssue[] = [];
  if (!s.solicitationId?.trim()) issues.push({ code: "SOLICITATION_MISSING", messageZh: "缺少招标编号" });
  if (!s.portal?.trim()) issues.push({ code: "PORTAL_MISSING", messageZh: "缺少门户名称" });
  if (!(HOLDER_SNAPSHOT_SOURCES as readonly string[]).includes(s.sourceKind)) issues.push({ code: "SOURCE_INVALID", messageZh: "来源类别无效" });
  const t = parseClosingTime(s.capturedAt);
  if (!t.ok) issues.push({ code: "CAPTURED_AT_INVALID", messageZh: t.code === "NO_TIMEZONE" ? "采集时间缺少时区" : "采集时间无效" });
  s.entries.forEach((e, i) => { if (!e.name?.trim()) issues.push({ code: "ENTRY_NAME_MISSING", messageZh: `第 ${i + 1} 个条目缺少名称` }); });
  return issues.length === 0 && t.ok ? { ok: true, capturedAt: t.closingAt } : { ok: false, issues };
}

export type HolderEntryView = { name: string; normalizedName: string; role: typeof HOLDER_ROLE; isOwn: boolean };

export type DocumentHolderSummary =
  | {
      ok: true;
      solicitationId: string;
      portal: string;
      sourceKind: HolderSnapshotSource;
      capturedAt: string;
      /** 快照里的条目数（门户显示的记录数） */
      documentHolderCount: number;
      ownEntryCount: number;
      competitorHolderCount: number;
      /** 只来自开标记录；没有记录 = null（未知） */
      bidderCount: number | null;
      bidderSource: (typeof BID_RECORD_SOURCES)[number] | null;
      entries: HolderEntryView[];
      /** 规范化后重复出现的名称（如实列出，不去重计数） */
      duplicateNames: string[];
      noteZh: string;
    }
  | { ok: false; issues: SnapshotIssue[] };

export function summarizeDocumentHolders(input: {
  snapshot: DocumentHolderSnapshot;
  ownNames?: readonly string[];
  bidOpening?: BidOpeningRecord | null;
}): DocumentHolderSummary {
  const v = validateHolderSnapshot(input.snapshot);
  if (!v.ok) return v;
  const own = new Set((input.ownNames ?? []).map(normalizeCompanyName).filter(Boolean));
  const entries: HolderEntryView[] = input.snapshot.entries.map((e) => {
    const normalizedName = normalizeCompanyName(e.name);
    return { name: e.name.trim(), normalizedName, role: HOLDER_ROLE, isOwn: own.has(normalizedName) };
  });
  const counts = new Map<string, number>();
  entries.forEach((e) => counts.set(e.normalizedName, (counts.get(e.normalizedName) ?? 0) + 1));
  const ownEntryCount = entries.filter((e) => e.isOwn).length;
  const bidOpening = input.bidOpening ?? null;
  return {
    ok: true,
    solicitationId: input.snapshot.solicitationId.trim(),
    portal: input.snapshot.portal.trim(),
    sourceKind: input.snapshot.sourceKind,
    capturedAt: input.snapshot.capturedAt,
    documentHolderCount: entries.length,
    ownEntryCount,
    competitorHolderCount: entries.length - ownEntryCount,
    bidderCount: bidOpening ? bidOpening.bidders.length : null,
    bidderSource: bidOpening ? bidOpening.sourceKind : null,
    entries,
    duplicateNames: [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name),
    noteZh: HOLDER_NOTE_ZH,
  };
}
