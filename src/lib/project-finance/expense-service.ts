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
  expenseApprovedEventKey,
  expenseCreatedEventKey,
  expenseInfoRequestedEventKey,
  expenseRejectedEventKey,
  expenseResubmittedEventKey,
  expenseSubmittedEventKey,
} from "./event-keys";
import {
  canTransitionExpense,
  EXPENSE_COST_CATEGORIES,
  ExpenseStateError,
  FinanceContractError,
  FinanceTenantError,
  SelfApprovalError,
  type ExpenseCostCategory,
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
  totalAmount: DecimalInput;
  currency: string;
  projectPhaseSnapshot?: string | null;
  projectStageSnapshot?: string | null;
  relatedTaskId?: string | null;
  relatedMilestoneId?: string | null;
}

/** DRAFT 费用创建（草稿；未提交，不产成本） */
export async function createExpenseDraft(input: CreateExpenseDraftInput) {
  assertCostCategory(input.costCategory);
  if (!input.description?.trim()) throw new FinanceContractError("费用描述必填");
  const total = dec(input.totalAmount);
  if (total.lte(0)) throw new FinanceContractError("费用金额必须为正");

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
        currency: input.currency,
        status: "DRAFT",
        projectPhaseSnapshot: input.projectPhaseSnapshot ?? null,
        projectStageSnapshot: input.projectStageSnapshot ?? null,
        relatedTaskId: input.relatedTaskId ?? null,
        relatedMilestoneId: input.relatedMilestoneId ?? null,
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
        schemaVersion: 1,
        expenseId: expense.id,
        costCategory: input.costCategory,
        totalAmount: total.toString(),
        currency: input.currency,
      },
      refs: { expenseSubmissionId: expense.id, budgetLineId: input.budgetLineId ?? undefined },
    });
    return expense;
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

    // 幂等快路：已审批 → 返回既有（不重复产成本）
    if (e.status === "APPROVED" && e.approvedProjectCostId) {
      return {
        expense: { id: e.id, status: e.status, approvedProjectCostId: e.approvedProjectCostId },
        cost: { id: e.approvedProjectCostId, costStatus: "ACTUAL" },
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
        return {
          expense: { id: now.id, status: now.status, approvedProjectCostId: now.approvedProjectCostId },
          cost: { id: now.approvedProjectCostId, costStatus: "ACTUAL" },
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
      amount: e.totalAmount,
      currency: e.currency,
      description: e.description,
      incurredById: e.submittedById, // 费用发生人 = 提交人
      incurredAt: e.expenseOccurredAt,
      refs: {
        expenseSubmissionId: e.id,
        ...(e.budgetLineId ? { budgetLineId: e.budgetLineId } : {}),
        ...(e.vendorName ? { vendorName: e.vendorName } : {}),
      },
      createdById: input.reviewerUserId,
    });

    await tx.projectExpenseSubmission.update({
      where: { id: e.id },
      data: { approvedProjectCostId: cost.id },
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
        schemaVersion: 1,
        expenseId: e.id,
        costId: cost.id,
        costCategory: e.costCategory,
        amount: e.totalAmount.toString(),
        currency: e.currency,
        submittedById: e.submittedById,
        reviewedById: input.reviewerUserId,
      },
      refs: { expenseSubmissionId: e.id, costId: cost.id, budgetLineId: e.budgetLineId ?? undefined },
      relatedCostId: cost.id,
    });

    return {
      expense: { id: e.id, status: "APPROVED", approvedProjectCostId: cost.id },
      cost: { id: cost.id, costStatus: cost.costStatus },
      created: true,
    };
  });
}
