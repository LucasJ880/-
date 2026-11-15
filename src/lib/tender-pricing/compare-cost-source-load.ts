/**
 * FLOW-H2 报价表助手的成本建议（只读取数）
 *
 * 按轮次从新到旧找第一条人工选定、已报价的条目（D1），再用比价矩阵同一套取数与换算（D2）取那一条的落地价。
 * orgId 必须是服务端鉴权得到的项目组织，不接受请求里的组织。
 */

import { db } from "@/lib/db";
import { ITEM_STATUS } from "@/lib/inquiry/types";
import { loadCompareMatrix } from "@/lib/tender-rfq/compare-service";
import { NONE_SELECTED_ZH, quantityBasisOf, type CompareCostSuggestion } from "./compare-cost-source";

export async function loadCompareCostSuggestion(input: { projectId: string; orgId: string; now?: Date }): Promise<CompareCostSuggestion> {
  const selected = await db.inquiryItem.findFirst({
    where: {
      isSelected: true,
      status: ITEM_STATUS.QUOTED,
      inquiry: { projectId: input.projectId, project: { orgId: input.orgId } },
    },
    orderBy: [{ inquiry: { roundNumber: "desc" } }, { updatedAt: "desc" }],
    select: { id: true, inquiryId: true, inquiry: { select: { roundNumber: true } } },
  });
  if (!selected) return { status: "none_selected", messageZh: NONE_SELECTED_ZH };

  const later = await db.projectInquiry.findMany({
    where: { projectId: input.projectId, roundNumber: { gt: selected.inquiry.roundNumber } },
    orderBy: { roundNumber: "asc" },
    select: { roundNumber: true },
  });
  const laterUnselectedRounds = later.map((r) => r.roundNumber);

  const r = await loadCompareMatrix({
    projectId: input.projectId,
    orgId: input.orgId,
    inquiryId: selected.inquiryId,
    now: input.now,
    includeNormalized: true,
  });
  const identity = {
    inquiryId: selected.inquiryId,
    inquiryItemId: selected.id,
    roundNumber: selected.inquiry.roundNumber,
    laterUnselectedRounds,
  };
  if (!r.ok) {
    return { status: "unconvertible", supplierName: "供应商", reasons: [r.message], ...identity };
  }
  const row = r.matrix.rows.find((x) => x.itemId === selected.id);
  const normalized = r.normalizedByItemId?.[selected.id];
  if (!row || !normalized) {
    return { status: "unconvertible", supplierName: "供应商", reasons: ["选定的报价不在比价矩阵里"], ...identity };
  }
  if (row.landedCad.total == null || !normalized.breakdownCad) {
    return {
      status: "unconvertible",
      supplierName: row.supplierName,
      reasons: row.blockers.length ? row.blockers : ["换算不出落地价"],
      ...identity,
    };
  }
  return {
    status: "ok",
    supplierName: row.supplierName,
    landedCadTotal: row.landedCad.total,
    quantityBasis: quantityBasisOf(row.quoted.totalPrice, r.firstTierQty),
    breakdown: normalized.breakdownCad,
    // 只带落地价换算的假设与警告（汇率、运费、关税口径），不带合规检查的文字
    assumptions: normalized.assumptions,
    warnings: normalized.warnings,
    ...identity,
  };
}
