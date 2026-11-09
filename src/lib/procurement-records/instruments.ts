/**
 * PROC-1 采购工具与来源证据写入（幂等；design D5）。
 *
 * - 采购工具按 (orgId, dedupeKey) 唯一；并发创建撞唯一键 → 读回既有（不产生第二条）；
 * - 证据按 (orgId, sourceType, sourceKey, contentHash) 唯一：内容不变只刷新 lastSeenAt，内容变化新增一行（修订历史）；
 * - 扫描只写来源字段，且只写非空值（来源失败 / 字段缺失不清空既有数据、不改 0）；
 *   用户维护的字段（资料持有机关、到期、options、确认重招、分诊）扫描永不覆盖。
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  buildInstrumentDedupeKey,
  needsInstitutionReview,
  normalizeInstitutionKey,
  normalizeInstrumentNumber,
  type InstitutionKey,
} from "./identity";
import { computePriority } from "./priority";
import { atiMentionsNumber, recordContentHash, stableHash, type AtiSummary, type NormalizedRecord } from "./sources-pure";
import type { KeywordMatch } from "./watch-config";
import type { KnownInstrumentRef, PageSnapshot } from "./source-fetch";

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export type AliasEntry = { value: string; kind: string; source?: string };

function readAliases(v: unknown): AliasEntry[] {
  return Array.isArray(v)
    ? (v as unknown[]).filter((a): a is AliasEntry => !!a && typeof a === "object" && typeof (a as AliasEntry).value === "string")
    : [];
}

function mergeAliases(existing: AliasEntry[], add: AliasEntry[]): AliasEntry[] {
  const out = [...existing];
  for (const a of add) {
    if (!out.some((x) => x.value === a.value && x.kind === a.kind)) out.push(a);
  }
  return out;
}

/** 已关注 / 种子合同（刷新路径输入） */
export async function loadKnownInstruments(orgId: string): Promise<KnownInstrumentRef[]> {
  const rows = await db.procurementInstrument.findMany({
    where: {
      orgId,
      instrumentClass: "AWARD_INSTRUMENT",
      OR: [{ triageStatus: "WATCHING" }, { origin: "SEED" }],
      NOT: { triageStatus: { in: ["IGNORED", "ARCHIVED"] } },
    },
    select: {
      id: true,
      officialNumber: true,
      normalizedNumber: true,
      instrumentClass: true,
      evidence: { select: { sourceUrl: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    officialNumber: r.officialNumber,
    normalizedNumber: r.normalizedNumber,
    instrumentClass: r.instrumentClass,
    contractHistoryUrls: [
      ...new Set(
        r.evidence
          .map((e) => e.sourceUrl)
          .filter((u): u is string => !!u && /canadabuys\.canada\.ca\/[a-z]{2}\/tender-opportunities\/contract-history\//i.test(u)),
      ),
    ],
  }));
}

export interface UpsertOutcome {
  instrumentId: string | null;
  created: boolean;
  /** 同一来源记录出现新内容版本（修订 / 变化） */
  evidenceChanged: boolean;
  evidenceCreated: boolean;
  /** 新采购工具但本轮预算已满 → 未创建（待续） */
  deferred: boolean;
  flaggedForReview: boolean;
}

interface EvidenceInput {
  orgId: string;
  instrumentId: string | null;
  sourceType: string;
  sourceKey: string;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  isOfficial: boolean;
  contentHash: string;
  publishedAt: Date | null;
  parseStatus: "PARSED" | "PARTIAL" | "FAILED";
  normalizedJson?: Prisma.InputJsonValue;
  snapshotJson?: Prisma.InputJsonValue;
  summary: string | null;
  scanRunId: string | null;
  createdById?: string | null;
  now: Date;
}

/** 写证据（幂等）；返回是否新内容、是否相对同 sourceKey 旧内容发生变化 */
export async function upsertEvidence(e: EvidenceInput): Promise<{ id: string; created: boolean; changed: boolean }> {
  const where = { orgId_sourceType_sourceKey_contentHash: { orgId: e.orgId, sourceType: e.sourceType, sourceKey: e.sourceKey, contentHash: e.contentHash } };
  const existing = await db.procurementSourceEvidence.findUnique({ where, select: { id: true, instrumentId: true } });
  if (existing) {
    await db.procurementSourceEvidence.update({
      where: { id: existing.id },
      data: { lastSeenAt: e.now, ...(existing.instrumentId || !e.instrumentId ? {} : { instrumentId: e.instrumentId }) },
    });
    return { id: existing.id, created: false, changed: false };
  }
  const prior = await db.procurementSourceEvidence.count({
    where: { orgId: e.orgId, sourceType: e.sourceType, sourceKey: e.sourceKey, NOT: { contentHash: e.contentHash } },
  });
  try {
    const row = await db.procurementSourceEvidence.create({
      data: {
        orgId: e.orgId,
        instrumentId: e.instrumentId,
        sourceType: e.sourceType,
        sourceKey: e.sourceKey,
        sourceRecordId: e.sourceRecordId,
        sourceUrl: e.sourceUrl,
        isOfficial: e.isOfficial,
        contentHash: e.contentHash,
        publishedAt: e.publishedAt,
        fetchedAt: e.now,
        lastSeenAt: e.now,
        parseStatus: e.parseStatus,
        normalizedJson: e.normalizedJson,
        snapshotJson: e.snapshotJson,
        summary: e.summary,
        scanRunId: e.scanRunId,
        createdById: e.createdById ?? null,
      },
      select: { id: true },
    });
    return { id: row.id, created: true, changed: prior > 0 };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const again = await db.procurementSourceEvidence.findUnique({ where, select: { id: true } });
    return { id: again!.id, created: false, changed: false };
  }
}

function procuringInstitutionOf(r: NormalizedRecord): InstitutionKey {
  return normalizeInstitutionKey(r.contractingInstitution);
}

function d(v: string | null): Date | null {
  if (!v) return null;
  const t = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * 把一条标准化来源记录写成采购工具 + 证据。
 * allowCreate=false：只允许更新既有采购工具（预算已满的新候选 → deferred，下轮继续）。
 */
export async function upsertInstrumentFromRecord(input: {
  orgId: string;
  record: NormalizedRecord;
  match: KeywordMatch | undefined;
  runId: string | null;
  now: Date;
  allowCreate: boolean;
  origin?: "SCAN" | "MANUAL" | "SEED";
  createdById?: string | null;
  /** 新建时的分诊状态（call-up 挂在已知 SO 下 → HISTORY） */
  initialTriage?: string;
  /** 人工导入：证据类型 / 官方性覆盖（人工导入不标官方） */
  evidenceOverride?: { sourceType: string; isOfficial: boolean; summary: string };
}): Promise<UpsertOutcome> {
  const { orgId, record: r, now } = input;
  const num = normalizeInstrumentNumber(r.officialNumber);
  if (!num.normalized) {
    return { instrumentId: null, created: false, evidenceChanged: false, evidenceCreated: false, deferred: false, flaggedForReview: false };
  }
  const inst = procuringInstitutionOf(r);
  const dedupeKey = buildInstrumentDedupeKey({
    jurisdiction: r.jurisdiction,
    procuringEntityKey: inst.key,
    instrumentClass: r.instrumentClass,
    normalizedNumber: num.normalized,
  });
  const aliases: AliasEntry[] = [
    ...r.aliases.map((a) => ({ value: a.value, kind: a.kind, source: r.sourceType })),
    ...(num.raw !== num.normalized ? [{ value: num.raw, kind: "RAW_NUMBER", source: r.sourceType }] : []),
  ];

  let instrument = await db.procurementInstrument.findUnique({
    where: { orgId_dedupeKey: { orgId, dedupeKey } },
    select: { id: true, aliasesJson: true, title: true, parentInstrumentId: true, contractingInstitution: true, buyingInstitution: true },
  });
  let created = false;
  let flagged = false;

  // 父 SO（call-up）
  let parentId: string | null = null;
  if (r.parentNumber) {
    const parentNorm = normalizeInstrumentNumber(r.parentNumber).normalized;
    const parent = await db.procurementInstrument.findFirst({
      where: { orgId, normalizedNumber: parentNorm, instrumentClass: "AWARD_INSTRUMENT" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    parentId = parent?.id ?? null;
  }

  if (!instrument) {
    if (!input.allowCreate) {
      return { instrumentId: null, created: false, evidenceChanged: false, evidenceCreated: false, deferred: true, flaggedForReview: false };
    }
    // 同号同类、机构键不同 → 无法确定别名时标人工复核（不合并）
    const sameNumber = await db.procurementInstrument.findFirst({
      where: { orgId, normalizedNumber: num.normalized, instrumentClass: r.instrumentClass, jurisdiction: r.jurisdiction },
      select: { id: true, procuringEntityKey: true },
    });
    let possibleDuplicateOfId: string | null = null;
    if (sameNumber) {
      const other: InstitutionKey = { key: sameNumber.procuringEntityKey, mapped: !sameNumber.procuringEntityKey.startsWith("RAW:") && sameNumber.procuringEntityKey !== "UNKNOWN" };
      if (needsInstitutionReview(inst, other)) {
        possibleDuplicateOfId = sameNumber.id;
        flagged = true;
      }
    }
    try {
      instrument = await db.procurementInstrument.create({
        data: {
          orgId,
          jurisdiction: r.jurisdiction,
          instrumentClass: r.instrumentClass,
          instrumentSubtype: r.instrumentSubtype,
          officialNumber: num.raw,
          normalizedNumber: num.normalized,
          procuringEntityKey: inst.key,
          dedupeKey,
          title: r.title?.slice(0, 500) ?? null,
          aliasesJson: aliases as unknown as Prisma.InputJsonValue,
          contractingInstitution: r.contractingInstitution,
          buyingInstitution: r.buyingInstitution,
          vendorName: r.vendorName,
          publishedAt: d(r.publishedAt),
          closingAt: d(r.closingAt),
          awardDate: d(r.awardDate),
          contractValue: r.contractValue,
          contractValueBasis: r.contractValue ? "DISCLOSED_CONTRACT_VALUE" : null,
          currency: r.currency,
          parentInstrumentId: parentId,
          possibleDuplicateOfId,
          triageStatus: input.initialTriage ?? "CANDIDATE",
          matchJson: input.match ? ({ ...input.match, parentNumber: r.parentNumber } as unknown as Prisma.InputJsonValue) : undefined,
          firstSeenRunId: input.runId,
          firstSeenAt: now,
          lastVerifiedAt: now,
          origin: input.origin ?? "SCAN",
          createdById: input.createdById ?? null,
        },
        select: { id: true, aliasesJson: true, title: true, parentInstrumentId: true, contractingInstitution: true, buyingInstitution: true },
      });
      created = true;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      instrument = await db.procurementInstrument.findUnique({
        where: { orgId_dedupeKey: { orgId, dedupeKey } },
        select: { id: true, aliasesJson: true, title: true, parentInstrumentId: true, contractingInstitution: true, buyingInstitution: true },
      });
      if (!instrument) throw err;
    }
  }

  const ev = await upsertEvidence({
    orgId,
    instrumentId: instrument.id,
    sourceType: input.evidenceOverride?.sourceType ?? r.sourceType,
    sourceKey: r.sourceKey,
    sourceRecordId: r.sourceRecordId,
    sourceUrl: r.sourceUrl,
    isOfficial: input.evidenceOverride ? input.evidenceOverride.isOfficial : true,
    contentHash: recordContentHash(r),
    publishedAt: d(r.publishedAt),
    parseStatus: "PARSED",
    normalizedJson: { ...r, raw: undefined } as unknown as Prisma.InputJsonValue,
    snapshotJson: r.raw as unknown as Prisma.InputJsonValue,
    summary: input.evidenceOverride?.summary ?? [r.title, r.vendorName, r.contractValue ? `公开合同值 ${r.contractValue} ${r.currency ?? ""}` : null].filter(Boolean).join(" · ").slice(0, 500),
    scanRunId: input.runId,
    now,
  });

  // 同一来源出现新修订（新修订号形成新证据行）也算采购工具发生变化
  const isNewAmendment = !created && ev.created && !!r.amendmentNumber && !/^0+$/.test(r.amendmentNumber);
  const evidenceChanged = ev.changed || isNewAmendment;

  if (!created) {
    // 只写非空来源字段；不覆盖用户维护字段
    const data: Prisma.ProcurementInstrumentUncheckedUpdateInput = {
      lastVerifiedAt: now,
      aliasesJson: mergeAliases(readAliases(instrument.aliasesJson), aliases) as unknown as Prisma.InputJsonValue,
    };
    if (!instrument.title && r.title) data.title = r.title.slice(0, 500);
    // 机构只补空：不同来源对同一合同的「报告部门」说法可能不同，不覆盖种子 / 用户核实值
    if (r.contractingInstitution && !instrument.contractingInstitution) data.contractingInstitution = r.contractingInstitution;
    if (r.buyingInstitution && !instrument.buyingInstitution) data.buyingInstitution = r.buyingInstitution;
    if (r.vendorName) data.vendorName = r.vendorName;
    if (r.publishedAt) data.publishedAt = d(r.publishedAt);
    if (r.closingAt) data.closingAt = d(r.closingAt);
    if (r.awardDate) data.awardDate = d(r.awardDate);
    if (r.contractValue) {
      data.contractValue = r.contractValue;
      data.contractValueBasis = "DISCLOSED_CONTRACT_VALUE";
      data.currency = r.currency;
    }
    if (parentId && !instrument.parentInstrumentId) data.parentInstrumentId = parentId;
    if (evidenceChanged) data.lastChangedAt = now;
    if (input.match) data.matchJson = { ...input.match, parentNumber: r.parentNumber } as unknown as Prisma.InputJsonValue;
    await db.procurementInstrument.update({ where: { id: instrument.id }, data });
  }

  if (parentId) {
    await upsertRelation({ orgId, fromInstrumentId: instrument.id, toInstrumentId: parentId, relation: "CALL_UP_OF", basis: `公开披露 standing_offer_number = ${r.parentNumber}` });
  }
  // 招标 ↔ 已知合同（合同别名里记有该招标号）
  if (r.instrumentClass === "SOLICITATION") {
    const awards = await db.procurementInstrument.findMany({
      where: { orgId, instrumentClass: "AWARD_INSTRUMENT" },
      select: { id: true, aliasesJson: true },
      take: 500,
    });
    for (const a of awards) {
      if (readAliases(a.aliasesJson).some((x) => x.kind === "SOLICITATION_NUMBER" && normalizeInstrumentNumber(x.value).normalized === num.normalized)) {
        await upsertRelation({ orgId, fromInstrumentId: instrument.id, toInstrumentId: a.id, relation: "SOLICITATION_FOR", basis: "合同记录中的招标号与本公告一致" });
      }
    }
  }

  return { instrumentId: instrument.id, created, evidenceChanged, evidenceCreated: ev.created, deferred: false, flaggedForReview: flagged };
}

export async function upsertRelation(input: { orgId: string; fromInstrumentId: string; toInstrumentId: string; relation: string; basis?: string; createdById?: string | null }) {
  if (input.fromInstrumentId === input.toInstrumentId) return;
  try {
    await db.procurementInstrumentRelation.upsert({
      where: { fromInstrumentId_toInstrumentId_relation: { fromInstrumentId: input.fromInstrumentId, toInstrumentId: input.toInstrumentId, relation: input.relation } },
      create: { orgId: input.orgId, fromInstrumentId: input.fromInstrumentId, toInstrumentId: input.toInstrumentId, relation: input.relation, basis: input.basis ?? null, createdById: input.createdById ?? null },
      update: {},
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}

/** ATI 摘要 → 证据（提到已知编号即挂到该采购工具；否则作为关键词相关的未挂靠证据） */
export async function recordAtiSummary(input: { orgId: string; summary: AtiSummary; known: KnownInstrumentRef[]; runId: string | null; now: Date }) {
  const s = input.summary;
  const target = input.known.find((k) => atiMentionsNumber(s.summaryEn, k.officialNumber));
  return upsertEvidence({
    orgId: input.orgId,
    instrumentId: target?.id ?? null,
    sourceType: "OPEN_CANADA_ATI_SUMMARIES",
    sourceKey: s.sourceKey,
    sourceRecordId: s.requestNumber,
    sourceUrl: s.sourceUrl,
    isOfficial: true,
    contentHash: stableHash({ ...s, sourceUrl: undefined }),
    publishedAt: null,
    parseStatus: "PARSED",
    normalizedJson: { ...s, raw: undefined } as unknown as Prisma.InputJsonValue,
    snapshotJson: s.raw as unknown as Prisma.InputJsonValue,
    summary: `${s.requestNumber} · ${s.ownerOrg ?? "未知机构"} · ${s.disposition ?? "处理结果未知"}${s.pages !== null ? ` · ${s.pages} 页` : ""}`,
    scanRunId: input.runId,
    now: input.now,
  });
}

/** 合同历史公开页快照（只记哈希；失败不写证据，只计入来源结果） */
export async function recordPageSnapshot(input: { orgId: string; snapshot: PageSnapshot; runId: string | null; now: Date }) {
  const s = input.snapshot;
  if (!s.digest) return null;
  const ev = await upsertEvidence({
    orgId: input.orgId,
    instrumentId: s.instrumentId,
    sourceType: "CANADABUYS_CONTRACT_HISTORY_PAGE",
    sourceKey: `contract-history:${s.url.toLowerCase()}`,
    sourceRecordId: null,
    sourceUrl: s.url,
    isOfficial: true,
    contentHash: s.digest,
    publishedAt: null,
    parseStatus: "PARTIAL",
    summary: "合同历史公开页快照（仅哈希，不解析字段；变化时请人工核对修订）",
    scanRunId: input.runId,
    now: input.now,
  });
  await db.procurementInstrument.update({
    where: { id: s.instrumentId },
    data: { lastVerifiedAt: input.now, ...(ev.changed ? { lastChangedAt: input.now } : {}) },
  });
  return ev;
}

/** 重算优先级（读证据与关系，确定性） */
export async function recomputePriority(instrumentId: string, now: Date) {
  const inst = await db.procurementInstrument.findUnique({
    where: { id: instrumentId },
    select: {
      id: true,
      orgId: true,
      normalizedNumber: true,
      matchJson: true,
      currentExpiryAt: true,
      closingAt: true,
      recordsHolderInstitution: true,
      recordsHolderBasis: true,
    },
  });
  if (!inst) return null;
  const [callUpCount, predecessor, atiCount, lineItems] = await Promise.all([
    db.procurementInstrument.count({ where: { orgId: inst.orgId, parentInstrumentId: inst.id } }),
    db.procurementInstrumentRelation.count({
      where: { orgId: inst.orgId, OR: [{ fromInstrumentId: inst.id }, { toInstrumentId: inst.id }], relation: { in: ["PREDECESSOR_OF", "RELATED_HISTORY"] } },
    }),
    db.procurementSourceEvidence.count({ where: { instrumentId: inst.id, sourceType: "OPEN_CANADA_ATI_SUMMARIES" } }),
    db.procurementLineItem.count({ where: { orgId: inst.orgId, instrumentNumber: inst.normalizedNumber, reviewStatus: "CONFIRMED" } }),
  ]);
  const m = (inst.matchJson ?? {}) as Partial<KeywordMatch>;
  const p = computePriority(
    {
      productHits: m.productHits ?? [],
      serviceHits: m.serviceHits ?? [],
      categoryHits: m.categoryHits ?? [],
      callUpCount,
      hasPredecessor: predecessor > 0,
      atiSummaryCount: atiCount,
      confirmedLineItemCount: lineItems,
      currentExpiryAt: inst.currentExpiryAt ? inst.currentExpiryAt.toISOString().slice(0, 10) : null,
      closingAt: inst.closingAt ? inst.closingAt.toISOString() : null,
      recordsHolderKnown: Boolean(inst.recordsHolderInstitution && inst.recordsHolderBasis),
    },
    now,
  );
  await db.procurementInstrument.update({
    where: { id: inst.id },
    data: { priorityJson: { ...p, computedAt: now.toISOString() } as unknown as Prisma.InputJsonValue },
  });
  return p;
}
