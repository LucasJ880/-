/**
 * CHAIN-2 — 寻源建议取数（服务端；只读）
 *
 * 推荐型号：供应商情报的推荐排名（只来自已完成的评估）+ 这些候选的强制项条目；
 * 自动建的候选池家数取自审计 `tender.supplier_auto_run` 里指向当前这份分析的那一条。
 * 价格：授标记录投影的可比价格分组（只取本项目采购方的授标，剔除我方结果）、情报室已存的市场价格基准、
 * 比价矩阵选定那家的落地价（只给对本项目有财务查看权的人）。
 * 每一块各自兜底：一块取数出错只影响那一块。零写入、零外部请求、零模型调用。
 */

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { isSupplierIntelEnabledForOrg } from "@/lib/supplier-intel/flags";
import { isPricingCompareSourceEnabledForOrg } from "@/lib/tender-pricing/compare-cost-source";
import { isT4AwardSchemaReady } from "./award-flags";
import { SUPPLIER_AUTO_RUN_AUDIT_ACTION } from "./auto-supplier-run";
import {
  assembleSourcingSuggestions,
  buildAwardColumn,
  buildLandedColumn,
  buildMarketColumn,
  buildRecommendations,
  type AwardGroupInput,
  type LandedColumn,
  type RankedCandidateInput,
  type SourcingSuggestionsView,
} from "./sourcing-suggestions-pure";

const warn = (what: string, err: unknown) =>
  console.warn(`[tender-intel] sourcing ${what} unavailable:`, err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200));

/** 推荐排名 + 强制项条目；取数出错 → null（卡上写暂时读不出来） */
async function loadRanked(orgId: string, userId: string, projectId: string): Promise<RankedCandidateInput[] | null> {
  try {
    const { loadProjectSupplierRanking } = await import("@/lib/supplier-intel/project-supplier-ranking");
    const view = await loadProjectSupplierRanking({ orgId, userId }, projectId);
    const ids = view.ranked.map((r) => r.candidateId);
    const gates = ids.length
      ? await db.supplierCandidate.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, mandatoryGateJson: true } })
      : [];
    const gateOf = new Map(gates.map((g) => [g.id, g.mandatoryGateJson]));
    return view.ranked.map((r) => {
      const snap = gateOf.get(r.candidateId) as { items?: unknown } | null | undefined;
      const items = Array.isArray(snap?.items) ? (snap!.items as Array<Record<string, unknown>>) : [];
      return {
        candidateId: r.candidateId,
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        offeringName: r.offeringName,
        offeringSku: r.offeringSku,
        section: r.section,
        rank: r.rank,
        mandatoryGateResult: r.mandatoryGateResult,
        scores: r.scores,
        gateItems: items.map((g) => ({ requirementKey: String(g.requirementKey ?? ""), gateVerdict: String(g.gateVerdict ?? ""), evidenceAdmissible: g.evidenceAdmissible === true })),
      };
    });
  } catch (err) {
    warn("ranking", err);
    return null;
  }
}

/** 项目当前有效的那份分析（与自动建池、自动起草同一条规则）+ 系统为它自动建的候选池家数 */
async function loadAnalysisAndPool(orgId: string, projectId: string): Promise<{ approved: boolean; autoPoolCount: number | null }> {
  try {
    const current = await db.tenderAnalysisRun.findFirst({
      where: { projectId, orgId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!current) return { approved: false, autoPoolCount: null };
    const audits = await db.auditLog.findMany({
      where: { orgId, projectId, action: SUPPLIER_AUTO_RUN_AUDIT_ACTION },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { targetId: true, afterData: true },
    });
    const hit = audits.find((a) => {
      try {
        return (JSON.parse(a.afterData ?? "{}") as { analysisRunId?: unknown }).analysisRunId === current.id;
      } catch {
        return false;
      }
    });
    const autoPoolCount = hit?.targetId ? await db.supplierCandidate.count({ where: { orgId, searchRunId: hit.targetId } }) : null;
    return { approved: current.status === "APPROVED", autoPoolCount };
  } catch (err) {
    warn("auto pool", err);
    return { approved: true, autoPoolCount: null };
  }
}

/**
 * 本项目采购方的授标 → 可比价格分组。剔除我方结果：本组织项目回灌的记录（金额是我方报价或中标价）、
 * 中标方是本组织的记录。null = 取数出错。
 */
async function loadAwardGroups(orgId: string, buyer: string | null): Promise<AwardGroupInput[] | null> {
  if (!buyer?.trim()) return [];
  try {
    const [{ listAwardsForBuyer, normalizeVendorName }, { deriveAwardIntelligence }] = await Promise.all([import("./awards"), import("./award-intelligence")]);
    const [rows, org] = await Promise.all([listAwardsForBuyer({ orgId, buyerName: buyer }), db.organization.findUnique({ where: { id: orgId }, select: { name: true } })]);
    const ownName = org?.name?.trim() ? normalizeVendorName(org.name) : null;
    const others = rows.filter((r) => r.projectId === null && (!ownName || r.winnerNameNormalized !== ownName));
    return deriveAwardIntelligence(others, { ownWinnerNames: [org?.name] }).comparablePricing.groups;
  } catch (err) {
    warn("awards", err);
    return null;
  }
}

async function loadMarketPricing(orgId: string, projectId: string): Promise<{ value: unknown; readError: boolean }> {
  try {
    const room = await db.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { orgId: true, summaryJson: true } });
    const summary = room && room.orgId === orgId && room.summaryJson && typeof room.summaryJson === "object" ? (room.summaryJson as Record<string, unknown>) : null;
    return { value: summary?.marketPricing ?? null, readError: false };
  } catch (err) {
    warn("market pricing", err);
    return { value: null, readError: true };
  }
}

/** 我方落地价：只有对本项目有财务查看权的人才取、才返回（没有权限 → null，响应里没有这个键） */
async function loadLanded(user: AuthUser, orgId: string, projectId: string, ownerId: string | null): Promise<LandedColumn | null> {
  let canRead = false;
  try {
    const { resolveFinancePrivilege } = await import("@/lib/project-finance/access");
    canRead = (await resolveFinancePrivilege(user, orgId, ownerId)).canReadAll;
  } catch (err) {
    warn("finance privilege", err);
    return null;
  }
  if (!canRead) return null;
  if (!isPricingCompareSourceEnabledForOrg(orgId)) return buildLandedColumn(null, false);
  const { loadCompareCostSuggestionSafe } = await import("@/lib/tender-pricing/compare-cost-source-load");
  return buildLandedColumn(await loadCompareCostSuggestionSafe({ projectId, orgId }));
}

export async function loadSourcingSuggestions(input: { user: AuthUser; orgId: string; projectId: string }): Promise<SourcingSuggestionsView> {
  const { user, orgId, projectId } = input;
  const project = await db.project.findFirst({ where: { id: projectId, orgId }, select: { clientOrganization: true, ownerId: true } });
  const intelEnabled = isSupplierIntelEnabledForOrg(orgId);
  const awardsReady = isT4AwardSchemaReady();

  const [ranked, analysis, awardGroups, marketPricing, landed] = await Promise.all([
    intelEnabled ? loadRanked(orgId, user.id, projectId) : Promise.resolve([] as RankedCandidateInput[]),
    intelEnabled ? loadAnalysisAndPool(orgId, projectId) : Promise.resolve({ approved: false, autoPoolCount: null }),
    awardsReady ? loadAwardGroups(orgId, project?.clientOrganization ?? null) : Promise.resolve([] as AwardGroupInput[]),
    loadMarketPricing(orgId, projectId),
    loadLanded(user, orgId, projectId, project?.ownerId ?? null),
  ]);

  return assembleSourcingSuggestions({
    recommendations: buildRecommendations({ projectId, intelEnabled, analysisApproved: analysis.approved, ranked, autoPoolCount: analysis.autoPoolCount }),
    awards: buildAwardColumn({ schemaReady: awardsReady, projectBuyer: project?.clientOrganization ?? null, groups: awardGroups }),
    market: buildMarketColumn(marketPricing.value, marketPricing.readError),
    landed,
  });
}
