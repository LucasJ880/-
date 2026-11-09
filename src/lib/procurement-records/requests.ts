/**
 * PROC-1 资料申请服务（design D7–D9；spec procurement/records-request）。
 *
 * - 版本只插入：任何正文 / 范围 / 机关 / 渠道 / 申请人变动新增版本；已提交版本永不覆盖；
 * - READY / 交接在事务内先取 advisory lock（申请主体 + 辖区 + 机关）再重算重复检查与 READY 闸；
 * - 「复制正文」「打开入口」只写非状态事件；提交状态只由用户回填 / 回执核对 / 真实证据改变；
 * - 不自动提交、不付款、不发邮件；不保存政府凭证。
 */

import type { Prisma, RecordsRequest, RecordsRequestVersion } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { applicantSnapshot } from "./applicants";
import {
  applyImportEvidence,
  estimateDueDate,
  isSufficientReceiptKind,
  mapLegacyStatus,
  matchReceipt,
  transition,
  type RequestAction,
} from "./case-pure";
import { checkDuplicates, type DuplicateCheck, type ExistingRequestScope } from "./duplicate-check";
import { institutionDisplayName, normalizeInstitutionKey, normalizeInstrumentNumber, isJurisdiction } from "./identity";
import { isUniqueViolation, upsertInstrumentFromRecord } from "./instruments";
import { evaluateReady, type ReadyBlocker } from "./ready-gate";
import {
  buildCompletedAtiCopyBody,
  buildExplanationZh,
  buildFederalAtiBody,
  isRecordCategory,
  isValidIsoDate,
  PATH_TYPES,
  RECORD_CATEGORIES,
  scopeFingerprint,
  textHash,
  UNKNOWN_CATEGORY,
  type PathType,
  type RecordCategory,
} from "./request-pure";
import { bodyTitle, buildProvincialRequestBody, resolveRequestLaw } from "./request-templates";
import { ensureDefaultRules, findRule } from "./rules";
import { localDateOf, DEFAULT_TIMEZONE } from "./schedule";
import { stableHash } from "./sources-pure";
import { ensureRequestTask } from "./tasks";

type Tx = Prisma.TransactionClient;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export type ServiceError = { ok: false; status: 400 | 404 | 409; code: string; message: string; detail?: unknown };
const err = (status: 400 | 404 | 409, code: string, message: string, detail?: unknown): ServiceError => ({ ok: false, status, code, message, ...(detail !== undefined ? { detail } : {}) });

export interface InstrumentRef {
  number: string;
  normalized: string;
  instrumentId: string | null;
}

function readRefs(v: unknown): InstrumentRef[] {
  return Array.isArray(v) ? (v as InstrumentRef[]).filter((r) => r && typeof r.number === "string") : [];
}
function readCategories(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
}
const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

// ─────────────────────────── 创建 ───────────────────────────

export interface CreateRequestInput {
  orgId: string;
  userId: string;
  projectId?: string | null;
  instrumentIds?: string[];
  instrumentNumbers?: string[];
  pathType?: PathType;
  channel?: "FORMAL" | "INFORMAL";
  jurisdiction?: string;
  recipientInstitution?: string | null;
  recordsHolderBasis?: string | null;
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  categories?: string[];
  applicantProfileId?: string | null;
  purposeZh?: string | null;
  gapsZh?: string | null;
  completedAtiRequestNumbers?: string[];
  autoDraftKey?: string | null;
  createdVia?: "USER" | "SCAN";
}

export async function createRequestDraft(input: CreateRequestInput): Promise<{ ok: true; requestId: string; created: boolean } | ServiceError> {
  const pathType: PathType = input.pathType && (PATH_TYPES as readonly string[]).includes(input.pathType) ? input.pathType : "NEW_FORMAL_REQUEST";
  const channel = input.channel ?? (pathType === "COMPLETED_ATI_COPY" ? "INFORMAL" : "FORMAL");
  if (input.startDate && !isValidIsoDate(input.startDate)) return err(400, "INVALID_DATE", "起始日期格式应为 YYYY-MM-DD");
  if (input.endDate && !isValidIsoDate(input.endDate)) return err(400, "INVALID_DATE", "结束日期格式应为 YYYY-MM-DD");

  const ids = [...new Set(input.instrumentIds ?? [])];
  const instruments = ids.length
    ? await db.procurementInstrument.findMany({ where: { orgId: input.orgId, id: { in: ids } } })
    : [];
  if (instruments.length !== ids.length) return err(400, "INSTRUMENT_NOT_FOUND", "关联的合同不存在或不属于本组织");
  if (input.projectId) {
    const p = await db.project.findUnique({ where: { id: input.projectId }, select: { orgId: true } });
    if (!p || p.orgId !== input.orgId) return err(400, "PROJECT_NOT_FOUND", "Tender 项目不存在或不属于本组织");
  }
  const jurisdiction = input.jurisdiction ?? instruments[0]?.jurisdiction ?? "CA-FED";
  if (!isJurisdiction(jurisdiction)) return err(400, "INVALID_JURISDICTION", "未知司法辖区");

  const first = instruments[0];
  const recipient = input.recipientInstitution !== undefined ? input.recipientInstitution : (first?.recordsHolderInstitution ?? null);
  const recordsHolderBasis = input.recordsHolderBasis !== undefined ? input.recordsHolderBasis : (first?.recordsHolderInstitution ? first.recordsHolderBasis : null);
  const recipientKey = recipient ? normalizeInstitutionKey(recipient).key : null;

  await ensureDefaultRules(input.orgId);
  const rule = await findRule(input.orgId, jurisdiction, recipientKey, channel);

  let applicant = null;
  if (input.applicantProfileId) {
    applicant = await db.recordsApplicantProfile.findFirst({ where: { id: input.applicantProfileId, orgId: input.orgId, archivedAt: null } });
    if (!applicant) return err(400, "APPLICANT_NOT_FOUND", "申请人资料不存在");
  } else {
    const all = await db.recordsApplicantProfile.findMany({ where: { orgId: input.orgId, archivedAt: null }, take: 2 });
    if (all.length === 1) applicant = all[0];
  }

  const refs: InstrumentRef[] = [];
  const solicitationNumbers: string[] = [];
  for (const i of instruments) {
    refs.push({ number: i.officialNumber, normalized: i.normalizedNumber, instrumentId: i.id });
    for (const a of (Array.isArray(i.aliasesJson) ? i.aliasesJson : []) as Array<{ value: string; kind: string }>) {
      if (a?.kind === "SOLICITATION_NUMBER" && a.value) solicitationNumbers.push(a.value);
    }
  }
  for (const n of input.instrumentNumbers ?? []) {
    const nn = normalizeInstrumentNumber(n);
    if (nn.normalized && !refs.some((r) => r.normalized === nn.normalized)) refs.push({ number: nn.raw, normalized: nn.normalized, instrumentId: null });
  }
  const categories = (input.categories ?? [...RECORD_CATEGORIES]).filter((c): c is RecordCategory => isRecordCategory(c));
  const startDate = input.startDate ?? null;
  const endDate = input.endDate ?? null;
  const title =
    input.title?.trim() ||
    `${first?.title ?? refs[0]?.number ?? "资料申请"}${refs.length ? `（${refs.map((r) => r.number).join(" / ")}）` : ""}`.slice(0, 200);

  const contractNumbers = refs.filter((r) => !solicitationNumbers.some((s) => normalizeInstrumentNumber(s).normalized === r.normalized)).map((r) => r.number);
  const institutionDisplay = recipient ? institutionDisplayName(recipientKey, recipient) : null;
  let bodyEn = "";
  if (pathType === "COMPLETED_ATI_COPY") bodyEn = buildCompletedAtiCopyBody({ institution: institutionDisplay, requestNumbers: input.completedAtiRequestNumbers ?? [] });
  else if (pathType === "NEW_FORMAL_REQUEST") {
    const bodyInput = { institution: institutionDisplay, projectTitle: bodyTitle(first?.title ?? input.title ?? null), solicitationNumbers, contractNumbers, startDate, endDate, categories };
    const law = resolveRequestLaw(jurisdiction, rule?.lawLabel);
    if (law === "FED_ATIA") bodyEn = buildFederalAtiBody(bodyInput);
    else if (law) bodyEn = buildProvincialRequestBody(law, bodyInput) ?? "";
  }

  // 资料缺口与路径检查（只用已存在的证据，不臆测）
  const evidence = instruments.length
    ? await db.procurementSourceEvidence.findMany({ where: { orgId: input.orgId, instrumentId: { in: ids } }, select: { sourceType: true, lastSeenAt: true, isOfficial: true } })
    : [];
  const callUps = instruments.length ? await db.procurementInstrument.count({ where: { orgId: input.orgId, parentInstrumentId: { in: ids } } }) : 0;
  const officialPublic = evidence.filter((e) => e.isOfficial && e.sourceType !== "OPEN_CANADA_ATI_SUMMARIES");
  const ati = evidence.filter((e) => e.sourceType === "OPEN_CANADA_ATI_SUMMARIES");
  const latest = (rows: typeof evidence) => rows.reduce<Date | null>((m, e) => (!m || e.lastSeenAt > m ? e.lastSeenAt : m), null);
  const pathChecks = {
    publicRecords: officialPublic.length ? { checkedAt: latest(officialPublic)!.toISOString(), by: "SCAN_EVIDENCE", summaryZh: `扫描已取得 ${officialPublic.length} 条官方公开证据` } : null,
    completedAti: ati.length ? { checkedAt: latest(ati)!.toISOString(), by: "SCAN_EVIDENCE", summaryZh: `发现既有披露摘要 ${ati.length} 条（优先考虑索取副本）` } : null,
  };
  const gaps = input.gapsZh ?? [
    callUps === 0 ? "未取得 call-up / PO 与实际订单数量、单价" : `已知公开披露 call-up ${callUps} 笔，仍缺数量、单价与实付`,
    "公开合同值不等于实际支出；需要 committed / ordered / invoiced / paid 分列记录",
    !recipient ? "资料持有机关未核实（PSPC 可能持有招标 / SO / 价格附件，购买部门可能持有订单与付款）" : null,
  ].filter(Boolean).join("；");

  const applicantKey = applicant?.canonicalKey ?? null;
  const explanationZh = buildExplanationZh({
    pathType,
    jurisdiction,
    institutionDisplay,
    recordsHolderBasis,
    instrumentLabels: refs.map((r) => r.number),
    startDate,
    endDate,
    categories,
    lawLabel: rule?.lawLabel ?? null,
    feeCents: rule?.applicationFeeCents ?? null,
    currency: rule?.currency ?? null,
    deadlineValue: rule?.deadlineValue ?? null,
    deadlineUnit: rule?.deadlineUnit ?? null,
    purposeZh: input.purposeZh ?? null,
    gapsZh: gaps,
  });

  try {
    const requestId = await db.$transaction(async (tx) => {
      const req = await tx.recordsRequest.create({
        data: {
          orgId: input.orgId,
          projectId: input.projectId ?? null,
          applicantProfileId: applicant?.id ?? null,
          applicantKey,
          title,
          jurisdiction,
          recipientInstitution: recipient,
          recipientInstitutionKey: recipientKey,
          recordsHolderBasis,
          lawLabel: rule?.lawLabel ?? null,
          pathType,
          channel,
          ruleProfileId: rule?.id ?? null,
          purposeZh: input.purposeZh ?? null,
          gapsZh: gaps,
          pathChecksJson: json(pathChecks),
          autoDraftKey: input.autoDraftKey ?? null,
          createdById: input.userId,
        },
      });
      const v = await tx.recordsRequestVersion.create({
        data: {
          requestId: req.id,
          versionNo: 1,
          bodyEn,
          explanationZh,
          startDate: toDate(startDate),
          endDate: toDate(endDate),
          categoriesJson: categories,
          instrumentRefsJson: json(refs),
          jurisdiction,
          recipientInstitution: recipient,
          recipientInstitutionKey: recipientKey,
          channel,
          applicantProfileVersion: applicant?.version ?? null,
          applicantSnapshotJson: applicant ? json(applicantSnapshot(applicant)) : undefined,
          textHash: textHash(bodyEn),
          scopeFingerprint: scopeFingerprint({ applicantKey, jurisdiction, institutionKey: recipientKey, numbers: refs.map((r) => r.number), categories, startDate, endDate }),
          kind: "TEMPLATE",
          createdById: input.userId,
        },
      });
      await tx.recordsRequest.update({ where: { id: req.id }, data: { currentVersionId: v.id } });
      await tx.recordsRequestEvent.create({
        data: { orgId: input.orgId, requestId: req.id, type: "CREATED", actorType: input.createdVia === "SCAN" ? "SYSTEM" : "USER", actorId: input.userId, payloadJson: json({ pathType, channel, via: input.createdVia ?? "USER" }) },
      });
      return req.id;
    });
    await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId ?? undefined, action: "records_request.create", targetType: "records_request", targetId: requestId, afterData: { pathType, channel, jurisdiction } });
    return { ok: true, requestId, created: true };
  } catch (e) {
    if (input.autoDraftKey && isUniqueViolation(e)) {
      const existing = await db.recordsRequest.findUnique({ where: { orgId_autoDraftKey: { orgId: input.orgId, autoDraftKey: input.autoDraftKey } }, select: { id: true } });
      if (existing) return { ok: true, requestId: existing.id, created: false };
    }
    throw e;
  }
}

/** 扫描自动草拟（幂等：autoDraftKey = auto:<instrumentId>） */
export async function createAutoDraftForInstrument(input: { orgId: string; instrumentId: string; actorUserId: string; runId: string }): Promise<{ created: boolean; requestId: string | null }> {
  const links = await db.procurementTenderLink.findMany({ where: { orgId: input.orgId, instrumentId: input.instrumentId }, select: { projectId: true }, take: 1 });
  const r = await createRequestDraft({
    orgId: input.orgId,
    userId: input.actorUserId,
    projectId: links[0]?.projectId ?? null,
    instrumentIds: [input.instrumentId],
    pathType: "NEW_FORMAL_REQUEST",
    autoDraftKey: `auto:${input.instrumentId}`,
    createdVia: "SCAN",
    purposeZh: "扫描自动草拟：为下一次投标准备，查清该合同的实际订单、数量、单价与支出（须人工核实机关、范围与申请人后才能就绪）。",
  });
  if (!r.ok) return { created: false, requestId: null };
  return { created: r.created, requestId: r.requestId };
}

// ─────────────────────────── 上下文（重复检查 + READY） ───────────────────────────

async function scopeOfVersion(req: Pick<RecordsRequest, "applicantKey" | "jurisdiction" | "recipientInstitutionKey">, v: RecordsRequestVersion | null) {
  return {
    applicantKey: req.applicantKey,
    jurisdiction: v?.jurisdiction ?? req.jurisdiction,
    institutionKey: v ? v.recipientInstitutionKey : req.recipientInstitutionKey,
    numbers: v ? readRefs(v.instrumentRefsJson).map((r) => r.number) : [],
    categories: v ? readCategories(v.categoriesJson) : [UNKNOWN_CATEGORY],
    startDate: dateOnly(v?.startDate),
    endDate: dateOnly(v?.endDate),
  };
}

/** 本组织全部申请的范围（已提交的用提交版本；其余用当前版本） */
export async function loadExistingScopes(orgId: string, client: Tx | typeof db = db): Promise<ExistingRequestScope[]> {
  const rows = await client.recordsRequest.findMany({ where: { orgId }, take: 5000 });
  const versionIds = rows.map((r) => r.submittedVersionId ?? r.currentVersionId).filter((x): x is string => !!x);
  const versions = await client.recordsRequestVersion.findMany({ where: { id: { in: versionIds } } });
  const byId = new Map(versions.map((v) => [v.id, v]));
  const out: ExistingRequestScope[] = [];
  for (const r of rows) {
    const v = byId.get(r.submittedVersionId ?? r.currentVersionId ?? "") ?? null;
    out.push({
      ...(await scopeOfVersion(r, v)),
      requestId: r.id,
      title: r.title,
      status: r.status,
      governmentOutcome: r.governmentOutcome,
      archived: Boolean(r.archivedAt),
      channel: r.channel,
    });
  }
  return out;
}

export async function isLedgerAttested(orgId: string, input: { applicantKey: string | null; jurisdiction: string; institutionKey: string | null }, client: Tx | typeof db = db): Promise<boolean> {
  const rows = await client.recordsLedgerAttestation.findMany({ where: { orgId, jurisdiction: input.jurisdiction, revokedAt: null } });
  return rows.some(
    (a) =>
      (a.institutionKey === "*" || (input.institutionKey !== null && a.institutionKey === input.institutionKey)) &&
      (a.applicantKey === null || a.applicantKey === input.applicantKey),
  );
}

export interface RequestContext {
  request: RecordsRequest;
  version: RecordsRequestVersion | null;
  duplicate: DuplicateCheck;
  ready: { ready: boolean; blockers: ReadyBlocker[] };
}

export async function buildRequestContext(requestId: string, client: Tx | typeof db = db): Promise<RequestContext | null> {
  const request = await client.recordsRequest.findUnique({ where: { id: requestId } });
  if (!request) return null;
  const version = request.currentVersionId ? await client.recordsRequestVersion.findUnique({ where: { id: request.currentVersionId } }) : null;
  const scope = await scopeOfVersion(request, version);
  let duplicate: DuplicateCheck;
  try {
    const [existing, attested] = await Promise.all([
      loadExistingScopes(request.orgId, client),
      isLedgerAttested(request.orgId, { applicantKey: request.applicantKey, jurisdiction: scope.jurisdiction, institutionKey: scope.institutionKey }, client),
    ]);
    duplicate = checkDuplicates({ candidate: { ...scope, requestId: request.id }, existing, ledgerAttested: attested, overlapReason: request.overlapReason });
  } catch {
    duplicate = checkDuplicates({ candidate: { ...scope, requestId: request.id }, existing: [], ledgerAttested: false, readFailed: true });
  }
  const applicant = request.applicantProfileId ? await client.recordsApplicantProfile.findUnique({ where: { id: request.applicantProfileId } }) : null;
  const rule = request.ruleProfileId ? await client.recordsRuleProfile.findUnique({ where: { id: request.ruleProfileId } }) : null;
  const ready = evaluateReady({
    archived: Boolean(request.archivedAt),
    pathType: request.pathType as PathType,
    recipientInstitution: request.recipientInstitution,
    recordsHolderBasis: request.recordsHolderBasis,
    pathChecks: (request.pathChecksJson ?? null) as never,
    version: version
      ? {
          bodyEn: version.bodyEn,
          startDate: dateOnly(version.startDate),
          endDate: dateOnly(version.endDate),
          categories: readCategories(version.categoriesJson),
          instrumentNumbers: readRefs(version.instrumentRefsJson).map((r) => r.number),
          applicantProfileVersion: version.applicantProfileVersion,
        }
      : null,
    applicant: applicant
      ? {
          verificationStatus: applicant.verificationStatus,
          version: applicant.version,
          archived: Boolean(applicant.archivedAt),
          fields: applicant,
        }
      : null,
    rule: rule ? { verificationStatus: rule.verificationStatus, applicationFeeCents: rule.applicationFeeCents, officialPortalUrl: rule.officialPortalUrl, selfServeSupported: rule.selfServeSupported } : null,
    duplicate,
  });
  return { request, version, duplicate, ready };
}

/** 在事务内为同一范围加锁（申请主体 + 辖区 + 机关），防并发交接 */
async function lockScope(tx: Tx, req: Pick<RecordsRequest, "orgId" | "applicantKey" | "jurisdiction" | "recipientInstitutionKey">) {
  const key = `records-scope|${req.orgId}|${req.applicantKey ?? "?"}|${req.jurisdiction}|${req.recipientInstitutionKey ?? "?"}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  // 申请主体 / 机关未知的申请与同辖区全部申请互斥（保守）
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`records-scope|${req.orgId}|${req.jurisdiction}`}))`;
}

async function addEvent(
  client: Tx | typeof db,
  e: { orgId: string; requestId: string; type: string; actorId: string | null; actorType?: "USER" | "SYSTEM"; effectiveAt?: Date | null; evidenceLevel?: string | null; attachmentIds?: string[]; payload?: unknown; noteZh?: string | null; dedupeKey?: string | null; correctsEventId?: string | null },
) {
  return client.recordsRequestEvent.create({
    data: {
      orgId: e.orgId,
      requestId: e.requestId,
      type: e.type,
      actorType: e.actorType ?? "USER",
      actorId: e.actorId,
      effectiveAt: e.effectiveAt ?? null,
      evidenceLevel: e.evidenceLevel ?? null,
      attachmentIdsJson: e.attachmentIds?.length ? e.attachmentIds : undefined,
      payloadJson: e.payload !== undefined ? json(e.payload) : undefined,
      noteZh: e.noteZh ?? null,
      dedupeKey: e.dedupeKey ?? null,
      correctsEventId: e.correctsEventId ?? null,
    },
  });
}
export { addEvent as appendRequestEvent };

function applyTransition(status: string, action: RequestAction) {
  return transition(status, action);
}

// ─────────────────────────── 保存草稿（新版本） ───────────────────────────

export interface DraftPatch {
  title?: string;
  recipientInstitution?: string | null;
  recordsHolderBasis?: string | null;
  channel?: "FORMAL" | "INFORMAL";
  pathType?: PathType;
  applicantProfileId?: string | null;
  purposeZh?: string | null;
  gapsZh?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  categories?: string[];
  instrumentNumbers?: string[];
  bodyEn?: string;
  regenerateBody?: boolean;
  overlapReason?: string | null;
  projectId?: string | null;
}

export async function saveDraft(input: { requestId: string; userId: string; patch: DraftPatch }): Promise<{ ok: true; versionNo: number | null; bodyMayBeStale: boolean } | ServiceError> {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
  if (req.status === "HANDOFF_PENDING" || req.status === "SUBMISSION_UNKNOWN") return err(409, "VERSION_LOCKED_DURING_HANDOFF", "交接进行中 / 提交结果不确定时不能修改正文；请先取消交接或解除不确定");
  if (req.archivedAt) return err(409, "ARCHIVED", "已归档的草稿不能修改");
  const p = input.patch;
  for (const d of [p.startDate, p.endDate]) if (d && !isValidIsoDate(d)) return err(400, "INVALID_DATE", "日期格式应为 YYYY-MM-DD");
  if (p.pathType && !(PATH_TYPES as readonly string[]).includes(p.pathType)) return err(400, "INVALID_PATH", "未知资料取得路径");
  if (p.projectId) {
    const proj = await db.project.findUnique({ where: { id: p.projectId }, select: { orgId: true } });
    if (!proj || proj.orgId !== req.orgId) return err(400, "PROJECT_NOT_FOUND", "Tender 项目不存在或不属于本组织");
  }
  const cur = req.currentVersionId ? await db.recordsRequestVersion.findUnique({ where: { id: req.currentVersionId } }) : null;

  let applicant = req.applicantProfileId ? await db.recordsApplicantProfile.findUnique({ where: { id: req.applicantProfileId } }) : null;
  if (p.applicantProfileId !== undefined) {
    applicant = p.applicantProfileId ? await db.recordsApplicantProfile.findFirst({ where: { id: p.applicantProfileId, orgId: req.orgId, archivedAt: null } }) : null;
    if (p.applicantProfileId && !applicant) return err(400, "APPLICANT_NOT_FOUND", "申请人资料不存在");
  }
  const recipient = p.recipientInstitution !== undefined ? p.recipientInstitution?.trim() || null : req.recipientInstitution;
  const recipientKey = recipient ? normalizeInstitutionKey(recipient).key : null;
  const channel = p.channel ?? (req.channel as "FORMAL" | "INFORMAL");
  const pathType = (p.pathType ?? req.pathType) as PathType;
  const startDate = p.startDate !== undefined ? p.startDate : dateOnly(cur?.startDate);
  const endDate = p.endDate !== undefined ? p.endDate : dateOnly(cur?.endDate);
  const categories = p.categories !== undefined ? p.categories.filter((c) => isRecordCategory(c)) : readCategories(cur?.categoriesJson);
  let refs = readRefs(cur?.instrumentRefsJson);
  if (p.instrumentNumbers !== undefined) {
    const next: InstrumentRef[] = [];
    for (const n of p.instrumentNumbers) {
      const nn = normalizeInstrumentNumber(n);
      if (!nn.normalized || next.some((r) => r.normalized === nn.normalized)) continue;
      next.push(refs.find((r) => r.normalized === nn.normalized) ?? { number: nn.raw, normalized: nn.normalized, instrumentId: null });
    }
    refs = next;
  }
  const rule = await findRule(req.orgId, req.jurisdiction, recipientKey, channel);
  const applicantKey = applicant?.canonicalKey ?? null;

  const scopeChanged =
    p.startDate !== undefined || p.endDate !== undefined || p.categories !== undefined || p.instrumentNumbers !== undefined || p.recipientInstitution !== undefined || p.channel !== undefined || p.applicantProfileId !== undefined || p.pathType !== undefined;
  const wantsVersion = scopeChanged || p.bodyEn !== undefined || p.regenerateBody === true || p.purposeZh !== undefined || p.gapsZh !== undefined || p.recordsHolderBasis !== undefined || (applicant && cur?.applicantProfileVersion !== applicant.version);

  let bodyEn = cur?.bodyEn ?? "";
  let kind = "DRAFT_EDIT";
  let bodyMayBeStale = false;
  const institutionDisplay = recipient ? institutionDisplayName(recipientKey, recipient) : null;
  const regenerate = () => {
    if (pathType === "COMPLETED_ATI_COPY") return buildCompletedAtiCopyBody({ institution: institutionDisplay, requestNumbers: [] });
    if (pathType === "NEW_FORMAL_REQUEST") {
      const bodyInput = { institution: institutionDisplay, projectTitle: bodyTitle(req.title.replace(/（.*$/, "")), solicitationNumbers: [], contractNumbers: refs.map((r) => r.number), startDate, endDate, categories: categories as RecordCategory[] };
      const law = resolveRequestLaw(req.jurisdiction, rule?.lawLabel);
      if (law === "FED_ATIA") return buildFederalAtiBody(bodyInput);
      if (law) return buildProvincialRequestBody(law, bodyInput) ?? bodyEn;
    }
    return bodyEn;
  };
  if (p.bodyEn !== undefined) bodyEn = p.bodyEn;
  else if (p.regenerateBody || (scopeChanged && cur?.kind === "TEMPLATE")) {
    bodyEn = regenerate();
    kind = "TEMPLATE";
  } else if (scopeChanged) bodyMayBeStale = true;

  const gapsZh = p.gapsZh !== undefined ? p.gapsZh : req.gapsZh;
  const purposeZh = p.purposeZh !== undefined ? p.purposeZh : req.purposeZh;
  const recordsHolderBasis = p.recordsHolderBasis !== undefined ? p.recordsHolderBasis : req.recordsHolderBasis;
  const explanationZh = buildExplanationZh({
    pathType,
    jurisdiction: req.jurisdiction,
    institutionDisplay,
    recordsHolderBasis,
    instrumentLabels: refs.map((r) => r.number),
    startDate,
    endDate,
    categories,
    lawLabel: rule?.lawLabel ?? null,
    feeCents: rule?.applicationFeeCents ?? null,
    currency: rule?.currency ?? null,
    deadlineValue: rule?.deadlineValue ?? null,
    deadlineUnit: rule?.deadlineUnit ?? null,
    purposeZh,
    gapsZh,
  });

  const result = await db.$transaction(async (tx) => {
    const fresh = await tx.recordsRequest.findUnique({ where: { id: req.id }, select: { lockVersion: true, status: true } });
    if (!fresh || fresh.lockVersion !== req.lockVersion) return err(409, "CONCURRENT_EDIT", "申请已被他人修改，请刷新后重试");
    let versionNo: number | null = null;
    let versionId = req.currentVersionId;
    if (wantsVersion) {
      const max = await tx.recordsRequestVersion.aggregate({ where: { requestId: req.id }, _max: { versionNo: true } });
      versionNo = (max._max.versionNo ?? 0) + 1;
      const v = await tx.recordsRequestVersion.create({
        data: {
          requestId: req.id,
          versionNo,
          bodyEn,
          explanationZh,
          startDate: toDate(startDate),
          endDate: toDate(endDate),
          categoriesJson: categories,
          instrumentRefsJson: json(refs),
          jurisdiction: req.jurisdiction,
          recipientInstitution: recipient,
          recipientInstitutionKey: recipientKey,
          channel,
          applicantProfileVersion: applicant?.version ?? null,
          applicantSnapshotJson: applicant ? json(applicantSnapshot(applicant)) : undefined,
          textHash: textHash(bodyEn),
          scopeFingerprint: scopeFingerprint({ applicantKey, jurisdiction: req.jurisdiction, institutionKey: recipientKey, numbers: refs.map((r) => r.number), categories, startDate, endDate }),
          kind,
          createdById: input.userId,
        },
      });
      versionId = v.id;
      await addEvent(tx, { orgId: req.orgId, requestId: req.id, type: "VERSION_CREATED", actorId: input.userId, payload: { versionNo, textHash: v.textHash, scopeFingerprint: v.scopeFingerprint } });
    }
    let status = fresh.status;
    if (wantsVersion && status === "READY") {
      const t = applyTransition(status, "REVERT_TO_DRAFT");
      if (t.ok) {
        status = t.to;
        await addEvent(tx, { orgId: req.orgId, requestId: req.id, type: "REVERTED_TO_DRAFT", actorId: input.userId, noteZh: "内容变更，需重新校验" });
      }
    }
    await tx.recordsRequest.update({
      where: { id: req.id },
      data: {
        status,
        currentVersionId: versionId,
        lockVersion: { increment: 1 },
        ...(p.title !== undefined ? { title: p.title.trim().slice(0, 200) || req.title } : {}),
        ...(p.projectId !== undefined ? { projectId: p.projectId } : {}),
        recipientInstitution: recipient,
        recipientInstitutionKey: recipientKey,
        recordsHolderBasis,
        channel,
        pathType,
        applicantProfileId: applicant?.id ?? null,
        applicantKey,
        ruleProfileId: rule?.id ?? null,
        lawLabel: rule?.lawLabel ?? null,
        purposeZh,
        gapsZh,
        ...(p.overlapReason !== undefined ? { overlapReason: p.overlapReason?.trim() || null } : {}),
      },
    });
    return { ok: true as const, versionNo, bodyMayBeStale };
  });
  return result;
}

/** 记录公开资料 / 既有披露检查（新正式申请 READY 前置） */
export async function recordPathCheck(input: { requestId: string; userId: string; kind: "publicRecords" | "completedAti"; summaryZh: string }) {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
  if (!input.summaryZh?.trim()) return err(400, "SUMMARY_REQUIRED", "请写明检查了哪些来源与结论");
  const cur = (req.pathChecksJson ?? {}) as Record<string, unknown>;
  const next = { ...cur, [input.kind]: { checkedAt: new Date().toISOString(), by: input.userId, method: "USER", summaryZh: input.summaryZh.trim().slice(0, 1000) } };
  await db.recordsRequest.update({ where: { id: req.id }, data: { pathChecksJson: json(next) } });
  await addEvent(db, { orgId: req.orgId, requestId: req.id, type: "NOTE", actorId: input.userId, noteZh: `${input.kind === "publicRecords" ? "公开资料" : "既有披露"}检查：${input.summaryZh.trim().slice(0, 300)}` });
  return { ok: true as const };
}

// ─────────────────────────── READY 与交接 ───────────────────────────

export async function markReady(input: { requestId: string; userId: string }) {
  return db.$transaction(async (tx) => {
    const req = await tx.recordsRequest.findUnique({ where: { id: input.requestId } });
    if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
    await lockScope(tx, req);
    const t = applyTransition(req.status, "MARK_READY");
    if (!t.ok) return err(409, t.code, t.messageZh);
    const ctx = await buildRequestContext(req.id, tx);
    if (!ctx) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
    if (!ctx.ready.ready) return err(409, "NOT_READY", "未满足就绪条件", { blockers: ctx.ready.blockers, duplicate: ctx.duplicate });
    await tx.recordsRequest.update({ where: { id: req.id }, data: { status: t.to, lockVersion: { increment: 1 } } });
    await addEvent(tx, { orgId: req.orgId, requestId: req.id, type: "READY_CHECKED", actorId: input.userId, payload: { versionId: req.currentVersionId, duplicate: ctx.duplicate.result } });
    return { ok: true as const, status: t.to };
  }, { timeout: 20_000 });
}

export async function startHandoff(input: { requestId: string; userId: string }) {
  return db.$transaction(async (tx) => {
    const req = await tx.recordsRequest.findUnique({ where: { id: input.requestId } });
    if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
    await lockScope(tx, req);
    const t = applyTransition(req.status, "START_HANDOFF");
    if (!t.ok) return err(409, t.code, t.messageZh);
    const ctx = await buildRequestContext(req.id, tx);
    if (!ctx) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
    if (!ctx.ready.ready) {
      await tx.recordsRequest.update({ where: { id: req.id }, data: { status: "DRAFT", lockVersion: { increment: 1 } } });
      await addEvent(tx, { orgId: req.orgId, requestId: req.id, type: "REVERTED_TO_DRAFT", actorId: input.userId, noteZh: "发起交接时重新校验未通过" });
      return err(409, "NOT_READY", "发起交接时重新校验未通过，已回到草稿", { blockers: ctx.ready.blockers, duplicate: ctx.duplicate });
    }
    await tx.recordsRequest.update({ where: { id: req.id }, data: { status: t.to, handoffVersionId: req.currentVersionId, lockVersion: { increment: 1 } } });
    await addEvent(tx, { orgId: req.orgId, requestId: req.id, type: "HANDOFF_STARTED", actorId: input.userId, payload: { versionId: req.currentVersionId } });
    return { ok: true as const, status: t.to };
  }, { timeout: 20_000 });
}

export async function cancelHandoff(input: { requestId: string; userId: string; reason?: string | null }) {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
  const t = applyTransition(req.status, "CANCEL_HANDOFF");
  if (!t.ok) return err(409, t.code, t.messageZh);
  await db.recordsRequest.update({ where: { id: req.id }, data: { status: t.to, handoffVersionId: null, lockVersion: { increment: 1 } } });
  await addEvent(db, { orgId: req.orgId, requestId: req.id, type: "HANDOFF_CANCELLED", actorId: input.userId, noteZh: input.reason ?? null });
  return { ok: true as const, status: t.to };
}

/** 「复制正文」「打开入口」「查看字段对应」：只记事件，不改提交状态 */
export async function recordHandoffAction(input: { requestId: string; userId: string; action: "COPIED_BODY" | "OPENED_PORTAL" | "VIEWED_FIELD_GUIDE" }) {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
  if (!["READY", "HANDOFF_PENDING"].includes(req.status)) return err(409, "INVALID_TRANSITION", "只有就绪或交接中的申请可以执行该操作");
  await addEvent(db, { orgId: req.orgId, requestId: req.id, type: input.action, actorId: input.userId, payload: { versionId: req.handoffVersionId ?? req.currentVersionId } });
  return { ok: true as const, status: req.status };
}

// ─────────────────────────── 提交登记 ───────────────────────────

export interface ReportSubmissionInput {
  requestId: string;
  userId: string;
  submittedAt: string;
  channel: string;
  actualFeeCents: number | null;
  feeCurrency: string | null;
  submissionReference: string | null;
  text: { mode: "SAME_AS_VERSION"; versionId: string } | { mode: "ACTUAL_TEXT"; bodyEn: string } | { mode: "UNVERIFIED" };
  receiptAttachmentId?: string | null;
}

export async function reportSubmission(input: ReportSubmissionInput) {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
  const t = applyTransition(req.status, "REPORT_SUBMITTED");
  if (!t.ok) return err(409, t.code, t.messageZh);
  const submittedAt = new Date(input.submittedAt);
  if (Number.isNaN(submittedAt.getTime())) return err(400, "INVALID_SUBMITTED_AT", "提交时间无效");
  if (input.actualFeeCents !== null && (!Number.isInteger(input.actualFeeCents) || input.actualFeeCents < 0)) return err(400, "INVALID_FEE", "实际费用须为非负整数分，或 null 表示未知");
  if (!input.channel?.trim()) return err(400, "CHANNEL_REQUIRED", "请填写实际提交渠道");

  return db.$transaction(async (tx) => {
    let submittedVersionId: string | null = null;
    let textVerified: boolean | null = null;
    if (input.text.mode === "SAME_AS_VERSION") {
      const v = await tx.recordsRequestVersion.findFirst({ where: { id: input.text.versionId, requestId: req.id } });
      if (!v) return err(400, "VERSION_NOT_FOUND", "版本不存在");
      submittedVersionId = v.id;
      textVerified = true;
    } else if (input.text.mode === "ACTUAL_TEXT") {
      if (!input.text.bodyEn.trim()) return err(400, "BODY_REQUIRED", "请粘贴实际提交的正文");
      const base = req.handoffVersionId ? await tx.recordsRequestVersion.findUnique({ where: { id: req.handoffVersionId } }) : null;
      const max = await tx.recordsRequestVersion.aggregate({ where: { requestId: req.id }, _max: { versionNo: true } });
      const v = await tx.recordsRequestVersion.create({
        data: {
          requestId: req.id,
          versionNo: (max._max.versionNo ?? 0) + 1,
          bodyEn: input.text.bodyEn,
          explanationZh: base?.explanationZh ?? null,
          startDate: base?.startDate ?? null,
          endDate: base?.endDate ?? null,
          categoriesJson: (base?.categoriesJson ?? []) as Prisma.InputJsonValue,
          instrumentRefsJson: (base?.instrumentRefsJson ?? []) as Prisma.InputJsonValue,
          jurisdiction: base?.jurisdiction ?? req.jurisdiction,
          recipientInstitution: base?.recipientInstitution ?? req.recipientInstitution,
          recipientInstitutionKey: base?.recipientInstitutionKey ?? req.recipientInstitutionKey,
          channel: base?.channel ?? req.channel,
          applicantProfileVersion: base?.applicantProfileVersion ?? null,
          applicantSnapshotJson: (base?.applicantSnapshotJson ?? undefined) as Prisma.InputJsonValue | undefined,
          textHash: textHash(input.text.bodyEn),
          scopeFingerprint: base?.scopeFingerprint ?? "",
          kind: "ACTUAL_SUBMITTED_TEXT",
          createdById: input.userId,
        },
      });
      submittedVersionId = v.id;
      textVerified = true;
    } else {
      submittedVersionId = req.handoffVersionId ?? req.currentVersionId;
      textVerified = false;
    }
    const rule = req.ruleProfileId ? await tx.recordsRuleProfile.findUnique({ where: { id: req.ruleProfileId } }) : null;
    const est = estimateDueDate({ receivedDate: localDateOf(submittedAt, DEFAULT_TIMEZONE), deadlineValue: rule?.deadlineValue ?? null, deadlineUnit: rule?.deadlineUnit ?? null, channel: req.channel });
    await tx.recordsRequest.update({
      where: { id: req.id },
      data: {
        status: t.to,
        submittedAt,
        submissionChannel: input.channel.trim().slice(0, 100),
        actualFeeCents: input.actualFeeCents,
        feeCurrency: input.feeCurrency,
        submissionReference: input.submissionReference?.trim() || null,
        submittedVersionId,
        submittedTextVerified: textVerified,
        submissionEvidenceLevel: "user_reported",
        unknownFactsJson: req.status === "SUBMISSION_UNKNOWN" ? req.unknownFactsJson ?? undefined : undefined,
        estimatedDueAt: est.estimatedDueAt ? new Date(`${est.estimatedDueAt}T00:00:00Z`) : null,
        estimateBasis: est.basisZh,
        lockVersion: { increment: 1 },
      },
    });
    await addEvent(tx, {
      orgId: req.orgId,
      requestId: req.id,
      type: "USER_REPORTED_SUBMISSION",
      actorId: input.userId,
      effectiveAt: submittedAt,
      evidenceLevel: "user_reported",
      attachmentIds: input.receiptAttachmentId ? [input.receiptAttachmentId] : [],
      payload: { channel: input.channel, actualFeeCents: input.actualFeeCents, feeCurrency: input.feeCurrency, submissionReference: input.submissionReference, submittedVersionId, textMode: input.text.mode },
      noteZh: textVerified === false ? "最终提交正文未核实" : null,
    });
    return { ok: true as const, status: t.to, submittedVersionId, submittedTextVerified: textVerified };
  });
}

export async function reportSubmissionUnknown(input: { requestId: string; userId: string; knownFacts: string[]; pendingChecks?: string[] }) {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
  const t = applyTransition(req.status, "REPORT_UNKNOWN");
  if (!t.ok) return err(409, t.code, t.messageZh);
  const facts = {
    knownFacts: input.knownFacts.map((f) => f.trim()).filter(Boolean).slice(0, 20),
    pendingChecks: (input.pendingChecks?.length ? input.pendingChecks : ["登录官方账户查看是否有该申请记录", "查找确认邮件 / 回执编号", "核对付款记录（仅付款不能证明提交成功）"]).slice(0, 20),
    recordedAt: new Date().toISOString(),
    recordedById: input.userId,
  };
  const ev = await db.$transaction(async (tx) => {
    await tx.recordsRequest.update({ where: { id: req.id }, data: { status: t.to, unknownFactsJson: json(facts), submittedVersionId: req.handoffVersionId ?? req.currentVersionId, lockVersion: { increment: 1 } } });
    return addEvent(tx, { orgId: req.orgId, requestId: req.id, type: "SUBMISSION_UNKNOWN", actorId: input.userId, evidenceLevel: "user_reported", payload: facts, noteZh: "提交结果不确定：不自动重试，不改用其他渠道重复申请" });
  });
  await ensureRequestTask({ request: req, kind: "RESOLVE_UNKNOWN", sourceEventId: ev.id, actorUserId: input.userId });
  return { ok: true as const, status: t.to };
}

export async function verifyReceipt(input: { requestId: string; userId: string; attachmentId: string; confirm: boolean; manualVisualCheck?: boolean; submissionReference?: string | null; submittedAt?: string | null }) {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
  const t = applyTransition(req.status, "VERIFY_RECEIPT");
  if (!t.ok) return err(409, t.code, t.messageZh);
  if (!input.confirm) return err(400, "CONFIRM_REQUIRED", "需要你确认回执属于本申请与该接收机关");
  const att = await db.recordsAttachment.findFirst({ where: { id: input.attachmentId, requestId: req.id }, include: { units: { select: { text: true }, orderBy: { unitIndex: "asc" } } } });
  if (!att) return err(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
  if (!isSufficientReceiptKind(att.kind)) return err(409, "RECEIPT_NOT_SUFFICIENT", "付款凭证或门户截图不能单独证明提交成功，请上传接收确认（回执 / 受理信）");
  const reference = input.submissionReference?.trim() || req.submissionReference;
  if (!reference) return err(400, "REFERENCE_REQUIRED", "请填写 submission reference（提交确认编号）");
  const text = att.units.map((u) => u.text).join("\n");
  const m = matchReceipt({ receiptText: text, submissionReference: reference, institutionKey: req.recipientInstitutionKey, institutionName: req.recipientInstitution });
  let method: string;
  if (m.textAvailable) {
    if (!m.referenceFound || !m.institutionFound) return err(409, "RECEIPT_MISMATCH", "回执里找不到提交编号或接收机关名称，保持待核实", m);
    method = "确定性比对：提交编号与接收机关名称均出现在回执文本中；真实用户确认";
  } else {
    if (!input.manualVisualCheck) return err(409, "RECEIPT_NOT_READABLE", "回执没有可读文本（可能需要 OCR）；如已目视核对编号与机关，请勾选人工核对", m);
    method = "人工目视核对（附件无可读文本，无 OCR）；真实用户确认";
  }
  const submittedAt = input.submittedAt ? new Date(input.submittedAt) : req.submittedAt;
  await db.$transaction(async (tx) => {
    await tx.recordsRequest.update({
      where: { id: req.id },
      data: {
        status: t.to,
        submissionReference: reference,
        submittedAt: submittedAt && !Number.isNaN(submittedAt.getTime()) ? submittedAt : req.submittedAt,
        submittedVersionId: req.submittedVersionId ?? req.handoffVersionId ?? req.currentVersionId,
        submittedTextVerified: req.submittedTextVerified ?? false,
        submissionEvidenceLevel: "document_verified",
        submissionVerifiedById: input.userId,
        submissionVerifiedAt: new Date(),
        submissionVerificationMethod: method,
        lockVersion: { increment: 1 },
      },
    });
    await addEvent(tx, {
      orgId: req.orgId,
      requestId: req.id,
      type: "SUBMISSION_VERIFIED",
      actorId: input.userId,
      evidenceLevel: "document_verified",
      attachmentIds: [att.id],
      payload: { method, match: m, from: req.status },
      dedupeKey: `SUBMISSION_VERIFIED:${att.contentHash}`,
    });
  });
  return { ok: true as const, status: t.to, match: m };
}

export async function resolveUnknownNotSubmitted(input: { requestId: string; userId: string; basisZh: string }) {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
  const t = applyTransition(req.status, "RESOLVE_UNKNOWN_NOT_SUBMITTED");
  if (!t.ok) return err(409, t.code, t.messageZh);
  if (!input.basisZh?.trim() || input.basisZh.trim().length < 8) return err(400, "BASIS_REQUIRED", "请写明确认未提交的依据（如官方账户无记录、无扣款）");
  await db.$transaction(async (tx) => {
    await tx.recordsRequest.update({ where: { id: req.id }, data: { status: t.to, submittedVersionId: null, lockVersion: { increment: 1 } } });
    await addEvent(tx, { orgId: req.orgId, requestId: req.id, type: "RESOLVED_NOT_SUBMITTED", actorId: input.userId, evidenceLevel: "user_reported", noteZh: input.basisZh.trim().slice(0, 1000), payload: { previousUnknown: req.unknownFactsJson } });
  });
  return { ok: true as const, status: t.to };
}

/** 未提交草稿的本地归档（与向政府撤回已提交申请分开） */
export async function archiveDraft(input: { requestId: string; userId: string; reason: string }) {
  const req = await db.recordsRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return err(404, "REQUEST_NOT_FOUND", "申请不存在");
  if (!["DRAFT", "READY"].includes(req.status)) return err(409, "NOT_ARCHIVABLE", "已交接或已提交的申请不能本地归档；向政府撤回须登记机关确认");
  await db.recordsRequest.update({ where: { id: req.id }, data: { archivedAt: new Date(), archivedById: input.userId, archiveReason: input.reason?.trim() || null, lockVersion: { increment: 1 } } });
  await addEvent(db, { orgId: req.orgId, requestId: req.id, type: "ARCHIVED", actorId: input.userId, noteZh: input.reason?.trim() || null });
  return { ok: true as const };
}

// ─────────────────────────── 台账确认与历史导入 ───────────────────────────

export async function attestLedger(input: { orgId: string; userId: string; jurisdiction: string; institutionKey: string; applicantKey?: string | null; method: "HISTORY_IMPORTED" | "USER_CONFIRMED_NONE"; note?: string | null; coverageFrom?: string | null; coverageTo?: string | null }) {
  if (!isJurisdiction(input.jurisdiction)) return err(400, "INVALID_JURISDICTION", "未知司法辖区");
  if (!["HISTORY_IMPORTED", "USER_CONFIRMED_NONE"].includes(input.method)) return err(400, "INVALID_METHOD", "确认方式无效");
  const row = await db.recordsLedgerAttestation.create({
    data: {
      orgId: input.orgId,
      jurisdiction: input.jurisdiction,
      institutionKey: input.institutionKey === "*" ? "*" : normalizeInstitutionKey(input.institutionKey).key,
      applicantKey: input.applicantKey ?? null,
      method: input.method,
      note: input.note?.trim() || null,
      coverageFrom: toDate(input.coverageFrom ?? null),
      coverageTo: toDate(input.coverageTo ?? null),
      attestedById: input.userId,
    },
  });
  await logAudit({ userId: input.userId, orgId: input.orgId, action: "records_ledger.attest", targetType: "records_ledger_attestation", targetId: row.id, afterData: { jurisdiction: row.jurisdiction, institutionKey: row.institutionKey, method: row.method } });
  return { ok: true as const, attestationId: row.id };
}

export interface HistoricalRequestItem {
  title: string;
  jurisdiction: string;
  recipientInstitution: string | null;
  instrumentNumbers: string[];
  startDate: string | null;
  endDate: string | null;
  categories?: string[];
  legacyStatus: string;
  submissionReference?: string | null;
  caseNumber?: string | null;
  submittedAt?: string | null;
  registeredAt?: string | null;
  responseLetterAt?: string | null;
  expectedReleasePages?: number | null;
  originNote: string;
  isFixture?: boolean;
}

/** 历史申请导入（旧状态经显式映射；无证据不 CLOSED、不标已取得文件；证据等级 user_reported；幂等） */
export async function importHistoricalRequest(input: { orgId: string; userId: string; item: HistoricalRequestItem }) {
  const it = input.item;
  const mapped = mapLegacyStatus(it.legacyStatus);
  if (!mapped.ok) return err(400, mapped.code, `未知的旧状态：${it.legacyStatus}（拒绝导入，不静默丢弃）`);
  if (!isJurisdiction(it.jurisdiction)) return err(400, "INVALID_JURISDICTION", "未知司法辖区");
  for (const d of [it.startDate, it.endDate]) if (d && !isValidIsoDate(d)) return err(400, "INVALID_DATE", "日期格式应为 YYYY-MM-DD");
  const m = applyImportEvidence(mapped.mapping, { hasFinalLetter: false, hasDisclosureFiles: false, hasLetterReported: Boolean(it.responseLetterAt) });
  const key = `import:${stableHash({ ...it, isFixture: undefined }).slice(0, 32)}`;
  const existing = await db.recordsRequest.findUnique({ where: { orgId_autoDraftKey: { orgId: input.orgId, autoDraftKey: key } }, select: { id: true } });
  if (existing) return { ok: true as const, requestId: existing.id, created: false, notes: m.noteZh };
  const recipientKey = it.recipientInstitution ? normalizeInstitutionKey(it.recipientInstitution).key : null;
  const refs: InstrumentRef[] = it.instrumentNumbers.map((n) => normalizeInstrumentNumber(n)).filter((n) => n.normalized).map((n) => ({ number: n.raw, normalized: n.normalized, instrumentId: null }));
  const categories = it.categories?.length ? it.categories : [UNKNOWN_CATEGORY];
  const registered = it.registeredAt && isValidIsoDate(it.registeredAt) ? it.registeredAt : null;
  await ensureDefaultRules(input.orgId);
  const rule = await findRule(input.orgId, it.jurisdiction, recipientKey, "FORMAL");
  const est = estimateDueDate({ receivedDate: registered, deadlineValue: rule?.deadlineValue ?? null, deadlineUnit: rule?.deadlineUnit ?? null, channel: "FORMAL" });
  const body = "（历史导入：原始提交正文未导入青砚；范围按复盘记录。）";
  try {
    const id = await db.$transaction(async (tx) => {
      const req = await tx.recordsRequest.create({
        data: {
          orgId: input.orgId,
          title: it.title.slice(0, 200),
          jurisdiction: it.jurisdiction,
          recipientInstitution: it.recipientInstitution,
          recipientInstitutionKey: recipientKey,
          pathType: "NEW_FORMAL_REQUEST",
          channel: "FORMAL",
          ruleProfileId: rule?.id ?? null,
          lawLabel: rule?.lawLabel ?? null,
          status: m.status,
          filesStatus: m.filesStatus,
          governmentOutcome: m.governmentOutcome,
          submissionReference: it.submissionReference ?? null,
          caseNumber: it.caseNumber ?? null,
          submittedAt: it.submittedAt ? new Date(it.submittedAt) : null,
          submissionEvidenceLevel: m.status === "DRAFT" || m.status === "READY" ? null : "user_reported",
          submittedTextVerified: m.status === "DRAFT" || m.status === "READY" ? null : false,
          expectedReleasePages: it.expectedReleasePages ?? null,
          estimatedDueAt: est.estimatedDueAt ? new Date(`${est.estimatedDueAt}T00:00:00Z`) : null,
          estimateBasis: est.basisZh,
          origin: it.isFixture ? "FIXTURE" : "HISTORICAL_IMPORT",
          originNote: [it.originNote, ...m.noteZh].join("；"),
          autoDraftKey: key,
          createdById: input.userId,
        },
      });
      const v = await tx.recordsRequestVersion.create({
        data: {
          requestId: req.id,
          versionNo: 1,
          bodyEn: body,
          startDate: toDate(it.startDate),
          endDate: toDate(it.endDate),
          categoriesJson: categories,
          instrumentRefsJson: json(refs),
          jurisdiction: it.jurisdiction,
          recipientInstitution: it.recipientInstitution,
          recipientInstitutionKey: recipientKey,
          channel: "FORMAL",
          textHash: textHash(body),
          scopeFingerprint: scopeFingerprint({ applicantKey: null, jurisdiction: it.jurisdiction, institutionKey: recipientKey, numbers: refs.map((r) => r.number), categories, startDate: it.startDate, endDate: it.endDate }),
          kind: "HISTORICAL_IMPORT",
          createdById: input.userId,
        },
      });
      const submittedLike = !["DRAFT", "READY"].includes(m.status);
      await tx.recordsRequest.update({ where: { id: req.id }, data: { currentVersionId: v.id, submittedVersionId: submittedLike ? v.id : null } });
      await addEvent(tx, { orgId: input.orgId, requestId: req.id, type: "HISTORICAL_IMPORT", actorId: input.userId, evidenceLevel: "user_reported", payload: { legacyStatus: it.legacyStatus, mapped: m }, noteZh: it.originNote });
      if (it.caseNumber) {
        await addEvent(tx, { orgId: input.orgId, requestId: req.id, type: "ACKNOWLEDGED", actorId: input.userId, effectiveAt: registered ? new Date(`${registered}T12:00:00Z`) : null, evidenceLevel: "user_reported", payload: { caseNumber: it.caseNumber, registeredAt: registered }, noteZh: "历史导入：受理信未导入，user_reported", dedupeKey: `import:ack:${it.caseNumber}` });
      }
      if (it.responseLetterAt) {
        await addEvent(tx, {
          orgId: input.orgId,
          requestId: req.id,
          type: "RESPONSE_LETTER",
          actorId: input.userId,
          effectiveAt: new Date(`${it.responseLetterAt}T12:00:00Z`),
          evidenceLevel: "user_reported",
          payload: { expectedReleasePages: it.expectedReleasePages ?? null, letterDate: it.responseLetterAt },
          noteZh: `历史导入：回复信称附件 ${it.expectedReleasePages ?? "?"} 页；回复信与附件均未导入，不能声称已取得或分析`,
          dedupeKey: `import:letter:${it.caseNumber ?? key}:${it.responseLetterAt}`,
        });
      }
      return req.id;
    });
    return { ok: true as const, requestId: id, created: true, notes: m.noteZh };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await db.recordsRequest.findUnique({ where: { orgId_autoDraftKey: { orgId: input.orgId, autoDraftKey: key } }, select: { id: true } });
      if (again) return { ok: true as const, requestId: again.id, created: false, notes: m.noteZh };
    }
    throw e;
  }
}

// ─────────────────────────── Tender 关联与候选 ───────────────────────────

export async function linkInstrumentToTender(input: { orgId: string; userId: string; projectId: string; instrumentId: string; relation: "CURRENT" | "PREDECESSOR" | "RELATED_HISTORY"; note?: string | null }) {
  const [project, inst] = await Promise.all([
    db.project.findUnique({ where: { id: input.projectId }, select: { orgId: true, workDomain: true } }),
    db.procurementInstrument.findFirst({ where: { id: input.instrumentId, orgId: input.orgId }, select: { id: true } }),
  ]);
  if (!project || project.orgId !== input.orgId) return err(404, "PROJECT_NOT_FOUND", "Tender 项目不存在");
  if (!inst) return err(404, "INSTRUMENT_NOT_FOUND", "采购工具不存在");
  if (!["CURRENT", "PREDECESSOR", "RELATED_HISTORY"].includes(input.relation)) return err(400, "INVALID_RELATION", "关联类型无效");
  await db.procurementTenderLink.upsert({
    where: { projectId_instrumentId: { projectId: input.projectId, instrumentId: input.instrumentId } },
    create: { orgId: input.orgId, projectId: input.projectId, instrumentId: input.instrumentId, relation: input.relation, note: input.note ?? null, createdById: input.userId },
    update: { relation: input.relation, note: input.note ?? null },
  });
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: "procurement_instrument.link_tender", targetType: "procurement_instrument", targetId: input.instrumentId, afterData: { relation: input.relation } });
  return { ok: true as const };
}

export async function setTriage(input: { orgId: string; userId: string; instrumentId: string; triageStatus: "CANDIDATE" | "WATCHING" | "IGNORED" | "ARCHIVED" }) {
  if (!["CANDIDATE", "WATCHING", "IGNORED", "ARCHIVED"].includes(input.triageStatus)) return err(400, "INVALID_TRIAGE", "分诊状态无效");
  const res = await db.procurementInstrument.updateMany({ where: { id: input.instrumentId, orgId: input.orgId }, data: { triageStatus: input.triageStatus, triagedById: input.userId, triagedAt: new Date() } });
  if (res.count !== 1) return err(404, "INSTRUMENT_NOT_FOUND", "采购工具不存在");
  return { ok: true as const };
}

/** 用户维护字段（扫描永不覆盖）：资料持有机关与依据、到期、剩余 options、确认重招日期 */
export async function updateInstrumentFacts(input: {
  orgId: string;
  userId: string;
  instrumentId: string;
  patch: { recordsHolderInstitution?: string | null; recordsHolderBasis?: string | null; currentExpiryAt?: string | null; remainingOptions?: number | null; confirmedRetenderDate?: string | null; contractingInstitution?: string | null; buyingInstitution?: string | null };
}) {
  const p = input.patch;
  for (const d of [p.currentExpiryAt, p.confirmedRetenderDate]) if (d && !isValidIsoDate(d)) return err(400, "INVALID_DATE", "日期格式应为 YYYY-MM-DD");
  if (p.remainingOptions !== undefined && p.remainingOptions !== null && (!Number.isInteger(p.remainingOptions) || p.remainingOptions < 0)) return err(400, "INVALID_OPTIONS", "剩余 options 须为非负整数或 null（未知）");
  const res = await db.procurementInstrument.updateMany({
    where: { id: input.instrumentId, orgId: input.orgId },
    data: {
      ...(p.recordsHolderInstitution !== undefined ? { recordsHolderInstitution: p.recordsHolderInstitution } : {}),
      ...(p.recordsHolderBasis !== undefined ? { recordsHolderBasis: p.recordsHolderBasis } : {}),
      ...(p.contractingInstitution !== undefined ? { contractingInstitution: p.contractingInstitution } : {}),
      ...(p.buyingInstitution !== undefined ? { buyingInstitution: p.buyingInstitution } : {}),
      ...(p.currentExpiryAt !== undefined ? { currentExpiryAt: toDate(p.currentExpiryAt) } : {}),
      ...(p.remainingOptions !== undefined ? { remainingOptions: p.remainingOptions } : {}),
      ...(p.confirmedRetenderDate !== undefined ? { confirmedRetenderDate: toDate(p.confirmedRetenderDate) } : {}),
    },
  });
  if (res.count !== 1) return err(404, "INSTRUMENT_NOT_FOUND", "采购工具不存在");
  await logAudit({ userId: input.userId, orgId: input.orgId, action: "procurement_instrument.update_facts", targetType: "procurement_instrument", targetId: input.instrumentId, afterData: p as Record<string, unknown> });
  return { ok: true as const };
}

/** 人工导入（省市门户 / MERX / Bonfire / Ariba 等；标「人工导入」，不标官方已核实） */
export async function importManualInstrument(input: {
  orgId: string;
  userId: string;
  jurisdiction: string;
  instrumentClass: "SOLICITATION" | "AWARD_INSTRUMENT" | "CALL_UP" | "OTHER";
  officialNumber: string;
  title: string | null;
  contractingInstitution: string | null;
  buyingInstitution: string | null;
  sourceUrl: string | null;
  platform: string | null;
  note: string | null;
}) {
  if (!isJurisdiction(input.jurisdiction)) return err(400, "INVALID_JURISDICTION", "未知司法辖区");
  if (!input.officialNumber?.trim()) return err(400, "NUMBER_REQUIRED", "请填写正式编号");
  if (input.sourceUrl) {
    try {
      const u = new URL(input.sourceUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad");
    } catch {
      return err(400, "INVALID_URL", "来源链接无效");
    }
  }
  const now = new Date();
  const o = await upsertInstrumentFromRecord({
    orgId: input.orgId,
    record: {
      sourceType: "OPEN_CANADA_CONTRACTS",
      sourceKey: `manual:${input.jurisdiction}:${normalizeInstrumentNumber(input.officialNumber).normalized}:${(input.sourceUrl ?? "").toLowerCase()}`,
      sourceRecordId: null,
      sourceUrl: input.sourceUrl,
      jurisdiction: input.jurisdiction as never,
      instrumentClass: input.instrumentClass,
      instrumentSubtype: null,
      officialNumber: input.officialNumber.trim(),
      aliases: [],
      parentNumber: null,
      title: input.title,
      description: input.note,
      categoryCodes: [],
      categoryText: null,
      regions: [],
      contractingInstitution: input.contractingInstitution,
      buyingInstitution: input.buyingInstitution,
      vendorName: null,
      publishedAt: null,
      closingAt: null,
      awardDate: null,
      periodEnd: null,
      contractValue: null,
      originalValue: null,
      amendmentValue: null,
      currency: null,
      amendmentNumber: null,
      status: null,
      raw: { platform: input.platform ?? "", note: input.note ?? "" },
    },
    match: undefined,
    runId: null,
    now,
    allowCreate: true,
    origin: "MANUAL",
    createdById: input.userId,
    initialTriage: "WATCHING",
    evidenceOverride: {
      sourceType: "MANUAL_LINK",
      isOfficial: false,
      summary: `人工导入${input.platform ? `（${input.platform}）` : ""}：平台不等于申请接收机关；官方性与字段待核实`,
    },
  });
  return { ok: true as const, instrumentId: o.instrumentId, created: o.created };
}
