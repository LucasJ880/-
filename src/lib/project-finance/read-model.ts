/**
 * T2-P1.5 Budget vs Actual 只读模型（server-side，从权威模型计算）
 *
 * 数据源只允许：ProjectBudgetVersion/Line（预算）+ ProjectCost（承诺/实际）+ 已审批 ProjectExpenseSubmission。
 * 禁止从聊天 / AuditLog / AI memory 推算。
 *
 * 口径：
 * - baseline = AWARD_BASELINE 版本；current = ACTIVE 版本。
 * - actual = ProjectCost.ACTUAL（非 VOIDED，authoritative 合计）；
 *   **行级滚动亦从 ProjectCost 读**（refs.budgetLineId），而非从 submission 表求和 —— T2-P1.6 修正：
 *   ① 唯一事实源纪律：submission 是流程记录，ProjectCost 才是成本事实；
 *   ② 多币种下 submission.totalAmount 是**原始币种**金额，直接求和会把 CNY 与 CAD 相加；
 *   ③ FX 结算修正（void + correction）后金额自动生效，无需二次同步。
 * - committed = ProjectCost.COMMITTED（非 VOIDED，v1 仅项目总计；per-line 待 CO/直接成本链接的后续版本）。
 */
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { isBaseCurrency } from "./money";

const Z = new Prisma.Decimal(0);

/** 从 ProjectCost.refs 安全读出 budgetLineId（refs 是 Json，形状由 cost-service 写入方保证）。 */
function budgetLineIdOf(refs: Prisma.JsonValue | null): string | null {
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) return null;
  const v = (refs as Record<string, unknown>).budgetLineId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pctVariance(budget: Prisma.Decimal, actual: Prisma.Decimal): number | null {
  if (budget.isZero()) return null;
  return Number(actual.sub(budget).div(budget).mul(100).toFixed(2));
}

export interface BudgetVsActualLine {
  budgetLineId: string;
  category: string;
  currentBudgetAmount: string;
  baselineAmount: string;
  committedAmount: string;
  actualAmount: string;
  varianceAmount: string;
  variancePercentage: number | null;
}

export interface BudgetVsActualCategory {
  category: string;
  currentBudgetAmount: string;
  baselineAmount: string;
  actualAmount: string;
  varianceAmount: string;
  variancePercentage: number | null;
}

export interface BudgetVsActual {
  currency: string | null;
  hasActiveBudget: boolean;
  hasBaseline: boolean;
  activeVersionNumber: number | null;
  baselineVersionNumber: number | null;
  total: {
    baselineAmount: string;
    currentBudgetAmount: string;
    committedAmount: string;
    actualAmount: string;
    varianceAmount: string;
    variancePercentage: number | null;
  };
  byLine: BudgetVsActualLine[];
  byCategory: BudgetVsActualCategory[];
  /** 未关联到任何预算行的 ProjectCost.ACTUAL 合计（如直接记的 ACTUAL 成本） */
  unlinkedActualAmount: string;
  pendingReviewCount: number;
}

export async function getBudgetVsActual(
  orgId: string,
  projectId: string,
): Promise<BudgetVsActual> {
  // 租户闸
  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true },
  });
  if (!project) {
    throw new Error("FINANCE_TENANT_MISMATCH");
  }

  const budget = await db.projectBudget.findUnique({
    where: { orgId_projectId: { orgId, projectId } },
  });

  const activeVersion = budget
    ? await db.projectBudgetVersion.findFirst({
        where: { budgetId: budget.id, status: "ACTIVE" },
      })
    : null;
  const baselineVersion = budget?.awardBaselineVersionId
    ? await db.projectBudgetVersion.findUnique({
        where: { id: budget.awardBaselineVersionId },
      })
    : null;

  const activeLines = activeVersion
    ? await db.projectBudgetLine.findMany({
        where: { budgetVersionId: activeVersion.id },
        orderBy: { sortOrder: "asc" },
      })
    : [];
  const baselineLines = baselineVersion
    ? await db.projectBudgetLine.findMany({
        where: { budgetVersionId: baselineVersion.id },
      })
    : [];

  // 实际按预算行滚动：直接读权威 ProjectCost.ACTUAL 的 refs.budgetLineId
  // （VOIDED 天然被 costStatus 过滤掉；FX correction 新行携带同一 budgetLineId）
  const actualCosts = await db.projectCost.findMany({
    where: { orgId, projectId, costStatus: "ACTUAL" },
    select: { amountActual: true, currency: true, refs: true },
  });
  const actualByLine = new Map<string, Prisma.Decimal>();
  let actualTotal = Z;
  let linkedActual = Z;
  for (const c of actualCosts) {
    // 权威成本行一律 CAD；legacy 非 CAD 行不并入合计（避免跨币种相加），由 profitability 读模型计数上报
    if (!isBaseCurrency(c.currency)) continue;
    const amount = c.amountActual ?? Z;
    actualTotal = actualTotal.add(amount);
    const lineId = budgetLineIdOf(c.refs);
    if (lineId) {
      linkedActual = linkedActual.add(amount);
      actualByLine.set(lineId, (actualByLine.get(lineId) ?? Z).add(amount));
    }
  }

  const committedAgg = await db.projectCost.aggregate({
    where: { orgId, projectId, costStatus: "COMMITTED" },
    _sum: { amountCommitted: true },
  });
  const committedTotal = committedAgg._sum.amountCommitted ?? Z;

  const pendingReviewCount = await db.projectExpenseSubmission.count({
    where: { orgId, projectId, status: "PENDING_REVIEW" },
  });

  // baseline 按行 id + 类别
  const baselineByLineId = new Map(baselineLines.map((l) => [l.id, l.amount]));
  const baselineByCategory = new Map<string, Prisma.Decimal>();
  for (const l of baselineLines) {
    baselineByCategory.set(l.category, (baselineByCategory.get(l.category) ?? Z).add(l.amount));
  }

  const byLine: BudgetVsActualLine[] = activeLines.map((l) => {
    const current = l.amount;
    const baseline = baselineByLineId.get(l.id) ?? Z;
    const actual = actualByLine.get(l.id) ?? Z;
    const variance = current.sub(actual);
    return {
      budgetLineId: l.id,
      category: l.category,
      currentBudgetAmount: current.toString(),
      baselineAmount: baseline.toString(),
      committedAmount: "0",
      actualAmount: actual.toString(),
      varianceAmount: variance.toString(),
      variancePercentage: pctVariance(current, actual),
    };
  });

  // 类别级：current（ACTIVE 行按类别）+ baseline（按类别）+ actual（按类别经 approved expense 的行→类别）
  const currentByCategory = new Map<string, Prisma.Decimal>();
  const lineCategory = new Map(activeLines.map((l) => [l.id, l.category]));
  for (const l of activeLines) {
    currentByCategory.set(l.category, (currentByCategory.get(l.category) ?? Z).add(l.amount));
  }
  const actualByCategory = new Map<string, Prisma.Decimal>();
  for (const [lineId, amt] of actualByLine) {
    const cat = lineCategory.get(lineId) ?? "OTHER";
    actualByCategory.set(cat, (actualByCategory.get(cat) ?? Z).add(amt));
  }
  const categories = new Set<string>([
    ...currentByCategory.keys(),
    ...baselineByCategory.keys(),
    ...actualByCategory.keys(),
  ]);
  const byCategory: BudgetVsActualCategory[] = [...categories].sort().map((cat) => {
    const current = currentByCategory.get(cat) ?? Z;
    const baseline = baselineByCategory.get(cat) ?? Z;
    const actual = actualByCategory.get(cat) ?? Z;
    return {
      category: cat,
      currentBudgetAmount: current.toString(),
      baselineAmount: baseline.toString(),
      actualAmount: actual.toString(),
      varianceAmount: current.sub(actual).toString(),
      variancePercentage: pctVariance(current, actual),
    };
  });

  const currentTotal = activeVersion?.totalBudgetAmount ?? Z;
  const baselineTotal = baselineVersion?.totalBudgetAmount ?? Z;
  // 未关联任何预算行的权威 ACTUAL 合计（如直接记的 ACTUAL 成本 / 无 budgetLineId 的费用）
  const unlinkedActual = actualTotal.sub(linkedActual);

  return {
    currency: budget?.currency ?? null,
    hasActiveBudget: Boolean(activeVersion),
    hasBaseline: Boolean(baselineVersion),
    activeVersionNumber: activeVersion?.versionNumber ?? null,
    baselineVersionNumber: baselineVersion?.versionNumber ?? null,
    total: {
      baselineAmount: baselineTotal.toString(),
      currentBudgetAmount: currentTotal.toString(),
      committedAmount: committedTotal.toString(),
      actualAmount: actualTotal.toString(),
      varianceAmount: currentTotal.sub(actualTotal).toString(),
      variancePercentage: pctVariance(currentTotal, actualTotal),
    },
    byLine,
    byCategory,
    unlinkedActualAmount: unlinkedActual.toString(),
    pendingReviewCount,
  };
}
