/**
 * CHAIN-3 进口线索——服务端（读视图 / 导入 / 别名裁决 / 加入供应商库）
 *
 * 纪律：
 * - 不发任何网络请求、不调模型：只解析用户贴进来的文字（数据源接口只有人工粘贴一种实现）。
 * - 每条挂上或待确认的记录存为一条 SupplierDiscoverySignal（平台 TRADE_DATA、来源「人工录入」），明细存后不改；
 *   挂上 / 待确认 / 否决每次读的时候按最新的人工裁决重新算——裁决不改信号。
 * - 别名裁决只追加进审计（每一对一条，按 [targetType, targetId] 查回，没有条数上限）；已裁决的再裁决 → 409。
 * - 加入供应商库：同名（规整后）的关联一家，没有才新建（来源 trade_data、邮箱留空）；线索经既有「关联供应商」流程关联。
 * - 并发：导入、裁决、加入供应商库各自在事务里拿 advisory lock。
 */

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { isT4AwardSchemaReady } from "@/lib/tender-intel/award-flags";
import { listOthersAwardsForBuyer } from "@/lib/tender-intel/sourcing-suggestions";
import { normalizeSupplierFacingCategory } from "@/lib/tender-rfq/build";
import { createImportLead, type ImportLead } from "@/lib/tender-competition/import-leads";
import { decideAlias, normalizeCompanyName, type AliasDecision } from "@/lib/tender-competition/company-identity";
import { groupProblems, type DateOrder, type GroupedProblem } from "./parse";
import { importLeadSourceNotesZh, manualPasteProvider } from "./provider";
import { candidatePairKeys, createImporterMatcher, uniqueWinnerNames } from "./match-pure";
import {
  IMPORT_LEADS_TEXT,
  aggregateByExporter,
  winnersStateMessage,
  type ExporterSummary,
  type ImportLeadsView,
  type LinkedSupplierRef,
  type MatchedLeadInput,
  type PendingSuggestionView,
  type WinnersState,
} from "./aggregate-pure";

export const IMPORT_LEAD_PLATFORM = "TRADE_DATA";
export const IMPORT_LEAD_KIND = "import_lead_v1";
export const IMPORT_LEADS_AUDIT_ACTION = "tender.import_leads_imported";
export const IMPORT_LEAD_ALIAS_AUDIT_ACTION = "tender.import_lead_alias_decided";
export const IMPORT_LEAD_SUPPLIER_AUDIT_ACTION = "tender.import_lead_supplier_added";
export const IMPORT_LEAD_ALIAS_TARGET = "import_lead_alias";
export const TRADE_DATA_SUPPLIER_SOURCE = "trade_data";
/** 一个项目最多存这么多条进口记录（10 批满额导入）；到了上限拒绝再导入，读视图也只到这么多 */
export const MAX_PROJECT_LEADS = 5000;
const EVIDENCE_BACKED = new Set(["HUMAN_CONFIRMED", "SYSTEM_VERIFIED"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Tx = Prisma.TransactionClient;

export function aliasTargetId(pairKey: string): string {
  return `alias:${createHash("sha256").update(pairKey).digest("hex").slice(0, 32)}`;
}

async function advisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS l`;
}

/* ---------------------------------- 读：中标者 / 裁决 / 线索 ---------------------------------- */

/** 本项目采购方的历史中标者：他人授标（剔除我方结果），有效且有依据的中标方，按规整后名称去重 */
export async function loadProjectWinners(orgId: string, buyer: string | null): Promise<WinnersState> {
  if (!isT4AwardSchemaReady()) return { status: "not_connected", messageZh: winnersStateMessage("not_connected") };
  if (!buyer?.trim()) return { status: "no_buyer", messageZh: winnersStateMessage("no_buyer") };
  try {
    const { rows } = await listOthersAwardsForBuyer(orgId, buyer);
    const names = uniqueWinnerNames(rows.filter((r) => r.status === "ACTIVE" && EVIDENCE_BACKED.has(r.verificationStatus)).map((r) => r.winnerName));
    return names.length ? { status: "ok", names } : { status: "none", messageZh: winnersStateMessage("none") };
  } catch (err) {
    console.warn("[import-leads] winners unavailable:", err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200));
    return { status: "unavailable", messageZh: winnersStateMessage("unavailable") };
  }
}

function parseDecision(afterData: string | null, pairKey: string): AliasDecision | null {
  try {
    const d = JSON.parse(afterData ?? "") as Partial<AliasDecision>;
    if (d.pairKey !== pairKey || (d.decision !== "CONFIRMED" && d.decision !== "REJECTED")) return null;
    return { pairKey: d.pairKey, nameA: String(d.nameA ?? ""), nameB: String(d.nameB ?? ""), decision: d.decision, decidedBy: String(d.decidedBy ?? ""), decidedAt: String(d.decidedAt ?? "") };
  } catch {
    return null;
  }
}

/** 按对查回最新的裁决（没有条数上限：只查这几对） */
async function loadDecisions(client: Tx | typeof db, orgId: string, pairKeys: readonly string[]): Promise<AliasDecision[]> {
  if (!pairKeys.length) return [];
  const byTarget = new Map(pairKeys.map((k) => [aliasTargetId(k), k]));
  const rows = await client.auditLog.findMany({
    where: { orgId, action: IMPORT_LEAD_ALIAS_AUDIT_ACTION, targetType: IMPORT_LEAD_ALIAS_TARGET, targetId: { in: [...byTarget.keys()] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { targetId: true, afterData: true },
  });
  const out = new Map<string, AliasDecision>();
  for (const r of rows) {
    const pairKey = r.targetId ? byTarget.get(r.targetId) : undefined;
    if (!pairKey || out.has(pairKey)) continue;
    const d = parseDecision(r.afterData, pairKey);
    if (d) out.set(pairKey, d);
  }
  return [...out.values()];
}

type LeadMeta = {
  kind: string;
  lead: ImportLead;
  importerRaw: string;
  quantityRaw: string | null;
  sourceUrlRaw: string | null;
  dedupeKey: string;
  batchId: string;
  sourceLabel: string | null;
};

type LeadSignal = {
  id: string;
  status: string;
  meta: LeadMeta;
  linkedSupplier: LinkedSupplierRef | null;
};

function readMeta(raw: unknown): LeadMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<LeadMeta>;
  if (m.kind !== IMPORT_LEAD_KIND || !m.lead || typeof m.importerRaw !== "string" || typeof m.dedupeKey !== "string") return null;
  return m as LeadMeta;
}

async function loadLeadSignals(client: Tx | typeof db, orgId: string, projectId: string): Promise<LeadSignal[]> {
  const rows = await client.supplierDiscoverySignal.findMany({
    where: { orgId, projectId, platform: IMPORT_LEAD_PLATFORM },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_PROJECT_LEADS,
    select: { id: true, status: true, rawMetadataJson: true, linkedSupplier: { select: { id: true, name: true, contactEmail: true, status: true } } },
  });
  const out: LeadSignal[] = [];
  for (const r of rows) {
    const meta = readMeta(r.rawMetadataJson);
    if (!meta) continue;
    const s = r.linkedSupplier;
    out.push({
      id: r.id,
      status: r.status,
      meta,
      linkedSupplier: s ? { id: s.id, name: s.name, hasEmail: !!s.contactEmail && EMAIL_RE.test(s.contactEmail), active: s.status === "active" } : null,
    });
  }
  return out;
}

/** 本项目当前那份分析里已确认、面向供应商的要求原文（汇总时比关键词） */
async function loadRequirementTexts(orgId: string, projectId: string): Promise<string[]> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId, orgId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: { requirements: { select: { category: true, originalRequirement: true, reviewStatus: true } } },
  });
  return (run?.requirements ?? [])
    .filter((r) => r.reviewStatus === "CONFIRMED" && normalizeSupplierFacingCategory(r.category) !== null)
    .map((r) => r.originalRequirement ?? "")
    .filter(Boolean);
}

type Classified = {
  matched: Array<LeadSignal & { winners: string[] }>;
  suggestions: PendingSuggestionView[];
};

/** 按当前中标者与最新裁决给每条线索归类（在供应链页被驳回的不算）；同一个进口商只比一次 */
function classify(signals: readonly LeadSignal[], winners: readonly string[], decisions: readonly AliasDecision[]): Classified {
  const matched: Classified["matched"] = [];
  const pending = new Map<string, PendingSuggestionView>();
  const match = createImporterMatcher(winners, decisions);
  for (const s of signals) {
    if (s.status === "REJECTED") continue;
    const m = match(s.meta.importerRaw);
    if (m.status === "MATCHED") matched.push({ ...s, winners: m.winners });
    else if (m.status === "SUGGESTED") {
      for (const sg of m.suggestions) {
        const cur = pending.get(sg.pairKey) ?? { pairKey: sg.pairKey, importerName: s.meta.importerRaw, winnerName: sg.winnerName, basisZh: sg.basisZh, recordCount: 0 };
        cur.recordCount += 1;
        pending.set(sg.pairKey, cur);
      }
    }
  }
  return { matched, suggestions: [...pending.values()] };
}

type ProjectState = {
  project: { clientOrganization: string | null };
  winners: WinnersState;
  signals: LeadSignal[];
  decisions: AliasDecision[];
  classified: Classified;
  exporters: ExporterSummary[];
};

async function loadProjectState(orgId: string, projectId: string, now: Date): Promise<ProjectState> {
  const project = await db.project.findFirst({ where: { id: projectId, orgId }, select: { clientOrganization: true } });
  const [winners, signals, requirementTexts] = await Promise.all([
    loadProjectWinners(orgId, project?.clientOrganization ?? null),
    loadLeadSignals(db, orgId, projectId),
    loadRequirementTexts(orgId, projectId),
  ]);
  const winnerNames = winners.status === "ok" ? winners.names : [];
  const decisions = await loadDecisions(db, orgId, candidatePairKeys(signals.map((s) => s.meta.importerRaw), winnerNames));
  const classified = winners.status === "ok" ? classify(signals, winnerNames, decisions) : { matched: [], suggestions: [] };
  const leads: MatchedLeadInput[] = classified.matched.map((s) => ({
    exporterName: s.meta.lead.exporterName,
    shipmentDate: s.meta.lead.shipmentDate,
    goods: s.meta.lead.goodsDescription,
    winners: s.winners,
    linkedSupplier: s.linkedSupplier,
    linkable: !s.linkedSupplier && (s.status === "NEW" || s.status === "REVIEWED"),
  }));
  return { project: { clientOrganization: project?.clientOrganization ?? null }, winners, signals, decisions, classified, exporters: aggregateByExporter(leads, { now, requirementTexts }) };
}

function toView(state: ProjectState, canEdit: boolean): ImportLeadsView {
  return {
    caveatZh: IMPORT_LEADS_TEXT.caveat,
    leadStatusZh: IMPORT_LEADS_TEXT.leadStatus,
    sourceNotesZh: importLeadSourceNotesZh(),
    winners: state.winners,
    suggestions: state.classified.suggestions,
    exporters: state.exporters,
    leadCount: state.classified.matched.length,
    storedLeadCount: state.signals.filter((s) => s.status !== "REJECTED").length,
    canEdit,
  };
}

export async function loadImportLeadsView(input: { orgId: string; projectId: string; canEdit: boolean; now?: Date }): Promise<ImportLeadsView> {
  return toView(await loadProjectState(input.orgId, input.projectId, input.now ?? new Date()), input.canEdit);
}

/* ---------------------------------- 导入 ---------------------------------- */

export type ImportResult = {
  totalRecords: number;
  problemRecords: number;
  imported: number;
  matched: number;
  suggested: number;
  duplicates: number;
  unrelated: number;
  unrelatedImporters: string[];
  problems: GroupedProblem[];
};

export type ServiceFailure = { ok: false; status: 400 | 404 | 409 | 422; code: string; messageZh: string };

export async function importLeads(input: {
  orgId: string;
  projectId: string;
  userId: string;
  text: string;
  sourceLabel: string | null;
  dateOrder: DateOrder | null;
  now?: Date;
}): Promise<{ ok: true; result: ImportResult; view: ImportLeadsView } | ServiceFailure> {
  const now = input.now ?? new Date();
  const project = await db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { clientOrganization: true } });
  const winners = await loadProjectWinners(input.orgId, project?.clientOrganization ?? null);
  if (winners.status !== "ok") return { ok: false, status: 422, code: "NO_WINNERS", messageZh: winners.messageZh };

  const parsed = manualPasteProvider.collect({ text: input.text, sourceLabel: input.sourceLabel, dateOrder: input.dateOrder, now });
  if (!parsed.ok) return { ok: false, status: 400, code: parsed.code, messageZh: parsed.messageZh };

  const batchId = randomUUID();
  const sourceLabel = input.sourceLabel?.trim().slice(0, 200) || null;
  const counts = { imported: 0, matched: 0, suggested: 0, existing: 0, unrelated: 0 };
  const unrelatedNames: string[] = [];

  // 比对在事务外做（只吃这一批的进口商与这几对的裁决；事务里只查重与写入）
  const decisions = await loadDecisions(db, input.orgId, candidatePairKeys(parsed.records.map((r) => r.importer), winners.names));
  const match = createImporterMatcher(winners.names, decisions);
  const candidates: Array<{ record: (typeof parsed.records)[number]; status: "MATCHED" | "SUGGESTED" }> = [];
  for (const r of parsed.records) {
    const m = match(r.importer);
    if (m.status === "UNRELATED") {
      counts.unrelated += 1;
      if (unrelatedNames.length < 10 && !unrelatedNames.some((n) => normalizeCompanyName(n) === normalizeCompanyName(r.importer))) unrelatedNames.push(r.importer);
      continue;
    }
    candidates.push({ record: r, status: m.status });
  }

  const capHit = await db.$transaction(
    async (tx) => {
      // 连点两次导入：第二次等第一次写完再查重，不会写出重复
      await advisoryLock(tx, `import-leads:${input.orgId}:${input.projectId}`);
      const keys = candidates.map((c) => c.record.dedupeKey);
      const existingRows = keys.length
        ? await tx.$queryRaw<Array<{ k: string | null }>>`SELECT "rawMetadataJson"->>'dedupeKey' AS k FROM "SupplierDiscoverySignal" WHERE "orgId" = ${input.orgId} AND "projectId" = ${input.projectId} AND "platform" = ${IMPORT_LEAD_PLATFORM} AND "rawMetadataJson"->>'dedupeKey' = ANY(${keys}::text[])`
        : [];
      const existing = new Set(existingRows.map((r) => r.k).filter((k): k is string => !!k));
      const fresh = candidates.filter((c) => !existing.has(c.record.dedupeKey));
      counts.existing = candidates.length - fresh.length;
      const stored = await tx.supplierDiscoverySignal.count({ where: { orgId: input.orgId, projectId: input.projectId, platform: IMPORT_LEAD_PLATFORM } });
      if (stored + fresh.length > MAX_PROJECT_LEADS) return stored;
      const rows: Prisma.SupplierDiscoverySignalCreateManyInput[] = [];
      for (const { record: r, status } of fresh) {
        const made = createImportLead(
          { importerName: r.importer, exporterName: r.exporter, sourceKind: manualPasteProvider.sourceKind, providerLabel: sourceLabel, capturedAt: now.toISOString(), shipmentDate: r.shipmentDate, goodsDescription: r.goods, evidenceRef: r.evidenceRef },
          now,
        );
        // 解析已校验过这些字段；万一不过，不写半条
        if (!made.ok) continue;
        const meta: LeadMeta = { kind: IMPORT_LEAD_KIND, lead: made.lead, importerRaw: r.importer, quantityRaw: r.quantityRaw, sourceUrlRaw: r.sourceUrlRaw, dedupeKey: r.dedupeKey, batchId, sourceLabel };
        rows.push({
          orgId: input.orgId,
          projectId: input.projectId,
          platform: IMPORT_LEAD_PLATFORM,
          contentType: "USER_SUBMITTED",
          sourceOrigin: "MANUAL_ENTRY",
          accountName: r.exporter,
          contentUrl: r.sourceUrlLink,
          title: `${r.exporter} → ${r.importer}`.slice(0, 500),
          description: r.goods,
          rawMetadataJson: meta as unknown as Prisma.InputJsonValue,
          status: "NEW",
        });
        counts.imported += 1;
        if (status === "MATCHED") counts.matched += 1;
        else counts.suggested += 1;
      }
      if (rows.length) await tx.supplierDiscoverySignal.createMany({ data: rows });
      return null;
    },
    { timeout: 30_000 },
  );
  if (capHit !== null) return { ok: false, status: 422, code: "LEAD_CAP", messageZh: IMPORT_LEADS_TEXT.leadCap(capHit, MAX_PROJECT_LEADS) };

  const result: ImportResult = {
    totalRecords: parsed.totalRecords,
    problemRecords: parsed.problems.length,
    imported: counts.imported,
    matched: counts.matched,
    suggested: counts.suggested,
    duplicates: parsed.duplicatesInBatch + counts.existing,
    unrelated: counts.unrelated,
    unrelatedImporters: unrelatedNames,
    problems: groupProblems(parsed.problems),
  };
  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    action: IMPORT_LEADS_AUDIT_ACTION,
    targetType: "project",
    targetId: input.projectId,
    afterData: { batchId, imported: result.imported, matched: result.matched, suggested: result.suggested, duplicates: result.duplicates, unrelated: result.unrelated, problemRecords: parsed.problems.length, totalRecords: parsed.totalRecords, sourceLabel },
  });
  return { ok: true, result, view: await loadImportLeadsView({ orgId: input.orgId, projectId: input.projectId, canEdit: true, now }) };
}

/* ---------------------------------- 别名裁决 ---------------------------------- */

export async function decideImportLeadAlias(input: {
  orgId: string;
  projectId: string;
  userId: string;
  pairKey: string;
  decision: "CONFIRMED" | "REJECTED";
  now?: Date;
}): Promise<{ ok: true; view: ImportLeadsView } | ServiceFailure> {
  const now = input.now ?? new Date();
  const state = await loadProjectState(input.orgId, input.projectId, now);
  const pending = state.classified.suggestions.find((s) => s.pairKey === input.pairKey);
  if (!pending) {
    const decided = (await loadDecisions(db, input.orgId, [input.pairKey])).length > 0;
    return decided
      ? { ok: false, status: 409, code: "ALREADY_DECIDED", messageZh: IMPORT_LEADS_TEXT.aliasConflict }
      : { ok: false, status: 404, code: "NOT_PENDING", messageZh: IMPORT_LEADS_TEXT.aliasNotPending };
  }
  const decided = decideAlias({ pairKey: pending.pairKey, nameA: pending.importerName, nameB: pending.winnerName }, { decision: input.decision, decidedBy: input.userId, decidedAt: now.toISOString() });
  if (!decided.ok) return { ok: false, status: 400, code: decided.code, messageZh: decided.messageZh };

  const targetId = aliasTargetId(pending.pairKey);
  const written = await db.$transaction(async (tx) => {
    await advisoryLock(tx, `import-lead-alias:${input.orgId}:${targetId}`);
    if ((await loadDecisions(tx, input.orgId, [pending.pairKey])).length > 0) return false;
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        orgId: input.orgId,
        projectId: input.projectId,
        action: IMPORT_LEAD_ALIAS_AUDIT_ACTION,
        targetType: IMPORT_LEAD_ALIAS_TARGET,
        targetId,
        afterData: JSON.stringify(decided.decision),
      },
    });
    return true;
  });
  if (!written) return { ok: false, status: 409, code: "ALREADY_DECIDED", messageZh: IMPORT_LEADS_TEXT.aliasConflict };
  return { ok: true, view: await loadImportLeadsView({ orgId: input.orgId, projectId: input.projectId, canEdit: true, now }) };
}

/* ---------------------------------- 加入供应商库 ---------------------------------- */

export type AddSupplierResult = {
  supplier: { id: string; name: string; created: boolean; hasEmail: boolean; active: boolean };
  linkedLeads: number;
  messageZh: string;
};

export async function addImportLeadSupplier(input: {
  orgId: string;
  projectId: string;
  userId: string;
  exporterKey: string;
  now?: Date;
}): Promise<{ ok: true; result: AddSupplierResult; view: ImportLeadsView } | ServiceFailure> {
  const now = input.now ?? new Date();
  const state = await loadProjectState(input.orgId, input.projectId, now);
  const exporter = state.exporters.find((e) => e.exporterKey === input.exporterKey);
  if (!exporter) return { ok: false, status: 404, code: "NOT_IN_SUMMARY", messageZh: IMPORT_LEADS_TEXT.exporterNotInSummary };
  const mine = state.classified.matched.filter((s) => normalizeCompanyName(s.meta.lead.exporterName) === exporter.exporterKey);
  const sourceLabel = mine.find((s) => s.meta.sourceLabel)?.meta.sourceLabel ?? null;

  const picked = await db.$transaction(async (tx) => {
    // 同一组织同一出口商连点两次：第二次等第一次建完，再按同名关联，不会建出两家
    await advisoryLock(tx, `import-lead-supplier:${input.orgId}:${exporter.exporterKey}`);
    // 这家出口商已有线索关联过供应商 → 就用那一家（「关联新导入的」走这里）
    const alreadyLinked = mine.find((m) => m.linkedSupplier)?.linkedSupplier;
    if (alreadyLinked) {
      const row = await tx.supplier.findFirst({ where: { id: alreadyLinked.id, orgId: input.orgId }, select: { id: true, name: true, contactEmail: true, status: true } });
      if (row) return { ...row, created: false };
    }
    // 规整后同名：按名称在本组织里全量比（库里没有规整名的列，也没有唯一约束；前缀筛会漏掉「&」、全角字、单字母等写法）
    const rows = await tx.supplier.findMany({ where: { orgId: input.orgId }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, contactEmail: true, status: true } });
    const same = rows.filter((r) => normalizeCompanyName(r.name) === exporter.exporterKey);
    const hasEmail = (r: { contactEmail: string | null }) => !!r.contactEmail && EMAIL_RE.test(r.contactEmail);
    const existing = same.find((r) => r.status === "active" && hasEmail(r)) ?? same.find((r) => r.status === "active") ?? same[0];
    if (existing) return { ...existing, created: false };
    const made = await tx.supplier.create({
      data: {
        orgId: input.orgId,
        name: exporter.exporterName,
        source: TRADE_DATA_SUPPLIER_SOURCE,
        sourceDetail: `进口线索：${exporter.winnerNames.join("、")} 的出口商${sourceLabel ? `（${sourceLabel}）` : ""}`.slice(0, 500),
        status: "active",
        contactEmail: null,
        createdById: input.userId,
      },
      select: { id: true, name: true, contactEmail: true, status: true },
    });
    return { ...made, created: true };
  });

  // 线索经既有「关联供应商」流程关联（状态机、行锁、resolutionJson、审计都按既有规则）；已关联 / 已驳回的不动
  const { linkSignalToSupplier } = await import("@/lib/supplier-intel/signal-service");
  let linkedLeads = 0;
  for (const s of mine) {
    if (s.status !== "NEW" && s.status !== "REVIEWED") continue;
    try {
      await linkSignalToSupplier({ orgId: input.orgId, userId: input.userId }, s.id, { supplierId: picked.id, note: "进口线索：加入供应商库" });
      linkedLeads += 1;
    } catch (err) {
      console.warn("[import-leads] link skipped:", err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200));
    }
  }

  const hasEmail = !!picked.contactEmail && EMAIL_RE.test(picked.contactEmail);
  const active = picked.status === "active";
  const messageZh = picked.created
    ? IMPORT_LEADS_TEXT.supplierCreated
    : `${IMPORT_LEADS_TEXT.supplierLinked(picked.name)}${active ? "" : IMPORT_LEADS_TEXT.supplierInactive}`;
  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    action: IMPORT_LEAD_SUPPLIER_AUDIT_ACTION,
    targetType: "supplier",
    targetId: picked.id,
    afterData: { supplierId: picked.id, created: picked.created, exporterName: exporter.exporterName, linkedLeads },
  });
  return {
    ok: true,
    result: { supplier: { id: picked.id, name: picked.name, created: picked.created, hasEmail, active }, linkedLeads, messageZh },
    view: await loadImportLeadsView({ orgId: input.orgId, projectId: input.projectId, canEdit: true, now }),
  };
}
