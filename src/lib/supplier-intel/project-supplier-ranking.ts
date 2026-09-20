/**
 * S4-B：项目级「当前推荐」+「供应商赛马」read-model（服务端装配；不新增表、不写候选）。
 *
 * 每个 Supplier × Offering 取本项目**最新 COMPLETED 的 EVALUATION_ONLY Run** 的候选；PRIMARY / BACKUP
 * 由 project-ranking-model 动态派生——历史候选的 recommendation / 评分永不因此改写（§42 / §47）。
 * 赛马态 / 下一步动作由既有事实派生（§48–§50），不用 LLM。
 * ACL：项目读权限；线索按可见性过滤；本项目 RFQ 只回状态与本项目报价（不泄露别项目报价）。
 */

import { db } from "@/lib/db";
import { assertProjectAccessForActor } from "./access";
import type { SupplierIntelActor } from "./actor";
import { loadProjectPriorityBrief, prioritizeSignal } from "./discovery-priority-service";
import { DISCOVERY_PRIORITY_DISCLAIMER, type DiscoveryPriorityResult } from "./discovery-priority";
import { SupplierIntelError } from "./errors";
import { deriveNextAction, deriveRacingState, rankCandidates, type RankedCandidate, type RacingFacts } from "./project-ranking-model";
import { isConfirmedQuote } from "./score-components";
import { buildSignalListScopeFilter } from "./signal-scope";

export const CURRENT_RANKING_DISCLAIMER = "当前项目推荐根据各供应商最新完成的评估动态计算；历史评估记录本身不会被改写。";

export interface RankingRow extends RankedCandidate {
  runId: string;
  completedAt: string | null;
  supplierName: string;
  offeringName: string | null;
  offeringSku: string | null;
  originSource: string;
  scoreVersion: string;
  unknownComponents: string[];
  reasonCodes: string[];
  priceEvidenceTier: string | null;
  nextAction: { code: string; label: string };
}

export interface RacingRow {
  key: string;
  supplierId: string;
  supplierName: string;
  offeringId: string | null;
  offeringName: string | null;
  sourcePlatform: string | null;
  originSource: string | null;
  discoveryPriority: DiscoveryPriorityResult | null;
  state: string;
  gate: string | null;
  rfq: "NONE" | "SENT" | "CONFIRMED";
  officialTotalScore: number | null;
  currentRank: number | null;
  section: string | null;
  candidateId: string | null;
  runId: string | null;
  evaluationInProgress: boolean;
  nextAction: { code: string; label: string };
}

export interface ProjectSupplierRankingView {
  project: { id: string; name: string | null };
  computedAt: string;
  disclaimers: { ranking: string; discovery: string };
  priorityBriefSource: string | null;
  sections: Record<"PRIMARY" | "BACKUP" | "NEEDS_VERIFICATION" | "HIGH_RISK" | "NOT_ELIGIBLE", RankingRow[]>;
  ranked: RankingRow[];
  racing: RacingRow[];
}

export async function loadProjectSupplierRanking(actor: SupplierIntelActor, projectId: string): Promise<ProjectSupplierRankingView> {
  await assertProjectAccessForActor(actor, projectId, "read");
  const project = await db.project.findFirst({ where: { id: projectId, orgId: actor.orgId }, select: { id: true, name: true } });
  if (!project) throw new SupplierIntelError("NOT_FOUND", "项目不存在");

  const runs = await db.supplierSearchRun.findMany({
    where: { orgId: actor.orgId, projectId, sourceConfigJson: { path: ["runMode"], equals: "EVALUATION_ONLY" } },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: { candidates: { include: { supplier: { select: { id: true, name: true } }, offering: { select: { id: true, name: true, sku: true } } } } },
  });

  // 每个 Supplier × Offering：最新 COMPLETED；同时记录是否有 RUNNING
  type Cand = (typeof runs)[number]["candidates"][number];
  const latest = new Map<string, { run: (typeof runs)[number]; cand: Cand }>();
  const inProgress = new Set<string>();
  for (const r of runs) {
    for (const c of r.candidates) {
      const key = `${c.supplierId}:${c.offeringId ?? "-"}`;
      if (r.status === "COMPLETED") { if (!latest.has(key)) latest.set(key, { run: r, cand: c }); }
      else if (r.status === "RUNNING") inProgress.add(key);
    }
  }

  const [readFilter, priorityBrief] = await Promise.all([buildSignalListScopeFilter(actor), loadProjectPriorityBrief(actor.orgId, projectId)]);
  const signals = await db.supplierDiscoverySignal.findMany({
    where: { AND: [...readFilter, { orgId: actor.orgId, status: "LINKED", linkedSupplierId: { not: null }, OR: [{ projectId }, { tenderId: projectId }, { searchRun: { is: { orgId: actor.orgId, projectId } } }] }] },
    orderBy: { discoveredAt: "desc" }, take: 500,
    select: { id: true, linkedSupplierId: true, platform: true, title: true, description: true, rawText: true, accountName: true, contentUrl: true, rawMetadataJson: true },
  });
  const supplierIds = [...new Set([...[...latest.values()].map((x) => x.cand.supplierId), ...[...inProgress].map((k) => k.split(":")[0]), ...signals.map((s) => s.linkedSupplierId as string)])];
  const [suppliers, offerings, certs, caps, inquiries] = await Promise.all([
    db.supplier.findMany({ where: { orgId: actor.orgId, id: { in: supplierIds } }, select: { id: true, name: true } }),
    db.supplierOffering.findMany({ where: { orgId: actor.orgId, supplierId: { in: supplierIds }, status: "active" }, select: { id: true, supplierId: true, name: true } }),
    db.supplierCertification.findMany({ where: { orgId: actor.orgId, supplierId: { in: supplierIds } }, select: { supplierId: true, status: true } }),
    db.supplierCapabilitySignal.findMany({ where: { orgId: actor.orgId, evidenceStatus: "VERIFIED", discoverySignal: { is: { linkedSupplierId: { in: supplierIds }, status: "LINKED" } } }, select: { id: true, discoverySignal: { select: { linkedSupplierId: true } } } }),
    db.projectInquiry.findMany({ where: { projectId, project: { is: { orgId: actor.orgId } } }, select: { items: { select: { supplierId: true, status: true, sentAt: true, repliedAt: true, unitPrice: true, totalPrice: true } } } }),
  ]);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const rfqBySupplier = new Map<string, "NONE" | "SENT" | "CONFIRMED">();
  for (const inq of inquiries) for (const it of inq.items) {
    const confirmed = isConfirmedQuote({ itemId: "", supplierId: it.supplierId, status: it.status, repliedAt: it.repliedAt ? it.repliedAt.toISOString() : null, unitPrice: it.unitPrice ? Number(it.unitPrice) : null, totalPrice: it.totalPrice ? Number(it.totalPrice) : null, currency: "", deliveryDays: null, validUntil: null });
    const prev = rfqBySupplier.get(it.supplierId) ?? "NONE";
    const next = confirmed ? "CONFIRMED" : it.sentAt || it.status !== "pending" ? "SENT" : "NONE";
    rfqBySupplier.set(it.supplierId, prev === "CONFIRMED" || next === "CONFIRMED" ? "CONFIRMED" : prev === "SENT" || next === "SENT" ? "SENT" : "NONE");
  }
  const priorityBySupplier = new Map<string, DiscoveryPriorityResult>();
  const platformBySupplier = new Map<string, string>();
  for (const s of signals) {
    const sid = s.linkedSupplierId as string;
    if (!platformBySupplier.has(sid)) platformBySupplier.set(sid, s.platform);
    const p = prioritizeSignal(priorityBrief?.brief ?? null, s);
    if (p && (!priorityBySupplier.has(sid) || (priorityBySupplier.get(sid) as DiscoveryPriorityResult).total < p.total)) priorityBySupplier.set(sid, p);
  }
  const verifiedCount = new Map<string, number>(); const claimedCerts = new Map<string, number>();
  for (const c of certs) { if (c.status === "VERIFIED") verifiedCount.set(c.supplierId, (verifiedCount.get(c.supplierId) ?? 0) + 1); if (c.status === "CLAIMED") claimedCerts.set(c.supplierId, (claimedCerts.get(c.supplierId) ?? 0) + 1); }
  for (const c of caps) { const sid = c.discoverySignal.linkedSupplierId as string; verifiedCount.set(sid, (verifiedCount.get(sid) ?? 0) + 1); }
  const hasOffering = new Set(offerings.map((o) => o.supplierId));

  // ── 当前排名 ──
  const ranked = rankCandidates([...latest.values()].map(({ cand }) => ({
    candidateId: cand.id, supplierId: cand.supplierId, offeringId: cand.offeringId, mandatoryGateResult: cand.mandatoryGateResult, recommendation: cand.recommendation,
    scores: { technical: cand.technicalScore, commercial: cand.commercialScore, reliability: cand.reliabilityScore, importRisk: cand.importRiskScore, total: cand.totalScore },
  })));
  const byCandidate = new Map([...latest.values()].map((x) => [x.cand.id, x]));
  const rows: RankingRow[] = ranked.map((r) => {
    const { run, cand } = byCandidate.get(r.candidateId) as { run: (typeof runs)[number]; cand: Cand };
    const bd = (cand.scoreBreakdownJson ?? null) as { unknownComponents?: string[]; reasonCodes?: string[]; commercial?: { priceEvidenceTier?: string } | null } | null;
    const facts = factsFor(cand.supplierId, cand.offeringId, cand, bd, false);
    return {
      ...r, runId: run.id, completedAt: run.completedAt ? run.completedAt.toISOString() : null, supplierName: cand.supplier.name,
      offeringName: cand.offering?.name ?? null, offeringSku: cand.offering?.sku ?? null, originSource: cand.originSource, scoreVersion: cand.scoreVersion,
      unknownComponents: bd?.unknownComponents ?? [], reasonCodes: bd?.reasonCodes ?? [], priceEvidenceTier: bd?.commercial?.priceEvidenceTier ?? null,
      nextAction: deriveNextAction(facts),
    };
  });
  const sections: ProjectSupplierRankingView["sections"] = { PRIMARY: [], BACKUP: [], NEEDS_VERIFICATION: [], HIGH_RISK: [], NOT_ELIGIBLE: [] };
  for (const r of rows) sections[r.section].push(r);

  function factsFor(supplierId: string, offeringId: string | null, cand: Cand | null, bd: { unknownComponents?: string[]; commercial?: { priceEvidenceTier?: string } | null } | null, evaluationInProgress: boolean): RacingFacts {
    const rfq = rfqBySupplier.get(supplierId) ?? "NONE";
    const scoreComplete = Boolean(cand && cand.totalScore !== null && cand.technicalScore !== null && cand.commercialScore !== null && cand.reliabilityScore !== null && cand.importRiskScore !== null);
    return {
      linked: platformBySupplier.has(supplierId) || Boolean(cand), hasOffering: Boolean(offeringId) || hasOffering.has(supplierId),
      verifiedEvidenceCount: verifiedCount.get(supplierId) ?? 0, claimedCertificationCount: claimedCerts.get(supplierId) ?? 0,
      latestGate: cand?.mandatoryGateResult ?? null, latestRecommendation: cand?.recommendation ?? null, scoreComplete,
      rfqConfirmed: rfq === "CONFIRMED", rfqSent: rfq !== "NONE", priceEvidenceTier: bd?.commercial?.priceEvidenceTier ?? null,
      unknownComponents: bd?.unknownComponents ?? [], evaluationInProgress,
    };
  }

  // ── 赛马 ──
  const racing: RacingRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const { cand } = byCandidate.get(r.candidateId) as { cand: Cand };
    const key = `${cand.supplierId}:${cand.offeringId ?? "-"}`; seen.add(key);
    const bd = (cand.scoreBreakdownJson ?? null) as { unknownComponents?: string[]; commercial?: { priceEvidenceTier?: string } | null } | null;
    const facts = factsFor(cand.supplierId, cand.offeringId, cand, bd, inProgress.has(key));
    racing.push({
      key, supplierId: cand.supplierId, supplierName: cand.supplier.name, offeringId: cand.offeringId, offeringName: cand.offering?.name ?? null,
      sourcePlatform: platformBySupplier.get(cand.supplierId) ?? null, originSource: cand.originSource, discoveryPriority: priorityBySupplier.get(cand.supplierId) ?? null,
      state: deriveRacingState(facts), gate: cand.mandatoryGateResult, rfq: rfqBySupplier.get(cand.supplierId) ?? "NONE", officialTotalScore: cand.totalScore,
      currentRank: r.rank, section: r.section, candidateId: cand.id, runId: r.runId, evaluationInProgress: inProgress.has(key), nextAction: r.nextAction,
    });
  }
  for (const key of inProgress) { if (seen.has(key)) continue; seen.add(key); const [sid, oid] = key.split(":"); const facts = factsFor(sid, oid === "-" ? null : oid, null, null, true);
    racing.push({ key, supplierId: sid, supplierName: supplierName.get(sid) ?? sid, offeringId: oid === "-" ? null : oid, offeringName: offerings.find((o) => o.id === oid)?.name ?? null, sourcePlatform: platformBySupplier.get(sid) ?? null, originSource: null, discoveryPriority: priorityBySupplier.get(sid) ?? null, state: deriveRacingState(facts), gate: null, rfq: rfqBySupplier.get(sid) ?? "NONE", officialTotalScore: null, currentRank: null, section: null, candidateId: null, runId: null, evaluationInProgress: true, nextAction: deriveNextAction(facts) }); }
  for (const sid of supplierIds) { const key = `${sid}:-`; if ([...seen].some((k) => k.startsWith(`${sid}:`))) continue; seen.add(key); const facts = factsFor(sid, null, null, null, false);
    racing.push({ key, supplierId: sid, supplierName: supplierName.get(sid) ?? sid, offeringId: null, offeringName: null, sourcePlatform: platformBySupplier.get(sid) ?? null, originSource: null, discoveryPriority: priorityBySupplier.get(sid) ?? null, state: deriveRacingState(facts), gate: null, rfq: rfqBySupplier.get(sid) ?? "NONE", officialTotalScore: null, currentRank: null, section: null, candidateId: null, runId: null, evaluationInProgress: false, nextAction: deriveNextAction(facts) }); }
  racing.sort((a, b) => (a.currentRank ?? 1e9) - (b.currentRank ?? 1e9) || (b.discoveryPriority?.total ?? -1) - (a.discoveryPriority?.total ?? -1) || a.supplierName.localeCompare(b.supplierName, "zh-CN"));

  return {
    project: { id: project.id, name: project.name },
    computedAt: new Date().toISOString(),
    disclaimers: { ranking: CURRENT_RANKING_DISCLAIMER, discovery: DISCOVERY_PRIORITY_DISCLAIMER },
    priorityBriefSource: priorityBrief ? priorityBrief.source.kind : null,
    sections, ranked: rows, racing,
  };
}
