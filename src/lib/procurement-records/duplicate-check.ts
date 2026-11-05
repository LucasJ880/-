/**
 * PROC-1 重复检查（纯函数，design D8；spec「重复检查」）。
 *
 * 命中 = 同一规范申请主体 + 辖区 + 资料持有机关 + 相交采购编号 + 相交记录类别 + 相交日期范围；
 * 与渠道、标题、英文措辞无关。对本组织全部申请（含归档、关闭）生效。
 * 不确定（申请主体 / 机关 / 编号缺失或机关未命中别名表）一律按「可能重叠」保守命中并标人工复核。
 * 台账未确认、状态无法解析、读取失败 → UNVERIFIED，绝不返回「没有重复」。
 */

import { normalizeNumbers, UNKNOWN_CATEGORY } from "./request-pure";

export const REQUEST_STATUSES = [
  "DRAFT",
  "READY",
  "HANDOFF_PENDING",
  "USER_REPORTED_SUBMISSION",
  "SUBMISSION_UNKNOWN",
  "SUBMITTED",
  "ACKNOWLEDGED",
  "PROCESSING",
  "CLOSED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const GOVERNMENT_OUTCOMES = [
  "FULL_DISCLOSURE",
  "PARTIAL_DISCLOSURE",
  "NO_RECORDS",
  "ALL_WITHHELD",
  "TRANSFERRED",
  "WITHDRAWN",
  "CANCELLED",
  "OTHER",
] as const;
export type GovernmentOutcome = (typeof GOVERNMENT_OUTCOMES)[number];

export function isRequestStatus(v: unknown): v is RequestStatus {
  return typeof v === "string" && (REQUEST_STATUSES as readonly string[]).includes(v);
}

export interface ScopeSpec {
  applicantKey: string | null;
  jurisdiction: string;
  institutionKey: string | null;
  numbers: string[];
  categories: string[];
  startDate: string | null;
  endDate: string | null;
}

export interface ExistingRequestScope extends ScopeSpec {
  requestId: string;
  title: string;
  status: string;
  governmentOutcome: string | null;
  archived: boolean;
  channel: string;
}

export type StatusClass = "DRAFT_LIKE" | "BLOCKING" | "NEEDS_REASON" | "IGNORED_ARCHIVED_DRAFT" | "UNPARSEABLE";

export function classifyExisting(e: Pick<ExistingRequestScope, "status" | "governmentOutcome" | "archived">): StatusClass {
  if (!isRequestStatus(e.status)) return "UNPARSEABLE";
  if (e.status === "DRAFT" || e.status === "READY") return e.archived ? "IGNORED_ARCHIVED_DRAFT" : "DRAFT_LIKE";
  if (e.status === "CLOSED") {
    if (e.governmentOutcome === "FULL_DISCLOSURE" || e.governmentOutcome === "PARTIAL_DISCLOSURE") return "BLOCKING";
    return "NEEDS_REASON";
  }
  return "BLOCKING";
}

export interface DateSegment {
  start: string;
  end: string;
  days: number;
}

export interface Overlap {
  requestId: string;
  title: string;
  status: string;
  channel: string;
  statusClass: StatusClass;
  overlap: DateSegment | null;
  sharedNumbers: string[];
  sharedCategories: string[];
  applicantUncertain: boolean;
  institutionUncertain: boolean;
  numbersUncertain: boolean;
}

export type DuplicateResult = "CLEAR" | "DRAFT_EXISTS" | "BLOCKING" | "NEEDS_REASON" | "UNVERIFIED";

export interface DuplicateCheck {
  result: DuplicateResult;
  ledgerVerified: boolean;
  overlaps: Overlap[];
  /** 候选范围中未被任何既有（非草稿）申请覆盖的日期段 */
  newSegments: DateSegment[];
  /** 已被覆盖的日期段 */
  coveredSegments: DateSegment[];
  reasonsZh: string[];
}

const DAY = 86400_000;
const MIN_DATE = "1900-01-01";
const MAX_DATE = "2999-12-31";

function toDay(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY;
}
function fromDay(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}
function seg(startDay: number, endDay: number): DateSegment {
  return { start: fromDay(startDay), end: fromDay(endDay), days: endDay - startDay + 1 };
}

/** 含首尾日的日期交集；缺失端按无界处理（保守） */
export function intersectRange(a: { startDate: string | null; endDate: string | null }, b: { startDate: string | null; endDate: string | null }): DateSegment | null {
  const s = Math.max(toDay(a.startDate ?? MIN_DATE), toDay(b.startDate ?? MIN_DATE));
  const e = Math.min(toDay(a.endDate ?? MAX_DATE), toDay(b.endDate ?? MAX_DATE));
  return s <= e ? seg(s, e) : null;
}

/** 候选区间减去覆盖区间的并集 → 新增段 */
export function subtractSegments(range: { startDate: string | null; endDate: string | null }, covered: DateSegment[]): DateSegment[] {
  if (!range.startDate || !range.endDate) return [];
  let pieces: Array<[number, number]> = [[toDay(range.startDate), toDay(range.endDate)]];
  for (const c of covered) {
    const cs = toDay(c.start);
    const ce = toDay(c.end);
    const next: Array<[number, number]> = [];
    for (const [s, e] of pieces) {
      if (ce < s || cs > e) {
        next.push([s, e]);
        continue;
      }
      if (cs > s) next.push([s, cs - 1]);
      if (ce < e) next.push([ce + 1, e]);
    }
    pieces = next;
  }
  return pieces.filter(([s, e]) => s <= e).map(([s, e]) => seg(s, e));
}

function mergeSegments(list: DateSegment[]): DateSegment[] {
  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
  const out: Array<[number, number]> = [];
  for (const s of sorted) {
    const a = toDay(s.start);
    const b = toDay(s.end);
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => seg(a, b));
}

function isMappedInstitution(k: string | null): boolean {
  return !!k && k !== "UNKNOWN" && !k.startsWith("RAW:");
}

export function checkDuplicates(input: {
  candidate: ScopeSpec & { requestId?: string | null };
  existing: ExistingRequestScope[];
  ledgerAttested: boolean;
  /** 台账读取失败等 */
  readFailed?: boolean;
  /** 已填写的新增范围 / 重新申请理由（解除 NEEDS_REASON 与 DRAFT_EXISTS） */
  overlapReason?: string | null;
}): DuplicateCheck {
  const c = input.candidate;
  const cNumbers = normalizeNumbers(c.numbers);
  const overlaps: Overlap[] = [];
  let unparseable = 0;

  for (const e of input.existing) {
    if (input.candidate.requestId && e.requestId === input.candidate.requestId) continue;
    if (e.jurisdiction !== c.jurisdiction) continue;
    const cls = classifyExisting(e);
    if (cls === "UNPARSEABLE") unparseable++;

    const applicantUncertain = !c.applicantKey || !e.applicantKey;
    if (!applicantUncertain && c.applicantKey !== e.applicantKey) continue;

    let institutionUncertain = false;
    if (c.institutionKey !== e.institutionKey) {
      if (isMappedInstitution(c.institutionKey) && isMappedInstitution(e.institutionKey)) continue;
      institutionUncertain = true;
    }

    const eNumbers = normalizeNumbers(e.numbers);
    const numbersUncertain = cNumbers.length === 0 || eNumbers.length === 0;
    const sharedNumbers = cNumbers.filter((n) => eNumbers.includes(n));
    if (!numbersUncertain && sharedNumbers.length === 0) continue;

    const cAll = c.categories.includes(UNKNOWN_CATEGORY);
    const eAll = e.categories.includes(UNKNOWN_CATEGORY);
    const sharedCategories = cAll ? [...e.categories] : eAll ? [...c.categories] : c.categories.filter((x) => e.categories.includes(x));
    if (!cAll && !eAll && sharedCategories.length === 0) continue;

    const ov = intersectRange(c, e);
    if (!ov) continue;

    overlaps.push({
      requestId: e.requestId,
      title: e.title,
      status: e.status,
      channel: e.channel,
      statusClass: cls,
      overlap: ov,
      sharedNumbers,
      sharedCategories,
      applicantUncertain,
      institutionUncertain,
      numbersUncertain,
    });
  }

  const covering = overlaps.filter((o) => o.statusClass === "BLOCKING" || o.statusClass === "NEEDS_REASON" || o.statusClass === "UNPARSEABLE");
  const coveredSegments = mergeSegments(covering.map((o) => o.overlap!).filter(Boolean));
  const newSegments = subtractSegments(c, coveredSegments);
  const reasons: string[] = [];
  const hasReason = Boolean(input.overlapReason?.trim());

  const ledgerVerified = input.ledgerAttested && !input.readFailed && unparseable === 0;
  if (!input.ledgerAttested) reasons.push("历史申请台账尚未导入或未经真实用户确认（不能判定没有重复）");
  if (input.readFailed) reasons.push("台账读取失败");
  if (unparseable > 0) reasons.push(`${unparseable} 条历史申请状态无法解析`);

  const blocking = overlaps.filter((o) => o.statusClass === "BLOCKING" || o.statusClass === "UNPARSEABLE");
  const needsReason = overlaps.filter((o) => o.statusClass === "NEEDS_REASON");
  const drafts = overlaps.filter((o) => o.statusClass === "DRAFT_LIKE");
  for (const o of overlaps) {
    const flags = [o.applicantUncertain && "申请主体未确定", o.institutionUncertain && "机关别名未确定（人工复核）", o.numbersUncertain && "编号缺失"].filter(Boolean);
    reasons.push(
      `与「${o.title}」（${o.status}）重叠 ${o.overlap ? `${o.overlap.start} 至 ${o.overlap.end}（${o.overlap.days} 天）` : ""}${flags.length ? `；${flags.join("、")}` : ""}`,
    );
  }
  if (covering.length && newSegments.length) {
    reasons.push(`新增部分：${newSegments.map((s) => `${s.start} 至 ${s.end}（${s.days} 天）`).join("、")}；请把范围缩到新增部分，不要整段重复申请`);
  }

  let result: DuplicateResult;
  if (blocking.length) result = "BLOCKING";
  else if (!ledgerVerified) result = "UNVERIFIED";
  else if (needsReason.length && !hasReason) result = "NEEDS_REASON";
  else if (drafts.length && !hasReason) result = "DRAFT_EXISTS";
  else result = "CLEAR";

  return { result, ledgerVerified, overlaps, newSegments, coveredSegments, reasonsZh: reasons };
}
