/**
 * PROC-1 读模型：候选列表、采购工具详情、申请台账、申请详情、Tender 页卡片。
 * 只返回本组织数据（调用方已按服务端 orgId 鉴权）；通知 / 列表摘要不含申请人地址、邮箱、电话或附件内容。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { EVENT_LABELS } from "./case-pure";
import { institutionDisplayName, JURISDICTION_LABELS } from "./identity";
import { buildRequestContext } from "./requests";
import { manualSearchLinks } from "./sources-pure";
import { listRequestTasks } from "./tasks";
import { findRule } from "./rules";

const dec = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function listCandidates(orgId: string, filter: { triage?: string | null; q?: string | null; take?: number }) {
  const where: Prisma.ProcurementInstrumentWhereInput = { orgId, NOT: { triageStatus: "HISTORY" } };
  if (filter.triage && filter.triage !== "ALL") where.triageStatus = filter.triage;
  if (filter.q?.trim()) where.OR = [{ title: { contains: filter.q.trim(), mode: "insensitive" } }, { officialNumber: { contains: filter.q.trim(), mode: "insensitive" } }];
  const rows = await db.procurementInstrument.findMany({ where, orderBy: [{ updatedAt: "desc" }], take: Math.min(filter.take ?? 100, 300) });
  const ids = rows.map((r) => r.id);
  const [evCounts, callUps, links, requests] = await Promise.all([
    db.procurementSourceEvidence.groupBy({ by: ["instrumentId", "sourceType"], where: { instrumentId: { in: ids } }, _count: { _all: true } }),
    db.procurementInstrument.groupBy({ by: ["parentInstrumentId"], where: { parentInstrumentId: { in: ids } }, _count: { _all: true } }),
    db.procurementTenderLink.findMany({ where: { orgId, instrumentId: { in: ids } }, select: { instrumentId: true, projectId: true, relation: true } }),
    db.recordsRequest.findMany({ where: { orgId, autoDraftKey: { in: ids.map((i) => `auto:${i}`) } }, select: { id: true, autoDraftKey: true, status: true } }),
  ]);
  const items = rows.map((r) => {
    const p = (r.priorityJson ?? null) as { score?: number; dimensions?: unknown[]; unknownsZh?: string[] } | null;
    return {
      id: r.id,
      jurisdiction: r.jurisdiction,
      jurisdictionLabel: JURISDICTION_LABELS[r.jurisdiction as keyof typeof JURISDICTION_LABELS] ?? r.jurisdiction,
      instrumentClass: r.instrumentClass,
      instrumentSubtype: r.instrumentSubtype,
      officialNumber: r.officialNumber,
      title: r.title,
      contractingInstitution: r.contractingInstitution,
      buyingInstitution: r.buyingInstitution,
      recordsHolderInstitution: r.recordsHolderInstitution,
      vendorName: r.vendorName,
      closingAt: iso(r.closingAt),
      currentExpiryAt: day(r.currentExpiryAt),
      remainingOptions: r.remainingOptions,
      confirmedRetenderDate: day(r.confirmedRetenderDate),
      contractValue: dec(r.contractValue),
      contractValueBasis: r.contractValueBasis,
      currency: r.currency,
      triageStatus: r.triageStatus,
      origin: r.origin,
      possibleDuplicateOfId: r.possibleDuplicateOfId,
      priority: p,
      lastVerifiedAt: iso(r.lastVerifiedAt),
      lastChangedAt: iso(r.lastChangedAt),
      firstSeenAt: iso(r.firstSeenAt),
      evidenceCounts: Object.fromEntries(evCounts.filter((e) => e.instrumentId === r.id).map((e) => [e.sourceType, e._count._all])),
      callUpCount: callUps.find((c) => c.parentInstrumentId === r.id)?._count._all ?? 0,
      tenderLinks: links.filter((l) => l.instrumentId === r.id).map((l) => ({ projectId: l.projectId, relation: l.relation })),
      autoDraft: requests.find((q) => q.autoDraftKey === `auto:${r.id}`) ?? null,
    };
  });
  items.sort((a, b) => (b.priority?.score ?? -1) - (a.priority?.score ?? -1));
  return items;
}

export async function getInstrumentDetail(orgId: string, instrumentId: string) {
  const r = await db.procurementInstrument.findFirst({ where: { id: instrumentId, orgId } });
  if (!r) return null;
  const [evidence, children, relations, links] = await Promise.all([
    db.procurementSourceEvidence.findMany({ where: { instrumentId: r.id }, orderBy: { fetchedAt: "desc" }, take: 50, select: { id: true, sourceType: true, sourceKey: true, sourceRecordId: true, sourceUrl: true, isOfficial: true, contentHash: true, publishedAt: true, fetchedAt: true, lastSeenAt: true, parseStatus: true, summary: true } }),
    db.procurementInstrument.findMany({ where: { orgId, parentInstrumentId: r.id }, orderBy: { awardDate: "desc" }, take: 200, select: { id: true, officialNumber: true, title: true, vendorName: true, awardDate: true, contractValue: true, contractValueBasis: true, buyingInstitution: true } }),
    db.procurementInstrumentRelation.findMany({ where: { orgId, OR: [{ fromInstrumentId: r.id }, { toInstrumentId: r.id }] } }),
    db.procurementTenderLink.findMany({ where: { orgId, instrumentId: r.id } }),
  ]);
  const projects = links.length ? await db.project.findMany({ where: { id: { in: links.map((l) => l.projectId) } }, select: { id: true, name: true } }) : [];
  return {
    id: r.id,
    officialNumber: r.officialNumber,
    normalizedNumber: r.normalizedNumber,
    title: r.title,
    jurisdiction: r.jurisdiction,
    instrumentClass: r.instrumentClass,
    instrumentSubtype: r.instrumentSubtype,
    aliases: r.aliasesJson,
    contractingInstitution: r.contractingInstitution,
    buyingInstitution: r.buyingInstitution,
    recordsHolderInstitution: r.recordsHolderInstitution,
    recordsHolderBasis: r.recordsHolderBasis,
    vendorName: r.vendorName,
    currentExpiryAt: day(r.currentExpiryAt),
    remainingOptions: r.remainingOptions,
    confirmedRetenderDate: day(r.confirmedRetenderDate),
    contractValue: dec(r.contractValue),
    contractValueBasis: r.contractValueBasis,
    currency: r.currency,
    triageStatus: r.triageStatus,
    priority: r.priorityJson,
    match: r.matchJson,
    possibleDuplicateOfId: r.possibleDuplicateOfId,
    lastVerifiedAt: iso(r.lastVerifiedAt),
    lastChangedAt: iso(r.lastChangedAt),
    evidence: evidence.map((e) => ({ ...e, publishedAt: iso(e.publishedAt), fetchedAt: iso(e.fetchedAt), lastSeenAt: iso(e.lastSeenAt) })),
    callUps: children.map((c) => ({ ...c, awardDate: day(c.awardDate), contractValue: dec(c.contractValue) })),
    relations,
    tenderLinks: links.map((l) => ({ projectId: l.projectId, projectName: projects.find((p) => p.id === l.projectId)?.name ?? null, relation: l.relation })),
    manualSearchLinks: manualSearchLinks(r.officialNumber),
  };
}

export async function listRequests(orgId: string, filter: { status?: string | null; institution?: string | null; projectId?: string | null; pendingOnly?: boolean; includeArchived?: boolean }) {
  const where: Prisma.RecordsRequestWhereInput = { orgId };
  if (filter.status && filter.status !== "ALL") where.status = filter.status;
  if (filter.institution) where.recipientInstitutionKey = filter.institution;
  if (filter.projectId) where.projectId = filter.projectId;
  if (!filter.includeArchived) where.archivedAt = null;
  const rows = await db.recordsRequest.findMany({ where, orderBy: { updatedAt: "desc" }, take: 300 });
  const tasks = await db.task.findMany({ where: { sourceType: "records_request", sourceId: { in: rows.map((r) => r.id) }, status: { notIn: ["done", "cancelled"] } }, select: { sourceId: true } });
  const pending = new Map<string, number>();
  for (const t of tasks) pending.set(t.sourceId!, (pending.get(t.sourceId!) ?? 0) + 1);
  const projects = await db.project.findMany({ where: { id: { in: rows.map((r) => r.projectId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    jurisdiction: r.jurisdiction,
    recipientInstitution: r.recipientInstitution,
    recipientInstitutionKey: r.recipientInstitutionKey,
    recipientDisplay: r.recipientInstitution ? institutionDisplayName(r.recipientInstitutionKey, r.recipientInstitution) : null,
    projectId: r.projectId,
    projectName: projects.find((p) => p.id === r.projectId)?.name ?? null,
    pathType: r.pathType,
    channel: r.channel,
    status: r.status,
    filesStatus: r.filesStatus,
    analysisStatus: r.analysisStatus,
    governmentOutcome: r.governmentOutcome,
    caseNumber: r.caseNumber,
    submittedAt: iso(r.submittedAt),
    evidenceLevel: r.submissionEvidenceLevel,
    officialDueAt: day(r.officialDueAt),
    estimatedDueAt: day(r.estimatedDueAt),
    internalFollowUpAt: iso(r.internalFollowUpAt),
    origin: r.origin,
    archived: Boolean(r.archivedAt),
    pendingTasks: pending.get(r.id) ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  }));
  return filter.pendingOnly ? items.filter((i) => i.pendingTasks > 0) : items;
}

export async function getRequestDetail(requestId: string) {
  const ctx = await buildRequestContext(requestId);
  if (!ctx) return null;
  const r = ctx.request;
  const [versions, events, attachments, lineItems, analyses, tasks, applicant, rule, project] = await Promise.all([
    db.recordsRequestVersion.findMany({ where: { requestId: r.id }, orderBy: { versionNo: "desc" }, select: { id: true, versionNo: true, kind: true, textHash: true, scopeFingerprint: true, createdAt: true, createdById: true, startDate: true, endDate: true } }),
    db.recordsRequestEvent.findMany({ where: { requestId: r.id }, orderBy: { recordedAt: "asc" } }),
    db.recordsAttachment.findMany({ where: { requestId: r.id }, orderBy: { uploadedAt: "asc" }, select: { id: true, kind: true, originalFilename: true, sizeBytes: true, mimeType: true, contentHash: true, source: true, acquiredAt: true, uploadedAt: true, uploadedById: true, parseStatus: true, parseError: true, pageCount: true, sheetRangesJson: true, eventId: true } }),
    db.procurementLineItem.findMany({ where: { requestId: r.id }, orderBy: [{ attachmentId: "asc" }, { sourceUnitIndex: "asc" }, { sourceRow: "asc" }], take: 1000 }),
    db.procurementAnalysis.findMany({ where: { requestId: r.id }, orderBy: { versionNo: "desc" }, take: 5 }),
    listRequestTasks(r.id),
    r.applicantProfileId ? db.recordsApplicantProfile.findUnique({ where: { id: r.applicantProfileId } }) : null,
    r.ruleProfileId ? db.recordsRuleProfile.findUnique({ where: { id: r.ruleProfileId } }) : findRule(r.orgId, r.jurisdiction, r.recipientInstitutionKey, r.channel),
    r.projectId ? db.project.findUnique({ where: { id: r.projectId }, select: { id: true, name: true } }) : null,
  ]);
  const submittedVersion = r.submittedVersionId && r.submittedVersionId !== r.currentVersionId ? await db.recordsRequestVersion.findUnique({ where: { id: r.submittedVersionId } }) : null;
  const actorIds = [...new Set([...events.map((e) => e.actorId), ...versions.map((v) => v.createdById), r.submissionVerifiedById].filter((x): x is string => !!x))];
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const name = (id: string | null) => (id ? (actors.find((a) => a.id === id)?.name ?? "成员") : null);
  const refs = (Array.isArray(ctx.version?.instrumentRefsJson) ? ctx.version!.instrumentRefsJson : []) as Array<{ number: string; normalized: string; instrumentId: string | null }>;
  const instruments = refs.length ? await db.procurementInstrument.findMany({ where: { orgId: r.orgId, normalizedNumber: { in: refs.map((x) => x.normalized) } }, select: { id: true, officialNumber: true, title: true, lastVerifiedAt: true, contractingInstitution: true, buyingInstitution: true, recordsHolderInstitution: true, currentExpiryAt: true } }) : [];
  return {
    id: r.id,
    orgId: r.orgId,
    title: r.title,
    project,
    jurisdiction: r.jurisdiction,
    jurisdictionLabel: JURISDICTION_LABELS[r.jurisdiction as keyof typeof JURISDICTION_LABELS] ?? r.jurisdiction,
    recipientInstitution: r.recipientInstitution,
    recipientInstitutionKey: r.recipientInstitutionKey,
    recipientDisplay: r.recipientInstitution ? institutionDisplayName(r.recipientInstitutionKey, r.recipientInstitution) : null,
    recordsHolderBasis: r.recordsHolderBasis,
    lawLabel: r.lawLabel,
    pathType: r.pathType,
    channel: r.channel,
    status: r.status,
    filesStatus: r.filesStatus,
    analysisStatus: r.analysisStatus,
    governmentOutcome: r.governmentOutcome,
    outcomeNote: r.outcomeNote,
    purposeZh: r.purposeZh,
    gapsZh: r.gapsZh,
    pathChecks: r.pathChecksJson,
    overlapReason: r.overlapReason,
    submission: {
      submittedAt: iso(r.submittedAt),
      channel: r.submissionChannel,
      actualFeeCents: r.actualFeeCents,
      feeCurrency: r.feeCurrency,
      submissionReference: r.submissionReference,
      caseNumber: r.caseNumber,
      evidenceLevel: r.submissionEvidenceLevel,
      verifiedBy: name(r.submissionVerifiedById),
      verifiedAt: iso(r.submissionVerifiedAt),
      verificationMethod: r.submissionVerificationMethod,
      submittedVersionId: r.submittedVersionId,
      submittedTextVerified: r.submittedTextVerified,
      unknownFacts: r.unknownFactsJson,
    },
    deadlines: { officialDueAt: day(r.officialDueAt), estimatedDueAt: day(r.estimatedDueAt), estimateBasis: r.estimateBasis, internalFollowUpAt: iso(r.internalFollowUpAt) },
    transfer: r.transferJson,
    expectedReleasePages: r.expectedReleasePages,
    origin: r.origin,
    originNote: r.originNote,
    archived: Boolean(r.archivedAt),
    archiveReason: r.archiveReason,
    lockVersion: r.lockVersion,
    currentVersion: ctx.version
      ? {
          id: ctx.version.id,
          versionNo: ctx.version.versionNo,
          kind: ctx.version.kind,
          bodyEn: ctx.version.bodyEn,
          explanationZh: ctx.version.explanationZh,
          startDate: day(ctx.version.startDate),
          endDate: day(ctx.version.endDate),
          categories: ctx.version.categoriesJson,
          instrumentRefs: refs,
          textHash: ctx.version.textHash,
          scopeFingerprint: ctx.version.scopeFingerprint,
          applicantProfileVersion: ctx.version.applicantProfileVersion,
          applicantSnapshot: ctx.version.applicantSnapshotJson,
        }
      : null,
    submittedVersion: submittedVersion ? { id: submittedVersion.id, versionNo: submittedVersion.versionNo, bodyEn: submittedVersion.bodyEn, textHash: submittedVersion.textHash, kind: submittedVersion.kind } : null,
    versions: versions.map((v) => ({ id: v.id, versionNo: v.versionNo, kind: v.kind, textHash: v.textHash, scopeFingerprint: v.scopeFingerprint, createdAt: v.createdAt.toISOString(), createdBy: name(v.createdById), startDate: day(v.startDate), endDate: day(v.endDate), isSubmitted: v.id === r.submittedVersionId, isHandoff: v.id === r.handoffVersionId, isCurrent: v.id === r.currentVersionId })),
    ready: ctx.ready,
    /** 只有草稿 / 就绪阶段需要 READY 闸；交接与提交之后不再适用（重叠只作参考） */
    readyApplicable: ["DRAFT", "READY"].includes(r.status) && !r.archivedAt,
    duplicate: ctx.duplicate,
    applicant: applicant
      ? { id: applicant.id, label: applicant.label, version: applicant.version, verificationStatus: applicant.verificationStatus, legalName: applicant.legalName, representativeName: applicant.representativeName, addressLine1: applicant.addressLine1, addressLine2: applicant.addressLine2, city: applicant.city, province: applicant.province, postalCode: applicant.postalCode, country: applicant.country, email: applicant.email, phone: applicant.phone }
      : null,
    rule: rule
      ? { id: rule.id, jurisdiction: rule.jurisdiction, institutionKey: rule.institutionKey, lawLabel: rule.lawLabel, officialPortalUrl: rule.officialPortalUrl, guidanceUrl: rule.guidanceUrl, channel: rule.channel, applicationFeeCents: rule.applicationFeeCents, currency: rule.currency, otherFeesRule: rule.otherFeesRule, deadlineValue: rule.deadlineValue, deadlineUnit: rule.deadlineUnit, selfServeSupported: rule.selfServeSupported, verificationStatus: rule.verificationStatus, verifiedAt: iso(rule.verifiedAt), verificationMethod: rule.verificationMethod, sourceRefs: rule.sourceRefsJson, fieldGuide: rule.fieldGuideJson }
      : null,
    instruments: instruments.map((i) => ({ ...i, lastVerifiedAt: iso(i.lastVerifiedAt), currentExpiryAt: day(i.currentExpiryAt) })),
    events: events.map((e) => ({ id: e.id, type: e.type, label: EVENT_LABELS[e.type] ?? e.type, actorType: e.actorType, actor: name(e.actorId), recordedAt: e.recordedAt.toISOString(), effectiveAt: iso(e.effectiveAt), evidenceLevel: e.evidenceLevel, attachmentIds: e.attachmentIdsJson, payload: e.payloadJson, noteZh: e.noteZh, correctsEventId: e.correctsEventId })),
    attachments: attachments.map((a) => ({ ...a, acquiredAt: iso(a.acquiredAt), uploadedAt: a.uploadedAt.toISOString(), downloadUrl: `/api/procurement/requests/${r.id}/attachments/${a.id}` })),
    lineItems: lineItems.map((l) => ({ id: l.id, attachmentId: l.attachmentId, instrumentNumber: l.instrumentNumber, documentType: l.documentType, amountBasis: l.amountBasis, amendmentMode: l.amendmentMode, docRef: l.docRef, docDate: day(l.docDate), productDescription: l.productDescription, specification: l.specification, quantity: dec(l.quantity), unit: l.unit, unitPrice: dec(l.unitPrice), amount: dec(l.amount), currency: l.currency, deliveryLocation: l.deliveryLocation, taxFreightNote: l.taxFreightNote, isCancellationOrCredit: l.isCancellationOrCredit, sourcePage: l.sourcePage, sourceSheet: l.sourceSheet, sourceRow: l.sourceRow, rawSnippet: l.rawSnippet, extractionMethod: l.extractionMethod, reviewStatus: l.reviewStatus, reviewNote: l.reviewNote, reviewedAt: iso(l.reviewedAt) })),
    analyses: analyses.map((a) => ({ id: a.id, versionNo: a.versionNo, status: a.status, coverage: a.coverageJson, result: a.resultJson, gaps: a.gapsJson, assumptions: a.assumptionsJson, lineItemCount: a.lineItemCount, confirmedCount: a.confirmedCount, createdAt: a.createdAt.toISOString() })),
    tasks: tasks.map((t) => ({ ...t, dueDate: iso(t.dueDate), createdAt: t.createdAt.toISOString() })),
    manualSearchLinks: refs.length ? manualSearchLinks(refs[0].number) : [],
    mailIntake: { enabled: false, note: "尚未启用自动收信：请上传或粘贴政府来信" },
  };
}

export type RequestDetail = NonNullable<Awaited<ReturnType<typeof getRequestDetail>>>;

/** Tender 详情「历史采购与资料申请」卡片 */
export async function getTenderProcurementSummary(orgId: string, projectId: string) {
  const links = await db.procurementTenderLink.findMany({ where: { orgId, projectId } });
  const instruments = links.length ? await db.procurementInstrument.findMany({ where: { orgId, id: { in: links.map((l) => l.instrumentId) } }, select: { id: true, officialNumber: true, title: true, currentExpiryAt: true, instrumentClass: true, recordsHolderInstitution: true } }) : [];
  const requests = await db.recordsRequest.findMany({ where: { orgId, projectId }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, status: true, filesStatus: true, analysisStatus: true, governmentOutcome: true, caseNumber: true } });
  return {
    instruments: links.map((l) => {
      const i = instruments.find((x) => x.id === l.instrumentId);
      return { relation: l.relation, id: l.instrumentId, officialNumber: i?.officialNumber ?? "?", title: i?.title ?? null, currentExpiryAt: day(i?.currentExpiryAt ?? null), recordsHolderInstitution: i?.recordsHolderInstitution ?? null };
    }),
    requests,
  };
}
