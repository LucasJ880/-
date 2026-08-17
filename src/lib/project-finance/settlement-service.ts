/**
 * T2-P1.6 结算子账服务 —— Payable / Payment（现金面，**不是成本面**）
 *
 * 三层分离（RULE 2 + RULE 6）：
 *   ProjectCost                = 经济成本事实（唯一权威，本文件从不写）
 *   ProjectExpenseSubmission   = 费用提交流程
 *   Payable + Payment          = 「钱是否已经付给谁」的结算子账 ← 本文件
 *
 * 硬不变量：
 * - 付款**绝不**产生第二条成本；本文件不 import cost-service，静态上就不可能写 ProjectCost（REIMB-04）。
 * - 一份 approved expense 至多一条 payable：DB `unique(expenseSubmissionId)` + 服务层先查后建（REIMB-01）。
 * - 付款为 append-only：错误用 VOID + 补偿，不覆盖旧记录。
 * - 超付不可能：付款走 `payable` 行 `FOR UPDATE` 行锁 + 剩余额校验（REIMB-07）。
 * - 重复放款不可能：`idempotencyKey` unique（双击 / 重试收敛到同一条）。
 * - fail-closed：TENDER_PROFITABILITY_SCHEMA_READY=OFF 时不触碰新表，
 *   审批路径退化为 P1.5 原语义（零回归）。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendProjectEvent } from "@/lib/project-ledger/event-service";
import type { LedgerActor } from "@/lib/project-ledger/types";
import {
  expensePayableCreatedEventKey,
  expensePaymentRecordedEventKey,
  expensePaymentVoidedEventKey,
} from "./event-keys";
import { isProfitabilitySchemaReady } from "./flags";
import { BASE_CURRENCY, dec, roundMoney, ZERO, type DecimalInput } from "./money";
import {
  FinanceContractError,
  FinanceTenantError,
  PAYMENT_METHODS,
  SettlementError,
  settlementForFundingSource,
  type PaymentMethod,
} from "./types";

type Tx = Prisma.TransactionClient;

async function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.$transaction(fn);
}

/* ═══════════════════════════ Payable ═══════════════════════════ */

export interface CreatePayableInput {
  tx: Tx;
  orgId: string;
  projectId: string;
  actor: LedgerActor;
  expense: {
    id: string;
    fundingSource: string | null;
    paidByUserId: string | null;
    submittedById: string;
    vendorName: string | null;
  };
  /** 应付本金 = 该费用的权威 CAD 金额（与 ProjectCost.amountActual 同额，但语义是「欠款」不是「成本」） */
  amountCad: Prisma.Decimal;
  approvedProjectCostId: string;
  createdById: string;
}

/**
 * 审批事务内创建应付（唯一调用点 = expense-service.approveExpense）。
 *
 * 返回 null 的三种情形（均为「公司已直接付清 / 无结算义务」）：
 *   COMPANY_CARD / COMPANY_BANK / OTHER / legacy NULL(UNSPECIFIED)
 *   → 员工应报销恒为 0（REIMB-02 / REIMB-03）
 */
export async function createPayableForApprovedExpense(input: CreatePayableInput) {
  if (!isProfitabilitySchemaReady()) return null;

  const mapping = settlementForFundingSource(input.expense.fundingSource);
  if (!mapping) return null;

  const amountCad = roundMoney(input.amountCad);
  if (amountCad.lte(0)) {
    throw new SettlementError("应付金额必须为正", 400);
  }

  const tx = input.tx;

  // 幂等：同一 expense 已有 payable → 直接返回（并发/重试收敛；DB unique 是最后防线）
  const existing = await tx.projectExpensePayable.findUnique({
    where: { expenseSubmissionId: input.expense.id },
  });
  if (existing) return existing;

  const payeeUserId =
    mapping.payeeType === "USER"
      ? (input.expense.paidByUserId ?? input.expense.submittedById)
      : null;
  const payeeName =
    mapping.payeeType === "VENDOR"
      ? (input.expense.vendorName ?? "未指定供应商")
      : mapping.payeeType === "AFFILIATE"
        ? "国内关联公司"
        : null;

  const payable = await tx.projectExpensePayable.create({
    data: {
      orgId: input.orgId,
      projectId: input.projectId,
      expenseSubmissionId: input.expense.id,
      approvedProjectCostId: input.approvedProjectCostId,
      settlementType: mapping.settlementType,
      payeeType: mapping.payeeType,
      payeeUserId,
      payeeName,
      amountCad,
      paidAmountCad: ZERO,
      currency: BASE_CURRENCY,
      status: "PENDING_PAYMENT",
      createdById: input.createdById,
    },
  });

  await appendProjectEvent({
    tx,
    orgId: input.orgId,
    projectId: input.projectId,
    eventType: "expense.payable_created",
    eventKey: expensePayableCreatedEventKey(input.expense.id),
    occurredAt: payable.createdAt,
    actor: input.actor,
    title: `应付已生成：${mapping.settlementType} ${amountCad.toString()} ${BASE_CURRENCY}`,
    payload: {
      schemaVersion: 1,
      expenseId: input.expense.id,
      payableId: payable.id,
      settlementType: mapping.settlementType,
      payeeType: mapping.payeeType,
      payeeUserId,
      amountCad: amountCad.toString(),
      fundingSource: input.expense.fundingSource,
      // 明确声明：这是现金义务，不是第二条成本
      note: "SETTLEMENT_SUBLEDGER_NOT_COST",
    },
    refs: {
      expenseSubmissionId: input.expense.id,
      payableId: payable.id,
      costId: input.approvedProjectCostId,
    },
  });

  return payable;
}

/* ═══════════════════════════ Payment ═══════════════════════════ */

function assertPaymentMethod(v: string): asserts v is PaymentMethod {
  if (!(PAYMENT_METHODS as readonly string[]).includes(v)) {
    throw new SettlementError(`付款方式非法: ${v}`, 400);
  }
}

/** 服务端构造的付款幂等键（禁止客户端直接给整键）。 */
export function buildPaymentIdempotencyKey(payableId: string, clientKey: string): string {
  const k = clientKey.trim();
  if (!k) throw new SettlementError("付款幂等键必填", 400);
  if (k.length > 80) throw new SettlementError("付款幂等键过长", 400);
  return `payment:${payableId}:${k}`;
}

export interface RecordPaymentInput {
  tx?: Tx;
  orgId: string;
  projectId: string;
  payableId: string;
  actor: LedgerActor;
  amountCad: DecimalInput;
  paidAt: Date;
  paymentMethod: string;
  paymentReference?: string | null;
  /** 服务端可信放款人（≠ 费用审批人的第四权，见 rbac PROJECT_PAYMENT_RECORD） */
  paidById: string;
  note?: string | null;
  /** 客户端提供的动作身份（同一次点击重试用同一个值） */
  clientKey: string;
}

export interface RecordPaymentResult {
  payment: { id: string; amountCad: string };
  payable: { id: string; status: string; amountCad: string; paidAmountCad: string; outstandingCad: string };
  created: boolean;
}

/**
 * 记录一笔付款（partial payment 一等公民）。
 *
 * 并发安全：对 payable 行取 `FOR UPDATE` 行锁后再读剩余额 —— 两笔并发付款被串行化，
 * 第二笔看到的是第一笔之后的 paidAmountCad，因此**不可能超付**（REIMB-07）。
 * 幂等：`idempotencyKey` unique；重复提交返回既有付款，不二次扣减剩余额。
 */
export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  if (!isProfitabilitySchemaReady()) {
    throw new FinanceContractError(
      "结算功能未启用（TENDER_PROFITABILITY_SCHEMA_READY=OFF）",
      404,
    );
  }
  assertPaymentMethod(input.paymentMethod);
  const amount = roundMoney(dec(input.amountCad));
  if (!amount.isFinite() || amount.lte(0)) {
    throw new SettlementError("付款金额必须为正", 400);
  }
  if (!(input.paidAt instanceof Date) || Number.isNaN(input.paidAt.getTime())) {
    throw new SettlementError("付款日期必填且必须合法", 400);
  }
  const idempotencyKey = buildPaymentIdempotencyKey(input.payableId, input.clientKey);

  return inTx(input.tx, async (tx) => {
    // 幂等快路（锁前）：已存在同键付款 → 原样返回
    const dup = await tx.projectExpensePayment.findUnique({ where: { idempotencyKey } });
    if (dup) {
      const p = await tx.projectExpensePayable.findFirst({
        where: { id: input.payableId, orgId: input.orgId, projectId: input.projectId },
      });
      if (!p) throw new FinanceTenantError("payable not found in project/organization");
      return {
        payment: { id: dup.id, amountCad: dup.amountCad.toString() },
        payable: {
          id: p.id,
          status: p.status,
          amountCad: p.amountCad.toString(),
          paidAmountCad: p.paidAmountCad.toString(),
          outstandingCad: p.amountCad.sub(p.paidAmountCad).toString(),
        },
        created: false,
      };
    }

    // 行锁：串行化同一 payable 上的并发付款（镜像 budget-service / history-anchor 的 PG 行锁风格）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "ProjectExpensePayable"
                 WHERE "id" = ${input.payableId} AND "orgId" = ${input.orgId} AND "projectId" = ${input.projectId}
                 FOR UPDATE`,
    );
    if (locked.length === 0) {
      throw new FinanceTenantError("payable not found in project/organization");
    }

    const payable = await tx.projectExpensePayable.findUniqueOrThrow({
      where: { id: input.payableId },
    });
    if (payable.status === "VOID") {
      throw new SettlementError("应付已作废，不可付款");
    }
    if (payable.status === "PAID") {
      throw new SettlementError("应付已结清，不可重复付款");
    }

    const outstanding = payable.amountCad.sub(payable.paidAmountCad);
    if (amount.gt(outstanding)) {
      throw new SettlementError(
        `付款金额 ${amount.toString()} 超过剩余应付 ${outstanding.toString()} ${BASE_CURRENCY}；禁止超付`,
      );
    }

    const payment = await tx.projectExpensePayment.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        payableId: payable.id,
        amountCad: amount,
        paidAt: input.paidAt,
        paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference ?? null,
        paidById: input.paidById,
        note: input.note ?? null,
        idempotencyKey,
      },
    });

    const nextPaid = roundMoney(payable.paidAmountCad.add(amount));
    const nextStatus = nextPaid.gte(payable.amountCad)
      ? "PAID"
      : nextPaid.gt(ZERO)
        ? "PARTIALLY_PAID"
        : "PENDING_PAYMENT";
    const updated = await tx.projectExpensePayable.update({
      where: { id: payable.id },
      data: { paidAmountCad: nextPaid, status: nextStatus },
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "expense.payment_recorded",
      eventKey: expensePaymentRecordedEventKey(payment.id),
      occurredAt: input.paidAt,
      actor: input.actor,
      title: `已付款：${amount.toString()} ${BASE_CURRENCY}（${input.paymentMethod}）`,
      result: nextStatus,
      payload: {
        schemaVersion: 1,
        payableId: payable.id,
        paymentId: payment.id,
        expenseId: payable.expenseSubmissionId,
        amountCad: amount.toString(),
        paidAmountCad: nextPaid.toString(),
        outstandingCad: updated.amountCad.sub(nextPaid).toString(),
        payableStatus: nextStatus,
        paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference ?? null,
        paidById: input.paidById,
        note: "SETTLEMENT_SUBLEDGER_NOT_COST",
      },
      refs: {
        expenseSubmissionId: payable.expenseSubmissionId,
        payableId: payable.id,
        paymentId: payment.id,
      },
    });

    return {
      payment: { id: payment.id, amountCad: amount.toString() },
      payable: {
        id: updated.id,
        status: updated.status,
        amountCad: updated.amountCad.toString(),
        paidAmountCad: nextPaid.toString(),
        outstandingCad: updated.amountCad.sub(nextPaid).toString(),
      },
      created: true,
    };
  });
}

/**
 * 冲销一笔付款（append-only 纠错：不删不改旧行，只打 VOID 并回退已付累计）。
 * 幂等：已 VOID 的付款重复冲销直接返回。
 */
export async function voidPayment(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  paymentId: string;
  actor: LedgerActor;
  voidedById: string;
  reason: string;
}) {
  if (!isProfitabilitySchemaReady()) {
    throw new FinanceContractError(
      "结算功能未启用（TENDER_PROFITABILITY_SCHEMA_READY=OFF）",
      404,
    );
  }
  const reason = input.reason?.trim();
  if (!reason) throw new SettlementError("冲销必须提供理由", 400);

  return inTx(input.tx, async (tx) => {
    const payment = await tx.projectExpensePayment.findFirst({
      where: { id: input.paymentId, orgId: input.orgId, projectId: input.projectId },
    });
    if (!payment) throw new FinanceTenantError("payment not found in project/organization");
    if (payment.voidedAt) {
      return { payment, payable: null, created: false as const };
    }

    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "ProjectExpensePayable"
                 WHERE "id" = ${payment.payableId} FOR UPDATE`,
    );
    if (locked.length === 0) throw new FinanceTenantError("payable not found");

    const voided = await tx.projectExpensePayment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidReason: reason, voidedById: input.voidedById },
    });

    const payable = await tx.projectExpensePayable.findUniqueOrThrow({
      where: { id: payment.payableId },
    });
    const nextPaid = roundMoney(payable.paidAmountCad.sub(payment.amountCad));
    const safePaid = nextPaid.lt(ZERO) ? ZERO : nextPaid;
    const nextStatus = safePaid.gte(payable.amountCad)
      ? "PAID"
      : safePaid.gt(ZERO)
        ? "PARTIALLY_PAID"
        : "PENDING_PAYMENT";
    const updated = await tx.projectExpensePayable.update({
      where: { id: payable.id },
      data: { paidAmountCad: safePaid, status: nextStatus },
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "expense.payment_voided",
      eventKey: expensePaymentVoidedEventKey(payment.id),
      occurredAt: new Date(),
      actor: input.actor,
      title: `付款已冲销：${payment.amountCad.toString()} ${BASE_CURRENCY}`,
      result: "voided",
      payload: {
        schemaVersion: 1,
        paymentId: payment.id,
        payableId: payable.id,
        amountCad: payment.amountCad.toString(),
        paidAmountCad: safePaid.toString(),
        payableStatus: nextStatus,
        reason,
        voidedById: input.voidedById,
      },
      refs: { payableId: payable.id, paymentId: payment.id },
    });

    return { payment: voided, payable: updated, created: true as const };
  });
}

/* ═══════════════════════════ 读侧 ═══════════════════════════ */

export interface PayableView {
  id: string;
  expenseSubmissionId: string;
  settlementType: string;
  payeeType: string;
  payeeUserId: string | null;
  payeeName: string | null;
  amountCad: string;
  paidAmountCad: string;
  outstandingCad: string;
  status: string;
  createdAt: string;
}

function toPayableView(p: {
  id: string;
  expenseSubmissionId: string;
  settlementType: string;
  payeeType: string;
  payeeUserId: string | null;
  payeeName: string | null;
  amountCad: Prisma.Decimal;
  paidAmountCad: Prisma.Decimal;
  status: string;
  createdAt: Date;
}): PayableView {
  return {
    id: p.id,
    expenseSubmissionId: p.expenseSubmissionId,
    settlementType: p.settlementType,
    payeeType: p.payeeType,
    payeeUserId: p.payeeUserId,
    payeeName: p.payeeName,
    amountCad: p.amountCad.toString(),
    paidAmountCad: p.paidAmountCad.toString(),
    outstandingCad: p.amountCad.sub(p.paidAmountCad).toString(),
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

/** 项目级付款队列（Accounting / Finance 视图）。flag OFF → available=false 空结果，绝不抛缺表。 */
export async function listProjectPayables(
  orgId: string,
  projectId: string,
  opts?: { status?: string | null; payeeUserId?: string | null },
): Promise<{ available: boolean; payables: PayableView[] }> {
  if (!isProfitabilitySchemaReady()) return { available: false, payables: [] };
  const rows = await db.projectExpensePayable.findMany({
    where: {
      orgId,
      projectId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.payeeUserId ? { payeeUserId: opts.payeeUserId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return { available: true, payables: rows.map(toPayableView) };
}

/** 某 payable 的付款明细（含已冲销行；审计需要看到全历史）。 */
export async function listPayablePayments(orgId: string, projectId: string, payableId: string) {
  if (!isProfitabilitySchemaReady()) return { available: false, payments: [] as unknown[] };
  const payments = await db.projectExpensePayment.findMany({
    where: { orgId, projectId, payableId },
    orderBy: { createdAt: "asc" },
  });
  return {
    available: true,
    payments: payments.map((p) => ({
      id: p.id,
      amountCad: p.amountCad.toString(),
      paidAt: p.paidAt.toISOString(),
      paymentMethod: p.paymentMethod,
      paymentReference: p.paymentReference,
      paidById: p.paidById,
      note: p.note,
      voidedAt: p.voidedAt?.toISOString() ?? null,
      voidReason: p.voidReason,
    })),
  };
}

/** 项目级未结应付合计（按结算类型分组；供 Tender Financial Summary 使用）。 */
export async function getOutstandingByType(
  orgId: string,
  projectId: string,
): Promise<{
  available: boolean;
  employeeReimbursementCad: Prisma.Decimal;
  vendorPayableCad: Prisma.Decimal;
  affiliatePayableCad: Prisma.Decimal;
  totalCad: Prisma.Decimal;
}> {
  const empty = {
    available: false,
    employeeReimbursementCad: ZERO,
    vendorPayableCad: ZERO,
    affiliatePayableCad: ZERO,
    totalCad: ZERO,
  };
  if (!isProfitabilitySchemaReady()) return empty;

  const rows = await db.projectExpensePayable.findMany({
    where: { orgId, projectId, status: { in: ["PENDING_PAYMENT", "PARTIALLY_PAID"] } },
    select: { settlementType: true, amountCad: true, paidAmountCad: true },
  });
  let employee = ZERO;
  let vendor = ZERO;
  let affiliate = ZERO;
  for (const r of rows) {
    const outstanding = r.amountCad.sub(r.paidAmountCad);
    if (outstanding.lte(0)) continue;
    if (r.settlementType === "EMPLOYEE_REIMBURSEMENT") employee = employee.add(outstanding);
    else if (r.settlementType === "VENDOR_PAYMENT") vendor = vendor.add(outstanding);
    else if (r.settlementType === "AFFILIATE_SETTLEMENT") affiliate = affiliate.add(outstanding);
  }
  return {
    available: true,
    employeeReimbursementCad: employee,
    vendorPayableCad: vendor,
    affiliatePayableCad: affiliate,
    totalCad: employee.add(vendor).add(affiliate),
  };
}
