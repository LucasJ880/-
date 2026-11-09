/**
 * PROC-1 明细复核与分析版本（DB）。每次分析新增版本、旧版本保留；分析待复核时生成站内待办。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { analyzeDisclosure, type AnalysisLine } from "./analysis-pure";
import { AMOUNT_BASES, DOCUMENT_TYPES, parseDecimal } from "./extract-pure";
import { normalizeInstrumentNumber } from "./identity";
import { isValidIsoDate } from "./request-pure";
import { appendRequestEvent } from "./requests";
import { ensureRequestTask } from "./tasks";
import type { LineItemPatch } from "./attachments";

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const dec = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());

export async function runAnalysis(input: { requestId: string; userId: string; trigger: "USER" | "EXTRACTION" | "REVIEW" }) {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return { ok: false as const, status: 404 as const, code: "REQUEST_NOT_FOUND", message: "申请不存在" };
  await db.recordsRequest.update({ where: { id: req.id }, data: { analysisStatus: "RUNNING" } });
  try {
    const [items, atts, version] = await Promise.all([
      db.procurementLineItem.findMany({ where: { requestId: req.id }, orderBy: [{ attachmentId: "asc" }, { sourceUnitIndex: "asc" }, { sourceRow: "asc" }] }),
      db.recordsAttachment.findMany({ where: { requestId: req.id }, select: { id: true, originalFilename: true, kind: true, parseStatus: true, pageCount: true } }),
      req.submittedVersionId ?? req.currentVersionId ? db.recordsRequestVersion.findUnique({ where: { id: (req.submittedVersionId ?? req.currentVersionId)! } }) : null,
    ]);
    const refs = (Array.isArray(version?.instrumentRefsJson) ? version!.instrumentRefsJson : []) as Array<{ number: string; normalized: string }>;
    const instruments = refs.length
      ? await db.procurementInstrument.findMany({ where: { orgId: req.orgId, normalizedNumber: { in: refs.map((r) => r.normalized) } }, select: { id: true, officialNumber: true, contractValue: true, contractValueBasis: true } })
      : [];
    const callUps = instruments.length ? await db.procurementInstrument.groupBy({ by: ["parentInstrumentId"], where: { parentInstrumentId: { in: instruments.map((i) => i.id) } }, _count: { _all: true } }) : [];
    const attName = new Map(atts.map((a) => [a.id, a.originalFilename]));
    const lines: AnalysisLine[] = items.map((l) => ({
      id: l.id,
      instrumentNumber: l.instrumentNumber,
      documentType: l.documentType,
      amountBasis: l.amountBasis,
      amendmentMode: l.amendmentMode,
      docRef: l.docRef,
      docDate: l.docDate ? l.docDate.toISOString().slice(0, 10) : null,
      productDescription: l.productDescription,
      quantity: dec(l.quantity),
      unit: l.unit,
      unitPrice: dec(l.unitPrice),
      amount: dec(l.amount),
      currency: l.currency,
      deliveryLocation: l.deliveryLocation,
      isCancellationOrCredit: l.isCancellationOrCredit,
      reviewStatus: l.reviewStatus,
      sourceLabel: `${attName.get(l.attachmentId) ?? "附件"}${l.sourcePage ? ` 第 ${l.sourcePage} 页` : ""}${l.sourceSheet ? ` 工作表「${l.sourceSheet}」` : ""}${l.sourceRow ? ` 第 ${l.sourceRow} 行` : ""}`,
    }));
    const result = analyzeDisclosure({
      lines,
      attachments: atts.map((a) => ({ id: a.id, filename: a.originalFilename, kind: a.kind, parseStatus: a.parseStatus, pageCount: a.pageCount })),
      request: {
        institution: req.recipientInstitution,
        requestedStart: version?.startDate ? version.startDate.toISOString().slice(0, 10) : null,
        requestedEnd: version?.endDate ? version.endDate.toISOString().slice(0, 10) : null,
        governmentOutcome: req.governmentOutcome,
        filesStatus: req.filesStatus,
        expectedReleasePages: req.expectedReleasePages,
      },
      instruments: instruments.map((i) => ({ number: i.officialNumber, contractValue: dec(i.contractValue), contractValueBasis: i.contractValueBasis, callUpCount: callUps.find((c) => c.parentInstrumentId === i.id)?._count._all ?? 0 })),
    });
    const max = await db.procurementAnalysis.aggregate({ where: { requestId: req.id }, _max: { versionNo: true } });
    const versionNo = (max._max.versionNo ?? 0) + 1;
    const analysis = await db.procurementAnalysis.create({
      data: {
        orgId: req.orgId,
        requestId: req.id,
        versionNo,
        status: result.status,
        inputAttachmentIdsJson: atts.filter((a) => a.kind === "DISCLOSURE_FILE").map((a) => a.id),
        coverageJson: json(result.coverage),
        resultJson: json({ headlineZh: result.headlineZh, totals: result.totals, quantities: result.quantities, unitPrices: result.unitPrices, orderFrequency: result.orderFrequency, publicValueNotes: result.publicValueNotes, counts: result.counts }),
        gapsJson: json(result.gaps),
        assumptionsJson: json(result.assumptions),
        lineItemCount: result.counts.total,
        confirmedCount: result.counts.confirmed,
        createdById: input.userId,
        completedAt: new Date(),
      },
    });
    await db.recordsRequest.update({ where: { id: req.id }, data: { analysisStatus: result.status } });
    const ev = await appendRequestEvent(db, { orgId: req.orgId, requestId: req.id, type: "ANALYSIS_RUN", actorId: input.userId, actorType: input.trigger === "EXTRACTION" ? "SYSTEM" : "USER", payload: { analysisId: analysis.id, versionNo, status: result.status, counts: result.counts } });
    if (result.status === "NEEDS_REVIEW") await ensureRequestTask({ request: req, kind: "REVIEW_ANALYSIS", sourceEventId: `analysis-v${versionNo}`, actorUserId: input.userId });
    void ev;
    return { ok: true as const, analysisId: analysis.id, versionNo, result };
  } catch (e) {
    await db.recordsRequest.update({ where: { id: req.id }, data: { analysisStatus: "FAILED" } });
    throw e;
  }
}

function validDecimal(v: string | null | undefined): boolean {
  if (v === null || v === undefined || v === "") return true;
  return parseDecimal(v).value !== null;
}

/** 复核明细：确认 / 否决 / 修改后确认（记录复核人与时间；更正不删原始片段） */
export async function reviewLineItem(input: { requestId: string; lineItemId: string; userId: string; action: "CONFIRM" | "REJECT" | "EDIT_AND_CONFIRM"; patch?: LineItemPatch; note?: string | null }) {
  const item = await db.procurementLineItem.findFirst({ where: { id: input.lineItemId, requestId: input.requestId } });
  if (!item) return { ok: false as const, status: 404 as const, code: "LINE_ITEM_NOT_FOUND", message: "明细不存在" };
  const p = input.patch ?? {};
  if (p.amountBasis !== undefined && !(AMOUNT_BASES as readonly string[]).includes(p.amountBasis)) return { ok: false as const, status: 400 as const, code: "INVALID_BASIS", message: "金额口径无效" };
  if (p.documentType !== undefined && !(DOCUMENT_TYPES as readonly string[]).includes(p.documentType)) return { ok: false as const, status: 400 as const, code: "INVALID_DOCUMENT_TYPE", message: "单据类型无效" };
  if (p.amendmentMode !== undefined && p.amendmentMode !== null && !["INCREMENT", "REVISED_TOTAL", "UNKNOWN"].includes(p.amendmentMode)) return { ok: false as const, status: 400 as const, code: "INVALID_AMENDMENT_MODE", message: "修订口径无效" };
  for (const v of [p.quantity, p.unitPrice, p.amount]) if (!validDecimal(v)) return { ok: false as const, status: 400 as const, code: "INVALID_NUMBER", message: "数量 / 单价 / 金额须为数字或留空（未知）" };
  if (p.docDate && !isValidIsoDate(p.docDate)) return { ok: false as const, status: 400 as const, code: "INVALID_DATE", message: "日期格式应为 YYYY-MM-DD" };
  const norm = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v === "" ? null : parseDecimal(v).value);
  const data: Prisma.ProcurementLineItemUncheckedUpdateInput = {
    reviewStatus: input.action === "REJECT" ? "REJECTED" : "CONFIRMED",
    reviewedById: input.userId,
    reviewedAt: new Date(),
    reviewNote: input.note?.trim()?.slice(0, 1000) || null,
  };
  if (input.action === "EDIT_AND_CONFIRM") {
    if (p.instrumentNumber !== undefined) data.instrumentNumber = p.instrumentNumber ? normalizeInstrumentNumber(p.instrumentNumber).normalized : null;
    if (p.documentType !== undefined) data.documentType = p.documentType;
    if (p.amountBasis !== undefined) data.amountBasis = p.amountBasis;
    if (p.amendmentMode !== undefined) data.amendmentMode = p.amendmentMode;
    if (p.docRef !== undefined) data.docRef = p.docRef;
    if (p.docDate !== undefined) data.docDate = p.docDate ? new Date(`${p.docDate}T00:00:00Z`) : null;
    if (p.productDescription !== undefined) data.productDescription = p.productDescription;
    if (p.quantity !== undefined) data.quantity = norm(p.quantity);
    if (p.unit !== undefined) data.unit = p.unit;
    if (p.unitPrice !== undefined) data.unitPrice = norm(p.unitPrice);
    if (p.amount !== undefined) data.amount = norm(p.amount);
    if (p.currency !== undefined) data.currency = p.currency ? p.currency.toUpperCase().slice(0, 3) : null;
    if (p.deliveryLocation !== undefined) data.deliveryLocation = p.deliveryLocation;
    if (p.isCancellationOrCredit !== undefined) data.isCancellationOrCredit = p.isCancellationOrCredit;
  }
  await db.procurementLineItem.update({ where: { id: item.id }, data });
  return { ok: true as const };
}

/** 人工录入（扫描件 / 无 OCR 时）：必须指向附件与页码，记为 MANUAL 并由录入人确认 */
export async function addManualLineItem(input: { requestId: string; attachmentId: string; userId: string; sourcePage: number | null; rawSnippet: string; patch: LineItemPatch }) {
  const att = await db.recordsAttachment.findFirst({ where: { id: input.attachmentId, requestId: input.requestId } });
  if (!att) return { ok: false as const, status: 404 as const, code: "ATTACHMENT_NOT_FOUND", message: "附件不存在" };
  if (!input.rawSnippet?.trim()) return { ok: false as const, status: 400 as const, code: "SNIPPET_REQUIRED", message: "请抄录原文片段（用于追溯）" };
  const p = input.patch;
  if (!p.amountBasis || !(AMOUNT_BASES as readonly string[]).includes(p.amountBasis)) return { ok: false as const, status: 400 as const, code: "INVALID_BASIS", message: "请选择金额口径（不确定选 UNKNOWN）" };
  for (const v of [p.quantity, p.unitPrice, p.amount]) if (!validDecimal(v)) return { ok: false as const, status: 400 as const, code: "INVALID_NUMBER", message: "数量 / 单价 / 金额须为数字或留空（未知）" };
  if (p.docDate && !isValidIsoDate(p.docDate)) return { ok: false as const, status: 400 as const, code: "INVALID_DATE", message: "日期格式应为 YYYY-MM-DD" };
  const norm = (v: string | null | undefined) => (v === undefined || v === null || v === "" ? null : parseDecimal(v).value);
  const row = await db.procurementLineItem.create({
    data: {
      orgId: att.orgId,
      requestId: att.requestId,
      attachmentId: att.id,
      dedupeKey: `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      instrumentNumber: p.instrumentNumber ? normalizeInstrumentNumber(p.instrumentNumber).normalized : null,
      documentType: p.documentType && (DOCUMENT_TYPES as readonly string[]).includes(p.documentType) ? p.documentType : "OTHER",
      amountBasis: p.amountBasis,
      amendmentMode: p.amendmentMode ?? null,
      docRef: p.docRef ?? null,
      docDate: p.docDate ? new Date(`${p.docDate}T00:00:00Z`) : null,
      productDescription: p.productDescription ?? null,
      quantity: norm(p.quantity),
      unit: p.unit ?? null,
      unitPrice: norm(p.unitPrice),
      amount: norm(p.amount),
      currency: p.currency ? p.currency.toUpperCase().slice(0, 3) : null,
      deliveryLocation: p.deliveryLocation ?? null,
      isCancellationOrCredit: p.isCancellationOrCredit ?? false,
      sourcePage: input.sourcePage,
      rawSnippet: input.rawSnippet.trim().slice(0, 2000),
      extractionMethod: "MANUAL",
      reviewStatus: "CONFIRMED",
      reviewedById: input.userId,
      reviewedAt: new Date(),
      createdById: input.userId,
    },
  });
  return { ok: true as const, lineItemId: row.id };
}
