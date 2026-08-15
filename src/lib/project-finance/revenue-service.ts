/**
 * T2-P1.6 项目收入账服务 —— REVENUE_SOURCE_GAP 的最小可审计解
 *
 * 审计结论（docs/QINGYAN_TENDER_T2_P16_EXISTING_MODEL_AUDIT.md §3）：
 *   本仓库此前**没有**权威项目收入源。现有候选全部不合格：
 *     - `ProjectQuote.totalAmount`  ：报价单文档（草稿/多版本/可 AI 生成），不是成交事实
 *     - `Project.estimatedValue`    ：`Float`，注释即写明「复盘与相似对比用」
 *     - `Project.ourBidPrice` / `winningBidPrice` ：同上，`Float` 复盘字段
 *     - T4 `AwardRecord`            ：**不在本 stack 的 base 内**（仅存在于 origin/main）
 *     - marketing `revenue`         ：MMM 营销域，与项目无关
 *   → 因此新建**唯一**权威收入账 ProjectRevenueEntry。
 *
 * 去重保证（为什么不会变成第二套收入源）：
 * - 上述字段全部保持 read-only / indicative，本服务不读也不写它们；
 *   read model 里凡引用 `Project.estimatedValue` 之处一律标记 `indicativeOnly`。
 * - 未来 T4 `AwardRecord` 进入本分支后，正确的收敛方式是**由 AwardRecord 驱动创建
 *   一条 CONTRACT_AWARD 收入条目**（AwardRecord = 中标事实，RevenueEntry = 记账事实），
 *   而不是让 read model 同时从两处求和。该衔接点记为 follow-up，不在本轮实现。
 *
 * 纪律镜像 ProjectCost：
 * - 金额列填充不覆盖：`amountForecastCad` → `amountRealizedCad`
 * - `REALIZED` 后禁止原地改实质字段；修正 = VOID 旧行 + correction 新行（`correctionOfEntryId` 新→旧）
 * - Change Order 只做**收入侧**表达（entryType=CHANGE_ORDER + 人工 approvedById/At），
 *   不构成完整 CO 工作流（CHANGE_ORDER_MODEL_GAP 仍登记在案）
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendProjectEvent } from "@/lib/project-ledger/event-service";
import type { LedgerActor } from "@/lib/project-ledger/types";
import {
  revenueRealizedEventKey,
  revenueRecordedEventKey,
  revenueVoidedEventKey,
} from "./event-keys";
import { isProfitabilitySchemaReady } from "./flags";
import { buildFxSnapshot } from "./fx";
import { BASE_CURRENCY, dec, roundMoney, ZERO, type DecimalInput, type FxRateSource } from "./money";
import {
  FinanceContractError,
  FinanceTenantError,
  REVENUE_ENTRY_TYPES,
  RevenueLifecycleError,
  type RevenueEntryType,
} from "./types";

type Tx = Prisma.TransactionClient;

async function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.$transaction(fn);
}

function assertEntryType(v: string): asserts v is RevenueEntryType {
  if (!(REVENUE_ENTRY_TYPES as readonly string[]).includes(v)) {
    throw new RevenueLifecycleError(`收入条目类型非法: ${v}`, 400);
  }
}

function assertSchemaReady() {
  if (!isProfitabilitySchemaReady()) {
    throw new FinanceContractError(
      "收入账功能未启用（TENDER_PROFITABILITY_SCHEMA_READY=OFF）",
      404,
    );
  }
}

export interface RecordRevenueInput {
  tx?: Tx;
  orgId: string;
  projectId: string;
  actor: LedgerActor;
  entryType: string;
  description?: string | null;
  /** 原始币种金额（永久保留） */
  originalAmount: DecimalInput;
  originalCurrency: string;
  fxRateCadPerOriginalUnit?: DecimalInput | null;
  fxRateDate?: Date | null;
  fxRateSource?: FxRateSource | null;
  /** 业务发生时间（合同签订日 / 变更批准日 / 开票日） */
  recognizedAt: Date;
  /** 直接以已实现口径入账（如已开票已收款）；缺省 = FORECAST */
  asRealized?: boolean;
  changeOrderReference?: string | null;
  /** CHANGE_ORDER 必须有人工批准人（AI 不得自动批准变更收入） */
  approvedById?: string | null;
  approvedAt?: Date | null;
  refs?: Prisma.InputJsonValue;
  createdById: string;
  /** 修正链：本行是对哪条被 void 行的修正 */
  correctionOfEntryId?: string | null;
}

/** 记一条收入（FORECAST 或直接 REALIZED）。 */
export async function recordRevenueEntry(input: RecordRevenueInput) {
  assertSchemaReady();
  assertEntryType(input.entryType);
  const amount = dec(input.originalAmount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new RevenueLifecycleError("收入金额必须为正", 400);
  }
  if (!(input.recognizedAt instanceof Date) || Number.isNaN(input.recognizedAt.getTime())) {
    throw new RevenueLifecycleError("收入确认时间必填且必须合法", 400);
  }
  if (input.entryType === "CHANGE_ORDER" && !input.approvedById) {
    throw new RevenueLifecycleError(
      "变更单收入必须记录人工批准人（approvedById）；AI 不得自动批准变更",
      400,
    );
  }

  const fx = await buildFxSnapshot({
    originalAmount: amount,
    originalCurrency: input.originalCurrency,
    fxRateCadPerOriginalUnit: input.fxRateCadPerOriginalUnit ?? null,
    fxRateDate: input.fxRateDate ?? input.recognizedAt,
    fxRateSource: input.fxRateSource ?? null,
  });
  const realized = input.asRealized === true;

  return inTx(input.tx, async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, orgId: input.orgId },
      select: { id: true },
    });
    if (!project) throw new FinanceTenantError();

    const entry = await tx.projectRevenueEntry.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        entryType: input.entryType,
        revenueStatus: realized ? "REALIZED" : "FORECAST",
        description: input.description?.trim() || null,
        originalAmount: fx.originalAmount,
        originalCurrency: fx.originalCurrency,
        fxRateCadPerOriginalUnit: fx.fxRateCadPerOriginalUnit,
        fxRateDate: fx.fxRateDate,
        fxRateSource: fx.fxRateSource,
        // 填充不覆盖：REALIZED 也保留 forecast 列（历史口径可还原）
        amountForecastCad: fx.estimatedCadAmount,
        amountRealizedCad: realized ? fx.estimatedCadAmount : null,
        recognizedAt: input.recognizedAt,
        changeOrderReference: input.changeOrderReference ?? null,
        approvedById: input.approvedById ?? null,
        approvedAt: input.approvedAt ?? (input.approvedById ? new Date() : null),
        refs: input.refs ?? Prisma.JsonNull,
        correctionOfEntryId: input.correctionOfEntryId ?? null,
        createdById: input.createdById,
      },
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "revenue.recorded",
      eventKey: revenueRecordedEventKey(entry.id),
      occurredAt: input.recognizedAt,
      actor: input.actor,
      title: `收入记账：${input.entryType} ${fx.estimatedCadAmount.toString()} ${BASE_CURRENCY}`,
      result: entry.revenueStatus,
      payload: {
        schemaVersion: 1,
        revenueEntryId: entry.id,
        entryType: input.entryType,
        revenueStatus: entry.revenueStatus,
        originalAmount: fx.originalAmount.toString(),
        originalCurrency: fx.originalCurrency,
        amountCad: fx.estimatedCadAmount.toString(),
        fxRateCadPerOriginalUnit: fx.fxRateCadPerOriginalUnit.toString(),
        fxRateSource: fx.fxRateSource,
        changeOrderReference: input.changeOrderReference ?? null,
        approvedById: input.approvedById ?? null,
        ...(input.correctionOfEntryId ? { correctionOfEntryId: input.correctionOfEntryId } : {}),
      },
      refs: { revenueEntryId: entry.id },
    });

    return entry;
  });
}

/**
 * FORECAST → REALIZED（开票 / 收款确认）。
 * 已实现金额可与预测不同（例如最终合同结算额），差额留在两列上可还原。
 */
export async function realizeRevenueEntry(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  entryId: string;
  actor: LedgerActor;
  realizedById: string;
  /** 实际实现的 CAD 金额；缺省沿用预测额 */
  amountRealizedCad?: DecimalInput | null;
  realizedAt?: Date | null;
}) {
  assertSchemaReady();
  return inTx(input.tx, async (tx) => {
    const entry = await tx.projectRevenueEntry.findFirst({
      where: { id: input.entryId, orgId: input.orgId, projectId: input.projectId },
    });
    if (!entry) throw new FinanceTenantError("revenue entry not found in project/organization");
    if (entry.revenueStatus === "VOIDED") {
      throw new RevenueLifecycleError("已作废收入条目不可实现");
    }
    if (entry.revenueStatus === "REALIZED") {
      // 幂等：已实现直接返回
      return { entry, realized: false as const };
    }

    const amount =
      input.amountRealizedCad != null
        ? roundMoney(dec(input.amountRealizedCad))
        : (entry.amountForecastCad ?? ZERO);
    if (amount.lte(0)) throw new RevenueLifecycleError("已实现收入必须为正", 400);

    const updated = await tx.projectRevenueEntry.update({
      where: { id: entry.id },
      // 只填充 realized 列，forecast 列保持不动（留痕）
      data: { revenueStatus: "REALIZED", amountRealizedCad: amount },
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "revenue.realized",
      eventKey: revenueRealizedEventKey(entry.id),
      occurredAt: input.realizedAt ?? new Date(),
      actor: input.actor,
      title: `收入已实现：${amount.toString()} ${BASE_CURRENCY}`,
      payload: {
        schemaVersion: 1,
        revenueEntryId: entry.id,
        entryType: entry.entryType,
        forecastCad: entry.amountForecastCad?.toString() ?? null,
        realizedCad: amount.toString(),
        realizedById: input.realizedById,
      },
      refs: { revenueEntryId: entry.id },
    });

    return { entry: updated, realized: true as const };
  });
}

/** 作废一条收入（可选同事务建 correction 新行；镜像 ProjectCost 的 void+correction）。 */
export async function voidRevenueEntry(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  entryId: string;
  actor: LedgerActor;
  voidedById: string;
  reason: string;
  correction?: Omit<
    RecordRevenueInput,
    "tx" | "orgId" | "projectId" | "actor" | "correctionOfEntryId"
  >;
}) {
  assertSchemaReady();
  const reason = input.reason?.trim();
  if (!reason) throw new RevenueLifecycleError("作废必须提供理由", 400);

  return inTx(input.tx, async (tx) => {
    const entry = await tx.projectRevenueEntry.findFirst({
      where: { id: input.entryId, orgId: input.orgId, projectId: input.projectId },
    });
    if (!entry) throw new FinanceTenantError("revenue entry not found in project/organization");
    if (entry.revenueStatus === "VOIDED") {
      throw new RevenueLifecycleError("收入条目已作废，不可重复作废");
    }

    const voided = await tx.projectRevenueEntry.update({
      where: { id: entry.id },
      data: { revenueStatus: "VOIDED", voidedAt: new Date(), voidReason: reason },
    });
    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "revenue.voided",
      eventKey: revenueVoidedEventKey(entry.id),
      occurredAt: new Date(),
      actor: input.actor,
      title: `收入条目作废：${entry.entryType}`,
      result: "voided",
      payload: {
        schemaVersion: 1,
        revenueEntryId: entry.id,
        previousStatus: entry.revenueStatus,
        reason,
        voidedById: input.voidedById,
      },
      refs: { revenueEntryId: entry.id },
    });

    let correction = null;
    if (input.correction) {
      correction = await recordRevenueEntry({
        ...input.correction,
        tx,
        orgId: input.orgId,
        projectId: input.projectId,
        actor: input.actor,
        correctionOfEntryId: entry.id,
      });
    }
    return { voided, correction };
  });
}

/* ═══════════════════════════ 读侧 ═══════════════════════════ */

export interface ProjectRevenueRollup {
  available: boolean;
  /** 合同额（CONTRACT_AWARD，非作废，预测口径） */
  contractRevenueCad: Prisma.Decimal;
  /** 已批准变更单合计（CHANGE_ORDER，非作废，预测口径） */
  approvedChangeOrdersCad: Prisma.Decimal;
  /** 调整项（ADJUSTMENT，非作废，预测口径） */
  adjustmentsCad: Prisma.Decimal;
  /** 预测总收入 = 上述三者之和 */
  forecastRevenueCad: Prisma.Decimal;
  /** 已实现总收入（仅 REALIZED 行的 amountRealizedCad） */
  realizedRevenueCad: Prisma.Decimal;
  entryCount: number;
  /** 仍处于 FORECAST（未实现）的条目数 —— final profit 资格判定用 */
  unrealizedEntryCount: number;
}

const EMPTY_ROLLUP: ProjectRevenueRollup = {
  available: false,
  contractRevenueCad: ZERO,
  approvedChangeOrdersCad: ZERO,
  adjustmentsCad: ZERO,
  forecastRevenueCad: ZERO,
  realizedRevenueCad: ZERO,
  entryCount: 0,
  unrealizedEntryCount: 0,
};

/** 项目收入汇总（唯一权威口径；VOIDED 一律排除）。flag OFF → available=false。 */
export async function getProjectRevenueRollup(
  orgId: string,
  projectId: string,
): Promise<ProjectRevenueRollup> {
  if (!isProfitabilitySchemaReady()) return EMPTY_ROLLUP;

  const rows = await db.projectRevenueEntry.findMany({
    where: { orgId, projectId, revenueStatus: { in: ["FORECAST", "REALIZED"] } },
    select: {
      entryType: true,
      revenueStatus: true,
      amountForecastCad: true,
      amountRealizedCad: true,
    },
  });

  let contract = ZERO;
  let changeOrders = ZERO;
  let adjustments = ZERO;
  let realized = ZERO;
  let unrealized = 0;

  for (const r of rows) {
    const forecast = r.amountForecastCad ?? ZERO;
    if (r.entryType === "CONTRACT_AWARD") contract = contract.add(forecast);
    else if (r.entryType === "CHANGE_ORDER") changeOrders = changeOrders.add(forecast);
    else adjustments = adjustments.add(forecast);

    if (r.revenueStatus === "REALIZED") realized = realized.add(r.amountRealizedCad ?? ZERO);
    else unrealized += 1;
  }

  return {
    available: true,
    contractRevenueCad: contract,
    approvedChangeOrdersCad: changeOrders,
    adjustmentsCad: adjustments,
    forecastRevenueCad: contract.add(changeOrders).add(adjustments),
    realizedRevenueCad: realized,
    entryCount: rows.length,
    unrealizedEntryCount: unrealized,
  };
}

/** 收入明细列表（读侧）。 */
export async function listRevenueEntries(orgId: string, projectId: string) {
  if (!isProfitabilitySchemaReady()) return { available: false, entries: [] as unknown[] };
  const rows = await db.projectRevenueEntry.findMany({
    where: { orgId, projectId },
    orderBy: { recognizedAt: "desc" },
    take: 200,
  });
  return {
    available: true,
    entries: rows.map((r) => ({
      id: r.id,
      entryType: r.entryType,
      revenueStatus: r.revenueStatus,
      description: r.description,
      originalAmount: r.originalAmount.toString(),
      originalCurrency: r.originalCurrency,
      amountForecastCad: r.amountForecastCad?.toString() ?? null,
      amountRealizedCad: r.amountRealizedCad?.toString() ?? null,
      recognizedAt: r.recognizedAt.toISOString(),
      changeOrderReference: r.changeOrderReference,
      approvedById: r.approvedById,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      voidedAt: r.voidedAt?.toISOString() ?? null,
      voidReason: r.voidReason,
    })),
  };
}
