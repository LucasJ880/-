/**
 * CHAIN-3 进口记录的解析与逐条校验（纯函数，零 DB / 零网络 / 零模型）
 *
 * - 逗号分隔复用 procurement-records 的 RFC 4180 解析；表头一行含制表符时按制表符逐行拆（从表格直接复制出来的样子）。
 * - 表头按别名整格匹配（不按前缀猜：`shipper` 不该误中 `Shipper Address`）；同一种列认出两列 → 整批不导入。
 * - 日期缺省只认年在前的写法；这一批选了「月/日/年」「日/月/年」才按所选读——不猜。
 * - 「第 N 条记录」= 表头下面第 N 条（空行不算；引号里换行时行号对不上，所以不说「第 N 行」）。
 */

import { parseCsv } from "@/lib/procurement-records/sources-pure";
import { normalizeCompanyName } from "@/lib/tender-competition/company-identity";

export const IMPORT_MAX_RECORDS = 500;
export const IMPORT_MAX_BYTES = 200 * 1024;
export const NAME_MAX_CHARS = 300;
export const GOODS_MAX_CHARS = 1000;
export const QUANTITY_MAX_CHARS = 100;
export const URL_MAX_CHARS = 2048;
export const SOURCE_LABEL_MAX_CHARS = 200;

export const DATE_ORDERS = ["YMD", "MDY", "DMY"] as const;
export type DateOrder = (typeof DATE_ORDERS)[number];
export const DATE_ORDER_ZH: Record<DateOrder, string> = { YMD: "年在前（缺省）", MDY: "月/日/年（美国网站常用）", DMY: "日/月/年" };

export const IMPORT_COLUMNS = {
  importer: { zh: "进口商", aliases: ["进口商", "importer", "consignee"] },
  exporter: { zh: "出口商", aliases: ["出口商", "exporter", "shipper", "supplier"] },
  date: { zh: "日期", aliases: ["日期", "date", "arrival date", "shipment date"] },
  goods: { zh: "品名", aliases: ["品名", "goods", "product", "description"] },
  quantity: { zh: "数量", aliases: ["数量", "quantity", "qty"] },
  sourceUrl: { zh: "来源网址", aliases: ["来源网址", "source url", "url", "link"] },
} as const;
export type ImportColumn = keyof typeof IMPORT_COLUMNS;
const COLUMN_ORDER: ImportColumn[] = ["importer", "exporter", "date", "goods", "quantity", "sourceUrl"];

export const IMPORT_COLUMNS_HINT_ZH =
  "把表格里的记录连同表头一起粘贴进来（逗号或制表符分隔）。需要的列：进口商、出口商；可选：日期、品名、数量、来源网址。";

export type BatchFailure =
  | { code: "EMPTY"; messageZh: string }
  | { code: "MISSING_COLUMNS"; messageZh: string; columns: string[] }
  | { code: "DUPLICATE_COLUMN"; messageZh: string }
  | { code: "TOO_MANY"; messageZh: string }
  | { code: "TOO_LARGE"; messageZh: string };

export const BATCH_TEXT = {
  empty: "没有可导入的内容。",
  missing: (cols: string[]) => `缺少必需的列：${cols.join("、")}。请连同表头一起粘贴。`,
  duplicate: (col: string, a: string, b: string) => `表头里有两列都是「${col}」：${a}、${b}。请删掉一列再贴。`,
  tooMany: (n: number) => `一次最多导入 ${IMPORT_MAX_RECORDS} 条记录，这次有 ${n} 条。`,
  tooLarge: "内容太长（超过 200 KB），请分批导入。",
} as const;

export const RECORD_PROBLEMS = ["IMPORTER_MISSING", "EXPORTER_MISSING", "DATE_INVALID", "DATE_FUTURE", "EVIDENCE_MISSING", "NAME_TOO_LONG", "GOODS_TOO_LONG"] as const;
export type RecordProblemCode = (typeof RECORD_PROBLEMS)[number];
export type RecordProblem = { recordNo: number; code: RecordProblemCode; value?: string };

export type ParsedRecord = {
  recordNo: number;
  importer: string;
  exporter: string;
  /** YYYY-MM-DD（补零）；没有日期 = null */
  shipmentDate: string | null;
  goods: string | null;
  quantityRaw: string | null;
  /** 原文（最多 2048 字）；不打开它 */
  sourceUrlRaw: string | null;
  /** 只有 http(s) 网址才给链接，否则 null（原文仍留在 sourceUrlRaw） */
  sourceUrlLink: string | null;
  evidenceRef: string;
  dedupeKey: string;
};

export type ParseOk = { ok: true; records: ParsedRecord[]; problems: RecordProblem[]; duplicatesInBatch: number; totalRecords: number };
export type ParseResult = ParseOk | ({ ok: false } & BatchFailure);

const normHeader = (h: string) => h.replace(/^﻿/, "").trim().replace(/\s+/g, " ").toLowerCase();
const normText = (s: string | null) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function realDay(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 年在前的三种写法恒认；斜杠 / 点 / 连字符分隔的「x/x/年」只在这一批选了月日顺序时才认 */
export function parseShipmentDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim();
  const ymd = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) return realDay(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const xxy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (xxy && order === "MDY") return realDay(Number(xxy[3]), Number(xxy[1]), Number(xxy[2]));
  if (xxy && order === "DMY") return realDay(Number(xxy[3]), Number(xxy[2]), Number(xxy[1]));
  return null;
}

export function isHttpUrl(raw: string | null): boolean {
  if (!raw || raw.length > URL_MAX_CHARS || !/^https?:\/\//i.test(raw)) return false;
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** 去重键：规整后「进口商 | 出口商 | 日期 | 品名 | 数量 | 来源网址」 */
export function importDedupeKey(r: { importer: string; exporter: string; shipmentDate: string | null; goods: string | null; quantityRaw: string | null; sourceUrlRaw: string | null }): string {
  return [normalizeCompanyName(r.importer), normalizeCompanyName(r.exporter), r.shipmentDate ?? "", normText(r.goods), normText(r.quantityRaw), normText(r.sourceUrlRaw)].join("|");
}

function splitRows(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  if (firstLine.includes("\t")) {
    return body
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => l.split("\t"));
  }
  return parseCsv(body);
}

function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function parseImportText(text: string, opts: { sourceLabel?: string | null; dateOrder?: DateOrder | null; now: Date }): ParseResult {
  if (byteLength(text ?? "") > IMPORT_MAX_BYTES) return { ok: false, code: "TOO_LARGE", messageZh: BATCH_TEXT.tooLarge };
  if (!text || !text.trim()) return { ok: false, code: "EMPTY", messageZh: BATCH_TEXT.empty };
  const rows = splitRows(text);
  if (rows.length < 2) return { ok: false, code: "EMPTY", messageZh: BATCH_TEXT.empty };

  const header = rows[0].map((h) => h.trim());
  const index: Partial<Record<ImportColumn, number>> = {};
  for (const col of COLUMN_ORDER) {
    const aliases = IMPORT_COLUMNS[col].aliases as readonly string[];
    const hits = header.map((h, i) => (aliases.includes(normHeader(h)) ? i : -1)).filter((i) => i >= 0);
    if (hits.length > 1) {
      return { ok: false, code: "DUPLICATE_COLUMN", messageZh: BATCH_TEXT.duplicate(IMPORT_COLUMNS[col].zh, header[hits[0]], header[hits[1]]) };
    }
    if (hits.length === 1) index[col] = hits[0];
  }
  const missing = (["importer", "exporter"] as const).filter((c) => index[c] === undefined).map((c) => IMPORT_COLUMNS[c].zh);
  if (missing.length) return { ok: false, code: "MISSING_COLUMNS", messageZh: BATCH_TEXT.missing(missing), columns: missing };

  const data = rows.slice(1);
  if (data.length > IMPORT_MAX_RECORDS) return { ok: false, code: "TOO_MANY", messageZh: BATCH_TEXT.tooMany(data.length) };

  const order: DateOrder = opts.dateOrder && (DATE_ORDERS as readonly string[]).includes(opts.dateOrder) ? opts.dateOrder : "YMD";
  const label = opts.sourceLabel?.trim().slice(0, SOURCE_LABEL_MAX_CHARS) || null;
  const today = todayUtc(opts.now);
  const cell = (row: string[], col: ImportColumn) => {
    const i = index[col];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const records: ParsedRecord[] = [];
  const problems: RecordProblem[] = [];
  const seen = new Set<string>();
  let duplicatesInBatch = 0;

  data.forEach((row, i) => {
    const recordNo = i + 1;
    const importer = cell(row, "importer");
    const exporter = cell(row, "exporter");
    const dateRaw = cell(row, "date");
    const goodsRaw = cell(row, "goods");
    const qtyRaw = cell(row, "quantity");
    const urlRaw = cell(row, "sourceUrl");
    const problem = (code: RecordProblemCode, value?: string) => problems.push({ recordNo, code, ...(value !== undefined ? { value } : {}) });

    if (!importer) return problem("IMPORTER_MISSING");
    if (!exporter) return problem("EXPORTER_MISSING");
    if (importer.length > NAME_MAX_CHARS || exporter.length > NAME_MAX_CHARS) return problem("NAME_TOO_LONG");
    if (goodsRaw.length > GOODS_MAX_CHARS) return problem("GOODS_TOO_LONG");
    let shipmentDate: string | null = null;
    if (dateRaw) {
      shipmentDate = parseShipmentDate(dateRaw, order);
      if (!shipmentDate) return problem("DATE_INVALID", dateRaw.slice(0, 40));
      if (shipmentDate > today) return problem("DATE_FUTURE", dateRaw.slice(0, 40));
    }
    const sourceUrlRaw = urlRaw ? urlRaw.slice(0, URL_MAX_CHARS) : null;
    const evidenceRef = sourceUrlRaw ?? (label ? `${label} · 第 ${recordNo} 条记录` : null);
    if (!evidenceRef) return problem("EVIDENCE_MISSING");

    const rec = {
      recordNo,
      importer,
      exporter,
      shipmentDate,
      goods: goodsRaw || null,
      quantityRaw: qtyRaw ? qtyRaw.slice(0, QUANTITY_MAX_CHARS) : null,
      sourceUrlRaw,
      sourceUrlLink: isHttpUrl(sourceUrlRaw) ? sourceUrlRaw : null,
      evidenceRef,
    };
    const dedupeKey = importDedupeKey(rec);
    if (seen.has(dedupeKey)) {
      duplicatesInBatch += 1;
      return;
    }
    seen.add(dedupeKey);
    records.push({ ...rec, dedupeKey });
  });

  return { ok: true, records, problems, duplicatesInBatch, totalRecords: data.length };
}

/* ---------------------------------- 问题归并 ---------------------------------- */

const PROBLEM_ZH: Record<RecordProblemCode, (example?: string, many?: boolean) => string> = {
  IMPORTER_MISSING: () => "缺少进口商",
  EXPORTER_MISSING: () => "缺少出口商",
  DATE_INVALID: (ex, many) => `日期「${ex ?? ""}」${many ? "等" : ""}认不出（请写成年在前，或为这一批选日期写法）`,
  DATE_FUTURE: () => "日期在未来",
  EVIDENCE_MISSING: () => "缺少来源网址，也没有填来源说明",
  NAME_TOO_LONG: () => `名称超过 ${NAME_MAX_CHARS} 字`,
  GOODS_TOO_LONG: () => `品名超过 ${GOODS_MAX_CHARS} 字`,
};

export type GroupedProblem = { code: RecordProblemCode; recordNos: number[]; messageZh: string };

/** 按原因归并：「{原因}：第 2、3、5 条记录」（超过 20 条只列前 20 条） */
export function groupProblems(problems: readonly RecordProblem[]): GroupedProblem[] {
  const out: GroupedProblem[] = [];
  for (const code of RECORD_PROBLEMS) {
    const list = problems.filter((p) => p.code === code);
    if (!list.length) continue;
    const nos = list.map((p) => p.recordNo);
    const shown = nos.slice(0, 20).join("、");
    const tail = nos.length > 20 ? ` 等 ${nos.length} 条记录` : " 条记录";
    out.push({ code, recordNos: nos, messageZh: `${PROBLEM_ZH[code](list[0].value, list.length > 1)}：第 ${shown}${tail}` });
  }
  return out;
}
