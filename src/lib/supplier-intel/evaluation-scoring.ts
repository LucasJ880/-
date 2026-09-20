/**
 * S4-B：评估收口时的**正式评分**（score-and-complete）。
 *
 * 只在 completeEvaluationRun 的 Run 行锁事务里被调用（§55 / §56）：
 *   Gate finalized → 构建评分证据快照 → 四个组件 → computeSupplierScore → 落 Candidate 评分快照
 *   → 候选推荐态 → Run → COMPLETED。绝不存在「先完成、以后再评分」的平行路径。
 *
 * 铁律（§16）：评分事务里 network / LLM / provider / 1688 / FX / customs 调用 = 0。
 * 本模块只 import db 类型、常量、纯评分模块；只读冻结快照 + 本地 DB + 既有项目数据。
 *
 * 商业数据边界（§59 / §60）：Commercial 的可比组只取**本项目**的询价轮；Reliability 只用别项目的
 * 交互聚合（id / 状态），不复制别项目报价。
 */

import type { Prisma } from "@prisma/client";
import { RECOMMENDATION_CONTRACT_V1, deriveCandidateRecommendation, type PersistedRecommendation } from "./recommendation-contract";
import { validateRequirementSnapshot } from "./requirement-snapshot";
import { SCORE_COMPONENT_RULE_VERSIONS, type ScoreReasonCode } from "./constants";
import { SUPPLIER_SCORE_V1, type SupplierScoreBreakdown } from "./score-contract";
import {
  buildOfficialScore, computeCommercialScore, computeImportRiskScore, computeReliabilityScore, computeTechnicalFit, derivePriceEvidenceTier, isConfirmedQuote,
  type CommercialBreakdown, type ImportRiskBreakdown, type ReliabilityBreakdown, type RfqRoundInput, type TechnicalBreakdown,
} from "./score-components";

type Tx = Prisma.TransactionClient;

const EXPORT_CAPABILITY_TYPES = ["CANADA_EXPORT", "OVERSEAS_EXPORT", "EXPORT_PACKAGING"];

export interface OfferingPriceEvidenceSnapshot {
  tier: string;
  listedPrice: string | null;
  currency: string | null;
  priceStatus: string | null;
  sourceKind: string | null;
  sourceUrl: string | null;
  sourceSignalId: string | null;
  sourceSignalPlatform: string | null;
}

export interface CandidateScoreSnapshot {
  scoreVersion: typeof SUPPLIER_SCORE_V1.version;
  recommendationContractVersion: typeof RECOMMENDATION_CONTRACT_V1.version;
  componentRuleVersions: typeof SCORE_COMPONENT_RULE_VERSIONS;
  computedAt: string;
  capturedAt: string;
  gateResult: string;
  technical: TechnicalBreakdown | null;
  commercial: (CommercialBreakdown & { offeringPriceEvidence: OfferingPriceEvidenceSnapshot }) | null;
  reliability: ReliabilityBreakdown | null;
  importRisk: ImportRiskBreakdown | null;
  contract: SupplierScoreBreakdown | null;
  knownWeightShare: number | null;
  unknownComponents: string[];
  /** score-contract 的按已知权重归一分（分析用，**不是**官方总分） */
  normalizedKnownScore: number | null;
  officialTotalScore: number | null;
  recommendation: PersistedRecommendation;
  rankable: boolean;
  reasonCodes: ScoreReasonCode[];
  provenance: { projectId: string; supplierId: string; offeringId: string | null; originSource: string; inquiryId: string | null; historyItemIds: string[]; capabilityIds: string[] };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function readOfferingSnapshot(json: unknown) {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  return {
    incoterm: typeof o.incoterm === "string" ? o.incoterm : null,
    leadTimeDays: num(o.leadTimeDays),
    unitPrice: o.unitPrice === null || o.unitPrice === undefined ? null : String(o.unitPrice),
    currency: typeof o.currency === "string" ? o.currency : null,
    priceStatus: typeof o.priceStatus === "string" ? o.priceStatus : null,
    sourceKind: typeof o.sourceKind === "string" ? o.sourceKind : null,
    sourceUrl: typeof o.sourceUrl === "string" ? o.sourceUrl : null,
    sourceSignalId: typeof o.sourceSignalId === "string" ? o.sourceSignalId : null,
  };
}

/** 本项目里该供应商的 RFQ 事实：最近一个含该供应商已确认报价的询价轮 + 是否已发出过询价 */
export async function loadProjectRfqFacts(tx: Tx, orgId: string, projectId: string, supplierId: string): Promise<{ round: RfqRoundInput | null; rfqSent: boolean; rfqConfirmed: boolean }> {
  const inquiries = await tx.projectInquiry.findMany({
    where: { projectId, project: { is: { orgId } } },
    orderBy: { roundNumber: "desc" },
    include: { items: { select: { id: true, supplierId: true, status: true, repliedAt: true, unitPrice: true, totalPrice: true, currency: true, deliveryDays: true, validUntil: true, sentAt: true } } },
  });
  let rfqSent = false;
  for (const inq of inquiries) {
    const items = inq.items.map((it) => ({
      itemId: it.id, supplierId: it.supplierId, status: it.status, repliedAt: it.repliedAt ? it.repliedAt.toISOString() : null,
      unitPrice: num(it.unitPrice), totalPrice: num(it.totalPrice), currency: it.currency, deliveryDays: it.deliveryDays ?? null, validUntil: it.validUntil ? it.validUntil.toISOString() : null,
    }));
    const mine = inq.items.find((it) => it.supplierId === supplierId);
    if (mine && (mine.sentAt || mine.status !== "pending")) rfqSent = true;
    const mineMapped = items.find((it) => it.supplierId === supplierId);
    if (mineMapped && isConfirmedQuote(mineMapped)) {
      return { round: { inquiryId: inq.id, roundNumber: inq.roundNumber, scope: inq.scope ?? null, items }, rfqSent: true, rfqConfirmed: true };
    }
  }
  return { round: null, rfqSent, rfqConfirmed: false };
}

export async function buildCandidateScoreSnapshot(
  tx: Tx,
  input: { orgId: string; projectId: string; run: { requirementSnapshotJson: unknown }; candidate: { id: string; supplierId: string; offeringId: string | null; originSource: string; mandatoryGateResult: string; offeringSnapshotJson: unknown }; now: Date },
): Promise<CandidateScoreSnapshot> {
  const { orgId, projectId, candidate, now } = input;
  const at = now.toISOString();
  const base = {
    scoreVersion: SUPPLIER_SCORE_V1.version, recommendationContractVersion: RECOMMENDATION_CONTRACT_V1.version, componentRuleVersions: SCORE_COMPONENT_RULE_VERSIONS,
    computedAt: at, capturedAt: at, gateResult: candidate.mandatoryGateResult,
  };
  const provenanceBase = { projectId, supplierId: candidate.supplierId, offeringId: candidate.offeringId, originSource: candidate.originSource };

  // §13 / §70：门不是 PASS 就不构建正式评分——FAIL 连组件都不算
  if (candidate.mandatoryGateResult !== "PASS") {
    const rec = deriveCandidateRecommendation({ gateResult: candidate.mandatoryGateResult, components: { technical: null, commercial: null, reliability: null, importRisk: null }, officialTotalScore: null });
    return {
      ...base, technical: null, commercial: null, reliability: null, importRisk: null, contract: null, knownWeightShare: null, unknownComponents: ["technical", "commercial", "reliability", "importRisk"],
      normalizedKnownScore: null, officialTotalScore: null, recommendation: rec.recommendation, rankable: false, reasonCodes: rec.reasonCodes,
      provenance: { ...provenanceBase, inquiryId: null, historyItemIds: [], capabilityIds: [] },
    };
  }

  // Technical：canonical 需求快照 + 冻结 Match
  const entries = validateRequirementSnapshot(input.run.requirementSnapshotJson);
  const matches = await tx.supplierRequirementMatch.findMany({ where: { candidateId: candidate.id, orgId }, select: { requirementKey: true, verdict: true, evaluatedBy: true } });
  const technical = computeTechnicalFit(entries.map((e) => ({ key: e.code, category: e.category, mandatory: e.mandatory })), matches);

  // Commercial：本项目 RFQ + 价格证据层
  const rfq = await loadProjectRfqFacts(tx, orgId, projectId, candidate.supplierId);
  const offering = readOfferingSnapshot(candidate.offeringSnapshotJson);
  let sourceSignalPlatform: string | null = null;
  if (offering?.sourceSignalId) {
    const sig = await tx.supplierDiscoverySignal.findFirst({ where: { id: offering.sourceSignalId, orgId }, select: { platform: true } });
    sourceSignalPlatform = sig?.platform ?? null;
  }
  const tier = derivePriceEvidenceTier({ rfqConfirmed: rfq.rfqConfirmed, offering: offering ? { sourceKind: offering.sourceKind, priceStatus: offering.priceStatus, unitPrice: offering.unitPrice, sourceUrl: offering.sourceUrl, sourceSignalPlatform } : null });
  const commercialCore = computeCommercialScore({ candidateSupplierId: candidate.supplierId, round: rfq.round, priceEvidenceTier: tier });
  const commercial = { ...commercialCore, offeringPriceEvidence: { tier, listedPrice: offering?.unitPrice ?? null, currency: offering?.currency ?? null, priceStatus: offering?.priceStatus ?? null, sourceKind: offering?.sourceKind ?? null, sourceUrl: offering?.sourceUrl ?? null, sourceSignalId: offering?.sourceSignalId ?? null, sourceSignalPlatform } };

  // Reliability：别项目的真实交互（同 org），只记 id / 状态
  const historyRows = await tx.inquiryItem.findMany({
    where: { supplierId: candidate.supplierId, inquiry: { is: { projectId: { not: projectId }, project: { is: { orgId } } } } },
    select: { id: true, status: true, sentAt: true, repliedAt: true, isSelected: true, inquiry: { select: { projectId: true } } },
  });
  const reliability = computeReliabilityScore({ currentProjectId: projectId, history: historyRows.map((h) => ({ itemId: h.id, projectId: h.inquiry.projectId, status: h.status, sentAt: h.sentAt ? h.sentAt.toISOString() : null, repliedAt: h.repliedAt ? h.repliedAt.toISOString() : null, isSelected: h.isSelected })) });

  // Import readiness：只认挂在已归属线索上的出口能力证据；VERIFIED 才计分
  const caps = await tx.supplierCapabilitySignal.findMany({
    where: { orgId, type: { in: EXPORT_CAPABILITY_TYPES }, discoverySignal: { is: { linkedSupplierId: candidate.supplierId, status: "LINKED" } } },
    select: { id: true, type: true, evidenceStatus: true },
  });
  const importRisk = computeImportRiskScore({ capabilities: caps, offering: offering ? { incoterm: offering.incoterm, leadTimeDays: offering.leadTimeDays } : null });

  const components = { technical: technical.score, commercial: commercial.score, reliability: reliability.score, importRisk: importRisk.score };
  const official = buildOfficialScore(components);
  const rec = deriveCandidateRecommendation({ gateResult: "PASS", components, officialTotalScore: official.officialTotalScore });
  const reasonCodes = [...new Set<ScoreReasonCode>([...technical.reasonCodes, ...commercial.reasonCodes, ...reliability.reasonCodes, ...importRisk.reasonCodes, ...rec.reasonCodes])];
  return {
    ...base, technical, commercial, reliability, importRisk, contract: official.breakdown,
    knownWeightShare: official.breakdown.knownWeightShare, unknownComponents: official.breakdown.unknownComponents,
    normalizedKnownScore: official.breakdown.totalScore, officialTotalScore: official.officialTotalScore,
    recommendation: rec.recommendation, rankable: rec.rankable, reasonCodes,
    provenance: { ...provenanceBase, inquiryId: rfq.round?.inquiryId ?? null, historyItemIds: reliability.history.map((h) => h.itemId), capabilityIds: caps.map((c) => c.id) },
  };
}
