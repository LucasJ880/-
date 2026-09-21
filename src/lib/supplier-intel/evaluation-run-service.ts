/**
 * S4-A：评估运行（EVALUATION_ONLY）的编排——复用 SupplierSearchRun / SupplierCandidate /
 * SupplierRequirementMatch 三张既有表与 evaluation-service 的候选 / 匹配脊柱，**不建新模型**。
 *
 * 生命周期问题的裁决（任务书 §3–§4）：S3-A 的发现 Run 以 finalize=true 收口成 COMPLETED，
 * 而候选 / 匹配只能写进 RUNNING 的 Run。绝不 reopen 历史 Run；正式评估 = **新的** Run，
 * runMode=EVALUATION_ONLY 写在 sourceConfigJson（零 schema），provenance 可指回那次发现 Run。
 *
 * 顺序不变量：Auth（路由）→ 项目写权限 → canonical 需求服务端读取 → 冻结快照 → 建 Run。
 * 客户端到不了 requirements / mandatory / evaluationVersion / scoreVersion / originSource / requirementRefId。
 *
 * 评估运行**不外呼**：Tavily / Open Web / 社媒 / 内部发现全部 0 次。它评估的是已经确认的供应商。
 */

import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit/logger";
import { db } from "@/lib/db";
import { assertProjectAccessForActor, probeProjectAccess } from "./access";
import type { SupplierIntelActor } from "./actor";
import { loadCanonicalSupplierRequirementSnapshot } from "./canonical-requirements";
import {
  SUPPLIER_INTEL_AUDIT_ACTIONS,
  isRunTerminal,
  readRunMode,
} from "./constants";
import { suggestDeterministicMatch, type DeterministicSuggestion } from "./deterministic-match";
import { SupplierIntelError } from "./errors";
import {
  createRequirementMatch,
  createSupplierCandidate,
  type MatchEvidenceInput,
} from "./evaluation-service";
import { buildCandidateScoreSnapshot, readCommercialEvidenceBinding, type CandidateScoreSnapshot } from "./evaluation-scoring";
import { computeMandatoryGate, type GateOutcome } from "./mandatory-gate";
import { validateRequirementSnapshot, type RequirementSnapshotEntry } from "./requirement-snapshot";
import {
  RUN_WRITE_TX_OPTIONS,
  createSearchRun,
  failSearchRun,
  lockSupplierSearchRunForWrite,
  startSearchRun,
  updateRunWorkingData,
} from "./run-service";
import { assertSignalAccess, buildSignalListScopeFilter } from "./signal-scope";

const RUN_TARGET_TYPE = "supplier_search_run";
const CANDIDATE_TARGET_TYPE = "supplier_candidate";
const MATCH_TARGET_TYPE = "supplier_requirement_match";

/* ───────────────── 来源推导（服务端，不信客户端） ───────────────── */

/**
 * 候选的 originSource 由服务端从事实推导：
 *   1. 这家供应商在本项目的任一历史 Run 里已是候选 → 继承那条候选的 originSource；
 *   2. 否则本项目里有一条已人工 LINKED 到这家的线索 → NEW_DISCOVERY；
 *   3. 都没有 → 无法证明来源，fail closed（不随手填 SAVED / HISTORICAL_SUCCESS 让记录过关）。
 */
export async function deriveCandidateOriginSource(
  orgId: string,
  projectId: string,
  supplierId: string,
): Promise<{ originSource: string; basis: "INHERITED_CANDIDATE" | "LINKED_SIGNAL"; refId: string }> {
  const prior = await db.supplierCandidate.findFirst({
    where: { orgId, supplierId, searchRun: { is: { orgId, projectId } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, originSource: true },
  });
  if (prior) return { originSource: prior.originSource, basis: "INHERITED_CANDIDATE", refId: prior.id };

  const linked = await db.supplierDiscoverySignal.findFirst({
    where: {
      orgId,
      linkedSupplierId: supplierId,
      status: "LINKED",
      OR: [{ projectId }, { tenderId: projectId }, { searchRun: { is: { orgId, projectId } } }],
    },
    orderBy: { discoveredAt: "desc" },
    select: { id: true },
  });
  if (linked) return { originSource: "NEW_DISCOVERY", basis: "LINKED_SIGNAL", refId: linked.id };

  throw new SupplierIntelError(
    "ORIGIN_SOURCE_UNRESOLVED",
    "无法证明这家供应商与本项目的来源：它既没有出现在本项目的任何一次搜索结果里，也没有已人工关联到本项目的线索。请先在采购工作台把线索关联到它，再开始评估",
  );
}

/* ───────────────── 创建评估运行 ───────────────── */

export interface CreateEvaluationRunInput {
  projectId: string;
  supplierId: string;
  offeringId?: string | null;
  /** provenance：指回那次发现 Run（服务端核实同 org、同项目） */
  sourceDiscoveryRunId?: string | null;
  /**
   * FR1：采购人员确认「这张 RFQ 回复对应本次评估的 Offering」——这是证据选择，不是客户端宣称报价已核实。
   * 服务端重验：同 org / 同项目 / 同供应商 / 已确认报价；通过后冻结进 sourceConfigJson.commercialEvidenceBinding。
   * 为 null 时允许创建（Commercial 将为 UNKNOWN → NEEDS_VERIFICATION；1688 首轮的正常路径）。
   */
  commercialInquiryItemId?: string | null;
}

/** 服务端重验并构造冻结绑定；任何一项不成立 → COMMERCIAL_EVIDENCE_BINDING_INVALID（fail closed） */
async function resolveCommercialEvidenceBinding(actor: SupplierIntelActor, projectId: string, supplierId: string, offeringId: string | null, inquiryItemId: string) {
  if (!offeringId) throw new SupplierIntelError("COMMERCIAL_EVIDENCE_BINDING_INVALID", "绑定正式报价需要先选定具体产品（报价绑定到 Supplier × Offering）");
  const item = await db.inquiryItem.findFirst({
    where: { id: inquiryItemId, inquiry: { is: { projectId, project: { is: { orgId: actor.orgId } } } } },
    select: { id: true, supplierId: true, status: true, repliedAt: true, unitPrice: true, totalPrice: true, inquiry: { select: { id: true, roundNumber: true, scope: true } } },
  });
  if (!item) throw new SupplierIntelError("COMMERCIAL_EVIDENCE_BINDING_INVALID", "该报价不属于本项目（或不存在）");
  if (item.supplierId !== supplierId) throw new SupplierIntelError("COMMERCIAL_EVIDENCE_BINDING_INVALID", "该报价不是这家供应商的");
  const confirmed = item.repliedAt !== null && ((item.totalPrice !== null && Number(item.totalPrice) > 0) || (item.unitPrice !== null && Number(item.unitPrice) > 0));
  if (!confirmed) throw new SupplierIntelError("COMMERCIAL_EVIDENCE_BINDING_INVALID", "该报价尚未回复或没有价格，不能作为正式商务证据");
  return { inquiryId: item.inquiry.id, inquiryItemId: item.id, supplierId: item.supplierId, offeringId, roundNumber: item.inquiry.roundNumber, scope: item.inquiry.scope ?? null, confirmedByUserId: actor.userId };
}

/** 本项目里这家供应商的已确认报价（给「开始评估」的绑定选择器用；服务端过项目读权限） */
export async function listCommercialEvidenceOptions(actor: SupplierIntelActor, projectId: string, supplierId: string) {
  await assertProjectAccessForActor(actor, projectId, "read");
  const items = await db.inquiryItem.findMany({
    where: { supplierId, inquiry: { is: { projectId, project: { is: { orgId: actor.orgId } } } } },
    select: { id: true, status: true, repliedAt: true, unitPrice: true, totalPrice: true, currency: true, deliveryDays: true, validUntil: true, inquiry: { select: { id: true, roundNumber: true, scope: true } } },
    orderBy: [{ inquiry: { roundNumber: "desc" } }, { repliedAt: "desc" }],
  });
  return items
    .filter((it) => it.repliedAt !== null && ((it.totalPrice !== null && Number(it.totalPrice) > 0) || (it.unitPrice !== null && Number(it.unitPrice) > 0)))
    .map((it) => ({
      inquiryItemId: it.id, inquiryId: it.inquiry.id, roundNumber: it.inquiry.roundNumber, scope: it.inquiry.scope ?? null, status: it.status,
      repliedAt: it.repliedAt ? it.repliedAt.toISOString() : null, currency: it.currency,
      totalPrice: it.totalPrice !== null ? it.totalPrice.toString() : null, unitPrice: it.unitPrice !== null ? it.unitPrice.toString() : null,
      deliveryDays: it.deliveryDays ?? null, validUntil: it.validUntil ? it.validUntil.toISOString() : null,
    }));
}

export async function createProjectEvaluationRun(
  actor: SupplierIntelActor,
  input: CreateEvaluationRunInput,
) {
  const projectId = input.projectId?.trim();
  const supplierId = input.supplierId?.trim();
  if (!projectId || !supplierId) throw new SupplierIntelError("INVALID_INPUT", "projectId / supplierId 必填");

  // 顺序不变量：项目写权限 → canonical 需求（fail closed）→ 其它校验 → 建 Run
  await assertProjectAccessForActor(actor, projectId, "write");
  const canonical = await loadCanonicalSupplierRequirementSnapshot({ orgId: actor.orgId, projectId });

  const supplier = await db.supplier.findFirst({ where: { id: supplierId, orgId: actor.orgId }, select: { id: true, name: true } });
  if (!supplier) throw new SupplierIntelError("NOT_FOUND", "供应商不存在");
  const offeringId = input.offeringId?.trim() || null;
  if (offeringId) {
    const off = await db.supplierOffering.findFirst({ where: { id: offeringId, orgId: actor.orgId }, select: { supplierId: true } });
    if (!off) throw new SupplierIntelError("NOT_FOUND", "产品/报盘不存在");
    if (off.supplierId !== supplier.id) throw new SupplierIntelError("OFFERING_SUPPLIER_MISMATCH", "offering 不属于该供应商");
  }

  let sourceDiscoveryRunId: string | null = null;
  if (input.sourceDiscoveryRunId?.trim()) {
    const src = await db.supplierSearchRun.findFirst({
      where: { id: input.sourceDiscoveryRunId.trim(), orgId: actor.orgId },
      select: { id: true, projectId: true },
    });
    // 指针只是 provenance；对不上事实就不记（不报错也不泄露它是否存在）
    if (src && src.projectId === projectId) sourceDiscoveryRunId = src.id;
  }

  const origin = await deriveCandidateOriginSource(actor.orgId, projectId, supplier.id);

  // FR1：正式报价绑定（可选）——服务端重验后冻结；客户端只能给一个 id
  const commercialEvidenceBinding = input.commercialInquiryItemId?.trim()
    ? await resolveCommercialEvidenceBinding(actor, projectId, supplier.id, offeringId, input.commercialInquiryItemId.trim())
    : null;

  const run = await createSearchRun(actor, {
    projectId,
    brief: {
      runMode: "EVALUATION_ONLY",
      purpose: "正式评估已确认的供应商 × 产品，对照本项目的 canonical 需求快照；不搜索新供应商",
      supplierId: supplier.id,
      supplierName: supplier.name,
      offeringId,
      requirementCount: canonical.entries.length,
    },
    requirements: canonical.entries,
    sourceConfig: {
      runMode: "EVALUATION_ONLY",
      provider: null,
      providerAvailable: false,
      internalAdapters: [],
      adapters: [],
      sourceDiscoveryRunId,
      commercialEvidenceBinding,
      canonicalAnalysisRunId: canonical.analysisRunId,
      canonicalAnalysisRunStatus: canonical.analysisRunStatus,
      canonicalUncertainCount: canonical.uncertainCount,
      canonicalUncertainSourceStatus: canonical.uncertainSourceStatus,
      canonicalUncertainSourceReason: canonical.uncertainSourceReason,
    },
  });
  await writeAuditLog(db, {
    userId: actor.userId,
    orgId: actor.orgId,
    projectId,
    action: SUPPLIER_INTEL_AUDIT_ACTIONS.EVALUATION_RUN_CREATED,
    targetType: RUN_TARGET_TYPE,
    targetId: run.id,
    afterData: { runMode: "EVALUATION_ONLY", supplierId: supplier.id, offeringId, sourceDiscoveryRunId, originSource: origin.originSource, originBasis: origin.basis, commercialEvidenceBinding: commercialEvidenceBinding ? { inquiryId: commercialEvidenceBinding.inquiryId, inquiryItemId: commercialEvidenceBinding.inquiryItemId, roundNumber: commercialEvidenceBinding.roundNumber } : null },
  });

  await startSearchRun(actor, run.id);
  await updateRunWorkingData(actor, run.id, {
    statusDetail: { status: "evaluating", runMode: "EVALUATION_ONLY", sources: {} },
  });

  let candidate;
  try {
    candidate = await createSupplierCandidate(actor, {
      searchRunId: run.id,
      supplierId: supplier.id,
      offeringId,
      originSource: origin.originSource,
      discoveryConfidence: { originBasis: origin.basis, originRefId: origin.refId },
    });
  } catch (err) {
    // §29：部分写入后失败——保留审计，Run 记为 FAILED，不偷偷删
    await failSearchRun(actor, run.id, `候选创建失败：${err instanceof Error ? err.message : String(err)}`, {
      status: "error",
      runMode: "EVALUATION_ONLY",
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  return { run: await db.supplierSearchRun.findFirstOrThrow({ where: { id: run.id } }), candidate };
}

/* ───────────────── 共用：读候选 + 其 Run，并过项目门 ───────────────── */

async function loadCandidateWithRun(actor: SupplierIntelActor, candidateId: string, level: "read" | "write") {
  const candidate = await db.supplierCandidate.findFirst({
    where: { id: candidateId, orgId: actor.orgId },
    include: { searchRun: { select: { id: true, projectId: true, status: true, sourceConfigJson: true, requirementSnapshotJson: true, evaluationVersion: true } } },
  });
  if (!candidate || !candidate.searchRun.projectId) throw new SupplierIntelError("NOT_FOUND", "候选不存在");
  await assertProjectAccessForActor(actor, candidate.searchRun.projectId, level);
  if (readRunMode(candidate.searchRun.sourceConfigJson) !== "EVALUATION_ONLY") {
    throw new SupplierIntelError("RUN_MODE_MISMATCH", "该候选不属于评估运行；发现运行的候选不能在这里做正式匹配");
  }
  return candidate;
}

/* ───────────────── 人工匹配 ───────────────── */

export interface RecordEvaluationMatchInput {
  candidateId: string;
  requirementKey: string;
  verdict: string;
  evidence: MatchEvidenceInput[];
  explanation?: string | null;
}

/**
 * 人工判定入口。evaluatedBy 由服务端固定为 HUMAN（客户端声明不了 DETERMINISTIC / AI_ASSISTED）。
 * PASS / PARTIAL / FAIL 必须带证据；只有 UNKNOWN 允许空证据（记为资料待补）。
 * 档案证据必须属于本评估的项目；线索证据必须是本人读得到的（项目门），再由脊柱校验 LINKED 归属。
 */
export async function recordEvaluationMatch(actor: SupplierIntelActor, input: RecordEvaluationMatchInput) {
  const candidate = await loadCandidateWithRun(actor, input.candidateId, "write");
  const projectId = candidate.searchRun.projectId!;
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  if (input.verdict !== "UNKNOWN" && evidence.length === 0) {
    throw new SupplierIntelError("EVIDENCE_REQUIRED", `判定为 ${input.verdict} 必须附带证据；资料不足请选「资料不足」`);
  }
  for (const item of evidence) {
    if (item?.kind === "archive") {
      const row = await db.tenderArchiveItem.findFirst({ where: { id: item.archiveItemId?.trim() ?? "", orgId: actor.orgId }, select: { projectId: true } });
      if (!row) throw new SupplierIntelError("ARCHIVE_EVIDENCE_NOT_FOUND", "证据档案不存在");
      if (row.projectId !== projectId) throw new SupplierIntelError("ARCHIVE_PROJECT_MISMATCH", "证据档案属于其它项目，不能支撑本项目的评估");
    } else if (item?.kind === "signal") {
      await assertSignalAccess(actor, item.signalId, "read");
    }
  }
  const match = await createRequirementMatch(actor, {
    candidateId: candidate.id,
    requirementKey: input.requirementKey,
    verdict: input.verdict,
    evidence,
    explanation: input.explanation ?? null,
    evaluatedBy: "HUMAN",
  });
  await writeAuditLog(db, {
    userId: actor.userId,
    orgId: actor.orgId,
    projectId,
    action: SUPPLIER_INTEL_AUDIT_ACTIONS.REQUIREMENT_MATCH_CREATED,
    targetType: MATCH_TARGET_TYPE,
    targetId: match.id,
    afterData: { candidateId: candidate.id, requirementKey: match.requirementKey, verdict: match.verdict, evaluatedBy: "HUMAN", evidenceCount: evidence.length, previousGateResult: candidate.mandatoryGateResult, gateInvalidated: candidate.mandatoryGateResult !== "PENDING" },
  });
  return match;
}

/* ───────────────── 确定性匹配（Layer 1） ───────────────── */

function readOfferingAttributes(offeringSnapshotJson: unknown): Record<string, unknown> | null {
  if (typeof offeringSnapshotJson !== "object" || offeringSnapshotJson === null) return null;
  const a = (offeringSnapshotJson as { attributes?: unknown }).attributes;
  return typeof a === "object" && a !== null && !Array.isArray(a) ? (a as Record<string, unknown>) : null;
}

async function loadSupplierCertsForRules(orgId: string, supplierId: string) {
  const rows = await db.supplierCertification.findMany({
    where: { orgId, supplierId },
    select: { id: true, certificationType: true, scope: true, offeringId: true, status: true, validFrom: true, expiresAt: true },
  });
  return rows.map((c) => ({ ...c, validFrom: c.validFrom ? c.validFrom.toISOString() : null, expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null }));
}

/** 只读：给视图看的规则建议（不写库） */
export async function suggestDeterministicMatches(
  actor: SupplierIntelActor,
  candidateId: string,
): Promise<Record<string, DeterministicSuggestion>> {
  const candidate = await loadCandidateWithRun(actor, candidateId, "read");
  const entries = validateRequirementSnapshot(candidate.searchRun.requirementSnapshotJson);
  const certs = await loadSupplierCertsForRules(actor.orgId, candidate.supplierId);
  const now = new Date();
  const out: Record<string, DeterministicSuggestion> = {};
  for (const e of entries) {
    const s = suggestDeterministicMatch(e, { offeringId: candidate.offeringId, offeringAttributes: readOfferingAttributes(candidate.offeringSnapshotJson) }, certs, now);
    if (s) out[e.code] = s;
  }
  return out;
}

/** 把规则建议写成正式 Match：verdict / 证据 / 说明全部由服务端重新计算，不信客户端带来的任何值 */
export async function applyDeterministicMatch(actor: SupplierIntelActor, input: { candidateId: string; requirementKey: string }) {
  const candidate = await loadCandidateWithRun(actor, input.candidateId, "write");
  const entries = validateRequirementSnapshot(candidate.searchRun.requirementSnapshotJson);
  const entry = entries.find((e) => e.code === input.requirementKey.trim());
  if (!entry) throw new SupplierIntelError("REQUIREMENT_KEY_NOT_IN_SNAPSHOT", `requirementKey 不在本 Run 的需求快照中：${input.requirementKey}`);
  const certs = await loadSupplierCertsForRules(actor.orgId, candidate.supplierId);
  const suggestion = suggestDeterministicMatch(entry, { offeringId: candidate.offeringId, offeringAttributes: readOfferingAttributes(candidate.offeringSnapshotJson) }, certs, new Date());
  if (!suggestion) throw new SupplierIntelError("NO_DETERMINISTIC_RULE", "这条要求没有可用的确定性规则，请人工判定");
  const match = await createRequirementMatch(actor, {
    candidateId: candidate.id,
    requirementKey: entry.code,
    verdict: suggestion.verdict,
    evidence: suggestion.evidence,
    explanation: suggestion.explanation,
    evaluatedBy: "DETERMINISTIC",
  });
  await writeAuditLog(db, {
    userId: actor.userId,
    orgId: actor.orgId,
    projectId: candidate.searchRun.projectId,
    action: SUPPLIER_INTEL_AUDIT_ACTIONS.REQUIREMENT_MATCH_CREATED,
    targetType: MATCH_TARGET_TYPE,
    targetId: match.id,
    afterData: { candidateId: candidate.id, requirementKey: match.requirementKey, verdict: match.verdict, evaluatedBy: "DETERMINISTIC", ruleId: suggestion.ruleId, previousGateResult: candidate.mandatoryGateResult, gateInvalidated: candidate.mandatoryGateResult !== "PENDING" },
  });
  return { match, suggestion };
}

/* ───────────────── 硬门计算（事务 + Run 锁） ───────────────── */

/**
 * 同一事务内：锁 Run → 必须 RUNNING → 读候选 → 读需求快照 → 读全部 Match → 纯函数计算 → 写候选。
 * 锁序沿用既有「Run 先于 Candidate」。与 Match 写入、Run 收口互相串行，
 * 不会出现「门算成 PASS 但同时有一条 mandatory Match 正在写入」。
 * 幂等：同输入同结果；候选只有一份门快照（覆盖，不产生第二个历史对象）；终态 Run 拒绝重算。
 */
export async function computeCandidateMandatoryGate(actor: SupplierIntelActor, candidateId: string): Promise<GateOutcome> {
  const pre = await loadCandidateWithRun(actor, candidateId, "write");
  return db.$transaction(async (tx) => {
    const run = await lockSupplierSearchRunForWrite(tx, actor.orgId, pre.searchRun.id);
    if (isRunTerminal(run.status)) {
      throw new SupplierIntelError("RUN_IMMUTABLE", `评估运行已处于终态 ${run.status}，硬门不可重算；改判请新建评估运行`);
    }
    if (run.status !== "RUNNING") throw new SupplierIntelError("RUN_NOT_RUNNING", `硬门只能在 RUNNING 的评估运行中计算（当前 ${run.status}）`);
    const candidate = await tx.supplierCandidate.findFirst({ where: { id: candidateId, orgId: actor.orgId } });
    if (!candidate) throw new SupplierIntelError("NOT_FOUND", "候选不存在");
    const entries = validateRequirementSnapshot(run.requirementSnapshotJson);
    const matches = await tx.supplierRequirementMatch.findMany({ where: { candidateId: candidate.id, orgId: actor.orgId } });
    const outcome = computeMandatoryGate({
      requirementSnapshot: entries,
      candidate: { offeringId: candidate.offeringId },
      matches: matches.map((m) => ({ id: m.id, requirementKey: m.requirementKey, verdict: m.verdict, evaluatedBy: m.evaluatedBy, evidence: m.evidenceJson, createdAt: m.createdAt.toISOString() })),
      evaluationVersion: run.evaluationVersion,
      computedAt: new Date(),
    });
    await tx.supplierCandidate.updateMany({
      where: { id: candidate.id, orgId: actor.orgId },
      data: {
        mandatoryGateResult: outcome.snapshot.result,
        mandatoryGateJson: outcome.snapshot as unknown as Prisma.InputJsonValue,
        recommendation: outcome.recommendation,
        rejectionReason: outcome.rejectionReason,
      },
    });
    await writeAuditLog(tx, {
      userId: actor.userId,
      orgId: actor.orgId,
      projectId: run.projectId,
      action: SUPPLIER_INTEL_AUDIT_ACTIONS.MANDATORY_GATE_COMPUTED,
      targetType: CANDIDATE_TARGET_TYPE,
      targetId: candidate.id,
      beforeData: { mandatoryGateResult: candidate.mandatoryGateResult, recommendation: candidate.recommendation },
      afterData: { mandatoryGateResult: outcome.snapshot.result, recommendation: outcome.recommendation, summary: outcome.snapshot.summary },
    });
    return outcome;
  }, RUN_WRITE_TX_OPTIONS);
}

/* ───────────────── 收口 ───────────────── */

/**
 * 只有「候选存在 + 全部候选硬门已算」才能 COMPLETED；之后候选 / Match / 门全部不可变。
 * 与硬门计算共用 Run 锁，串行。
 */
/**
 * S4-B score-and-complete（§15 / §55）：收口 = 门已定 → 构建评分证据快照 → 四组件 → computeSupplierScore
 * → 落候选评分快照 → 候选推荐态 → Run COMPLETED，全部在同一个 Run 行锁事务里。
 * 没有「先完成、以后再评分」的路径；COMPLETED 之后评分列不可变（重评估 = 新 Run）。
 * 事务内零网络 / 零 LLM / 零 provider：只读冻结快照、本地 DB 与既有项目数据。
 */
export async function completeEvaluationRun(actor: SupplierIntelActor, runId: string) {
  const pre = await db.supplierSearchRun.findFirst({ where: { id: runId, orgId: actor.orgId }, select: { projectId: true, sourceConfigJson: true } });
  if (!pre || !pre.projectId) throw new SupplierIntelError("NOT_FOUND", "评估运行不存在");
  await assertProjectAccessForActor(actor, pre.projectId, "write");
  if (readRunMode(pre.sourceConfigJson) !== "EVALUATION_ONLY") throw new SupplierIntelError("RUN_MODE_MISMATCH", "这不是评估运行");

  return db.$transaction(async (tx) => {
    const run = await lockSupplierSearchRunForWrite(tx, actor.orgId, runId);
    if (isRunTerminal(run.status)) throw new SupplierIntelError("RUN_IMMUTABLE", `评估运行已处于终态 ${run.status}`);
    if (run.status !== "RUNNING") throw new SupplierIntelError("RUN_NOT_RUNNING", `评估运行不在 RUNNING（当前 ${run.status}）`);
    const projectId = run.projectId as string;
    const candidates = await tx.supplierCandidate.findMany({ where: { searchRunId: run.id, orgId: actor.orgId }, select: { id: true, supplierId: true, offeringId: true, originSource: true, mandatoryGateResult: true, recommendation: true, offeringSnapshotJson: true } });
    if (candidates.length === 0) throw new SupplierIntelError("NO_CANDIDATE", "评估运行里没有任何候选，不能收口");
    const pending = candidates.filter((c) => c.mandatoryGateResult === "PENDING");
    if (pending.length > 0) throw new SupplierIntelError("GATE_PENDING", `还有 ${pending.length} 个候选没有计算强制项硬门，不能收口`);
    const gates = { PASS: 0, FAIL: 0, INCOMPLETE: 0 } as Record<string, number>;
    for (const c of candidates) gates[c.mandatoryGateResult] = (gates[c.mandatoryGateResult] ?? 0) + 1;

    // ── S4-B：正式评分（同事务、同 Run 锁）──
    const now = new Date();
    const scored: Array<{ candidateId: string; snapshot: CandidateScoreSnapshot }> = [];
    for (const c of candidates) {
      const snapshot = await buildCandidateScoreSnapshot(tx, { orgId: actor.orgId, projectId, run: { requirementSnapshotJson: run.requirementSnapshotJson, sourceConfigJson: run.sourceConfigJson }, candidate: c, now });
      const isPass = c.mandatoryGateResult === "PASS";
      const updated = await tx.supplierCandidate.updateMany({
        where: { id: c.id, orgId: actor.orgId, mandatoryGateResult: c.mandatoryGateResult },
        data: {
          technicalScore: isPass ? snapshot.technical?.score ?? null : null,
          commercialScore: isPass ? snapshot.commercial?.score ?? null : null,
          reliabilityScore: isPass ? snapshot.reliability?.score ?? null : null,
          importRiskScore: isPass ? snapshot.importRisk?.score ?? null : null,
          totalScore: isPass ? snapshot.officialTotalScore : null,
          scoreVersion: snapshot.scoreVersion,
          scoreBreakdownJson: snapshot as unknown as Prisma.InputJsonValue,
          // FAIL / INCOMPLETE 保持门给出的 NOT_ELIGIBLE / NEEDS_VERIFICATION；PASS 按推荐契约（null = 可进排名）
          recommendation: isPass ? snapshot.recommendation : c.recommendation,
        },
      });
      if (updated.count !== 1) throw new SupplierIntelError("INVALID_RUN_TRANSITION", "候选门结果已被并发修改，评分中止");
      scored.push({ candidateId: c.id, snapshot });
      await writeAuditLog(tx, {
        userId: actor.userId, orgId: actor.orgId, projectId,
        action: SUPPLIER_INTEL_AUDIT_ACTIONS.SCORE_COMPUTED, targetType: CANDIDATE_TARGET_TYPE, targetId: c.id,
        afterData: {
          scoreVersion: snapshot.scoreVersion, componentRuleVersions: snapshot.componentRuleVersions, recommendationContractVersion: snapshot.recommendationContractVersion,
          gateResult: c.mandatoryGateResult, knownWeightShare: snapshot.knownWeightShare, officialTotalScore: snapshot.officialTotalScore,
          components: { technical: snapshot.technical?.score ?? null, commercial: snapshot.commercial?.score ?? null, reliability: snapshot.reliability?.score ?? null, importRisk: snapshot.importRisk?.score ?? null },
          recommendation: isPass ? snapshot.recommendation : c.recommendation, rankable: snapshot.rankable, reasonCodes: snapshot.reasonCodes,
          priceEvidenceTier: snapshot.commercial?.priceEvidenceTier ?? null,
        },
      });
    }
    const statusDetail = { status: "evaluated", runMode: "EVALUATION_ONLY", sources: {}, candidateCount: candidates.length, gates, scored: scored.map((x) => ({ candidateId: x.candidateId, officialTotalScore: x.snapshot.officialTotalScore, recommendation: x.snapshot.recommendation, unknownComponents: x.snapshot.unknownComponents })) };
    const updated = await tx.supplierSearchRun.updateMany({
      where: { id: run.id, orgId: actor.orgId, status: "RUNNING" },
      data: { status: "COMPLETED", completedAt: new Date(), statusDetailJson: statusDetail as unknown as Prisma.InputJsonValue },
    });
    if (updated.count !== 1) throw new SupplierIntelError("INVALID_RUN_TRANSITION", "状态已被并发修改：RUNNING → COMPLETED 未生效");
    await writeAuditLog(tx, {
      userId: actor.userId,
      orgId: actor.orgId,
      projectId: run.projectId,
      action: SUPPLIER_INTEL_AUDIT_ACTIONS.RUN_COMPLETED,
      targetType: RUN_TARGET_TYPE,
      targetId: run.id,
      beforeData: { status: "RUNNING" },
      afterData: { status: "COMPLETED", runMode: "EVALUATION_ONLY", gates },
    });
    await writeAuditLog(tx, {
      userId: actor.userId, orgId: actor.orgId, projectId,
      action: SUPPLIER_INTEL_AUDIT_ACTIONS.EVALUATION_FINALIZED, targetType: RUN_TARGET_TYPE, targetId: run.id,
      afterData: { runMode: "EVALUATION_ONLY", gates, scored: statusDetail.scored },
    });
    return tx.supplierSearchRun.findFirstOrThrow({ where: { id: run.id } });
  }, RUN_WRITE_TX_OPTIONS);
}

/* ───────────────── 视图 ───────────────── */

export interface EvaluationRequirementRow {
  entry: RequirementSnapshotEntry;
  /** 展示补充（只有当快照条目仍能对上当前 canonical 行时才有；快照本身才是真相） */
  display: { textZh: string | null; textZhIsChinese: boolean; sources: unknown[] } | null;
  match: {
    id: string; verdict: string; evaluatedBy: string; explanation: string | null; confidence: number | null;
    evidence: unknown; createdAt: string;
  } | null;
  suggestion: DeterministicSuggestion | null;
}

export async function loadEvaluationView(actor: SupplierIntelActor, runId: string) {
  const run = await db.supplierSearchRun.findFirst({ where: { id: runId, orgId: actor.orgId } });
  if (!run || !run.projectId) throw new SupplierIntelError("NOT_FOUND", "评估运行不存在");
  await assertProjectAccessForActor(actor, run.projectId, "read");
  if (readRunMode(run.sourceConfigJson) !== "EVALUATION_ONLY") throw new SupplierIntelError("RUN_MODE_MISMATCH", "这不是评估运行");
  // 探测只吞授权失败；DB 抖动要抛出去（否则 200 + canWrite=false 会把整页按钮变没）
  const canWrite = await probeProjectAccess(actor, run.projectId, "write");

  const entries = validateRequirementSnapshot(run.requirementSnapshotJson);
  const candidates = await db.supplierCandidate.findMany({
    where: { searchRunId: run.id, orgId: actor.orgId },
    include: { matches: true, supplier: { select: { id: true, name: true } }, offering: { select: { id: true, name: true, sku: true } } },
    orderBy: { createdAt: "asc" },
  });
  const project = await db.project.findFirst({ where: { id: run.projectId, orgId: actor.orgId }, select: { id: true, name: true } });

  // 展示补充：中文说明 + 来源引用，按 requirementRefId 对当前 canonical 行；对不上就只显示快照原文
  const { loadProcurementView } = await import("./procurement-view");
  let displayById = new Map<string, { textZh: string; textZhIsChinese: boolean; sources: unknown[] }>();
  try {
    const pv = await loadProcurementView(actor, run.projectId);
    displayById = new Map(pv.requirements.map((r) => [r.id, { textZh: r.textZh, textZhIsChinese: r.textZhIsChinese, sources: r.sources }]));
  } catch (err) {
    // 只吞领域性的「没有可用展示」（如 canonical 被阻断）；DB 抖动等基础设施错误必须抛出，
    // 否则页面会静默少掉中文说明与来源引用，用户不知道自己看到的是残缺视图
    if (!(err instanceof SupplierIntelError)) throw err;
  }

  const supplierIds = [...new Set(candidates.map((c) => c.supplierId))];
  const [certs, readFilter, archives] = await Promise.all([
    db.supplierCertification.findMany({ where: { orgId: actor.orgId, supplierId: { in: supplierIds } }, orderBy: { createdAt: "desc" } }),
    buildSignalListScopeFilter(actor),
    db.tenderArchiveItem.findMany({
      where: { orgId: actor.orgId, projectId: run.projectId, accessClass: { not: "RESTRICTED" } },
      orderBy: { capturedAt: "desc" }, take: 50,
      select: { id: true, kind: true, mimeType: true, capturedAt: true, projectDocumentId: true },
    }),
  ]);
  const signals = supplierIds.length
    ? await db.supplierDiscoverySignal.findMany({
        where: { AND: [...readFilter, { orgId: actor.orgId, linkedSupplierId: { in: supplierIds }, status: "LINKED" }] },
        select: { id: true, title: true, accountName: true, platform: true, linkedSupplierId: true, contentUrl: true },
        take: 100,
      })
    : [];
  const now = new Date();

  const candidateViews = [];
  for (const c of candidates) {
    const supplierCerts = certs.filter((x) => x.supplierId === c.supplierId).map((x) => ({
      id: x.id, certificationType: x.certificationType, scope: x.scope, offeringId: x.offeringId, status: x.status,
      validFrom: x.validFrom ? x.validFrom.toISOString() : null,
      expiresAt: x.expiresAt ? x.expiresAt.toISOString() : null, certificateNumber: x.certificateNumber,
      expiredByDate: Boolean(x.expiresAt && x.expiresAt.getTime() < now.getTime()),
      scopeCompatible: x.scope === "SUPPLIER" || (Boolean(c.offeringId) && x.offeringId === c.offeringId),
    }));
    const byKey = new Map(c.matches.map((m) => [m.requirementKey, m]));
    const rows: EvaluationRequirementRow[] = entries.map((e) => {
      const m = byKey.get(e.code);
      const suggestion = m ? null : suggestDeterministicMatch(e, { offeringId: c.offeringId, offeringAttributes: readOfferingAttributes(c.offeringSnapshotJson) }, supplierCerts, now);
      return {
        entry: e,
        display: displayById.get(e.id) ?? null,
        match: m ? { id: m.id, verdict: m.verdict, evaluatedBy: m.evaluatedBy, explanation: m.explanation, confidence: m.confidence, evidence: m.evidenceJson, createdAt: m.createdAt.toISOString() } : null,
        suggestion,
      };
    });
    candidateViews.push({
      id: c.id,
      supplier: { id: c.supplier.id, name: c.supplier.name },
      offering: c.offering ? { id: c.offering.id, name: c.offering.name, sku: c.offering.sku } : null,
      originSource: c.originSource,
      supplierSnapshot: c.supplierSnapshotJson,
      offeringSnapshot: c.offeringSnapshotJson,
      mandatoryGateResult: c.mandatoryGateResult,
      mandatoryGate: c.mandatoryGateJson,
      recommendation: c.recommendation,
      rejectionReason: c.rejectionReason,
      scores: { technical: c.technicalScore, commercial: c.commercialScore, reliability: c.reliabilityScore, importRisk: c.importRiskScore, total: c.totalScore },
      scoreVersion: c.scoreVersion,
      scoreBreakdown: c.scoreBreakdownJson,
      requirements: rows,
      evidenceOptions: {
        certifications: supplierCerts,
        signals: signals.filter((s) => s.linkedSupplierId === c.supplierId).map((s) => ({ id: s.id, title: s.title ?? s.accountName ?? s.id, platform: s.platform, contentUrl: s.contentUrl })),
        archives: archives.map((a) => ({ id: a.id, kind: a.kind, mimeType: a.mimeType, capturedAt: a.capturedAt.toISOString() })),
      },
    });
  }

  return {
    run: {
      id: run.id, status: run.status, runMode: "EVALUATION_ONLY" as const, createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      evaluationVersion: run.evaluationVersion, scoreVersion: run.scoreVersion,
      requirementSnapshotVersion: (run.sourceConfigJson as { canonicalAnalysisRunId?: string } | null)?.canonicalAnalysisRunId ?? null,
      sourceDiscoveryRunId: (run.sourceConfigJson as { sourceDiscoveryRunId?: string | null } | null)?.sourceDiscoveryRunId ?? null,
      commercialEvidenceBinding: readCommercialEvidenceBinding(run.sourceConfigJson),
      statusDetail: run.statusDetailJson,
    },
    project: project ? { id: project.id, name: project.name } : { id: run.projectId, name: null },
    canWrite,
    requirementCount: entries.length,
    mandatoryCount: entries.filter((e) => e.mandatory === true || e.mandatory === "uncertain").length,
    candidates: candidateViews,
  };
}

/** 项目内的评估运行列表（可按供应商过滤）；先项目读权限 */
export async function listProjectEvaluationRuns(actor: SupplierIntelActor, projectId: string, opts?: { supplierId?: string | null }) {
  await assertProjectAccessForActor(actor, projectId, "read");
  const runs = await db.supplierSearchRun.findMany({
    where: { orgId: actor.orgId, projectId, sourceConfigJson: { path: ["runMode"], equals: "EVALUATION_ONLY" } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { candidates: { select: { id: true, supplierId: true, offeringId: true, mandatoryGateResult: true, recommendation: true, rejectionReason: true, offering: { select: { name: true, sku: true } }, supplier: { select: { name: true } } } } },
  });
  const filtered = opts?.supplierId ? runs.filter((r) => r.candidates.some((c) => c.supplierId === opts.supplierId)) : runs;
  return filtered.map((r) => ({
    id: r.id, status: r.status, createdAt: r.createdAt.toISOString(), completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    evaluationVersion: r.evaluationVersion,
    commercialEvidenceBinding: readCommercialEvidenceBinding(r.sourceConfigJson),
    candidates: r.candidates.map((c) => ({ id: c.id, supplierId: c.supplierId, supplierName: c.supplier.name, offeringId: c.offeringId, offeringName: c.offering?.name ?? null, offeringSku: c.offering?.sku ?? null, mandatoryGateResult: c.mandatoryGateResult, recommendation: c.recommendation, rejectionReason: c.rejectionReason })),
  }));
}
