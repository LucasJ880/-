// ============================================================
// MemoryClaim lifecycle service（T3）
//
// 核心纪律：
// - AI_AUTO_MEMORY_WRITE = NO：actorType=ai 一律拒绝；system producer 本轮未启用
// - 每个可用 claim 必须有 evidence；唯一例外 = USER_ENTRY 无证据 → 强制 NEEDS_REVIEW
// - claimNature=FACT 必须有证据且 sourceType ≠ AI_DERIVED（AI 推理绝不默认 FACT）
// - 事实语义字段不可原地改写：实质变化 = supersede / retract + 新 claim（new→old 链）
// - 一切读写 org-scoped；cross-org 一律 fail-closed（按不存在处理）
// ============================================================

import { Prisma } from "@prisma/client";
import type { MemoryClaim, MemoryClaimEvidence } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { requireMemoryWriteAccess, type MemoryAccessContext } from "./access";
import {
  CorporateMemoryError,
  DEFAULT_ACCESS_CLASS,
  MEMORY_ACCESS_CLASSES,
  MEMORY_CLAIM_NATURES,
  MEMORY_CLAIM_TYPES,
  MEMORY_CONFIDENCE_LEVELS,
  MEMORY_EVIDENCE_SOURCE_TYPES,
  MEMORY_LIMITS,
  MEMORY_SOURCE_TYPES,
  MEMORY_SUBJECT_TYPES,
  MEMORY_VERIFICATION_STATUSES,
  optionalDate,
  requireBoundedJson,
  requireBoundedString,
  requireDate,
  requireVocab,
  type MemoryActorInput,
} from "./types";

export type MemoryClaimWithEvidence = MemoryClaim & {
  evidence: MemoryClaimEvidence[];
};

export interface MemoryClaimEvidenceInput {
  sourceType: string;
  sourceKey?: string;
  archiveItemId?: string;
  documentId?: string;
  pageNumber?: number;
  sectionLabel?: string;
  sourceUrl?: string;
  sourceSnippet?: string;
  contentHash?: string;
  capturedAt: Date;
  accessClass?: string;
  metadata?: unknown;
}

export interface CreateMemoryClaimInput {
  orgId: string;
  actor: MemoryActorInput;
  subjectType: string;
  subjectKey: string;
  claimType: string;
  claimNature: string;
  statement: string;
  structuredValue?: unknown;
  confidence: string;
  /// 缺省 NEEDS_REVIEW（最保守）；SYSTEM_VERIFIED 本轮无 system verifier，创建时拒绝
  verificationStatus?: string;
  sourceType: string;
  capturedAt: Date;
  validFrom?: Date;
  validTo?: Date;
  accessClass?: string;
  evidence?: MemoryClaimEvidenceInput[];
  metadata?: unknown;
}

/// supersede / correction 的替换 claim 输入：subject 继承旧 claim（supersession 不改 subject）
export type ReplacementClaimInput = Omit<
  CreateMemoryClaimInput,
  "orgId" | "actor" | "subjectType" | "subjectKey"
>;

interface NormalizedEvidence {
  sourceType: string;
  sourceKey: string | null;
  archiveItemId: string | null;
  documentId: string | null;
  pageNumber: number | null;
  sectionLabel: string | null;
  sourceUrl: string | null;
  sourceSnippet: string | null;
  contentHash: string | null;
  capturedAt: Date;
  accessClass: string;
  metadata: unknown;
}

interface NormalizedClaimCore {
  claimType: string;
  claimNature: string;
  statement: string;
  structuredValue: unknown;
  confidence: string;
  verificationStatus: string;
  sourceType: string;
  capturedAt: Date;
  validFrom: Date | null;
  validTo: Date | null;
  accessClass: string;
  status: "ACTIVE" | "NEEDS_REVIEW";
  metadata: unknown;
  evidence: NormalizedEvidence[];
}

// --- 写入 actor 门（AI_AUTO_MEMORY_WRITE = NO） ---

function assertWritableActorType(actor: MemoryActorInput): "user" {
  const actorType = actor.actorType ?? "user";
  if (actorType === "ai" || actorType.startsWith("ai:") || actorType === "agent") {
    throw new CorporateMemoryError(
      "AI_AUTO_MEMORY_WRITE_DISABLED",
      "AI 禁止直接写入 Corporate Memory（AI_AUTO_MEMORY_WRITE = NO）；AI 提案未来只能进入 candidate 审核流",
    );
  }
  if (actorType === "system") {
    throw new CorporateMemoryError(
      "SYSTEM_WRITER_NOT_ENABLED",
      "system producer 本轮未启用（MEMORY_WRITE_PERMISSION = CONSERVATIVE_ADMIN_ONLY）",
    );
  }
  if (actorType !== "user") {
    throw new CorporateMemoryError("INVALID_INPUT", `未知 actorType: ${actorType}`);
  }
  return "user";
}

// --- Evidence 校验 ---

function normalizeEvidenceInput(
  raw: MemoryClaimEvidenceInput,
  index: number,
): NormalizedEvidence {
  const label = `evidence[${index}]`;
  if (raw.sourceType === "AI_DERIVED") {
    throw new CorporateMemoryError(
      "INVALID_INPUT",
      `${label}.sourceType 不可为 AI_DERIVED：AI 产物不是独立证据，必须回指真实来源`,
    );
  }
  const sourceType = requireVocab(
    raw.sourceType,
    MEMORY_EVIDENCE_SOURCE_TYPES,
    `${label}.sourceType`,
  );
  const sourceKey = requireBoundedString(
    raw.sourceKey,
    `${label}.sourceKey`,
    MEMORY_LIMITS.SOURCE_KEY_MAX_CHARS,
    { optional: true },
  );
  const archiveItemId = requireBoundedString(
    raw.archiveItemId,
    `${label}.archiveItemId`,
    100,
    { optional: true },
  );
  const documentId = requireBoundedString(
    raw.documentId,
    `${label}.documentId`,
    100,
    { optional: true },
  );
  const sourceUrl = requireBoundedString(
    raw.sourceUrl,
    `${label}.sourceUrl`,
    MEMORY_LIMITS.URL_MAX_CHARS,
    { optional: true },
  );
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    throw new CorporateMemoryError(
      "INVALID_INPUT",
      `${label}.sourceUrl 必须是 http(s) URL`,
    );
  }
  if (!sourceKey && !archiveItemId && !documentId && !sourceUrl) {
    throw new CorporateMemoryError(
      "INVALID_INPUT",
      `${label} 至少需要一个来源定位符（sourceKey / archiveItemId / documentId / sourceUrl）`,
    );
  }
  let pageNumber: number | null = null;
  if (raw.pageNumber !== undefined && raw.pageNumber !== null) {
    if (!Number.isInteger(raw.pageNumber) || raw.pageNumber < 1) {
      throw new CorporateMemoryError(
        "INVALID_INPUT",
        `${label}.pageNumber 必须是正整数`,
      );
    }
    pageNumber = raw.pageNumber;
  }
  return {
    sourceType,
    sourceKey,
    archiveItemId,
    documentId,
    pageNumber,
    sectionLabel: requireBoundedString(
      raw.sectionLabel,
      `${label}.sectionLabel`,
      MEMORY_LIMITS.SECTION_LABEL_MAX_CHARS,
      { optional: true },
    ),
    sourceUrl,
    sourceSnippet: requireBoundedString(
      raw.sourceSnippet,
      `${label}.sourceSnippet`,
      MEMORY_LIMITS.SNIPPET_MAX_CHARS,
      { optional: true },
    ),
    contentHash: requireBoundedString(raw.contentHash, `${label}.contentHash`, 128, {
      optional: true,
    }),
    capturedAt: requireDate(raw.capturedAt, `${label}.capturedAt`),
    accessClass:
      raw.accessClass === undefined || raw.accessClass === null
        ? DEFAULT_ACCESS_CLASS
        : requireVocab(raw.accessClass, MEMORY_ACCESS_CLASSES, `${label}.accessClass`),
    metadata: requireBoundedJson(raw.metadata, `${label}.metadata`),
  };
}

function normalizeEvidenceList(
  evidence: MemoryClaimEvidenceInput[] | undefined,
): NormalizedEvidence[] {
  if (evidence === undefined || evidence === null) return [];
  if (!Array.isArray(evidence)) {
    throw new CorporateMemoryError("INVALID_INPUT", "evidence 必须是数组");
  }
  if (evidence.length > MEMORY_LIMITS.EVIDENCE_MAX_PER_CALL) {
    throw new CorporateMemoryError(
      "INVALID_INPUT",
      `evidence 单次上限 ${MEMORY_LIMITS.EVIDENCE_MAX_PER_CALL} 条`,
    );
  }
  return evidence.map((raw, index) => normalizeEvidenceInput(raw, index));
}

// --- Claim 核心字段校验（create 与 replacement 共用） ---

function normalizeClaimCore(input: {
  claimType: string;
  claimNature: string;
  statement: string;
  structuredValue?: unknown;
  confidence: string;
  verificationStatus?: string;
  sourceType: string;
  capturedAt: Date;
  validFrom?: Date;
  validTo?: Date;
  accessClass?: string;
  evidence?: MemoryClaimEvidenceInput[];
  metadata?: unknown;
}): NormalizedClaimCore {
  const claimType = requireVocab(input.claimType, MEMORY_CLAIM_TYPES, "claimType");
  const claimNature = requireVocab(
    input.claimNature,
    MEMORY_CLAIM_NATURES,
    "claimNature",
  );
  const sourceType = requireVocab(input.sourceType, MEMORY_SOURCE_TYPES, "sourceType");
  const confidence = requireVocab(
    input.confidence,
    MEMORY_CONFIDENCE_LEVELS,
    "confidence",
  );
  let verificationStatus =
    input.verificationStatus === undefined || input.verificationStatus === null
      ? "NEEDS_REVIEW"
      : requireVocab(
          input.verificationStatus,
          MEMORY_VERIFICATION_STATUSES,
          "verificationStatus",
        );
  if (verificationStatus === "SYSTEM_VERIFIED") {
    throw new CorporateMemoryError(
      "SYSTEM_VERIFICATION_NOT_ENABLED",
      "本轮无 system verifier：创建时不可直接标 SYSTEM_VERIFIED",
    );
  }
  if (sourceType === "AI_DERIVED" && verificationStatus === "HUMAN_CONFIRMED") {
    throw new CorporateMemoryError(
      "INVALID_INPUT",
      "AI_DERIVED claim 创建时不可直接标 HUMAN_CONFIRMED；先创建后走 confirmMemoryClaim 受控提升",
    );
  }

  const statement = requireBoundedString(
    input.statement,
    "statement",
    MEMORY_LIMITS.STATEMENT_MAX_CHARS,
  ) as string;
  const capturedAt = requireDate(input.capturedAt, "capturedAt");
  const validFrom = optionalDate(input.validFrom, "validFrom");
  const validTo = optionalDate(input.validTo, "validTo");
  if (validFrom && validTo && validFrom.getTime() > validTo.getTime()) {
    throw new CorporateMemoryError("INVALID_INPUT", "validFrom 不得晚于 validTo");
  }

  const evidence = normalizeEvidenceList(input.evidence);

  // 证据政策（MEM-02/MEM-03）：
  // - FACT 必须有证据；AI_DERIVED 永远不能是 FACT
  // - 无证据仅允许 USER_ENTRY，且强制 NEEDS_REVIEW（verification + lifecycle 双 NEEDS_REVIEW）
  if (claimNature === "FACT" && sourceType === "AI_DERIVED") {
    throw new CorporateMemoryError(
      "AI_DERIVED_CANNOT_BE_FACT",
      "AI 推断（sourceType=AI_DERIVED）不可标 FACT；请用 INTERPRETATION/INFERENCE",
    );
  }
  let status: "ACTIVE" | "NEEDS_REVIEW" = "ACTIVE";
  if (evidence.length === 0) {
    if (claimNature === "FACT") {
      throw new CorporateMemoryError(
        "FACT_REQUIRES_EVIDENCE",
        "FACT claim 必须附带直接支撑证据",
      );
    }
    if (sourceType !== "USER_ENTRY") {
      throw new CorporateMemoryError(
        "EVIDENCE_REQUIRED",
        "claim 必须附带 evidence；唯一例外 = USER_ENTRY（进入 NEEDS_REVIEW）",
      );
    }
    // 显式 USER_ENTRY + NEEDS_REVIEW 政策（MEM-02）
    verificationStatus = "NEEDS_REVIEW";
    status = "NEEDS_REVIEW";
  } else if (sourceType === "AI_DERIVED") {
    // AI_DERIVED 即便有证据也保持非 FACT + 非 HUMAN_CONFIRMED（上面已拦），无额外动作
  }

  return {
    claimType,
    claimNature,
    statement,
    structuredValue: requireBoundedJson(input.structuredValue, "structuredValue"),
    confidence,
    verificationStatus,
    sourceType,
    capturedAt,
    validFrom,
    validTo,
    accessClass:
      input.accessClass === undefined || input.accessClass === null
        ? DEFAULT_ACCESS_CLASS
        : requireVocab(input.accessClass, MEMORY_ACCESS_CLASSES, "accessClass"),
    status,
    metadata: requireBoundedJson(input.metadata, "metadata"),
    evidence,
  };
}

// --- org 内引用 fail-closed 校验（MEM-09） ---

async function assertSubjectInScope(
  tx: Prisma.TransactionClient,
  orgId: string,
  subjectType: string,
  subjectKey: string,
): Promise<void> {
  if (subjectType === "BUYER") {
    const buyer = await tx.buyer.findFirst({
      where: { id: subjectKey, orgId },
      select: { id: true },
    });
    if (!buyer) {
      throw new CorporateMemoryError(
        "SUBJECT_OUT_OF_SCOPE",
        "subjectType=BUYER 时 subjectKey 必须是本 org 的 Buyer.id",
      );
    }
    return;
  }
  if (subjectType === "PROJECT" || subjectType === "TENDER") {
    const project = await tx.project.findFirst({
      where: { id: subjectKey, orgId },
      select: { id: true },
    });
    if (!project) {
      throw new CorporateMemoryError(
        "SUBJECT_OUT_OF_SCOPE",
        `subjectType=${subjectType} 时 subjectKey 必须是本 org 的 Project.id`,
      );
    }
    return;
  }
  if (subjectType === "ORGANIZATION" && subjectKey !== orgId) {
    throw new CorporateMemoryError(
      "SUBJECT_OUT_OF_SCOPE",
      "subjectType=ORGANIZATION 时 subjectKey 必须等于本 orgId",
    );
  }
  // VENDOR / PRODUCT / OTHER：无强制注册表，允许 opaque key（见报告 §Subject Contract）
}

async function assertEvidenceRefsInScope(
  tx: Prisma.TransactionClient,
  orgId: string,
  evidence: NormalizedEvidence[],
): Promise<void> {
  for (const [index, ev] of evidence.entries()) {
    if (ev.archiveItemId) {
      const item = await tx.tenderArchiveItem.findFirst({
        where: { id: ev.archiveItemId, orgId },
        select: { id: true },
      });
      if (!item) {
        throw new CorporateMemoryError(
          "EVIDENCE_SOURCE_OUT_OF_SCOPE",
          `evidence[${index}].archiveItemId 不存在或不属于本 org`,
        );
      }
    }
    if (ev.documentId) {
      const doc = await tx.projectDocument.findUnique({
        where: { id: ev.documentId },
        select: { project: { select: { orgId: true } } },
      });
      if (!doc || doc.project.orgId !== orgId) {
        throw new CorporateMemoryError(
          "EVIDENCE_SOURCE_OUT_OF_SCOPE",
          `evidence[${index}].documentId 不存在或不属于本 org`,
        );
      }
    }
  }
}

// --- 创建（含 evidence，事务原子） ---

async function createClaimRowTx(
  tx: Prisma.TransactionClient,
  access: MemoryAccessContext,
  subjectType: string,
  subjectKey: string,
  core: NormalizedClaimCore,
  supersedesClaimId: string | null,
): Promise<MemoryClaimWithEvidence> {
  await assertSubjectInScope(tx, access.orgId, subjectType, subjectKey);
  await assertEvidenceRefsInScope(tx, access.orgId, core.evidence);

  const claim = await tx.memoryClaim.create({
    data: {
      orgId: access.orgId,
      subjectType,
      subjectKey,
      claimType: core.claimType,
      claimNature: core.claimNature,
      statement: core.statement,
      structuredValue:
        core.structuredValue === null
          ? undefined
          : (core.structuredValue as Prisma.InputJsonValue),
      confidence: core.confidence,
      verificationStatus: core.verificationStatus,
      sourceType: core.sourceType,
      capturedAt: core.capturedAt,
      validFrom: core.validFrom,
      validTo: core.validTo,
      status: core.status,
      supersedesClaimId,
      accessClass: core.accessClass,
      createdByType: "user",
      createdById: access.userId,
      verifiedById:
        core.verificationStatus === "HUMAN_CONFIRMED" ? access.userId : null,
      verifiedAt:
        core.verificationStatus === "HUMAN_CONFIRMED" ? new Date() : null,
      metadata:
        core.metadata === null ? undefined : (core.metadata as Prisma.InputJsonValue),
      evidence: {
        create: core.evidence.map((ev) => ({
          orgId: access.orgId,
          sourceType: ev.sourceType,
          sourceKey: ev.sourceKey,
          archiveItemId: ev.archiveItemId,
          documentId: ev.documentId,
          pageNumber: ev.pageNumber,
          sectionLabel: ev.sectionLabel,
          sourceUrl: ev.sourceUrl,
          sourceSnippet: ev.sourceSnippet,
          contentHash: ev.contentHash,
          capturedAt: ev.capturedAt,
          accessClass: ev.accessClass,
          metadata:
            ev.metadata === null ? undefined : (ev.metadata as Prisma.InputJsonValue),
          createdById: access.userId,
        })),
      },
    },
    include: { evidence: true },
  });

  await writeAuditLog(tx, {
    userId: access.userId,
    orgId: access.orgId,
    action: "memory_claim_created",
    targetType: "memory_claim",
    targetId: claim.id,
    afterData: {
      subjectType,
      subjectKey,
      claimType: core.claimType,
      claimNature: core.claimNature,
      verificationStatus: core.verificationStatus,
      status: core.status,
      accessClass: core.accessClass,
      evidenceCount: core.evidence.length,
      supersedesClaimId,
    },
  });
  return claim;
}

/** 创建 MemoryClaim（受控人工路径；AI/system 直写被拒）。 */
export async function createMemoryClaim(
  input: CreateMemoryClaimInput,
): Promise<MemoryClaimWithEvidence> {
  assertWritableActorType(input.actor);
  const access = await requireMemoryWriteAccess({
    orgId: input.orgId,
    actor: input.actor,
  });
  const subjectType = requireVocab(
    input.subjectType,
    MEMORY_SUBJECT_TYPES,
    "subjectType",
  );
  const subjectKey = requireBoundedString(
    input.subjectKey,
    "subjectKey",
    MEMORY_LIMITS.SUBJECT_KEY_MAX_CHARS,
  ) as string;
  const core = normalizeClaimCore(input);

  return db.$transaction(async (tx) =>
    createClaimRowTx(tx, access, subjectType, subjectKey, core, null),
  );
}

// --- Supersession / Retraction / Confirmation / Governance ---

async function loadOwnedClaim(
  tx: Prisma.TransactionClient,
  orgId: string,
  claimId: string,
): Promise<MemoryClaim> {
  if (typeof claimId !== "string" || !claimId.trim()) {
    throw new CorporateMemoryError("INVALID_INPUT", "claimId 必填");
  }
  const claim = await tx.memoryClaim.findFirst({
    where: { id: claimId, orgId },
  });
  if (!claim) {
    // cross-org 与不存在同响应：不可枚举、fail-closed
    throw new CorporateMemoryError("CLAIM_NOT_FOUND", "claim 不存在");
  }
  return claim;
}

export interface SupersedeMemoryClaimResult {
  oldClaim: MemoryClaim;
  newClaim: MemoryClaimWithEvidence;
}

/**
 * 实质变化：旧 claim ACTIVE→SUPERSEDED，新 claim ACTIVE 且 supersedesClaimId=旧 id。
 * subject 继承旧 claim（supersession 不改 subject；换 subject = 新 claim + retraction）。
 */
export async function supersedeMemoryClaim(input: {
  orgId: string;
  actor: MemoryActorInput;
  claimId: string;
  replacement: ReplacementClaimInput;
}): Promise<SupersedeMemoryClaimResult> {
  assertWritableActorType(input.actor);
  const access = await requireMemoryWriteAccess({
    orgId: input.orgId,
    actor: input.actor,
  });
  const core = normalizeClaimCore(input.replacement);

  return db.$transaction(async (tx) => {
    const old = await loadOwnedClaim(tx, access.orgId, input.claimId);
    if (old.status !== "ACTIVE") {
      throw new CorporateMemoryError(
        "CLAIM_NOT_SUPERSEDABLE",
        `仅 ACTIVE claim 可被 supersede（当前 ${old.status}）`,
      );
    }
    const oldUpdated = await tx.memoryClaim.update({
      where: { id: old.id },
      data: { status: "SUPERSEDED", supersededAt: new Date() },
    });
    const newClaim = await createClaimRowTx(
      tx,
      access,
      old.subjectType,
      old.subjectKey,
      core,
      old.id,
    );
    await writeAuditLog(tx, {
      userId: access.userId,
      orgId: access.orgId,
      action: "memory_claim_superseded",
      targetType: "memory_claim",
      targetId: old.id,
      afterData: { newClaimId: newClaim.id },
    });
    return { oldClaim: oldUpdated, newClaim };
  });
}

export interface RetractMemoryClaimResult {
  retractedClaim: MemoryClaim;
  correctionClaim: MemoryClaimWithEvidence | null;
}

/**
 * 撤回错误 claim：不改原 statement，status → RETRACTED（历史保留）。
 * 可选 replacement = 修正 claim（ACTIVE，supersedesClaimId=旧 id，记录 correction 关系）。
 */
export async function retractMemoryClaim(input: {
  orgId: string;
  actor: MemoryActorInput;
  claimId: string;
  reason: string;
  replacement?: ReplacementClaimInput;
}): Promise<RetractMemoryClaimResult> {
  assertWritableActorType(input.actor);
  const access = await requireMemoryWriteAccess({
    orgId: input.orgId,
    actor: input.actor,
  });
  const reason = requireBoundedString(
    input.reason,
    "reason",
    MEMORY_LIMITS.RETRACTION_REASON_MAX_CHARS,
  ) as string;
  const core = input.replacement ? normalizeClaimCore(input.replacement) : null;

  return db.$transaction(async (tx) => {
    const old = await loadOwnedClaim(tx, access.orgId, input.claimId);
    if (old.status !== "ACTIVE" && old.status !== "NEEDS_REVIEW") {
      throw new CorporateMemoryError(
        "CLAIM_NOT_RETRACTABLE",
        `仅 ACTIVE / NEEDS_REVIEW claim 可撤回（当前 ${old.status}）`,
      );
    }
    const retracted = await tx.memoryClaim.update({
      where: { id: old.id },
      data: {
        status: "RETRACTED",
        retractedAt: new Date(),
        retractionReason: reason,
      },
    });
    let correction: MemoryClaimWithEvidence | null = null;
    if (core) {
      correction = await createClaimRowTx(
        tx,
        access,
        old.subjectType,
        old.subjectKey,
        core,
        old.id,
      );
    }
    await writeAuditLog(tx, {
      userId: access.userId,
      orgId: access.orgId,
      action: "memory_claim_retracted",
      targetType: "memory_claim",
      targetId: old.id,
      afterData: { reason, correctionClaimId: correction?.id ?? null },
    });
    return { retractedClaim: retracted, correctionClaim: correction };
  });
}

/**
 * 人工确认：verificationStatus → HUMAN_CONFIRMED（记录 verifiedBy/At）；
 * lifecycle NEEDS_REVIEW 的 claim 同时提升为 ACTIVE。幂等：已确认则原样返回。
 */
export async function confirmMemoryClaim(input: {
  orgId: string;
  actor: MemoryActorInput;
  claimId: string;
}): Promise<MemoryClaim> {
  assertWritableActorType(input.actor);
  const access = await requireMemoryWriteAccess({
    orgId: input.orgId,
    actor: input.actor,
  });
  return db.$transaction(async (tx) => {
    const claim = await loadOwnedClaim(tx, access.orgId, input.claimId);
    if (claim.status === "SUPERSEDED" || claim.status === "RETRACTED") {
      throw new CorporateMemoryError(
        "INVALID_INPUT",
        "已归档（SUPERSEDED/RETRACTED）claim 不可确认",
      );
    }
    if (claim.verificationStatus === "HUMAN_CONFIRMED") return claim;
    const updated = await tx.memoryClaim.update({
      where: { id: claim.id },
      data: {
        verificationStatus: "HUMAN_CONFIRMED",
        verifiedById: access.userId,
        verifiedAt: new Date(),
        status: claim.status === "NEEDS_REVIEW" ? "ACTIVE" : claim.status,
      },
    });
    await writeAuditLog(tx, {
      userId: access.userId,
      orgId: access.orgId,
      action: "memory_claim_confirmed",
      targetType: "memory_claim",
      targetId: claim.id,
      afterData: { from: claim.verificationStatus, status: updated.status },
    });
    return updated;
  });
}

const GOVERNANCE_PATCH_KEYS = ["metadata", "reviewNote", "accessClass"] as const;

export interface MemoryClaimGovernancePatch {
  metadata?: unknown;
  reviewNote?: string | null;
  accessClass?: string;
}

/**
 * 原地更新白名单（MEM-06）：仅 metadata / reviewNote / accessClass。
 * 任何事实语义字段（statement/confidence/subject/…）出现在 patch → GOVERNANCE_FIELD_FORBIDDEN。
 */
export async function updateMemoryClaimGovernance(input: {
  orgId: string;
  actor: MemoryActorInput;
  claimId: string;
  patch: MemoryClaimGovernancePatch;
}): Promise<MemoryClaim> {
  assertWritableActorType(input.actor);
  const access = await requireMemoryWriteAccess({
    orgId: input.orgId,
    actor: input.actor,
  });
  if (!input.patch || typeof input.patch !== "object") {
    throw new CorporateMemoryError("INVALID_INPUT", "patch 必填");
  }
  const keys = Object.keys(input.patch);
  if (keys.length === 0) {
    throw new CorporateMemoryError("INVALID_INPUT", "patch 不可为空");
  }
  const forbidden = keys.filter(
    (k) => !(GOVERNANCE_PATCH_KEYS as readonly string[]).includes(k),
  );
  if (forbidden.length > 0) {
    throw new CorporateMemoryError(
      "GOVERNANCE_FIELD_FORBIDDEN",
      `原地修改仅限 ${GOVERNANCE_PATCH_KEYS.join("/")}；被拒字段：${forbidden.join(",")}（事实变化请走 supersede/retract）`,
    );
  }

  const data: Prisma.MemoryClaimUpdateInput = {};
  if ("metadata" in input.patch) {
    const metadata = requireBoundedJson(input.patch.metadata, "metadata");
    data.metadata =
      metadata === null ? Prisma.DbNull : (metadata as Prisma.InputJsonValue);
  }
  if ("reviewNote" in input.patch) {
    data.reviewNote = requireBoundedString(
      input.patch.reviewNote,
      "reviewNote",
      MEMORY_LIMITS.REVIEW_NOTE_MAX_CHARS,
      { optional: true },
    );
  }
  if ("accessClass" in input.patch) {
    data.accessClass = requireVocab(
      input.patch.accessClass,
      MEMORY_ACCESS_CLASSES,
      "accessClass",
    );
  }

  return db.$transaction(async (tx) => {
    const claim = await loadOwnedClaim(tx, access.orgId, input.claimId);
    const updated = await tx.memoryClaim.update({
      where: { id: claim.id },
      data,
    });
    await writeAuditLog(tx, {
      userId: access.userId,
      orgId: access.orgId,
      action: "memory_claim_governance_updated",
      targetType: "memory_claim",
      targetId: claim.id,
      afterData: { changedKeys: keys },
    });
    return updated;
  });
}

/** 为既有 claim 追加 evidence（多证据保留；per-evidence 分级不塌缩）。 */
export async function attachMemoryClaimEvidence(input: {
  orgId: string;
  actor: MemoryActorInput;
  claimId: string;
  evidence: MemoryClaimEvidenceInput[];
}): Promise<MemoryClaimWithEvidence> {
  assertWritableActorType(input.actor);
  const access = await requireMemoryWriteAccess({
    orgId: input.orgId,
    actor: input.actor,
  });
  const evidence = normalizeEvidenceList(input.evidence);
  if (evidence.length === 0) {
    throw new CorporateMemoryError("INVALID_INPUT", "evidence 不可为空");
  }
  return db.$transaction(async (tx) => {
    const claim = await loadOwnedClaim(tx, access.orgId, input.claimId);
    if (claim.status === "SUPERSEDED" || claim.status === "RETRACTED") {
      throw new CorporateMemoryError(
        "INVALID_INPUT",
        "已归档（SUPERSEDED/RETRACTED）claim 不可追加 evidence",
      );
    }
    await assertEvidenceRefsInScope(tx, access.orgId, evidence);
    await tx.memoryClaimEvidence.createMany({
      data: evidence.map((ev) => ({
        orgId: access.orgId,
        claimId: claim.id,
        sourceType: ev.sourceType,
        sourceKey: ev.sourceKey,
        archiveItemId: ev.archiveItemId,
        documentId: ev.documentId,
        pageNumber: ev.pageNumber,
        sectionLabel: ev.sectionLabel,
        sourceUrl: ev.sourceUrl,
        sourceSnippet: ev.sourceSnippet,
        contentHash: ev.contentHash,
        capturedAt: ev.capturedAt,
        accessClass: ev.accessClass,
        metadata:
          ev.metadata === null ? undefined : (ev.metadata as Prisma.InputJsonValue),
        createdById: access.userId,
      })),
    });
    await writeAuditLog(tx, {
      userId: access.userId,
      orgId: access.orgId,
      action: "memory_claim_evidence_attached",
      targetType: "memory_claim",
      targetId: claim.id,
      afterData: { attachedCount: evidence.length },
    });
    const withEvidence = await tx.memoryClaim.findFirst({
      where: { id: claim.id, orgId: access.orgId },
      include: { evidence: true },
    });
    if (!withEvidence) {
      throw new CorporateMemoryError("CLAIM_NOT_FOUND", "claim 不存在");
    }
    return withEvidence;
  });
}
