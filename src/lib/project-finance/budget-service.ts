/**
 * T2-P1.5 预算服务 — 版本化预算 + AWARD_BASELINE 冻结（canonical 写入口）
 *
 * 契约：
 * - 一个项目至多一个 current ACTIVE version（激活新版自动 SUPERSEDE 旧 ACTIVE）。
 * - AWARD_BASELINE 冻结后不得原地改其财务事实（行不可增删改）；后续变化 = 新版本。
 * - budget.created / budget.version.created / budget.activated / budget.baseline_frozen 全部写 ProjectEvent（同事务）。
 * - 业务代码不得直接 prisma.projectBudget*.create/update —— 一律经本服务。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendProjectEvent } from "@/lib/project-ledger/event-service";
import type { LedgerActor } from "@/lib/project-ledger/types";
import {
  budgetActivatedEventKey,
  budgetBaselineFrozenEventKey,
  budgetCreatedEventKey,
  budgetVersionCreatedEventKey,
} from "./event-keys";
import {
  BUDGET_LINE_CATEGORIES,
  BaselineImmutableError,
  FinanceContractError,
  FinanceTenantError,
  PERCENTAGE_BUDGET_CATEGORIES,
  type BudgetLineCategory,
} from "./types";

type Tx = Prisma.TransactionClient;
type DecimalInput = Prisma.Decimal | string | number;

function dec(v: DecimalInput): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

async function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.$transaction(fn);
}

export interface BudgetLineInput {
  category: BudgetLineCategory | string;
  amount: DecimalInput;
  percentage?: DecimalInput | null;
  basis?: string | null;
  basisAmount?: DecimalInput | null;
  note?: string | null;
  supplierName?: string | null;
  sourceReference?: string | null;
  relatedTaskId?: string | null;
  relatedMilestoneId?: string | null;
  sortOrder?: number;
}

function assertBudgetCategory(c: string): asserts c is BudgetLineCategory {
  if (!(BUDGET_LINE_CATEGORIES as readonly string[]).includes(c)) {
    throw new FinanceContractError(`未知预算类别: ${c}`);
  }
}

/** 百分比型行必须保留可还原计算基础（basis+basisAmount）；禁止只存最终金额 */
function assertPercentageLineHasBasis(line: BudgetLineInput): void {
  const isPct = (PERCENTAGE_BUDGET_CATEGORIES as readonly string[]).includes(
    line.category,
  );
  if (!isPct) return;
  if (line.percentage == null || line.basisAmount == null || !line.basis) {
    throw new FinanceContractError(
      `${line.category} 为百分比型预算行，必须提供 percentage + basis + basisAmount（保留可还原来源），不得只存最终金额`,
    );
  }
}

function sumLines(lines: BudgetLineInput[]): Prisma.Decimal {
  return lines.reduce((acc, l) => acc.add(dec(l.amount)), new Prisma.Decimal(0));
}

/** 获取或创建项目预算容器（幂等：每项目至多一个） */
export async function getOrCreateProjectBudget(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  currency: string;
  actor: LedgerActor;
  createdById: string;
}) {
  return inTx(input.tx, async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, orgId: input.orgId },
      select: { id: true },
    });
    if (!project) throw new FinanceTenantError();

    const existing = await tx.projectBudget.findUnique({
      where: { orgId_projectId: { orgId: input.orgId, projectId: input.projectId } },
    });
    if (existing) return existing;

    const budget = await tx.projectBudget.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        currency: input.currency,
        createdById: input.createdById,
      },
    });
    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "budget.created",
      eventKey: budgetCreatedEventKey(budget.id),
      occurredAt: budget.createdAt,
      actor: input.actor,
      title: "项目预算已创建",
      payload: { schemaVersion: 1, budgetId: budget.id, currency: budget.currency },
      refs: { budgetId: budget.id },
    });
    return budget;
  });
}

/** 创建 DRAFT 预算版本（含预算行）；不自动激活 */
export async function createBudgetVersion(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  currency: string;
  actor: LedgerActor;
  createdById: string;
  note?: string | null;
  lines: BudgetLineInput[];
}) {
  for (const line of input.lines) {
    assertBudgetCategory(line.category);
    assertPercentageLineHasBasis(line);
  }
  return inTx(input.tx, async (tx) => {
    const budget = await getOrCreateProjectBudget({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      currency: input.currency,
      actor: input.actor,
      createdById: input.createdById,
    });

    const maxVer = await tx.projectBudgetVersion.aggregate({
      where: { budgetId: budget.id },
      _max: { versionNumber: true },
    });
    const versionNumber = (maxVer._max.versionNumber ?? 0) + 1;
    const total = sumLines(input.lines);

    const version = await tx.projectBudgetVersion.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        budgetId: budget.id,
        versionNumber,
        status: "DRAFT",
        note: input.note ?? null,
        totalBudgetAmount: total,
        createdById: input.createdById,
      },
    });

    for (const [i, line] of input.lines.entries()) {
      await tx.projectBudgetLine.create({
        data: {
          orgId: input.orgId,
          projectId: input.projectId,
          budgetVersionId: version.id,
          category: line.category,
          amount: dec(line.amount),
          percentage: line.percentage != null ? dec(line.percentage) : null,
          basis: line.basis ?? null,
          basisAmount: line.basisAmount != null ? dec(line.basisAmount) : null,
          note: line.note ?? null,
          supplierName: line.supplierName ?? null,
          sourceReference: line.sourceReference ?? null,
          relatedTaskId: line.relatedTaskId ?? null,
          relatedMilestoneId: line.relatedMilestoneId ?? null,
          sortOrder: line.sortOrder ?? i,
          createdById: input.createdById,
        },
      });
    }

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "budget.version.created",
      eventKey: budgetVersionCreatedEventKey(version.id),
      occurredAt: version.createdAt,
      actor: input.actor,
      title: `预算版本 v${versionNumber} 已创建（草稿）`,
      payload: {
        schemaVersion: 1,
        budgetId: budget.id,
        versionId: version.id,
        versionNumber,
        totalBudgetAmount: total.toString(),
        lineCount: input.lines.length,
      },
      refs: { budgetId: budget.id, versionId: version.id },
    });

    return { budget, version };
  });
}

async function loadOwnedVersion(tx: Tx, orgId: string, projectId: string, versionId: string) {
  const version = await tx.projectBudgetVersion.findFirst({
    where: { id: versionId, orgId, projectId },
  });
  if (!version) throw new FinanceTenantError("budget version not found in project/organization");
  return version;
}

/** 激活版本为 current ACTIVE；同项目既有 ACTIVE → SUPERSEDED（AWARD_BASELINE 不受影响，永久保留） */
export async function activateBudgetVersion(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  versionId: string;
  actor: LedgerActor;
  actorUserId: string;
}) {
  return inTx(input.tx, async (tx) => {
    const version = await loadOwnedVersion(tx, input.orgId, input.projectId, input.versionId);
    if (version.status === "AWARD_BASELINE") {
      throw new BaselineImmutableError("AWARD_BASELINE 版本不可再改为 ACTIVE；如需新预算请创建新版本");
    }
    if (version.status === "ACTIVE") return version;
    if (version.status === "SUPERSEDED") {
      throw new FinanceContractError("已 SUPERSEDED 版本不可重新激活；请基于其创建新版本", 409);
    }

    // 既有 ACTIVE → SUPERSEDED（不动 AWARD_BASELINE）
    await tx.projectBudgetVersion.updateMany({
      where: { budgetId: version.budgetId, status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });
    const activated = await tx.projectBudgetVersion.update({
      where: { id: version.id },
      data: { status: "ACTIVE", activatedById: input.actorUserId, activatedAt: new Date() },
    });
    await tx.projectBudget.update({
      where: { id: version.budgetId },
      data: { currentVersionId: version.id },
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "budget.activated",
      eventKey: budgetActivatedEventKey(version.id),
      occurredAt: new Date(),
      actor: input.actor,
      title: `预算版本 v${version.versionNumber} 已激活`,
      payload: {
        schemaVersion: 1,
        budgetId: version.budgetId,
        versionId: version.id,
        versionNumber: version.versionNumber,
        totalBudgetAmount: activated.totalBudgetAmount.toString(),
      },
      refs: { budgetId: version.budgetId, versionId: version.id },
    });
    return activated;
  });
}

/**
 * 冻结 AWARD_BASELINE（原始中标假设永久保留）：把来源版本（默认当前 ACTIVE）的行**快照**为
 * 一个新的 AWARD_BASELINE 版本（不可变副本），与 current ACTIVE 并存 —— 之后 baseline 永不被
 * 后续 ACTIVE 修订覆盖，实现 Baseline vs Actual。写 budget.baseline_frozen 事件。
 * 幂等：项目已存在 AWARD_BASELINE → 返回既有。
 */
export async function freezeAwardBaseline(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  actor: LedgerActor;
  actorUserId: string;
  /** 来源版本；缺省 = 当前 ACTIVE */
  sourceVersionId?: string;
}) {
  return inTx(input.tx, async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, orgId: input.orgId },
      select: { id: true },
    });
    if (!project) throw new FinanceTenantError();

    const budget = await tx.projectBudget.findUnique({
      where: { orgId_projectId: { orgId: input.orgId, projectId: input.projectId } },
    });
    if (!budget) throw new FinanceContractError("项目尚无预算，无法冻结 baseline", 409);

    // 幂等：已存在 baseline → 返回既有
    if (budget.awardBaselineVersionId) {
      return tx.projectBudgetVersion.findUniqueOrThrow({
        where: { id: budget.awardBaselineVersionId },
      });
    }

    const source = input.sourceVersionId
      ? await loadOwnedVersion(tx, input.orgId, input.projectId, input.sourceVersionId)
      : await tx.projectBudgetVersion.findFirst({
          where: { budgetId: budget.id, status: "ACTIVE" },
        });
    if (!source) {
      throw new FinanceContractError("没有可冻结的来源版本（需先激活一个预算版本）", 409);
    }
    const sourceLines = await tx.projectBudgetLine.findMany({
      where: { budgetVersionId: source.id },
      orderBy: { sortOrder: "asc" },
    });

    const maxVer = await tx.projectBudgetVersion.aggregate({
      where: { budgetId: budget.id },
      _max: { versionNumber: true },
    });
    const versionNumber = (maxVer._max.versionNumber ?? 0) + 1;

    // 不可变快照版本
    const baseline = await tx.projectBudgetVersion.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        budgetId: budget.id,
        versionNumber,
        status: "AWARD_BASELINE",
        note: `AWARD_BASELINE（快照自 v${source.versionNumber}）`,
        totalBudgetAmount: source.totalBudgetAmount,
        baselineFrozenById: input.actorUserId,
        baselineFrozenAt: new Date(),
        createdById: input.actorUserId,
      },
    });
    for (const l of sourceLines) {
      await tx.projectBudgetLine.create({
        data: {
          orgId: input.orgId,
          projectId: input.projectId,
          budgetVersionId: baseline.id,
          category: l.category,
          amount: l.amount,
          percentage: l.percentage,
          basis: l.basis,
          basisAmount: l.basisAmount,
          note: l.note,
          supplierName: l.supplierName,
          sourceReference: l.sourceReference,
          relatedTaskId: l.relatedTaskId,
          relatedMilestoneId: l.relatedMilestoneId,
          sortOrder: l.sortOrder,
          createdById: input.actorUserId,
        },
      });
    }
    await tx.projectBudget.update({
      where: { id: budget.id },
      data: { awardBaselineVersionId: baseline.id },
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "budget.baseline_frozen",
      eventKey: budgetBaselineFrozenEventKey(baseline.id),
      occurredAt: new Date(),
      actor: input.actor,
      title: `AWARD_BASELINE 已冻结：v${versionNumber}（快照自 v${source.versionNumber}）`,
      payload: {
        schemaVersion: 1,
        budgetId: budget.id,
        versionId: baseline.id,
        sourceVersionId: source.id,
        versionNumber,
        baselineAmount: baseline.totalBudgetAmount.toString(),
        currency: budget.currency,
      },
      refs: { budgetId: budget.id, versionId: baseline.id },
    });
    return baseline;
  });
}

/** 断言版本可被原地修改行（AWARD_BASELINE / SUPERSEDED 不可）；供未来 line 编辑 API 复用 */
export async function assertVersionEditable(tx: Tx, orgId: string, projectId: string, versionId: string) {
  const version = await loadOwnedVersion(tx, orgId, projectId, versionId);
  if (version.status === "AWARD_BASELINE") {
    throw new BaselineImmutableError();
  }
  if (version.status === "SUPERSEDED") {
    throw new FinanceContractError("SUPERSEDED 版本不可原地修改；请基于其创建新版本", 409);
  }
  return version;
}
