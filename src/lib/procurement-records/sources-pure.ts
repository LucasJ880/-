/**
 * PROC-1 官方来源解析（纯函数，design D4）。网络抓取在 source-fetch.ts，这里只把官方开放数据记录
 * 标准化为 NormalizedRecord，并给出确定的解析状态。
 *
 * 纪律：
 * - 列名前缀匹配；必需列缺失 → PARSE_FAILED（不当零结果）；
 * - 缺失值保持 null，绝不补 0；
 * - 记录里的任何文字只作为资料内容（不解释、不执行）。
 *
 * 字段依据：
 * - CanadaBuys 招标公告 CSV：官方开放数据字典的双语列名（如 `referenceNumber-numeroReference`、
 *   `title-titre-eng`），2026-11-05 本会话无法联网复核，按前缀匹配实现；
 * - Open Government 合同披露（CKAN 资源 fac950c0…）：仓库 2026-08-20 实证字段
 *   （vendor_name / description_en / contract_value / contract_date / owner_org_title / reference_number …），
 *   另用 procurement_id / standing_offer_number / instrument_type / original_value / amendment_value / delivery_date；
 * - Completed ATI 摘要（CKAN）：request_number / summary_en / disposition / pages / owner_org_title / year / month。
 */

import { createHash } from "node:crypto";
import {
  normalizeInstitutionKey,
  normalizeInstrumentNumber,
  type InstrumentClass,
  type InstrumentSubtype,
  type Jurisdiction,
} from "./identity";
import type { SourceKey } from "./watch-config";

export const SOURCE_STATUSES = ["SUCCESS", "PARTIAL", "UNAVAILABLE", "PARSE_FAILED", "SKIPPED"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  SUCCESS: "成功",
  PARTIAL: "部分成功",
  UNAVAILABLE: "无法获取",
  PARSE_FAILED: "解析失败",
  SKIPPED: "未执行",
};

export interface SourceResult {
  source: SourceKey;
  status: SourceStatus;
  /** 实际取回的记录 / 行数 */
  fetched: number;
  /** 通过关键词与过滤的条数 */
  matched: number;
  newCandidates: number;
  updatedEvidence: number;
  truncated: boolean;
  pagesFetched: number;
  note: string | null;
  startedAt: string;
  finishedAt: string;
}

export function emptySourceResult(source: SourceKey, startedAt: Date): SourceResult {
  return {
    source,
    status: "SKIPPED",
    fetched: 0,
    matched: 0,
    newCandidates: 0,
    updatedEvidence: 0,
    truncated: false,
    pagesFetched: 0,
    note: null,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
  };
}

/** 整轮状态：全部 SUCCESS/SKIPPED → SUCCEEDED；有成功也有失败 → PARTIAL；没有任何成功 → FAILED */
export function aggregateRunStatus(results: SourceResult[]): "SUCCEEDED" | "PARTIAL" | "FAILED" {
  const ran = results.filter((r) => r.status !== "SKIPPED");
  if (ran.length === 0) return results.length === 0 ? "FAILED" : "SUCCEEDED";
  const ok = ran.filter((r) => r.status === "SUCCESS");
  if (ok.length === ran.length) return "SUCCEEDED";
  const someOk = ran.some((r) => r.status === "SUCCESS" || r.status === "PARTIAL");
  return someOk ? "PARTIAL" : "FAILED";
}

// ───────────────────────────── CSV ─────────────────────────────

/** RFC 4180 CSV（引号、转义引号、字段内换行、CRLF、BOM） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((v) => v.length > 0)) rows.push(row);
  }
  return rows;
}

export interface ColumnSpec {
  exact?: string[];
  prefix?: string[];
}

/** 列定位：先精确（大小写不敏感），再前缀；找不到 → -1 */
export function findColumn(headers: string[], spec: ColumnSpec): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const e of spec.exact ?? []) {
    const i = lower.indexOf(e.toLowerCase());
    if (i >= 0) return i;
  }
  for (const p of spec.prefix ?? []) {
    const i = lower.findIndex((h) => h.startsWith(p.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}

// ───────────────────────── 标准化记录 ─────────────────────────

export interface NormalizedRecord {
  sourceType: SourceKey;
  /** 来源自然键（幂等；修订号进键，因此修订形成新证据而不是新采购工具） */
  sourceKey: string;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  jurisdiction: Jurisdiction;
  instrumentClass: InstrumentClass;
  instrumentSubtype: InstrumentSubtype | null;
  officialNumber: string;
  aliases: Array<{ value: string; kind: "PLATFORM_ALIAS" | "AMENDMENT_SUFFIX" | "RAW_NUMBER" }>;
  parentNumber: string | null;
  title: string | null;
  description: string | null;
  categoryCodes: string[];
  categoryText: string | null;
  regions: string[];
  contractingInstitution: string | null;
  buyingInstitution: string | null;
  vendorName: string | null;
  publishedAt: string | null;
  closingAt: string | null;
  awardDate: string | null;
  periodEnd: string | null;
  contractValue: string | null;
  originalValue: string | null;
  amendmentValue: string | null;
  currency: string | null;
  amendmentNumber: string | null;
  status: string | null;
  /** 原始记录（截断；只作证据快照） */
  raw: Record<string, string>;
}

const MAX_RAW_FIELD = 2000;

function trimRaw(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    const s = String(v);
    if (!s.trim()) continue;
    out[k] = s.length > MAX_RAW_FIELD ? `${s.slice(0, MAX_RAW_FIELD)}…` : s;
  }
  return out;
}

/** 规范 JSON（键排序）+ sha256，用于证据内容哈希 */
export function stableHash(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canon(value)), "utf8").digest("hex");
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** 日期 → YYYY-MM-DD（无法解析 → null） */
export function toIsoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** 时间戳 → ISO（无法解析 → null） */
function toIsoInstant(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 金额文本 → 规范十进制字符串（保留原精度；无法解析 → null，绝不给 0） */
export function toDecimalString(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const cleaned = s.replace(/[$,\s]/g, "").replace(/CAD$/i, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return cleaned;
}

function splitList(v: unknown): string[] {
  const s = str(v);
  if (!s) return [];
  return s
    .split(/[\n;*|]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// ─────────────────── CanadaBuys 招标公告 CSV ───────────────────

const CB_COLUMNS = {
  title: { prefix: ["title-titre-eng", "title-eng"], exact: ["title"] },
  titleFr: { prefix: ["title-titre-fra"] },
  referenceNumber: { prefix: ["referencenumber-numeroreference", "referencenumber"] },
  amendmentNumber: { prefix: ["amendmentnumber-numeromodification", "amendmentnumber"] },
  solicitationNumber: { prefix: ["solicitationnumber-numerosollicitation", "solicitationnumber"] },
  publicationDate: { prefix: ["publicationdate-datepublication", "publicationdate"] },
  closingDate: { prefix: ["tenderclosingdate-appeloffresdatecloture", "tenderclosingdate"] },
  amendmentDate: { prefix: ["amendmentdate-datemodification", "amendmentdate"] },
  status: { prefix: ["tenderstatus-appeloffresstatut-eng", "tenderstatus"] },
  gsin: { exact: ["gsin-nibs", "gsin"] },
  gsinDesc: { prefix: ["gsindescription-nibsdescription-eng", "gsindescription"] },
  unspsc: { exact: ["unspsc"] },
  unspscDesc: { prefix: ["unspscdescription-eng", "unspscdescription"] },
  noticeType: { prefix: ["noticetype-avistype-eng", "noticetype"] },
  regionsDelivery: { prefix: ["regionsofdelivery-regionslivraison-eng", "regionsofdelivery"] },
  regionsOpportunity: { prefix: ["regionsofopportunity-regionappeloffres-eng", "regionsofopportunity"] },
  contractingEntity: { prefix: ["contractingentityname-nomentitcontractante-eng", "contractingentityname"] },
  endUser: { prefix: ["enduserentitiesname-nomentitesutilisateurfinal-eng", "enduserentitiesname"] },
  noticeUrl: { prefix: ["noticeurl-urlavis-eng", "noticeurl"] },
  description: { prefix: ["tenderdescription-descriptionappeloffres-eng", "tenderdescription"] },
  descriptionFr: { prefix: ["tenderdescription-descriptionappeloffres-fra"] },
} satisfies Record<string, ColumnSpec>;

export type CanadaBuysParse =
  | { ok: true; records: NormalizedRecord[]; rowCount: number; skippedRows: number }
  | { ok: false; reason: string; missingColumns: string[] };

export function parseCanadaBuysNoticesCsv(text: string): CanadaBuysParse {
  const rows = parseCsv(text);
  if (rows.length === 0) return { ok: false, reason: "CSV 为空", missingColumns: [] };
  const headers = rows[0];
  const idx = Object.fromEntries(
    Object.entries(CB_COLUMNS).map(([k, spec]) => [k, findColumn(headers, spec)]),
  ) as Record<keyof typeof CB_COLUMNS, number>;
  const missing: string[] = [];
  if (idx.title < 0) missing.push("title-titre-eng");
  if (idx.referenceNumber < 0 && idx.solicitationNumber < 0) missing.push("referenceNumber / solicitationNumber");
  if (missing.length) return { ok: false, reason: "必需列缺失（CSV 可能已改版）", missingColumns: missing };

  const get = (row: string[], k: keyof typeof CB_COLUMNS) => (idx[k] >= 0 ? str(row[idx[k]]) : null);
  const records: NormalizedRecord[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const ref = get(row, "referenceNumber");
    const sol = get(row, "solicitationNumber");
    const number = sol ?? ref;
    const title = get(row, "title");
    if (!number || !title) {
      skipped++;
      continue;
    }
    const amendment = get(row, "amendmentNumber");
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (row[i] !== undefined) raw[h] = row[i];
    });
    const aliases: NormalizedRecord["aliases"] = [];
    if (ref && sol && ref !== sol) aliases.push({ value: ref, kind: "PLATFORM_ALIAS" });
    const nn = normalizeInstrumentNumber(number);
    if (nn.amendmentSuffix) aliases.push({ value: number, kind: "AMENDMENT_SUFFIX" });
    records.push({
      sourceType: "CANADABUYS_TENDER_NOTICES",
      sourceKey: `canadabuys:${(ref ?? number).toLowerCase()}:${amendment ?? "0"}`,
      sourceRecordId: ref ?? number,
      sourceUrl: get(row, "noticeUrl"),
      jurisdiction: "CA-FED",
      instrumentClass: "SOLICITATION",
      instrumentSubtype: null,
      officialNumber: number,
      aliases,
      parentNumber: null,
      title,
      description: get(row, "description"),
      categoryCodes: [...splitList(get(row, "gsin")), ...splitList(get(row, "unspsc"))],
      categoryText: [get(row, "gsinDesc"), get(row, "unspscDesc")].filter(Boolean).join(" | ") || null,
      regions: [...splitList(get(row, "regionsDelivery")), ...splitList(get(row, "regionsOpportunity"))],
      contractingInstitution: get(row, "contractingEntity"),
      buyingInstitution: get(row, "endUser"),
      vendorName: null,
      publishedAt: toIsoInstant(get(row, "publicationDate")),
      closingAt: toIsoInstant(get(row, "closingDate")),
      awardDate: null,
      periodEnd: null,
      contractValue: null,
      originalValue: null,
      amendmentValue: null,
      currency: null,
      amendmentNumber: amendment,
      status: get(row, "status"),
      raw: trimRaw({ ...raw, "title-titre-fra": get(row, "titleFr"), description_fr: get(row, "descriptionFr") }),
    });
  }
  return { ok: true, records, rowCount: rows.length - 1, skippedRows: skipped };
}

// ─────────────────── Open Government 合同披露（CKAN） ───────────────────

export const CKAN_DATASTORE_SEARCH = "https://open.canada.ca/data/en/api/3/action/datastore_search";
export const CONTRACTS_RESOURCE_DEFAULT = "fac950c0-00d5-4ec1-a4d3-9cbebf98a305";

export function ckanQueryUrl(resourceId: string, params: { q?: Record<string, string> | string; filters?: Record<string, string>; limit: number; offset?: number; sort?: string }): string {
  const u = new URL(CKAN_DATASTORE_SEARCH);
  u.searchParams.set("resource_id", resourceId);
  u.searchParams.set("limit", String(params.limit));
  if (params.offset) u.searchParams.set("offset", String(params.offset));
  if (params.q) u.searchParams.set("q", typeof params.q === "string" ? params.q : JSON.stringify(params.q));
  if (params.filters) u.searchParams.set("filters", JSON.stringify(params.filters));
  if (params.sort) u.searchParams.set("sort", params.sort);
  return u.toString();
}

export type CkanParse =
  | { ok: true; records: Array<Record<string, unknown>>; total: number | null }
  | { ok: false; reason: string };

/** CKAN datastore_search 响应体校验（success:false / 缺 result.records → 解析失败） */
export function parseCkanResponse(json: unknown): CkanParse {
  if (!json || typeof json !== "object") return { ok: false, reason: "响应不是 JSON 对象" };
  const o = json as { success?: unknown; result?: { records?: unknown; total?: unknown }; error?: unknown };
  if (o.success === false) return { ok: false, reason: `CKAN success=false${o.error ? `：${JSON.stringify(o.error).slice(0, 120)}` : ""}` };
  if (!o.result || !Array.isArray(o.result.records)) return { ok: false, reason: "缺少 result.records" };
  const total = typeof o.result.total === "number" ? o.result.total : null;
  return { ok: true, records: o.result.records as Array<Record<string, unknown>>, total };
}

/**
 * 合同披露行 → 标准化记录。
 * - 有 standing_offer_number 且与本行编号不同 → CALL_UP（父 = SO 号；机构 = 报告部门）；
 * - instrument_type 含 SOSA / standing offer → AWARD_INSTRUMENT / STANDING_OFFER；
 * - 其余 → AWARD_INSTRUMENT / CONTRACT。
 * 编号用 procurement_id，缺失退回 reference_number（并记为 RAW_NUMBER 别名）。
 * delivery_date 只存为 periodEnd，不推断 SO 到期日（未知保持 null）。
 */
export function mapOpenCanadaContract(row: Record<string, unknown>, resourceId: string): NormalizedRecord | null {
  const ref = str(row.reference_number);
  const proc = str(row.procurement_id);
  const number = proc ?? ref;
  if (!number) return null;
  const so = str(row.standing_offer_number);
  const instrumentType = (str(row.instrument_type) ?? "").toLowerCase();
  const ownerTitle = str(row.owner_org_title) ?? str(row.owner_org);
  const isSosa = /sosa|standing offer|supply arrangement/.test(instrumentType);
  const isCallUp = !!so && normalizeInstrumentNumber(so).normalized !== normalizeInstrumentNumber(number).normalized && !isSosa;
  const aliases: NormalizedRecord["aliases"] = [];
  if (ref && proc && ref !== proc) aliases.push({ value: ref, kind: "RAW_NUMBER" });
  return {
    sourceType: "OPEN_CANADA_CONTRACTS",
    sourceKey: `opencanada-contracts:${(str(row.owner_org) ?? "unknown").toLowerCase()}:${(ref ?? number).toLowerCase()}`,
    sourceRecordId: ref ?? number,
    sourceUrl: ckanQueryUrl(resourceId, { filters: ref ? { reference_number: ref } : { procurement_id: number }, limit: 5 }),
    jurisdiction: "CA-FED",
    instrumentClass: isCallUp ? "CALL_UP" : "AWARD_INSTRUMENT",
    instrumentSubtype: isCallUp ? "PURCHASE_ORDER" : isSosa ? "STANDING_OFFER" : "CONTRACT",
    officialNumber: number,
    aliases,
    parentNumber: isCallUp ? so : null,
    title: str(row.description_en),
    description: [str(row.description_en), str(row.comments_en)].filter(Boolean).join(" — ") || null,
    categoryCodes: [str(row.commodity_code), str(row.economic_object_code)].filter((x): x is string => Boolean(x)),
    categoryText: str(row.commodity_type),
    regions: [],
    contractingInstitution: ownerTitle,
    buyingInstitution: ownerTitle,
    vendorName: str(row.vendor_name),
    publishedAt: null,
    closingAt: null,
    awardDate: toIsoDate(row.contract_date),
    periodEnd: toIsoDate(row.delivery_date),
    contractValue: toDecimalString(row.contract_value),
    originalValue: toDecimalString(row.original_value),
    amendmentValue: toDecimalString(row.amendment_value),
    currency: "CAD",
    amendmentNumber: null,
    status: null,
    raw: trimRaw(row),
  };
}

// ─────────────────── Completed ATI 摘要（CKAN） ───────────────────

export interface AtiSummary {
  sourceKey: string;
  requestNumber: string;
  summaryEn: string;
  disposition: string | null;
  pages: number | null;
  ownerOrg: string | null;
  ownerOrgKey: string;
  yearMonth: string | null;
  sourceUrl: string;
  raw: Record<string, string>;
}

export function mapAtiSummary(row: Record<string, unknown>, resourceId: string): AtiSummary | null {
  const reqNo = str(row.request_number);
  const summary = str(row.summary_en) ?? str(row.summary_fr);
  if (!reqNo || !summary) return null;
  const owner = str(row.owner_org_title) ?? str(row.owner_org);
  const pagesRaw = str(row.pages);
  const pages = pagesRaw && /^\d+$/.test(pagesRaw) ? Number(pagesRaw) : null;
  const y = str(row.year);
  const m = str(row.month);
  return {
    sourceKey: `ati:${(str(row.owner_org) ?? "unknown").toLowerCase()}:${reqNo.toLowerCase()}`,
    requestNumber: reqNo,
    summaryEn: summary.slice(0, 2000),
    disposition: str(row.disposition),
    pages,
    ownerOrg: owner,
    ownerOrgKey: normalizeInstitutionKey(owner).key,
    yearMonth: y ? `${y}${m ? `-${m.padStart(2, "0")}` : ""}` : null,
    sourceUrl: ckanQueryUrl(resourceId, { filters: { request_number: reqNo }, limit: 5 }),
    raw: trimRaw(row),
  };
}

/** ATI 摘要是否提到某编号（规范化后包含；短编号 < 6 字符不匹配，避免误挂） */
export function atiMentionsNumber(summary: string, number: string): boolean {
  const n = normalizeInstrumentNumber(number).normalized;
  if (n.length < 6) return false;
  return summary.toUpperCase().replace(/[\s\-_./#]+/g, "").includes(n);
}

/** 证据内容哈希只取标准化后的实质字段（抓取时间、URL 查询串顺序不影响） */
export function recordContentHash(r: NormalizedRecord): string {
  const { sourceUrl: _u, ...rest } = r;
  void _u;
  return stableHash(rest);
}

/** 官方入口检索链接（人工核查用） */
export function manualSearchLinks(number: string): Array<{ label: string; url: string }> {
  const q = encodeURIComponent(number);
  return [
    { label: "Completed ATI 检索（search.open.canada.ca/ati）", url: `https://search.open.canada.ca/ati/?search_text=${q}` },
    { label: "合同披露检索（search.open.canada.ca/contracts）", url: `https://search.open.canada.ca/contracts/?search_text=${q}` },
    { label: "CanadaBuys 检索", url: `https://canadabuys.canada.ca/en/tender-opportunities?search_filter=${q}` },
  ];
}
