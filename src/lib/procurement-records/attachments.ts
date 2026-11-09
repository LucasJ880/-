/**
 * PROC-1 附件（spec procurement/disclosure-analysis「附件保存」「解析与阻塞」「明细抽取与复核」）。
 *
 * - 私有 Blob（putPrivateBlob）；下载只走鉴权路由流式返回，不出公开链接；日志不打印内容；
 * - 同申请同 sha256 → 返回既有附件；
 * - 解析在响应后执行（after）+ cron 兜底；可读 PDF 分页、扫描件 NEEDS_OCR、加密 ENCRYPTED、损坏 CORRUPT；
 * - 披露文件解析后确定性抽取明细（唯一键幂等），全部默认 NEEDS_REVIEW；无法读取的内容不生成任何明细。
 */

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { putPrivateBlob, readBlobBuffer } from "@/lib/files/blob-access";
import { normalizeFilename } from "@/lib/files/upload-guard";
import { extractFromPdfPage, extractFromTable, pageNeedsOcr, type ExtractedLine } from "./extract-pure";
import { appendRequestEvent } from "./requests";
import { recomputeFilesStatus } from "./events";
import { ATTACHMENT_KINDS, type AttachmentKind } from "./labels";

export { ATTACHMENT_KINDS, ATTACHMENT_KIND_LABELS } from "./labels";
export type { AttachmentKind } from "./labels";


export const ALLOWED_EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
};
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const PARSE_STALE_MS = 10 * 60_000;

export function isAttachmentKind(v: unknown): v is AttachmentKind {
  return typeof v === "string" && (ATTACHMENT_KINDS as readonly string[]).includes(v);
}

type Err = { ok: false; status: 400 | 404 | 409 | 413; code: string; message: string };

export async function saveAttachment(input: {
  requestId: string;
  userId: string;
  kind: AttachmentKind;
  filename: string;
  buffer: Buffer;
  acquiredAt?: string | null;
}): Promise<{ ok: true; attachmentId: string; duplicate: boolean; parseStatus: string } | Err> {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId }, select: { id: true, orgId: true } });
  if (!req) return { ok: false, status: 404, code: "REQUEST_NOT_FOUND", message: "申请不存在" };
  if (input.buffer.length === 0) return { ok: false, status: 400, code: "EMPTY_FILE", message: "空文件" };
  if (input.buffer.length > MAX_ATTACHMENT_BYTES) return { ok: false, status: 413, code: "FILE_TOO_LARGE", message: "文件超过 25 MB" };
  const { safe, ext } = normalizeFilename(input.filename);
  const mime = ALLOWED_EXTENSIONS[ext];
  if (!mime) return { ok: false, status: 400, code: "UNSUPPORTED_TYPE", message: `不支持的文件类型：.${ext || "?"}（支持 PDF / CSV / XLSX / XLS / PNG / JPG / TXT）` };
  const hash = createHash("sha256").update(input.buffer).digest("hex");
  const existing = await db.recordsAttachment.findUnique({ where: { requestId_contentHash: { requestId: req.id, contentHash: hash } }, select: { id: true, parseStatus: true } });
  if (existing) return { ok: true, attachmentId: existing.id, duplicate: true, parseStatus: existing.parseStatus };
  const pathname = `procurement-records/${req.orgId}/${req.id}/${hash.slice(0, 16)}-${safe}`;
  await putPrivateBlob({ pathname, body: input.buffer, contentType: mime });
  const acquired = input.acquiredAt ? new Date(input.acquiredAt) : null;
  try {
    const row = await db.recordsAttachment.create({
      data: {
        orgId: req.orgId,
        requestId: req.id,
        kind: input.kind,
        originalFilename: input.filename.slice(0, 255),
        storagePathname: pathname,
        sizeBytes: input.buffer.length,
        mimeType: mime,
        contentHash: hash,
        acquiredAt: acquired && !Number.isNaN(acquired.getTime()) ? acquired : null,
        uploadedById: input.userId,
        parseStatus: ["png", "jpg", "jpeg"].includes(ext) ? "NEEDS_OCR" : "PENDING",
        parseError: ["png", "jpg", "jpeg"].includes(ext) ? "图片无文字层，当前没有 OCR 能力；请人工核对 / 录入" : null,
      },
      select: { id: true, parseStatus: true },
    });
    await appendRequestEvent(db, { orgId: req.orgId, requestId: req.id, type: "ATTACHMENT_ADDED", actorId: input.userId, attachmentIds: [row.id], payload: { kind: input.kind, sizeBytes: input.buffer.length, contentHash: hash } });
    await recomputeFilesStatus(req.id);
    return { ok: true, attachmentId: row.id, duplicate: false, parseStatus: row.parseStatus };
  } catch (e) {
    const { isUniqueViolation } = await import("./instruments");
    if (isUniqueViolation(e)) {
      const again = await db.recordsAttachment.findUnique({ where: { requestId_contentHash: { requestId: req.id, contentHash: hash } }, select: { id: true, parseStatus: true } });
      if (again) return { ok: true, attachmentId: again.id, duplicate: true, parseStatus: again.parseStatus };
    }
    throw e;
  }
}

interface ParsedUnit {
  unitIndex: number;
  unitKind: "page" | "sheet";
  unitLabel: string | null;
  text: string;
  parseStatus: "done" | "OCR_REQUIRED";
}

type ParseOutcome = { status: "PARSED" | "NEEDS_OCR" | "ENCRYPTED" | "CORRUPT" | "UNSUPPORTED"; error: string | null; units: ParsedUnit[]; pageCount: number | null; sheets: Array<{ sheet: string; rows: number }> | null };

/** 纯解析（供测试直接调用） */
export async function parseAttachmentBuffer(buffer: Buffer, filename: string): Promise<ParseOutcome> {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") {
    try {
      const { extractText } = await import("unpdf");
      const res = await extractText(new Uint8Array(buffer), { mergePages: false });
      const pages = Array.isArray(res.text) ? res.text : [String(res.text ?? "")];
      const units: ParsedUnit[] = pages.map((t, i) => ({ unitIndex: i + 1, unitKind: "page", unitLabel: null, text: t ?? "", parseStatus: pageNeedsOcr(t ?? "") ? "OCR_REQUIRED" : "done" }));
      const allOcr = units.length > 0 && units.every((u) => u.parseStatus === "OCR_REQUIRED");
      return { status: allOcr ? "NEEDS_OCR" : "PARSED", error: allOcr ? "PDF 无文字层（扫描件），当前没有 OCR 能力；请人工录入" : null, units, pageCount: res.totalPages ?? units.length, sheets: null };
    } catch (e) {
      const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      if (/password|encrypt/i.test(msg)) return { status: "ENCRYPTED", error: "PDF 已加密，无法读取", units: [], pageCount: null, sheets: null };
      return { status: "CORRUPT", error: "PDF 无法解析（可能已损坏）", units: [], pageCount: null, sheets: null };
    }
  }
  if (ext === "csv" || ext === "txt") {
    const text = buffer.toString("utf-8");
    if (text.includes("\u0000")) return { status: "CORRUPT", error: "文本文件含二进制内容", units: [], pageCount: null, sheets: null };
    const rows = text.split(/\r?\n/).filter((l) => l.trim()).length;
    return { status: "PARSED", error: null, units: [{ unitIndex: 1, unitKind: "sheet", unitLabel: ext === "csv" ? `CSV · ${rows} 行` : "TXT", text, parseStatus: "done" }], pageCount: null, sheets: ext === "csv" ? [{ sheet: "CSV", rows }] : null };
  }
  if (ext === "xlsx" || ext === "xls") {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buffer, { type: "buffer" });
      if (!wb.SheetNames.length) return { status: "CORRUPT", error: "工作簿没有工作表", units: [], pageCount: null, sheets: null };
      const units: ParsedUnit[] = [];
      const sheets: Array<{ sheet: string; rows: number }> = [];
      wb.SheetNames.forEach((name, i) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
        const rows = csv.split("\n").filter((l) => l.replace(/,/g, "").trim()).length;
        sheets.push({ sheet: name, rows });
        units.push({ unitIndex: i + 1, unitKind: "sheet", unitLabel: `${name} · ${rows} 行`, text: csv, parseStatus: "done" });
      });
      return { status: "PARSED", error: null, units, pageCount: null, sheets };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/password|encrypt/i.test(msg)) return { status: "ENCRYPTED", error: "工作簿已加密，无法读取", units: [], pageCount: null, sheets: null };
      return { status: "CORRUPT", error: "工作簿无法解析（可能已损坏）", units: [], pageCount: null, sheets: null };
    }
  }
  if (["png", "jpg", "jpeg"].includes(ext)) return { status: "NEEDS_OCR", error: "图片无文字层，当前没有 OCR 能力", units: [], pageCount: null, sheets: null };
  return { status: "UNSUPPORTED", error: "不支持的格式", units: [], pageCount: null, sheets: null };
}

/** 从解析单元抽取明细（纯组合） */
export function extractLinesFromUnits(units: ParsedUnit[], filename: string): ExtractedLine[] {
  const out: ExtractedLine[] = [];
  for (const u of units) {
    if (u.parseStatus !== "done") continue;
    if (u.unitKind === "sheet") {
      if (/\.txt$/i.test(filename)) continue;
      out.push(...extractFromTable({ sheet: (u.unitLabel ?? "Sheet").replace(/ · .*$/, ""), csvText: u.text, unitIndex: u.unitIndex }).lines);
    } else {
      out.push(...extractFromPdfPage({ pageText: u.text, pageNumber: u.unitIndex, unitIndex: u.unitIndex }));
    }
  }
  return out;
}

/** 认领并解析一个附件（after() 与 cron 共用；幂等） */
export async function processAttachment(attachmentId: string, opts?: { readBuffer?: (pathname: string) => Promise<Buffer | null> }): Promise<{ status: string; lines: number } | null> {
  const now = new Date();
  const claimed = await db.recordsAttachment.updateMany({
    where: { id: attachmentId, OR: [{ parseStatus: "PENDING" }, { parseStatus: "PARSING", parseStartedAt: { lt: new Date(now.getTime() - PARSE_STALE_MS) } }] },
    data: { parseStatus: "PARSING", parseStartedAt: now, parseAttempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return null;
  const att = await db.recordsAttachment.findUnique({ where: { id: attachmentId } });
  if (!att) return null;
  let buffer: Buffer | null = null;
  try {
    buffer = opts?.readBuffer ? await opts.readBuffer(att.storagePathname) : ((await readBlobBuffer(att.storagePathname))?.buffer ?? null);
  } catch {
    buffer = null;
  }
  if (!buffer) {
    await db.recordsAttachment.update({ where: { id: att.id }, data: { parseStatus: "FAILED", parseError: "存储读取失败，稍后重试" } });
    return { status: "FAILED", lines: 0 };
  }
  const parsed = await parseAttachmentBuffer(buffer, att.originalFilename);
  if (parsed.units.length) {
    await db.recordsAttachmentUnit.createMany({
      data: parsed.units.map((u) => ({ attachmentId: att.id, unitIndex: u.unitIndex, unitKind: u.unitKind, unitLabel: u.unitLabel, text: u.text, charCount: u.text.length, parseStatus: u.parseStatus })),
      skipDuplicates: true,
    });
  }
  await db.recordsAttachment.update({
    where: { id: att.id },
    data: {
      parseStatus: parsed.status,
      parseError: parsed.error,
      parsedAt: new Date(),
      pageCount: parsed.pageCount,
      sheetRangesJson: parsed.sheets ? (parsed.sheets as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
  let lineCount = 0;
  if (att.kind === "DISCLOSURE_FILE" && parsed.status === "PARSED") {
    const lines = extractLinesFromUnits(parsed.units, att.originalFilename);
    if (lines.length) {
      const res = await db.procurementLineItem.createMany({
        data: lines.map((l) => ({
          orgId: att.orgId,
          requestId: att.requestId,
          attachmentId: att.id,
          dedupeKey: l.dedupeKey,
          instrumentNumber: l.instrumentNumber,
          documentType: l.documentType,
          amountBasis: l.amountBasis,
          amendmentMode: l.amendmentMode,
          docRef: l.docRef,
          linkedRef: l.linkedRef,
          docDate: l.docDate ? new Date(`${l.docDate}T00:00:00Z`) : null,
          productDescription: l.productDescription,
          specification: l.specification,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          amount: l.amount,
          currency: l.currency,
          deliveryLocation: l.deliveryLocation,
          taxFreightNote: l.taxFreightNote,
          isCancellationOrCredit: l.isCancellationOrCredit,
          sourceUnitIndex: l.sourceUnitIndex,
          sourcePage: l.sourcePage,
          sourceSheet: l.sourceSheet,
          sourceRow: l.sourceRow,
          rawSnippet: l.rawSnippet,
          extractionMethod: l.extractionMethod,
          reviewStatus: "NEEDS_REVIEW",
        })),
        skipDuplicates: true,
      });
      lineCount = res.count;
    }
  }
  await recomputeFilesStatus(att.requestId);
  if (att.kind === "DISCLOSURE_FILE") {
    const { runAnalysis } = await import("./analysis");
    await runAnalysis({ requestId: att.requestId, userId: att.uploadedById, trigger: "EXTRACTION" });
  }
  return { status: parsed.status, lines: lineCount };
}

/** cron 兜底：处理排队 / 失联的解析 */
export async function processPendingAttachments(deadline: Date): Promise<{ processed: number }> {
  const now = new Date();
  const rows = await db.recordsAttachment.findMany({
    where: { OR: [{ parseStatus: "PENDING", uploadedAt: { lt: new Date(now.getTime() - 60_000) } }, { parseStatus: "PARSING", parseStartedAt: { lt: new Date(now.getTime() - PARSE_STALE_MS) } }], parseAttempts: { lt: 5 } },
    select: { id: true },
    take: 10,
    orderBy: { uploadedAt: "asc" },
  });
  let processed = 0;
  for (const r of rows) {
    if (Date.now() > deadline.getTime() - 5_000) break;
    try {
      await processAttachment(r.id);
      processed++;
    } catch (e) {
      console.error("[procurement-records] attachment parse failed", r.id, e instanceof Error ? e.message : "unknown");
    }
  }
  return { processed };
}

export const REVIEW_ACTIONS = ["CONFIRM", "REJECT", "EDIT_AND_CONFIRM"] as const;

export interface LineItemPatch {
  instrumentNumber?: string | null;
  documentType?: string;
  amountBasis?: string;
  amendmentMode?: string | null;
  docRef?: string | null;
  docDate?: string | null;
  productDescription?: string | null;
  quantity?: string | null;
  unit?: string | null;
  unitPrice?: string | null;
  amount?: string | null;
  currency?: string | null;
  deliveryLocation?: string | null;
  isCancellationOrCredit?: boolean;
}
