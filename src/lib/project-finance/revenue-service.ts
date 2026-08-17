/**
 * T2-P1.6 项目收入账服务 —— 项目收入的**唯一财务事实源**
 *
 * ── R1 更新：T4 AwardRecord 现已在 base 内（PR #107 merged → #104 集成 main → #111 吸收） ──
 * 原审计前提「AwardRecord 不在 base」已失效，但**结论不变**，且现在有了正式契约：
 *
 *   AwardRecord         = Tender Award **Intelligence / Evidence**（组织级情报事实层）
 *   ProjectRevenueEntry = Project **Financial Revenue Ledger**（收入计算唯一财务源）
 *
 * AwardRecord 绝不直接参与 Project Profit 求和 —— 因为它可能记录的是
 * 历史买家授标 / **竞争对手中标** / 外部市场情报，与我方收入毫无关系。
 * 二者经 `materializeAwardRevenue()` 单向、显式、受控地衔接（六重资格闸 + 结构化去重）。
 *
 * 其余候选仍然不合格（保持 read-only / indicative，本服务不读不写）：
 *   `ProjectQuote.totalAmount`（报价单文档）、`Project.estimatedValue` /
 *   `ourBidPrice` / `winningBidPrice`（`Float` 复盘字段）、marketing `revenue`（MMM 域）。
 *
 * 纪律镜像 ProjectCost：
 * - 金额列填充不覆盖：`amountForecastCad` → `amountRecognizedCad`
 * - `RECOGNIZED` 后禁止原地改实质字段；修正 = VOID 旧行 + correction 新行（`correctionOfEntryId` 新→旧）
 * - Change Order 只做**收入侧**表达（entryType=CHANGE_ORDER + 人工 approvedById/At），
 *   不构成完整 CO 工作流（CHANGE_ORDER_MODEL_GAP 仍登记在案）
 *
 * ── 收入 ≠ 现金（R1 §H）──
 * `RECOGNIZED` = 经济收入已确认/定案，**不等于**客户已付款。
 * invoice / customer payment / cash collection / AR aging 均**不在本域**，
 * P1.6 不实现（CUSTOMER_COLLECTION_OUT_OF_SCOPE）；未来银行回款**禁止**再产生第二条 revenue。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendProjectEvent } from "@/lib/project-ledger/event-service";
import type { LedgerActor } from "@/lib/project-ledger/types";
import {
  revenueRecognizedEventKey,
  revenueRecordedEventKey,
  revenueVoidedEventKey,
} from "./event-keys";
import { isProfitabilitySchemaReady } from "./flags";
import { buildFxSnapshot } from "./fx";
import { BASE_CURRENCY, dec, roundMoney, ZERO, type DecimalInput, type FxRateSource } from "./money";
import {
  buildRevenueActiveSourceKey,
  FinanceContractError,
  FinanceTenantError,
  isProjectAwardEligible,
  REVENUE_ENTRY_TYPES,
  RevenueLifecycleError,
  type RevenueEntryType,
  type RevenueSourceType,
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
  /** 直接以「已确认」口径入账（履约完成且金额定案）；缺省 = FORECAST。与是否收到现金无关 */
  asRecognized?: boolean;
  changeOrderReference?: string | null;
  /** CHANGE_ORDER 必须有人工批准人（AI 不得自动批准变更收入） */
  approvedById?: string | null;
  approvedAt?: Date | null;
  refs?: Prisma.InputJsonValue;
  createdById: string;
  /** 修正链：本行是对哪条被 void 行的修正 */
  correctionOfEntryId?: string | null;
  /* ── R1 §F 结构化 provenance ── */
  /** AWARD_RECORD | MANUAL；缺省 MANUAL（无来源锚 → activeSourceKey 为 NULL，不受唯一键约束） */
  sourceType?: RevenueSourceType | null;
  /** 来源域内 id（sourceType=AWARD_RECORD 时为 AwardRecord.id） */
  sourceRefId?: string | null;
}

/** 记一条收入（FORECAST 或直接 RECOGNIZED）。 */
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
  const realized = input.asRecognized === true;

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
        revenueStatus: realized ? "RECOGNIZED" : "FORECAST",
        description: input.description?.trim() || null,
        originalAmount: fx.originalAmount,
        originalCurrency: fx.originalCurrency,
        fxRateCadPerOriginalUnit: fx.fxRateCadPerOriginalUnit,
        fxRateDate: fx.fxRateDate,
        fxRateSource: fx.fxRateSource,
        // 填充不覆盖：RECOGNIZED 也保留 forecast 列（历史口径可还原）
        amountForecastCad: fx.estimatedCadAmount,
        amountRecognizedCad: realized ? fx.estimatedCadAmount : null,
        recognizedAt: input.recognizedAt,
        changeOrderReference: input.changeOrderReference ?? null,
        approvedById: input.approvedById ?? null,
        approvedAt: input.approvedAt ?? (input.approvedById ? new Date() : null),
        refs: input.refs ?? Prisma.JsonNull,
        sourceType: input.sourceType ?? null,
        sourceRefId: input.sourceRefId ?? null,
        // 有来源锚时写去重键；DB @@unique([projectId, activeSourceKey]) 是最后防线
        activeSourceKey: buildRevenueActiveSourceKey(
          input.entryType as RevenueEntryType,
          input.sourceType,
          input.sourceRefId,
        ),
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
 * FORECAST → RECOGNIZED（经济收入确认：履约完成、金额定案）。
 * **不是**「收到客户的钱」—— 回款属未来 AR 域，本函数与现金无关。
 * 确认金额可与预测不同（例如最终合同结算额），差额留在两列上可还原。
 */
export async function recognizeRevenueEntry(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  entryId: string;
  actor: LedgerActor;
  recognizedById: string;
  /** 实际实现的 CAD 金额；缺省沿用预测额 */
  amountRecognizedCad?: DecimalInput | null;
  recognitionOccurredAt?: Date | null;
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
    if (entry.revenueStatus === "RECOGNIZED") {
      // 幂等：已实现直接返回
      return { entry, recognized: false as const };
    }

    const amount =
      input.amountRecognizedCad != null
        ? roundMoney(dec(input.amountRecognizedCad))
        : (entry.amountForecastCad ?? ZERO);
    if (amount.lte(0)) throw new RevenueLifecycleError("已实现收入必须为正", 400);

    const updated = await tx.projectRevenueEntry.update({
      where: { id: entry.id },
      // 只填充 realized 列，forecast 列保持不动（留痕）
      data: { revenueStatus: "RECOGNIZED", amountRecognizedCad: amount },
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "revenue.recognized",
      eventKey: revenueRecognizedEventKey(entry.id),
      occurredAt: input.recognitionOccurredAt ?? new Date(),
      actor: input.actor,
      title: `收入已实现：${amount.toString()} ${BASE_CURRENCY}`,
      payload: {
        schemaVersion: 1,
        revenueEntryId: entry.id,
        entryType: entry.entryType,
        forecastCad: entry.amountForecastCad?.toString() ?? null,
        realizedCad: amount.toString(),
        recognizedById: input.recognizedById,
      },
      refs: { revenueEntryId: entry.id },
    });

    return { entry: updated, recognized: true as const };
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
      data: {
        revenueStatus: "VOIDED",
        voidedAt: new Date(),
        voidReason: reason,
        // 释放去重键位：sourceType/sourceRefId 作为 provenance 永久保留，
        // 仅 activeSourceKey 置 NULL，使同来源的 replacement 行能够写入（R1 §F）
        activeSourceKey: null,
      },
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

/* ═════════════ R1 §E/§F：AwardRecord → CONTRACT_AWARD 物化（唯一受控通道） ═════════════ */

/**
 * 冻结契约（R1 §E）：
 *
 *   AwardRecord         = Tender Award **Intelligence / Evidence**（组织级情报事实层）
 *   ProjectRevenueEntry = Project **Financial Revenue Ledger**（项目收入唯一财务源）
 *
 * - `AwardRecord` 本身**永不**参与 Project Profit 求和 —— profitability/portfolio 读模型
 *   从不查询 AwardRecord（由 p16-pure 静态断言锁定）。
 * - `CONTRACT_AWARD` 收入条目**可以**引用一条合法 AwardRecord 作为 provenance。
 * - **禁止** `on AwardRecord created → auto create revenue`：
 *   AwardRecord 可能是历史买家授标 / 竞争对手中标 / 外部市场情报，与我方收入毫无关系。
 *   物化必须是显式、单独授权的人工动作（本函数 + COST_WRITE 路由）。
 */
export const AWARD_MATERIALIZE_ELIGIBLE_VERIFICATION = [
  "HUMAN_CONFIRMED",
  "SYSTEM_VERIFIED",
] as const;

export type AwardMaterializeRefusal =
  | "AWARD_NOT_FOUND"
  | "AWARD_NOT_LINKED_TO_PROJECT"
  | "AWARD_NOT_ACTIVE"
  | "AWARD_NOT_VERIFIED"
  | "AWARD_AMOUNT_MISSING"
  | "PROJECT_NOT_AWARDED_TO_US";

export interface MaterializeAwardRevenueResult {
  materialized: boolean;
  entryId: string | null;
  /** materialized=false 时说明为何拒绝（如实返回，绝不静默跳过） */
  refusedReason: AwardMaterializeRefusal | null;
  /** true = 命中既有有效条目（幂等），未新建 */
  idempotentHit: boolean;
}

/**
 * 由一条 AwardRecord 物化本项目的 CONTRACT_AWARD 收入条目。
 *
 * 六重资格闸（全部满足才允许物化）：
 *  1. AwardRecord 存在且同 org（租户）
 *  2. `awardRecord.projectId === projectId` —— 明确关联**当前项目**
 *     （历史买家授标 / 竞争对手中标 / 外部情报的 projectId 为 null 或指向别的项目 → 拒）
 *  3. `awardRecord.status === "ACTIVE"`（RETRACTED / NEEDS_REVIEW → 拒）
 *  4. `verificationStatus ∈ {HUMAN_CONFIRMED, SYSTEM_VERIFIED}`
 *     （AI_EXTRACTED / NEEDS_REVIEW 不足以产生财务事实）
 *  5. `contractAmount > 0` 且有 currency
 *  6. **项目本身处于我方中标态**（`isProjectAwardEligible`）——
 *     这一条是关键：AwardRecord 完全可以挂在我们**落标**的项目上用来记录
 *     「是谁中的标」，此时 winnerName 是竞争对手。仅凭 projectId 关联就建收入会
 *     把竞争对手的中标额记成我方收入。
 *
 * 幂等：`@@unique([projectId, activeSourceKey])` + 事务内先查后建；
 * 重复调用返回既有条目（idempotentHit=true），绝不产生第二条。
 */
export async function materializeAwardRevenue(input: {
  tx?: Tx;
  orgId: string;
  projectId: string;
  awardRecordId: string;
  actor: LedgerActor;
  createdById: string;
  /** 缺省 FORECAST（合同额 = 预期收入，尚未确认为经济收入） */
  asRecognized?: boolean;
  description?: string | null;
}): Promise<MaterializeAwardRevenueResult> {
  assertSchemaReady();

  return inTx(input.tx, async (tx) => {
    const refuse = (r: AwardMaterializeRefusal): MaterializeAwardRevenueResult => ({
      materialized: false,
      entryId: null,
      refusedReason: r,
      idempotentHit: false,
    });

    const project = await tx.project.findFirst({
      where: { id: input.projectId, orgId: input.orgId },
      select: {
        id: true,
        bidPhaseStatus: true,
        tenderStatus: true,
        workDomain: true,
      },
    });
    if (!project) throw new FinanceTenantError();

    const award = await tx.awardRecord.findFirst({
      where: { id: input.awardRecordId, orgId: input.orgId },
    });
    if (!award) return refuse("AWARD_NOT_FOUND");
    // ② 必须明确关联当前项目（外部/历史/竞对情报的 projectId 为 null 或指向别处）
    if (award.projectId !== input.projectId) return refuse("AWARD_NOT_LINKED_TO_PROJECT");
    // ③ 只认 ACTIVE
    if (award.status !== "ACTIVE") return refuse("AWARD_NOT_ACTIVE");
    // ④ 必须过既有人工/系统验证契约
    if (
      !(AWARD_MATERIALIZE_ELIGIBLE_VERIFICATION as readonly string[]).includes(
        award.verificationStatus,
      )
    ) {
      return refuse("AWARD_NOT_VERIFIED");
    }
    // ⑤ 金额
    if (award.contractAmount == null || award.contractAmount.lte(0)) {
      return refuse("AWARD_AMOUNT_MISSING");
    }
    // ⑥ 项目必须处于我方中标态 —— 防止把竞争对手的中标额记成我方收入
    if (!isProjectAwardEligible(project)) return refuse("PROJECT_NOT_AWARDED_TO_US");

    // 幂等：同 project + 同 award 的有效 CONTRACT_AWARD 至多一条
    const activeKey = buildRevenueActiveSourceKey(
      "CONTRACT_AWARD",
      "AWARD_RECORD",
      award.id,
    );
    const existing = await tx.projectRevenueEntry.findFirst({
      where: { projectId: input.projectId, activeSourceKey: activeKey },
    });
    if (existing) {
      return {
        materialized: false,
        entryId: existing.id,
        refusedReason: null,
        idempotentHit: true,
      };
    }

    const entry = await recordRevenueEntry({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      actor: input.actor,
      entryType: "CONTRACT_AWARD",
      description:
        input.description?.trim() ||
        `由授标记录物化：${award.winnerName}${award.solicitationNumber ? ` / ${award.solicitationNumber}` : ""}`,
      originalAmount: award.contractAmount,
      originalCurrency: award.currency ?? BASE_CURRENCY,
      // 授标记录本身不带汇率；非 CAD 时要求财务另行补录（fail-closed，绝不臆造汇率）
      fxRateCadPerOriginalUnit: (award.currency ?? BASE_CURRENCY) === BASE_CURRENCY ? "1" : null,
      fxRateDate: award.awardDate ?? new Date(),
      fxRateSource: (award.currency ?? BASE_CURRENCY) === BASE_CURRENCY ? "BASE_CURRENCY" : "MANUAL",
      recognizedAt: award.awardDate ?? new Date(),
      asRecognized: input.asRecognized === true,
      refs: { awardRecordId: award.id },
      sourceType: "AWARD_RECORD",
      sourceRefId: award.id,
      createdById: input.createdById,
    });

    return { materialized: true, entryId: entry.id, refusedReason: null, idempotentHit: false };
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
  /** 已确认总收入（仅 RECOGNIZED 行的 amountRecognizedCad）；≠ 已收到的现金 */
  recognizedRevenueCad: Prisma.Decimal;
  entryCount: number;
  /** 仍处于 FORECAST（未确认）的条目数 —— final profit 资格判定用 */
  unrecognizedEntryCount: number;
  /** 非 CAD 且缺 CAD 折算的收入条目数（数据质量；不猜金额） */
  unknownCurrencyEntryCount: number;
}

const EMPTY_ROLLUP: ProjectRevenueRollup = {
  available: false,
  contractRevenueCad: ZERO,
  approvedChangeOrdersCad: ZERO,
  adjustmentsCad: ZERO,
  forecastRevenueCad: ZERO,
  recognizedRevenueCad: ZERO,
  entryCount: 0,
  unrecognizedEntryCount: 0,
  unknownCurrencyEntryCount: 0,
};

/** 项目收入汇总（唯一权威口径；VOIDED 一律排除）。flag OFF → available=false。 */
export async function getProjectRevenueRollup(
  orgId: string,
  projectId: string,
): Promise<ProjectRevenueRollup> {
  if (!isProfitabilitySchemaReady()) return EMPTY_ROLLUP;

  const rows = await db.projectRevenueEntry.findMany({
    where: { orgId, projectId, revenueStatus: { in: ["FORECAST", "RECOGNIZED"] } },
    select: {
      entryType: true,
      revenueStatus: true,
      amountForecastCad: true,
      amountRecognizedCad: true,
      originalCurrency: true,
    },
  });

  let contract = ZERO;
  let changeOrders = ZERO;
  let adjustments = ZERO;
  let realized = ZERO;
  let unrealized = 0;
  let unknownCurrency = 0;

  for (const r of rows) {
    // 收入行的 CAD 列由 buildFxSnapshot 保证；若历史/异常行缺失则计数上报，不猜
    if (r.amountForecastCad == null && r.amountRecognizedCad == null) unknownCurrency += 1;
    const forecast = r.amountForecastCad ?? ZERO;
    if (r.entryType === "CONTRACT_AWARD") contract = contract.add(forecast);
    else if (r.entryType === "CHANGE_ORDER") changeOrders = changeOrders.add(forecast);
    else adjustments = adjustments.add(forecast);

    if (r.revenueStatus === "RECOGNIZED") realized = realized.add(r.amountRecognizedCad ?? ZERO);
    else unrealized += 1;
  }

  return {
    available: true,
    contractRevenueCad: contract,
    approvedChangeOrdersCad: changeOrders,
    adjustmentsCad: adjustments,
    forecastRevenueCad: contract.add(changeOrders).add(adjustments),
    recognizedRevenueCad: realized,
    entryCount: rows.length,
    unrecognizedEntryCount: unrealized,
    unknownCurrencyEntryCount: unknownCurrency,
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
      amountRecognizedCad: r.amountRecognizedCad?.toString() ?? null,
      recognizedAt: r.recognizedAt.toISOString(),
      changeOrderReference: r.changeOrderReference,
      approvedById: r.approvedById,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      voidedAt: r.voidedAt?.toISOString() ?? null,
      voidReason: r.voidReason,
    })),
  };
}
