/**
 * CHAIN-2 — 寻源建议取数（服务端；只读）
 *
 * 推荐型号：供应商情报的推荐排名（只来自已完成的评估）+ 这些候选的强制闸条目；
 * 自动建的候选池家数取自审计 `tender.supplier_auto_run` 指向的那个搜索运行。
 * 价格：授标记录投影的可比价格分组（按项目采购方规整后比对）、情报室已存的市场价格基准、
 * 比价矩阵选定那家的落地价（只给对本项目有财务查看权的人）。
 * 零写入、零外部请求、零模型调用。
 */

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { isSupplierIntelEnabledForOrg } from "@/lib/supplier-intel/flags";
import { isT4AwardSchemaReady } from "./award-flags";
import { SUPPLIER_AUTO_RUN_AUDIT_ACTION } from "./auto-supplier-run";
import {
  assembleSourcingSuggestions,
  buildAwardColumn,
  buildLandedColumn,
  buildMarketColumn,
  buildRecommendations,
  type AwardGroupInput,
  type RankedCandidateInput,
  type SourcingSuggestionsView,
} from "./sourcing-suggestions-pure";

/** 推荐排名 + 强制闸条目；取数出错 → null（卡上写暂时读不出来） */
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
    console.warn("[tender-intel] sourcing ranking unavailable:", err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200));
    return null;
  }
}

/** 系统在批准分析后自动建的候选池（最近一次）的候选家数；没有自动建过 = null */
async function loadAutoPoolCount(orgId: string, projectId: string): Promise<number | null> {
  const audit = await db.auditLog.findFirst({
    where: { orgId, projectId, action: SUPPLIER_AUTO_RUN_AUDIT_ACTION },
    orderBy: { createdAt: "desc" },
    select: { targetId: true },
  });
  if (!audit?.targetId) return null;
  return db.supplierCandidate.count({ where: { orgId, searchRunId: audit.targetId } });
}

async function loadAwardGroups(orgId: string): Promise<{ ready: boolean; groups: AwardGroupInput[] }> {
  if (!isT4AwardSchemaReady()) return { ready: false, groups: [] };
  const [{ listAwardsForOrg }, { deriveAwardIntelligence }] = await Promise.all([import("./awards"), import("./award-intelligence")]);
  const [rows, org] = await Promise.all([listAwardsForOrg({ orgId }), db.organization.findUnique({ where: { id: orgId }, select: { name: true } })]);
  // 我方中标不进统计口径（与组织级授标情报同一做法）
  const intel = deriveAwardIntelligence(rows, { ownWinnerNames: [org?.name] });
  return { ready: true, groups: intel.comparablePricing.groups };
}

export async function loadSourcingSuggestions(input: { user: AuthUser; orgId: string; projectId: string }): Promise<SourcingSuggestionsView> {
  const { user, orgId, projectId } = input;
  const project = await db.project.findFirst({ where: { id: projectId, orgId }, select: { clientOrganization: true, ownerId: true } });
  const intelEnabled = isSupplierIntelEnabledForOrg(orgId);

  const [ranked, autoPoolCount, awardData, room, privilege] = await Promise.all([
    intelEnabled ? loadRanked(orgId, user.id, projectId) : Promise.resolve([] as RankedCandidateInput[]),
    intelEnabled ? loadAutoPoolCount(orgId, projectId) : Promise.resolve(null),
    loadAwardGroups(orgId).catch(() => ({ ready: false, groups: [] as AwardGroupInput[] })),
    db.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { orgId: true, summaryJson: true } }),
    import("@/lib/project-finance/access").then((m) => m.resolveFinancePrivilege(user, orgId, project?.ownerId ?? null)),
  ]);

  const summary = room && room.orgId === orgId && room.summaryJson && typeof room.summaryJson === "object" ? (room.summaryJson as Record<string, unknown>) : null;
  // 我方落地价：只有对本项目有财务查看权的人才取、才返回
  const landed = privilege.canReadAll
    ? buildLandedColumn(await (await import("@/lib/tender-pricing/compare-cost-source-load")).loadCompareCostSuggestionSafe({ projectId, orgId }))
    : null;

  return assembleSourcingSuggestions({
    recommendations: buildRecommendations({ projectId, intelEnabled, ranked, autoPoolCount }),
    awards: buildAwardColumn({ schemaReady: awardData.ready, projectBuyer: project?.clientOrganization ?? null, groups: awardData.groups }),
    market: buildMarketColumn(summary?.marketPricing),
    landed,
  });
}
