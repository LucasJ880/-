/**
 * T2-P1.6 FX 最终结算服务（RULE 4 §6.3）
 *
 * 场景：审批时按锁定汇率记了 estimated CAD；银行实际入账 CAD 与之不同，另有电汇/银行手续费。
 *   Approved economic cost : CAD 13,802.40
 *   Final settlement       : CAD 13,965.00 + fee 45.00 = 14,010.00
 *   Variance               : +207.60
 *
 * 硬约束：
 * - `ProjectCost.ACTUAL` **禁止原地改金额**。修正一律走既有 ledger 契约：
 *   `voidProjectCost({ reason, correction })` 在同一事务内 VOID 旧行 + 建 correction 新行
 *   （`correctionOfCostId` 新→旧）+ `cost.voided` / `cost.recorded` 事件。本文件不自建修正框架。
 * - 原始币种 / 原始金额 / 审批时汇率快照全部保留：结算写的是**新的一条 FX 结算记录**，
 *   不回写 submission 的 fxRate* 列（历史汇率不因结算而被抹掉）。
 * - 幂等：`unique(expenseSubmissionId)` —— 重复结算返回既有记录，绝不二次 void/二次修正（FX-SETTLE-04）。
 * - 差额同步到结算子账：payable 尚未付款时按最终 CAD 调整应付本金（已付部分不允许缩到低于已付额）。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendProjectEvent } from "@/lib/project-ledger/event-service";
import { voidProjectCost } from "@/lib/project-ledger/cost-service";
import { isLedgerProducerActive } from "@/lib/project-ledger/flags";
import type { LedgerActor } from "@/lib/project-ledger/types";
import { expenseCostCorrectedEventKey, expenseFxSettledEventKey } from "./event-keys";
import { isProfitabilitySchemaReady } from "./flags";
import {
  assertFxRate,
  BASE_CURRENCY,
  computeFinalCad,
  dec,
  isBaseCurrency,
  resolveExpenseCad,
  roundMoney,
  ZERO,
  type DecimalInput,
} from "./money";
import { FinanceContractError, FinanceTenantError, SettlementError } from "./types";

type Tx = Prisma.TransactionClient;

async function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.$transaction(fn);
}

export interface SettleExpenseFxInput {
  tx?: Tx;
  orgId: string;
  projectId: string;
  expenseId: string;
  actor: LedgerActor;
  /** 服务端可信操作人（Finance） */
  settledById: string;
  /** 银行实际成交汇率：1 单位原始币种 = X CAD */
  settledFxRateCadPerOriginalUnit: DecimalInput;
  settlementDate: Date;
  /** 银行入账 CAD 本金 */
  settledCadAmount: DecimalInput;
  /** 电汇 / 银行手续费（CAD） */
  bankFeeCad?: DecimalInput | null;
  /** BANK_SETTLEMENT（默认）| MANUAL */
  fxRateSource?: "BANK_SETTLEMENT" | "MANUAL" | null;
  note?: string | null;
}

export interface SettleExpenseFxResult {
  settlement: {
    id: string;
    estimatedCadAmount: string;
    settledCadAmount: string;
    bankFeeCad: string;
    finalCadAmount: string;
    varianceCad: string;
  };
  /** 差额非 0 时的成本修正（VOID 旧 ACTUAL + correction 新 ACTUAL） */
  costCorrection: { voidedCostId: string; correctedCostId: string } | null;
  /** 差额同步后的应付（若该费用有结算义务且尚未付清） */
  payable: { id: string; amountCad: string; status: string } | null;
  created: boolean;
}

/**
 * 记录一笔费用的 FX 最终结算，并在必要时驱动权威成本修正。
 * 只允许对 **APPROVED** 且 **非 CAD** 的费用结算（CAD 费用无 FX variance 可言）。
 */
export async function settleExpenseFx(
  input: SettleExpenseFxInput,
): Promise<SettleExpenseFxResult> {
  if (!isProfitabilitySchemaReady()) {
    throw new FinanceContractError(
      "FX 结算功能未启用（TENDER_PROFITABILITY_SCHEMA_READY=OFF）",
      404,
    );
  }
  if (!(input.settlementDate instanceof Date) || Number.isNaN(input.settlementDate.getTime())) {
    throw new FinanceContractError("结算日期必填且必须合法");
  }
  const bankFee = input.bankFeeCad != null ? roundMoney(dec(input.bankFeeCad)) : ZERO;
  const settledCad = roundMoney(dec(input.settledCadAmount));
  const finalCad = computeFinalCad({ settledCadAmount: settledCad, bankFeeCad: bankFee });
  const fxSource = input.fxRateSource ?? "BANK_SETTLEMENT";

  return inTx(input.tx, async (tx) => {
    const e = await tx.projectExpenseSubmission.findFirst({
      where: { id: input.expenseId, orgId: input.orgId, projectId: input.projectId },
    });
    if (!e) throw new FinanceTenantError("expense not found in project/organization");

    // 幂等（FX-SETTLE-04）：已结算 → 返回既有，绝不二次 void / 二次修正
    const existing = await tx.projectExpenseFxSettlement.findUnique({
      where: { expenseSubmissionId: e.id },
    });
    if (existing) {
      return {
        settlement: {
          id: existing.id,
          estimatedCadAmount: existing.estimatedCadAmount.toString(),
          settledCadAmount: existing.settledCadAmount.toString(),
          bankFeeCad: existing.bankFeeCad.toString(),
          finalCadAmount: existing.finalCadAmount.toString(),
          varianceCad: existing.varianceCad.toString(),
        },
        costCorrection:
          existing.previousProjectCostId && existing.correctedProjectCostId
            ? {
                voidedCostId: existing.previousProjectCostId,
                correctedCostId: existing.correctedProjectCostId,
              }
            : null,
        payable: null,
        created: false,
      };
    }

    if (e.status !== "APPROVED" || !e.approvedProjectCostId) {
      throw new FinanceContractError(
        `仅已审批费用可做 FX 结算；当前状态 ${e.status}`,
        409,
      );
    }
    if (isBaseCurrency(e.currency)) {
      throw new FinanceContractError(
        `${BASE_CURRENCY} 费用不存在汇率结算差额；无需 FX 结算`,
      );
    }
    const estimated = resolveExpenseCad(e);
    if (!estimated.known) {
      throw new FinanceContractError("该费用缺少审批时的 CAD 快照，无法计算结算差额");
    }
    assertFxRate(input.settledFxRateCadPerOriginalUnit, e.currency);

    const variance = roundMoney(finalCad.sub(estimated.cad));

    const settlement = await tx.projectExpenseFxSettlement.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        expenseSubmissionId: e.id,
        originalAmount: e.totalAmount,
        originalCurrency: e.currency,
        estimatedCadAmount: estimated.cad,
        settledFxRateCadPerOriginalUnit: assertFxRate(
          input.settledFxRateCadPerOriginalUnit,
          e.currency,
        ),
        settlementDate: input.settlementDate,
        fxRateSource: fxSource,
        settledCadAmount: settledCad,
        bankFeeCad: bankFee,
        finalCadAmount: finalCad,
        varianceCad: variance,
        previousProjectCostId: null,
        correctedProjectCostId: null,
        settledById: input.settledById,
        note: input.note ?? null,
      },
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "expense.fx_settled",
      eventKey: expenseFxSettledEventKey(e.id),
      occurredAt: input.settlementDate,
      actor: input.actor,
      title: `汇率结算完成：最终 ${finalCad.toString()} ${BASE_CURRENCY}（差额 ${variance.toString()}）`,
      payload: {
        schemaVersion: 1,
        expenseId: e.id,
        settlementId: settlement.id,
        originalAmount: e.totalAmount.toString(),
        originalCurrency: e.currency,
        estimatedCadAmount: estimated.cad.toString(),
        settledFxRateCadPerOriginalUnit: settlement.settledFxRateCadPerOriginalUnit.toString(),
        settledCadAmount: settledCad.toString(),
        bankFeeCad: bankFee.toString(),
        finalCadAmount: finalCad.toString(),
        varianceCad: variance.toString(),
        fxRateSource: fxSource,
        settledById: input.settledById,
      },
      refs: { expenseSubmissionId: e.id, fxSettlementId: settlement.id },
    });

    /* ── 差额 → 权威成本修正（VOID + correction；FX-SETTLE-02 / 03） ── */
    let costCorrection: { voidedCostId: string; correctedCostId: string } | null = null;
    if (!variance.isZero()) {
      if (!isLedgerProducerActive()) {
        throw new FinanceContractError(
          "修正权威成本需 isLedgerProducerActive()（T2_LEDGER_SCHEMA_READY && T2_LEDGER_PRODUCERS_ENABLED）；当前 ledger producer 未有效开启",
          409,
        );
      }
      const oldCost = await tx.projectCost.findFirst({
        where: { id: e.approvedProjectCostId, orgId: input.orgId, projectId: input.projectId },
      });
      if (!oldCost) throw new FinanceTenantError("approved cost not found in project/organization");

      const { correction } = await voidProjectCost({
        tx,
        orgId: input.orgId,
        projectId: input.projectId,
        costId: oldCost.id,
        actor: input.actor,
        reason: `FX 最终结算差额修正：estimated ${estimated.cad.toString()} → final ${finalCad.toString()} ${BASE_CURRENCY}（fxSettlement:${settlement.id}）`,
        correction: {
          costStatus: "ACTUAL",
          category: oldCost.category,
          amount: finalCad,
          currency: BASE_CURRENCY,
          description: oldCost.description,
          incurredById: oldCost.incurredById,
          incurredAt: oldCost.incurredAt,
          supplierId: oldCost.supplierId,
          refs: {
            expenseSubmissionId: e.id,
            ...(e.budgetLineId ? { budgetLineId: e.budgetLineId } : {}),
            ...(e.vendorName ? { vendorName: e.vendorName } : {}),
            originalAmount: e.totalAmount.toString(),
            originalCurrency: e.currency,
            fxSettlementId: settlement.id,
            fxRateCadPerOriginalUnit: settlement.settledFxRateCadPerOriginalUnit.toString(),
            fxRateDate: input.settlementDate.toISOString(),
            fxRateSource: fxSource,
            settledCadAmount: settledCad.toString(),
            bankFeeCad: bankFee.toString(),
            ...(e.fundingSource ? { fundingSource: e.fundingSource } : {}),
          },
          createdById: input.settledById,
        },
      });
      if (!correction) {
        throw new FinanceContractError("成本修正未生成（ledger correction 契约异常）", 500);
      }

      await tx.projectExpenseFxSettlement.update({
        where: { id: settlement.id },
        data: { previousProjectCostId: oldCost.id, correctedProjectCostId: correction.id },
      });

      await appendProjectEvent({
        tx,
        orgId: input.orgId,
        projectId: input.projectId,
        eventType: "expense.cost_corrected",
        eventKey: expenseCostCorrectedEventKey(e.id),
        occurredAt: input.settlementDate,
        actor: input.actor,
        title: `成本已按最终结算修正：${estimated.cad.toString()} → ${finalCad.toString()} ${BASE_CURRENCY}`,
        payload: {
          schemaVersion: 1,
          expenseId: e.id,
          settlementId: settlement.id,
          voidedCostId: oldCost.id,
          correctedCostId: correction.id,
          previousAmountCad: estimated.cad.toString(),
          correctedAmountCad: finalCad.toString(),
          varianceCad: variance.toString(),
          correctedById: input.settledById,
        },
        refs: {
          expenseSubmissionId: e.id,
          fxSettlementId: settlement.id,
          costId: correction.id,
          previousCostId: oldCost.id,
        },
        relatedCostId: correction.id,
      });

      costCorrection = { voidedCostId: oldCost.id, correctedCostId: correction.id };
    }

    /* ── 差额 → 结算子账同步（未付清的应付按最终 CAD 调整本金） ── */
    let payableView: { id: string; amountCad: string; status: string } | null = null;
    const payable = await tx.projectExpensePayable.findUnique({
      where: { expenseSubmissionId: e.id },
    });
    if (payable && payable.status !== "VOID") {
      if (finalCad.lt(payable.paidAmountCad)) {
        // 已付超过最终应付：不静默缩本金（会造成负剩余额），交由人工经 void payment 纠正
        throw new SettlementError(
          `最终结算金额 ${finalCad.toString()} 低于已付 ${payable.paidAmountCad.toString()} ${BASE_CURRENCY}；请先冲销多付的付款再结算`,
        );
      }
      const nextStatus = payable.paidAmountCad.gte(finalCad)
        ? "PAID"
        : payable.paidAmountCad.gt(ZERO)
          ? "PARTIALLY_PAID"
          : "PENDING_PAYMENT";
      const updated = await tx.projectExpensePayable.update({
        where: { id: payable.id },
        data: { amountCad: finalCad, status: nextStatus },
      });
      payableView = {
        id: updated.id,
        amountCad: updated.amountCad.toString(),
        status: updated.status,
      };
    }

    return {
      settlement: {
        id: settlement.id,
        estimatedCadAmount: estimated.cad.toString(),
        settledCadAmount: settledCad.toString(),
        bankFeeCad: bankFee.toString(),
        finalCadAmount: finalCad.toString(),
        varianceCad: variance.toString(),
      },
      costCorrection,
      payable: payableView,
      created: true,
    };
  });
}

/** 项目级 FX 结算列表（读侧；flag OFF → available=false）。 */
export async function listFxSettlements(orgId: string, projectId: string) {
  if (!isProfitabilitySchemaReady()) return { available: false, settlements: [] as unknown[] };
  const rows = await db.projectExpenseFxSettlement.findMany({
    where: { orgId, projectId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return {
    available: true,
    settlements: rows.map((s) => ({
      id: s.id,
      expenseSubmissionId: s.expenseSubmissionId,
      originalAmount: s.originalAmount.toString(),
      originalCurrency: s.originalCurrency,
      estimatedCadAmount: s.estimatedCadAmount.toString(),
      settledFxRateCadPerOriginalUnit: s.settledFxRateCadPerOriginalUnit.toString(),
      settlementDate: s.settlementDate.toISOString(),
      settledCadAmount: s.settledCadAmount.toString(),
      bankFeeCad: s.bankFeeCad.toString(),
      finalCadAmount: s.finalCadAmount.toString(),
      varianceCad: s.varianceCad.toString(),
      previousProjectCostId: s.previousProjectCostId,
      correctedProjectCostId: s.correctedProjectCostId,
    })),
  };
}
