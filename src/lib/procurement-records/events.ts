/**
 * PROC-1 案件事件（只追加；spec「案件事件」「结案、撤回与转交」「期限」「站内待办」）。
 *
 * - 最终回应 / 撤回确认必须附来信（GOVERNMENT_LETTER）才能 CLOSED；内部提醒永不关闭案件；
 * - 转交保留原申请与原提交时间，记录接收机关、新编号与待确认状态，不生成第二次提交、不重置期限；
 * - 同一来信（附件哈希 / 来信编号 / message id + 事件类型）重复登记只保留一条；
 * - 更正以新事件指向旧事件，旧事件不删。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  actionForEvent,
  CASE_EVENT_TYPES,
  deriveFilesStatus,
  estimateDueDate,
  isGovernmentOutcome,
  taskKindForEvent,
  transition,
  type CaseEventType,
} from "./case-pure";
import { foldText } from "./identity";
import { isUniqueViolation } from "./instruments";
import { isValidIsoDate } from "./request-pure";
import { ensureRequestTask } from "./tasks";

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export interface CaseEventInput {
  requestId: string;
  userId: string;
  type: string;
  effectiveAt?: string | null;
  noteZh?: string | null;
  attachmentIds?: string[];
  /** 用户确认所附来信属于本申请与该机关（决定 document_verified） */
  confirmedMatch?: boolean;
  payload?: {
    caseNumber?: string;
    registeredAt?: string;
    officialDueAt?: string;
    outcome?: string;
    outcomeNote?: string;
    toInstitution?: string;
    newCaseNumber?: string;
    suggestedInstitution?: string;
    expectedReleasePages?: number;
    amountCents?: number;
    currency?: string;
    followUpAt?: string;
    letterReference?: string;
    messageId?: string;
    correctsEventId?: string;
    corrections?: { caseNumber?: string | null; officialDueAt?: string | null; expectedReleasePages?: number | null; submissionReference?: string | null };
  };
}

type Err = { ok: false; status: 400 | 404 | 409; code: string; message: string };
const err = (status: 400 | 404 | 409, code: string, message: string): Err => ({ ok: false, status, code, message });

function isCaseEventType(v: string): v is CaseEventType {
  return (CASE_EVENT_TYPES as readonly string[]).includes(v);
}

async function recomputeFilesStatus(requestId: string) {
  const [atts, confirmed, letters] = await Promise.all([
    db.recordsAttachment.findMany({ where: { requestId }, select: { kind: true } }),
    db.recordsRequestEvent.count({ where: { requestId, type: "FILES_RECEIVED_CONFIRMED" } }),
    db.recordsRequestEvent.count({ where: { requestId, type: { in: ["RESPONSE_LETTER", "FINAL_RESPONSE", "PARTIAL_RELEASE"] } } }),
  ]);
  const disclosure = atts.filter((a) => a.kind === "DISCLOSURE_FILE").length;
  const hasLetter = letters > 0 || atts.some((a) => a.kind === "GOVERNMENT_LETTER");
  const filesStatus = deriveFilesStatus({ hasLetter, disclosureFileCount: disclosure, userConfirmedAllFiles: confirmed > 0 });
  await db.recordsRequest.update({ where: { id: requestId }, data: { filesStatus } });
  return { filesStatus, disclosureFileCount: disclosure };
}
export { recomputeFilesStatus };

export async function addCaseEvent(input: CaseEventInput): Promise<{ ok: true; eventId: string; duplicate: boolean; status: string } | Err> {
  if (!isCaseEventType(input.type)) return err(400, "INVALID_EVENT_TYPE", `未知事件类型：${input.type}`);
  const type = input.type;
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
  const p = input.payload ?? {};
  const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : null;
  if (effectiveAt && Number.isNaN(effectiveAt.getTime())) return err(400, "INVALID_EFFECTIVE_AT", "生效时间无效");
  for (const d of [p.registeredAt, p.officialDueAt]) if (d && !isValidIsoDate(d)) return err(400, "INVALID_DATE", "日期格式应为 YYYY-MM-DD");

  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  const atts = attachmentIds.length ? await db.recordsAttachment.findMany({ where: { requestId: req.id, id: { in: attachmentIds } }, select: { id: true, kind: true, contentHash: true } }) : [];
  if (atts.length !== attachmentIds.length) return err(400, "ATTACHMENT_NOT_FOUND", "附件不存在或不属于本申请");

  // 去重键：附件哈希 / 来信编号 / message id
  let dedupeKey: string | null = null;
  if (atts.length) dedupeKey = `${type}:att:${atts.map((a) => a.contentHash).sort().join(",")}`;
  else if (p.letterReference?.trim()) dedupeKey = `${type}:ref:${foldText(p.letterReference)}`;
  else if (p.messageId?.trim()) dedupeKey = `${type}:msg:${p.messageId.trim()}`;

  if (dedupeKey) {
    const dup = await db.recordsRequestEvent.findUnique({ where: { requestId_dedupeKey: { requestId: req.id, dedupeKey } }, select: { id: true } });
    if (dup) return { ok: true, eventId: dup.id, duplicate: true, status: req.status };
  }

  // 状态动作
  const action = actionForEvent(type);
  let nextStatus = req.status;
  if (action) {
    const t = transition(req.status, action);
    if (!t.ok) return err(409, t.code, t.messageZh);
    nextStatus = t.to;
  } else if (type === "FILES_RECEIVED_CONFIRMED" && !["USER_REPORTED_SUBMISSION", "SUBMITTED", "ACKNOWLEDGED", "PROCESSING", "CLOSED"].includes(req.status)) {
    return err(409, "INVALID_TRANSITION", "尚未提交的申请不能确认取得披露文件");
  }

  const data: Prisma.RecordsRequestUncheckedUpdateInput = { status: nextStatus, lockVersion: { increment: 1 } };
  switch (type) {
    case "ACKNOWLEDGED": {
      if (!p.caseNumber?.trim()) return err(400, "CASE_NUMBER_REQUIRED", "请填写正式案件编号");
      data.caseNumber = p.caseNumber.trim().slice(0, 80);
      if (p.registeredAt && req.channel !== "INFORMAL") {
        const rule = req.ruleProfileId ? await db.recordsRuleProfile.findUnique({ where: { id: req.ruleProfileId } }) : null;
        const est = estimateDueDate({ receivedDate: p.registeredAt, deadlineValue: rule?.deadlineValue ?? null, deadlineUnit: rule?.deadlineUnit ?? null, channel: req.channel });
        data.estimatedDueAt = est.estimatedDueAt ? new Date(`${est.estimatedDueAt}T00:00:00Z`) : null;
        data.estimateBasis = est.basisZh;
      }
      break;
    }
    case "EXTENSION":
    case "CLARIFICATION_REQUEST":
      if (p.officialDueAt) data.officialDueAt = new Date(`${p.officialDueAt}T00:00:00Z`);
      break;
    case "TRANSFERRED":
      if (!p.toInstitution?.trim()) return err(400, "TO_INSTITUTION_REQUIRED", "请填写接收转交的机关");
      data.transferJson = json({ toInstitution: p.toInstitution.trim(), newCaseNumber: p.newCaseNumber?.trim() || null, status: "PENDING_CONFIRMATION", recordedAt: new Date().toISOString(), originalSubmittedAt: req.submittedAt?.toISOString() ?? null });
      data.governmentOutcome = "TRANSFERRED";
      break;
    case "RESPONSE_LETTER":
    case "PARTIAL_RELEASE":
      if (p.expectedReleasePages !== undefined) {
        if (!Number.isInteger(p.expectedReleasePages) || p.expectedReleasePages < 0) return err(400, "INVALID_PAGES", "页数须为非负整数");
        data.expectedReleasePages = p.expectedReleasePages;
      }
      break;
    case "FINAL_RESPONSE":
    case "WITHDRAWAL_CONFIRMED": {
      if (!atts.some((a) => a.kind === "GOVERNMENT_LETTER")) return err(409, "FINAL_RESPONSE_REQUIRES_LETTER", "结案必须附上机关的实际来信（GOVERNMENT_LETTER）");
      const outcome = type === "WITHDRAWAL_CONFIRMED" ? "WITHDRAWN" : p.outcome;
      if (!isGovernmentOutcome(outcome)) return err(400, "OUTCOME_REQUIRED", "请选择政府处理结果");
      data.governmentOutcome = outcome;
      data.outcomeNote = p.outcomeNote?.trim() || null;
      if (p.expectedReleasePages !== undefined && Number.isInteger(p.expectedReleasePages)) data.expectedReleasePages = p.expectedReleasePages;
      break;
    }
    case "FILES_RECEIVED_CONFIRMED": {
      const n = await db.recordsAttachment.count({ where: { requestId: req.id, kind: "DISCLOSURE_FILE" } });
      if (n === 0) return err(409, "NO_DISCLOSURE_FILES", "还没有上传任何披露文件，不能确认已取得全部文件");
      break;
    }
    case "INTERNAL_FOLLOW_UP": {
      const at = p.followUpAt ? new Date(p.followUpAt) : null;
      if (!at || Number.isNaN(at.getTime())) return err(400, "FOLLOW_UP_AT_REQUIRED", "请填写内部提醒时间");
      data.internalFollowUpAt = at;
      break;
    }
    case "CORRECTION": {
      if (!p.correctsEventId) return err(400, "CORRECTS_EVENT_REQUIRED", "更正必须指向被更正的事件");
      const target = await db.recordsRequestEvent.findFirst({ where: { id: p.correctsEventId, requestId: req.id }, select: { id: true } });
      if (!target) return err(404, "EVENT_NOT_FOUND", "被更正的事件不存在");
      const c = p.corrections ?? {};
      if (c.caseNumber !== undefined) data.caseNumber = c.caseNumber;
      if (c.submissionReference !== undefined) data.submissionReference = c.submissionReference;
      if (c.officialDueAt !== undefined) {
        if (c.officialDueAt && !isValidIsoDate(c.officialDueAt)) return err(400, "INVALID_DATE", "日期格式应为 YYYY-MM-DD");
        data.officialDueAt = c.officialDueAt ? new Date(`${c.officialDueAt}T00:00:00Z`) : null;
      }
      if (c.expectedReleasePages !== undefined) data.expectedReleasePages = c.expectedReleasePages;
      break;
    }
    default:
      break;
  }

  const evidenceLevel = atts.length && input.confirmedMatch ? "document_verified" : "user_reported";
  let eventId: string;
  try {
    eventId = await db.$transaction(async (tx) => {
      const fresh = await tx.recordsRequest.findUnique({ where: { id: req.id }, select: { status: true } });
      if (fresh?.status !== req.status) throw new Error("CONCURRENT_STATUS_CHANGE");
      const ev = await tx.recordsRequestEvent.create({
        data: {
          orgId: req.orgId,
          requestId: req.id,
          type,
          actorType: "USER",
          actorId: input.userId,
          effectiveAt,
          evidenceLevel: type === "NOTE" || type === "INTERNAL_FOLLOW_UP" ? null : evidenceLevel,
          attachmentIdsJson: atts.length ? atts.map((a) => a.id) : undefined,
          payloadJson: json(p),
          noteZh: input.noteZh?.trim()?.slice(0, 2000) || null,
          correctsEventId: p.correctsEventId ?? null,
          dedupeKey,
        },
      });
      await tx.recordsRequest.update({ where: { id: req.id }, data });
      if (atts.length) await tx.recordsAttachment.updateMany({ where: { id: { in: atts.map((a) => a.id) }, eventId: null }, data: { eventId: ev.id } });
      return ev.id;
    });
  } catch (e) {
    if (isUniqueViolation(e) && dedupeKey) {
      const existing = await db.recordsRequestEvent.findUnique({ where: { requestId_dedupeKey: { requestId: req.id, dedupeKey } }, select: { id: true } });
      if (existing) return { ok: true, eventId: existing.id, duplicate: true, status: req.status };
    }
    if (e instanceof Error && e.message === "CONCURRENT_STATUS_CHANGE") return err(409, "CONCURRENT_EDIT", "申请状态已变化，请刷新后重试");
    throw e;
  }

  const files = await recomputeFilesStatus(req.id);
  const kind = taskKindForEvent(type, { hasDisclosureFiles: files.disclosureFileCount > 0 });
  if (kind) await ensureRequestTask({ request: req, kind, sourceEventId: eventId, actorUserId: input.userId, dueDate: p.officialDueAt ? new Date(`${p.officialDueAt}T12:00:00Z`) : null });
  if (type === "INTERNAL_FOLLOW_UP" && data.internalFollowUpAt instanceof Date) {
    await ensureRequestTask({ request: req, kind: "FOLLOW_UP_DUE", sourceEventId: eventId, actorUserId: input.userId, dueDate: data.internalFollowUpAt });
  }
  return { ok: true, eventId, duplicate: false, status: nextStatus };
}
