/**
 * T2-P1.5 费用提交服务 — 状态机 + 审核 + 审批→ProjectCost.ACTUAL（canonical 写入口）
 *
 * 核心不变量：
 * - Submission ≠ Authoritative Cost：只有 approveExpense 在同一权威事务内经 cost-service 产 ProjectCost.ACTUAL。
 * - 自审批禁止：submittedById === reviewerUserId → SelfApprovalError（服务端硬拒，非仅 UI disable）。
 * - 幂等：一份 expense 至多一条 approved ProjectCost。并发/双击 approve 经条件 updateMany 状态闸收敛。
 * - 原子：审批的 状态翻转 + ProjectCost + approvedProjectCostId + ProjectEvent 全或全无回滚。
 * - 生命周期转移集中于 types.EXPENSE_TRANSITIONS，禁止散落 route/UI。
 * - 状态机 command，不让 route 直接 update status。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendProjectEvent } from "@/lib/project-ledger/event-service";
import { createProjectCost } from "@/lib/project-ledger/cost-service";
import { isLedgerProducerActive } from "@/lib/project-ledger/flags";
import type { LedgerActor } from "@/lib/project-ledger/types";
import {
  expenseAmountConfirmedEventKey,
  expenseApprovedEventKey,
  expenseCreatedEventKey,
  expenseFxRateLockedEventKey,
  expenseInfoRequestedEventKey,
  expenseRejectedEventKey,
  expenseResubmittedEventKey,
  expenseSubmittedEventKey,
} from "./event-keys";
import { buildFxSnapshot, type FxSnapshot } from "./fx";
import { isProfitabilitySchemaReady } from "./flags";
import {
  BASE_CURRENCY,
  isBaseCurrency,
  normalizeCurrency,
  resolveExpenseCad,
  type DecimalInput as MoneyInput,
  type FxRateSource,
} from "./money";
import { createPayableForApprovedExpense } from "./settlement-service";
import {
  canTransitionExpense,
  EXPENSE_COST_CATEGORIES,
  EXPENSE_FUNDING_SOURCES,
  ExpenseStateError,
  FinanceContractError,
  FinanceTenantError,
  SelfApprovalError,
  type ExpenseCostCategory,
  type ExpenseFundingSource,
} from "./types";

type Tx = Prisma.TransactionClient;
type DecimalInput = Prisma.Decimal | string | number;

function dec(v: DecimalInput): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}
async function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.$transaction(fn);
}

function assertCostCategory(c: string): asserts c is ExpenseCostCategory {
  if (!(EXPENSE_COST_CATEGORIES as readonly string[]).includes(c)) {
    throw new FinanceContractError(
      `费用成本类别非法: ${c}（须落在冻结 ProjectCost 类别内，且不得为 AI/DATA_API）`,
    );
  }
}

async function loadOwnedExpense(tx: Tx, orgId: string, projectId: string, expenseId: string) {
  const e = await tx.projectExpenseSubmission.findFirst({
    where: { id: expenseId, orgId, projectId },
  });
  if (!e) throw new FinanceTenantError("expense not found in project/organization");
  return e;
}

function assertFundingSource(v: string): asserts v is ExpenseFundingSource {
  if (!(EXPENSE_FUNDING_SOURCES as readonly string[]).includes(v)) {
    throw new FinanceContractError(`出资来源非法: ${v}`);
  }
}

/**
 * 出资来源归属校验（服务端硬闸）：
 * `EMPLOYEE_PERSONAL` 的垫资人必须就是提交人 —— 普通成员不得替他人伪造个人垫付，
 * 否则等于可以给任意用户凭空造一条报销应付。route 层已强制 submittedById = 登录用户，
 * 二者叠加即「谁都无法替别人申报个人垫付」。
 */
function resolvePaidByUserId(input: {
  fundingSource?: string | null;
  paidByUserId?: string | null;
  submittedById: string;
}): string | null {
  if (!input.fundingSource) return null;
  assertFundingSource(input.fundingSource);
  if (input.fundingSource !== "EMPLOYEE_PERSONAL") {
    // 公司卡/银行/国内代付/供应商未付：不存在「员工垫资人」
    return null;
  }
  const claimed = input.paidByUserId ?? input.submittedById;
  if (claimed !== input.submittedById) {
    throw new FinanceContractError(
      "个人垫付费用的垫资人必须是提交人本人；不得代他人申报个人垫付",
      403,
    );
  }
  return input.submittedById;
}

/** 非 CAD 费用必须带 FX 快照；CAD 费用短路（rate=1，estimated=total）。 */
async function buildExpenseFx(input: {
  totalAmount: Prisma.Decimal;
  currency: string;
  fxRateCadPerOriginalUnit?: MoneyInput | null;
  fxRateDate?: Date | null;
  fxRateSource?: FxRateSource | null;
  expenseOccurredAt: Date;
}): Promise<FxSnapshot> {
  return buildFxSnapshot({
    originalAmount: input.totalAmount,
    originalCurrency: input.currency,
    fxRateCadPerOriginalUnit: input.fxRateCadPerOriginalUnit ?? null,
    // 汇率日缺省 = 费用发生日（快照语义；绝不隐式用「今天」）
    fxRateDate: input.fxRateDate ?? input.expenseOccurredAt,
    fxRateSource: input.fxRateSource ?? null,
  });
}

export interface CreateExpenseDraftInput {
  tx?: Tx;
  orgId: string;
  projectId: string;
  actor: LedgerActor;
  submittedById: string;
  costCategory: string;
  budgetLineId?: string | null;
  expenseOccurredAt: Date;
  vendorName?: string | null;
  description: string;
  subtotal?: DecimalInput | null;
  taxAmount?: DecimalInput | null;
  /** 原始金额（用户录入币种下的金额；永久保留，绝不被折算覆盖） */
  totalAmount: DecimalInput;
  /** 原始币种 */
  currency: string;
  projectPhaseSnapshot?: string | null;
  projectStageSnapshot?: string | null;
  relatedTaskId?: string | null;
  relatedMilestoneId?: string | null;
  /* ── T2-P1.6 ── */
  /** 1 单位 currency = X CAD；currency=CAD 时忽略（恒 1） */
  fxRateCadPerOriginalUnit?: DecimalInput | null;
  fxRateDate?: Date | null;
  fxRateSource?: FxRateSource | null;
  /** 谁先付的钱；缺省 null = UNSPECIFIED（审批不产生应付） */
  fundingSource?: string | null;
  paidByUserId?: string | null;
  /**
   * 金额确认人。缺省 = submittedById：由**人**发起的创建动作本身即金额确认
   * （AI/OCR 结果只能落在 extracted* 列，永远无法经此路径成为 totalAmount）。
   */
  amountConfirmedById?: string | null;
}

/** DRAFT 费用创建（草稿；未提交，不产成本） */
export async function createExpenseDraft(input: CreateExpenseDraftInput) {
  assertCostCategory(input.costCategory);
  if (!input.description?.trim()) throw new FinanceContractError("费用描述必填");
  const total = dec(input.totalAmount);
  if (!total.isFinite() || total.lte(0)) throw new FinanceContractError("费用金额必须为正");
  const currency = normalizeCurrency(input.currency);
  if (!currency) throw new FinanceContractError("费用币种必填");
  const paidByUserId = resolvePaidByUserId({
    fundingSource: input.fundingSource,
    paidByUserId: input.paidByUserId,
    submittedById: input.submittedById,
  });
  // FX 快照在事务外解析（可能触达 provider），落库在事务内
  const fx = await buildExpenseFx({
    totalAmount: total,
    currency,
    fxRateCadPerOriginalUnit: input.fxRateCadPerOriginalUnit,
    fxRateDate: input.fxRateDate,
    fxRateSource: input.fxRateSource,
    expenseOccurredAt: input.expenseOccurredAt,
  });
  const amountConfirmedById = input.amountConfirmedById ?? input.submittedById;

  return inTx(input.tx, async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, orgId: input.orgId },
      select: { id: true },
    });
    if (!project) throw new FinanceTenantError();

    const expense = await tx.projectExpenseSubmission.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        budgetLineId: input.budgetLineId ?? null,
        costCategory: input.costCategory,
        submittedById: input.submittedById,
        expenseOccurredAt: input.expenseOccurredAt,
        vendorName: input.vendorName ?? null,
        description: input.description.trim(),
        subtotal: input.subtotal != null ? dec(input.subtotal) : null,
        taxAmount: input.taxAmount != null ? dec(input.taxAmount) : null,
        totalAmount: total,
        currency,
        status: "DRAFT",
        projectPhaseSnapshot: input.projectPhaseSnapshot ?? null,
        projectStageSnapshot: input.projectStageSnapshot ?? null,
        relatedTaskId: input.relatedTaskId ?? null,
        relatedMilestoneId: input.relatedMilestoneId ?? null,
        fxRateCadPerOriginalUnit: fx.fxRateCadPerOriginalUnit,
        fxRateDate: fx.fxRateDate,
        fxRateSource: fx.fxRateSource,
        estimatedCadAmount: fx.estimatedCadAmount,
        fundingSource: input.fundingSource ?? null,
        paidByUserId,
        amountConfirmedAt: new Date(),
        amountConfirmedById,
      },
    });
    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "expense.created",
      eventKey: expenseCreatedEventKey(expense.id),
      occurredAt: expense.createdAt,
      actor: input.actor,
      title: `费用草稿：${input.costCategory}`,
      payload: {
        schemaVersion: 2,
        expenseId: expense.id,
        costCategory: input.costCategory,
        totalAmount: total.toString(),
        currency,
        estimatedCadAmount: fx.estimatedCadAmount.toString(),
        fundingSource: input.fundingSource ?? null,
      },
      refs: { expenseSubmissionId: expense.id, budgetLineId: input.budgetLineId ?? undefined },
    });
    // 金额人工确认留痕（EXP-MOBILE-06）
    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "expense.amount_confirmed",
      eventKey: expenseAmountConfirmedEventKey(expense.id, expense.transitionCount),
      occurredAt: expense.createdAt,
      actor: input.actor,
      title: `金额已确认：${total.toString()} ${currency}`,
      payload: {
        schemaVersion: 1,
        expenseId: expense.id,
        totalAmount: total.toString(),
        currency,
        confirmedById: amountConfirmedById,
      },
      refs: { expenseSubmissionId: expense.id },
    });
    // 非 CAD：额外锁定汇率事件（CAD 无 FX 流程，不产噪声事件）
    if (!isBaseCurrency(currency)) {
      await appendProjectEvent({
        tx,
        orgId: input.orgId,
        projectId: input.projectId,
        eventType: "expense.fx_rate_locked",
        eventKey: expenseFxRateLockedEventKey(expense.id, expense.transitionCount),
        occurredAt: expense.createdAt,
        actor: input.actor,
        title: `汇率已锁定：1 ${currency} = ${fx.fxRateCadPerOriginalUnit.toString()} ${BASE_CURRENCY}`,
        payload: {
          schemaVersion: 1,
          expenseId: expense.id,
          originalAmount: total.toString(),
          originalCurrency: currency,
          fxRateCadPerOriginalUnit: fx.fxRateCadPerOriginalUnit.toString(),
          fxRateDate: fx.fxRateDate.toISOString(),
          fxRateSource: fx.fxRateSource,
          estimatedCadAmount: fx.estimatedCadAmount.toString(),
        },
        refs: { expenseSubmissionId: expense.id },
      });
    }
    return expense;
  });
}

export interface UpdateExpenseDraftInput {
  tx?: Tx;
  orgId: string;
  projectId: string;
  expenseId: string;
  actor: LedgerActor;
  /** 服务端可信操作人；必须 = submittedById（本人才能改自己未锁定的费用） */
  actorUserId: string;
  changes: {
    costCategory?: string;
    budgetLineId?: string | null;
    expenseOccurredAt?: Date;
    vendorName?: string | null;
    description?: string;
    subtotal?: DecimalInput | null;
    taxAmount?: DecimalInput | null;
    totalAmount?: DecimalInput;
    currency?: string;
    fxRateCadPerOriginalUnit?: DecimalInput | null;
    fxRateDate?: Date | null;
    fxRateSource?: FxRateSource | null;
    fundingSource?: string | null;
    paidByUserId?: string | null;
  };
}

/**
 * 修改尚未锁定的**本人**费用（DRAFT / NEEDS_INFO）。
 * 金额或币种变化 → 重算 FX 快照 + 重新记录金额确认事件（任务书 §7 时间线：
 * 「10:41 Lucas changed amount $23 → $28」必须可追溯）。
 * 终态（APPROVED / REJECTED）与在审态（SUBMITTED / PENDING_REVIEW / RESUBMITTED）一律拒绝。
 */
export async function updateExpenseDraft(input: UpdateExpenseDraftInput) {
  const c = input.changes;
  if (c.costCategory !== undefined) assertCostCategory(c.costCategory);

  const pre = await db.projectExpenseSubmission.findFirst({
    where: { id: input.expenseId, orgId: input.orgId, projectId: input.projectId },
  });
  if (!pre) throw new FinanceTenantError("expense not found in project/organization");
  if (pre.submittedById !== input.actorUserId) {
    throw new FinanceContractError("只能修改本人提交的费用", 403);
  }
  if (pre.status !== "DRAFT" && pre.status !== "NEEDS_INFO") {
    throw new ExpenseStateError(`费用当前状态 ${pre.status}，不可编辑（仅 DRAFT / NEEDS_INFO 可改）`);
  }

  const nextTotal = c.totalAmount !== undefined ? dec(c.totalAmount) : pre.totalAmount;
  if (!nextTotal.isFinite() || nextTotal.lte(0)) {
    throw new FinanceContractError("费用金额必须为正");
  }
  const nextCurrency = c.currency !== undefined ? normalizeCurrency(c.currency) : pre.currency;
  if (!nextCurrency) throw new FinanceContractError("费用币种必填");

  const amountChanged = !nextTotal.equals(pre.totalAmount) || nextCurrency !== pre.currency;
  const fxInputChanged =
    c.fxRateCadPerOriginalUnit !== undefined ||
    c.fxRateDate !== undefined ||
    c.fxRateSource !== undefined;

  // 金额/币种/汇率任一变化 → 重建快照（事务外解析）
  const fx =
    amountChanged || fxInputChanged
      ? await buildExpenseFx({
          totalAmount: nextTotal,
          currency: nextCurrency,
          fxRateCadPerOriginalUnit:
            c.fxRateCadPerOriginalUnit !== undefined
              ? c.fxRateCadPerOriginalUnit
              : pre.fxRateCadPerOriginalUnit,
          fxRateDate: c.fxRateDate !== undefined ? c.fxRateDate : pre.fxRateDate,
          fxRateSource:
            (c.fxRateSource !== undefined
              ? c.fxRateSource
              : (pre.fxRateSource as FxRateSource | null)) ?? null,
          expenseOccurredAt: c.expenseOccurredAt ?? pre.expenseOccurredAt,
        })
      : null;

  const fundingSource =
    c.fundingSource !== undefined ? c.fundingSource : pre.fundingSource;
  const paidByUserId = resolvePaidByUserId({
    fundingSource,
    paidByUserId: c.paidByUserId !== undefined ? c.paidByUserId : pre.paidByUserId,
    submittedById: pre.submittedById,
  });

  return inTx(input.tx, async (tx) => {
    const nextTransition = pre.transitionCount + 1;
    const updated = await tx.projectExpenseSubmission.update({
      where: { id: pre.id },
      data: {
        ...(c.costCategory !== undefined ? { costCategory: c.costCategory } : {}),
        ...(c.budgetLineId !== undefined ? { budgetLineId: c.budgetLineId } : {}),
        ...(c.expenseOccurredAt !== undefined ? { expenseOccurredAt: c.expenseOccurredAt } : {}),
        ...(c.vendorName !== undefined ? { vendorName: c.vendorName } : {}),
        ...(c.description !== undefined ? { description: c.description.trim() } : {}),
        ...(c.subtotal !== undefined ? { subtotal: c.subtotal != null ? dec(c.subtotal) : null } : {}),
        ...(c.taxAmount !== undefined ? { taxAmount: c.taxAmount != null ? dec(c.taxAmount) : null } : {}),
        totalAmount: nextTotal,
        currency: nextCurrency,
        ...(fx
          ? {
              fxRateCadPerOriginalUnit: fx.fxRateCadPerOriginalUnit,
              fxRateDate: fx.fxRateDate,
              fxRateSource: fx.fxRateSource,
              estimatedCadAmount: fx.estimatedCadAmount,
            }
          : {}),
        fundingSource: fundingSource ?? null,
        paidByUserId,
        transitionCount: nextTransition,
        // 金额变化 = 需要重新人工确认；此处的操作人已校验为提交人本人
        ...(amountChanged
          ? { amountConfirmedAt: new Date(), amountConfirmedById: input.actorUserId }
          : {}),
      },
    });

    if (amountChanged) {
      await appendProjectEvent({
        tx,
        orgId: input.orgId,
        projectId: input.projectId,
        eventType: "expense.amount_confirmed",
        eventKey: expenseAmountConfirmedEventKey(pre.id, nextTransition),
        occurredAt: new Date(),
        actor: input.actor,
        title: `金额已修改并确认：${pre.totalAmount.toString()} ${pre.currency} → ${nextTotal.toString()} ${nextCurrency}`,
        payload: {
          schemaVersion: 1,
          expenseId: pre.id,
          previousAmount: pre.totalAmount.toString(),
          previousCurrency: pre.currency,
          totalAmount: nextTotal.toString(),
          currency: nextCurrency,
          confirmedById: input.actorUserId,
        },
        refs: { expenseSubmissionId: pre.id },
      });
    }
    if (fx && !isBaseCurrency(nextCurrency)) {
      await appendProjectEvent({
        tx,
        orgId: input.orgId,
        projectId: input.projectId,
        eventType: "expense.fx_rate_locked",
        eventKey: expenseFxRateLockedEventKey(pre.id, nextTransition),
        occurredAt: new Date(),
        actor: input.actor,
        title: `汇率已更新：1 ${nextCurrency} = ${fx.fxRateCadPerOriginalUnit.toString()} ${BASE_CURRENCY}`,
        payload: {
          schemaVersion: 1,
          expenseId: pre.id,
          originalAmount: nextTotal.toString(),
          originalCurrency: nextCurrency,
          fxRateCadPerOriginalUnit: fx.fxRateCadPerOriginalUnit.toString(),
          fxRateDate: fx.fxRateDate.toISOString(),
          fxRateSource: fx.fxRateSource,
          estimatedCadAmount: fx.estimatedCadAmount.toString(),
        },
        refs: { expenseSubmissionId: pre.id },
      });
    }
    return updated;
  });
}

/** 通用生命周期转移（非审批；审批走 approveExpense）。集中校验状态机 + 递增 transitionCount。 */
async function transition(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  expenseId: string;
  to: "SUBMITTED" | "PENDING_REVIEW" | "NEEDS_INFO" | "RESUBMITTED" | "REJECTED";
  actor: LedgerActor;
  actorUserId: string;
  reviewNote?: string | null;
  eventType: string;
  buildKey: (expenseId: string, transitionSeq: number) => string;
  title: (versionInfo: number) => string;
  extraData?: Prisma.ProjectExpenseSubmissionUpdateInput;
}) {
  return inTx(input.tx, async (tx) => {
    const e = await loadOwnedExpense(tx, input.orgId, input.projectId, input.expenseId);
    if (!canTransitionExpense(e.status as never, input.to)) {
      throw new ExpenseStateError(`非法状态转移 ${e.status} → ${input.to}`);
    }
    const nextTransition = e.transitionCount + 1;
    const updated = await tx.projectExpenseSubmission.update({
      where: { id: e.id },
      data: {
        status: input.to,
        transitionCount: nextTransition,
        ...(input.to === "SUBMITTED" || input.to === "RESUBMITTED"
          ? { submittedAt: new Date() }
          : {}),
        ...(input.reviewNote !== undefined
          ? { reviewNote: input.reviewNote, reviewedById: input.actorUserId, reviewedAt: new Date() }
          : {}),
        ...(input.extraData ?? {}),
      },
    });
    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: input.eventType,
      eventKey: input.buildKey(e.id, nextTransition),
      occurredAt: new Date(),
      actor: input.actor,
      title: input.title(nextTransition),
      payload: {
        schemaVersion: 1,
        expenseId: e.id,
        fromStatus: e.status,
        toStatus: input.to,
        transitionSeq: nextTransition,
        ...(input.reviewNote != null ? { reviewNote: input.reviewNote } : {}),
      },
      refs: { expenseSubmissionId: e.id },
    });
    return updated;
  });
}

/** DRAFT → SUBMITTED → PENDING_REVIEW（提交即进入待审；两步合一） */
export async function submitExpense(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  expenseId: string;
  actor: LedgerActor;
  actorUserId: string;
}) {
  return inTx(input.tx, async (tx) => {
    // 金额必须由**人**确认过才能进入审核（AI/OCR 不得自动提交）。
    // legacy 行（P1.5 遗留、无确认留痕）：仅当操作人就是提交人时，在同事务内补记确认；
    // 他人提交/系统提交一律拒绝 —— 绝不代替提交人确认金额。
    const pre = await loadOwnedExpense(tx, input.orgId, input.projectId, input.expenseId);
    if (!pre.amountConfirmedAt) {
      if (pre.submittedById !== input.actorUserId) {
        throw new FinanceContractError(
          "费用金额尚未由提交人确认，不能提交审核（AI/OCR 建议值不能自动成为最终金额）",
        );
      }
      const seq = pre.transitionCount;
      await tx.projectExpenseSubmission.update({
        where: { id: pre.id },
        data: { amountConfirmedAt: new Date(), amountConfirmedById: input.actorUserId },
      });
      await appendProjectEvent({
        tx,
        orgId: input.orgId,
        projectId: input.projectId,
        eventType: "expense.amount_confirmed",
        eventKey: expenseAmountConfirmedEventKey(pre.id, seq),
        occurredAt: new Date(),
        actor: input.actor,
        title: `金额已确认：${pre.totalAmount.toString()} ${pre.currency}`,
        payload: {
          schemaVersion: 1,
          expenseId: pre.id,
          totalAmount: pre.totalAmount.toString(),
          currency: pre.currency,
          confirmedById: input.actorUserId,
          legacyBackfill: true,
        },
        refs: { expenseSubmissionId: pre.id },
      });
    }
    await transition({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      expenseId: input.expenseId,
      to: "SUBMITTED",
      actor: input.actor,
      actorUserId: input.actorUserId,
      eventType: "expense.submitted",
      buildKey: expenseSubmittedEventKey,
      title: () => "费用已提交",
    });
    return transition({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      expenseId: input.expenseId,
      to: "PENDING_REVIEW",
      actor: input.actor,
      actorUserId: input.actorUserId,
      eventType: "expense.pending_review",
      buildKey: (id, t) => `expense.pending_review:${id}:t${t}`,
      title: () => "费用进入待审核",
    });
  });
}

/** PENDING_REVIEW → NEEDS_INFO（审核方要求补充信息） */
export async function requestExpenseInfo(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  expenseId: string;
  actor: LedgerActor;
  reviewerUserId: string;
  note: string;
}) {
  if (!input.note?.trim()) throw new FinanceContractError("要求补充信息必须提供说明");
  return transition({
    tx: input.tx,
    orgId: input.orgId,
    projectId: input.projectId,
    expenseId: input.expenseId,
    to: "NEEDS_INFO",
    actor: input.actor,
    actorUserId: input.reviewerUserId,
    reviewNote: input.note.trim(),
    eventType: "expense.info_requested",
    buildKey: expenseInfoRequestedEventKey,
    title: () => "审核要求补充信息",
  });
}

/** NEEDS_INFO → RESUBMITTED → PENDING_REVIEW（提交人补充后重提） */
export async function resubmitExpense(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  expenseId: string;
  actor: LedgerActor;
  actorUserId: string;
}) {
  return inTx(input.tx, async (tx) => {
    await transition({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      expenseId: input.expenseId,
      to: "RESUBMITTED",
      actor: input.actor,
      actorUserId: input.actorUserId,
      eventType: "expense.resubmitted",
      buildKey: expenseResubmittedEventKey,
      title: () => "费用已重新提交",
    });
    return transition({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      expenseId: input.expenseId,
      to: "PENDING_REVIEW",
      actor: input.actor,
      actorUserId: input.actorUserId,
      eventType: "expense.pending_review",
      buildKey: (id, t) => `expense.pending_review:${id}:t${t}`,
      title: () => "费用重新进入待审核",
    });
  });
}

/** PENDING_REVIEW → REJECTED（终态） */
export async function rejectExpense(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  expenseId: string;
  actor: LedgerActor;
  reviewerUserId: string;
  note: string;
}) {
  if (!input.note?.trim()) throw new FinanceContractError("拒绝必须提供理由");
  return inTx(input.tx, async (tx) => {
    const e = await loadOwnedExpense(tx, input.orgId, input.projectId, input.expenseId);
    // 自审批同样禁止（拒绝亦是审核动作）
    if (e.submittedById === input.reviewerUserId) throw new SelfApprovalError();
    return transition({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      expenseId: input.expenseId,
      to: "REJECTED",
      actor: input.actor,
      actorUserId: input.reviewerUserId,
      reviewNote: input.note.trim(),
      eventType: "expense.rejected",
      buildKey: (id) => expenseRejectedEventKey(id),
      title: () => "费用被拒绝",
    });
  });
}

export interface ApproveExpenseResult {
  expense: { id: string; status: string; approvedProjectCostId: string | null };
  cost: { id: string; costStatus: string } | null;
  /** 结算子账（EMPLOYEE_PERSONAL / CHINA_AFFILIATE / VENDOR_INVOICE_UNPAID 才有；公司已付 → null） */
  payable: { id: string; settlementType: string; amountCad: string } | null;
  created: boolean;
}

/**
 * PENDING_REVIEW → APPROVED，原子产 ProjectCost.ACTUAL（经 cost-service）。
 * 条件 updateMany(status=PENDING_REVIEW) 作并发/双击闸；只有胜者创建成本。
 */
export async function approveExpense(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  expenseId: string;
  actor: LedgerActor; // 审核人（server-authorized）
  reviewerUserId: string;
  reviewNote?: string | null;
}): Promise<ApproveExpenseResult> {
  return inTx(input.tx, async (tx) => {
    const e = await loadOwnedExpense(tx, input.orgId, input.projectId, input.expenseId);

    // 幂等快路：已审批 → 返回既有（不重复产成本、不重复产应付）
    if (e.status === "APPROVED" && e.approvedProjectCostId) {
      const existingPayable = isProfitabilitySchemaReady()
        ? await tx.projectExpensePayable.findUnique({ where: { expenseSubmissionId: e.id } })
        : null;
      return {
        expense: { id: e.id, status: e.status, approvedProjectCostId: e.approvedProjectCostId },
        cost: { id: e.approvedProjectCostId, costStatus: "ACTUAL" },
        payable: existingPayable
          ? {
              id: existingPayable.id,
              settlementType: existingPayable.settlementType,
              amountCad: existingPayable.amountCad.toString(),
            }
          : null,
        created: false,
      };
    }
    if (!canTransitionExpense(e.status as never, "APPROVED")) {
      throw new ExpenseStateError(`仅 PENDING_REVIEW 可审批；当前 ${e.status}`);
    }
    // 自审批硬拒
    if (e.submittedById === input.reviewerUserId) throw new SelfApprovalError();
    // dark-merge / fail-closed：产权威成本须 ledger producer 有效开启
    // = T3.5 canonical isLedgerProducerActive()（SCHEMA_READY && PRODUCERS_ENABLED）。
    // 绝不单看 PRODUCERS_ENABLED——schema 未就绪时严禁写 M1 表（ProjectCost）。
    if (!isLedgerProducerActive()) {
      throw new FinanceContractError(
        "审批产 ProjectCost.ACTUAL 需 isLedgerProducerActive()（T2_LEDGER_SCHEMA_READY && T2_LEDGER_PRODUCERS_ENABLED）；当前 ledger producer 未有效开启",
        409,
      );
    }
    assertCostCategory(e.costCategory);

    // 权威 CAD 金额（RULE 3：ProjectCost 一律以 BASE_CURRENCY 记账，跨币种合计才有意义）。
    // 原始币种与原始金额保留在 submission，并随 refs 一起进 ProjectCost 留痕（RULE 4）。
    const cad = resolveExpenseCad(e);
    if (!cad.known) {
      throw new FinanceContractError(
        `费用为 ${cad.currency} 但缺少汇率快照，无法折算为 ${BASE_CURRENCY}；请先补录汇率再审批`,
      );
    }

    // 并发闸：只有把 PENDING_REVIEW 翻成 APPROVED 的那一个事务胜出
    const flip = await tx.projectExpenseSubmission.updateMany({
      where: { id: e.id, orgId: input.orgId, projectId: input.projectId, status: "PENDING_REVIEW" },
      data: {
        status: "APPROVED",
        reviewedById: input.reviewerUserId,
        reviewedAt: new Date(),
        ...(input.reviewNote != null ? { reviewNote: input.reviewNote } : {}),
      },
    });
    if (flip.count === 0) {
      // 竞争失败：重读，若已 APPROVED 幂等返回，否则并发转成了别的态
      const now = await loadOwnedExpense(tx, input.orgId, input.projectId, input.expenseId);
      if (now.status === "APPROVED" && now.approvedProjectCostId) {
        const existingPayable = isProfitabilitySchemaReady()
          ? await tx.projectExpensePayable.findUnique({ where: { expenseSubmissionId: now.id } })
          : null;
        return {
          expense: { id: now.id, status: now.status, approvedProjectCostId: now.approvedProjectCostId },
          cost: { id: now.approvedProjectCostId, costStatus: "ACTUAL" },
          payable: existingPayable
            ? {
                id: existingPayable.id,
                settlementType: existingPayable.settlementType,
                amountCad: existingPayable.amountCad.toString(),
              }
            : null,
          created: false,
        };
      }
      throw new ExpenseStateError(`审批竞争：费用当前状态 ${now.status}，无法审批`);
    }

    // 胜者：经 cost-service 产权威 ProjectCost.ACTUAL（同事务）
    const cost = await createProjectCost({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      actor: input.actor,
      costStatus: "ACTUAL",
      category: e.costCategory,
      // RULE 3：权威成本一律 CAD（CAD 费用时 === totalAmount，行为与 P1.5 完全一致）
      amount: cad.cad,
      currency: BASE_CURRENCY,
      description: e.description,
      incurredById: e.submittedById, // 费用发生人 = 提交人
      incurredAt: e.expenseOccurredAt,
      refs: {
        expenseSubmissionId: e.id,
        ...(e.budgetLineId ? { budgetLineId: e.budgetLineId } : {}),
        ...(e.vendorName ? { vendorName: e.vendorName } : {}),
        // RULE 4：原始币种事实随权威成本行留痕（不覆盖、可独立审计）
        originalAmount: e.totalAmount.toString(),
        originalCurrency: e.currency,
        ...(e.fxRateCadPerOriginalUnit
          ? { fxRateCadPerOriginalUnit: e.fxRateCadPerOriginalUnit.toString() }
          : {}),
        ...(e.fxRateDate ? { fxRateDate: e.fxRateDate.toISOString() } : {}),
        ...(e.fxRateSource ? { fxRateSource: e.fxRateSource } : {}),
        ...(e.fundingSource ? { fundingSource: e.fundingSource } : {}),
      },
      createdById: input.reviewerUserId,
    });

    await tx.projectExpenseSubmission.update({
      where: { id: e.id },
      data: { approvedProjectCostId: cost.id },
    });

    // 结算子账（RULE 6：审批 = 经济成本认定，≠ 已付款）。
    // 同事务内至多一条 payable；公司卡/银行/legacy UNSPECIFIED → null（员工应报销 = 0）。
    const payable = await createPayableForApprovedExpense({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      actor: input.actor,
      expense: {
        id: e.id,
        fundingSource: e.fundingSource,
        paidByUserId: e.paidByUserId,
        submittedById: e.submittedById,
        vendorName: e.vendorName,
      },
      amountCad: cad.cad,
      approvedProjectCostId: cost.id,
      createdById: input.reviewerUserId,
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "expense.approved",
      eventKey: expenseApprovedEventKey(e.id),
      occurredAt: new Date(),
      actor: input.actor,
      actors: [
        { actorKey: `user:${e.submittedById}`, userId: e.submittedById, role: "performer" },
        { actorKey: `user:${input.reviewerUserId}`, userId: input.reviewerUserId, role: "approver" },
      ],
      title: `费用已审批：${e.costCategory}`,
      result: "approved",
      payload: {
        schemaVersion: 2,
        expenseId: e.id,
        costId: cost.id,
        costCategory: e.costCategory,
        // 原始录入事实
        originalAmount: e.totalAmount.toString(),
        originalCurrency: e.currency,
        // 权威记账事实（CAD）
        amountCad: cad.cad.toString(),
        currency: BASE_CURRENCY,
        fundingSource: e.fundingSource ?? null,
        payableId: payable?.id ?? null,
        submittedById: e.submittedById,
        reviewedById: input.reviewerUserId,
      },
      refs: { expenseSubmissionId: e.id, costId: cost.id, budgetLineId: e.budgetLineId ?? undefined },
      relatedCostId: cost.id,
    });

    return {
      expense: { id: e.id, status: "APPROVED", approvedProjectCostId: cost.id },
      cost: { id: cost.id, costStatus: cost.costStatus },
      payable: payable
        ? {
            id: payable.id,
            settlementType: payable.settlementType,
            amountCad: payable.amountCad.toString(),
          }
        : null,
      created: true,
    };
  });
}
