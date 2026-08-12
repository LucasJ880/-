/**
 * ProjectCost canonical lifecycle service — 当前权威成本域记录的唯一写入口
 *
 * 契约（#96 §6.3）：
 *   PLANNED → COMMITTED → ACTUAL；任何阶段 → VOIDED。
 *   三金额列只填充不覆盖（留痕）；PLANNED 可编辑但实质修改必须
 *   revisionCount+1 + cost.revised 事件（同事务）；ACTUAL 后不可实质修改，
 *   修正 = void 旧行 + correction 新行（correctionOfCostId）。
 *   AI/模型成本唯一权威 = AiUsageLedger —— 本服务拒绝 AI/DATA_API 类别。
 *
 * 业务代码不得直接 prisma.projectCost.create/update —— 一律经本服务。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendProjectEvent } from "./event-service";
import { lockProjectHistoryAnchorShared } from "./history-anchor";
import {
  costRevisionEventKey,
  costStatusEventKey,
} from "./event-keys";
import {
  COST_CATEGORIES_RESERVED_FOR_AI_LEDGER,
  CostLifecycleError,
  LedgerTenantError,
  PROJECT_COST_CATEGORIES,
  type LedgerActor,
  type ProjectCostCategory,
} from "./types";

type Tx = Prisma.TransactionClient;
type DecimalInput = Prisma.Decimal | string | number;

function dec(v: DecimalInput): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

function decEq(a: Prisma.Decimal | null, b: Prisma.Decimal | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.equals(b);
}

function assertCategory(category: string): asserts category is ProjectCostCategory {
  if (!(PROJECT_COST_CATEGORIES as readonly string[]).includes(category)) {
    throw new CostLifecycleError(`未知成本类别: ${category}`, 400);
  }
  if (
    (COST_CATEGORIES_RESERVED_FOR_AI_LEDGER as readonly string[]).includes(
      category,
    )
  ) {
    throw new CostLifecycleError(
      "AI/DATA_API 成本由 AiUsageLedger 唯一记账，不允许写入 ProjectCost",
      400,
    );
  }
}

async function inTx<T>(
  tx: Tx | undefined,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (tx) return fn(tx);
  return db.$transaction(fn);
}

async function loadOwnedCost(tx: Tx, orgId: string, projectId: string, costId: string) {
  const cost = await tx.projectCost.findFirst({
    where: { id: costId, orgId, projectId },
  });
  if (!cost) throw new LedgerTenantError("cost not found in project/organization");
  return cost;
}

export interface CreateProjectCostInput {
  tx?: Tx;
  orgId: string;
  projectId: string;
  actor: LedgerActor;
  /** PLANNED（计划）或 ACTUAL（“记一笔”快捷实报） */
  costStatus: "PLANNED" | "ACTUAL";
  category: string;
  amount: DecimalInput;
  currency: string;
  description?: string | null;
  quantity?: DecimalInput | null;
  unit?: string | null;
  unitRate?: DecimalInput | null;
  incurredById?: string | null;
  incurredAt: Date;
  supplierId?: string | null;
  refs?: Prisma.InputJsonValue;
  /** 修正链：新行指回被 void 的旧行（由 voidProjectCost 的 correction 路径填写） */
  correctionOfCostId?: string | null;
  createdById: string;
}

export async function createProjectCost(input: CreateProjectCostInput) {
  assertCategory(input.category);
  if (input.costStatus !== "PLANNED" && input.costStatus !== "ACTUAL") {
    throw new CostLifecycleError("新建成本仅允许 PLANNED 或 ACTUAL", 400);
  }
  const amount = dec(input.amount);

  return inTx(input.tx, async (tx) => {
    // 授权锚锁（T3.5）：ProjectCost 行本身即权威历史，创建前须先对 Project 行取
    // FOR KEY SHARE，与 hard delete 互斥（防 cost↔delete orphan）。同时充当租户闸。
    const anchorLocked = await lockProjectHistoryAnchorShared(
      tx,
      input.orgId,
      input.projectId,
    );
    if (!anchorLocked) {
      throw new LedgerTenantError("project not found in organization");
    }

    const cost = await tx.projectCost.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        costStatus: input.costStatus,
        category: input.category,
        description: input.description ?? null,
        quantity: input.quantity != null ? dec(input.quantity) : null,
        unit: input.unit ?? null,
        unitRate: input.unitRate != null ? dec(input.unitRate) : null,
        amountPlanned: input.costStatus === "PLANNED" ? amount : null,
        amountActual: input.costStatus === "ACTUAL" ? amount : null,
        currency: input.currency,
        incurredById: input.incurredById ?? null,
        incurredAt: input.incurredAt,
        supplierId: input.supplierId ?? null,
        refs: input.refs ?? Prisma.JsonNull,
        correctionOfCostId: input.correctionOfCostId ?? null,
        createdById: input.createdById,
      },
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "cost.recorded",
      eventKey: costStatusEventKey(cost.id, cost.costStatus),
      occurredAt: input.incurredAt,
      actor: input.actor,
      title:
        input.costStatus === "PLANNED"
          ? `计划成本：${input.category}`
          : `实报成本：${input.category}`,
      payload: {
        schemaVersion: 1,
        costId: cost.id,
        costStatus: cost.costStatus,
        category: cost.category,
        amount: amount.toString(),
        currency: cost.currency,
        ...(input.correctionOfCostId
          ? { correctionOfCostId: input.correctionOfCostId }
          : {}),
      },
      refs: { costId: cost.id },
      relatedCostId: cost.id,
    });

    return cost;
  });
}

export interface RevisePlannedCostInput {
  tx?: Tx;
  orgId: string;
  projectId: string;
  costId: string;
  actor: LedgerActor;
  changes: {
    amount?: DecimalInput;
    category?: string;
    description?: string | null;
    quantity?: DecimalInput | null;
    unit?: string | null;
    unitRate?: DecimalInput | null;
    currency?: string;
    supplierId?: string | null;
    incurredAt?: Date;
  };
}

/** PLANNED 实质修订：revisionCount+1 + cost.revised 事件（同事务）。非 PLANNED 一律拒绝。 */
export async function revisePlannedCost(input: RevisePlannedCostInput) {
  if (input.changes.category !== undefined) assertCategory(input.changes.category);

  return inTx(input.tx, async (tx) => {
    const cost = await loadOwnedCost(tx, input.orgId, input.projectId, input.costId);
    if (cost.costStatus !== "PLANNED") {
      throw new CostLifecycleError(
        `仅 PLANNED 成本允许修订；当前状态 ${cost.costStatus} 的修正 = void + correction 新行`,
      );
    }

    const changedFields: string[] = [];
    const data: Prisma.ProjectCostUpdateInput = {};
    const c = input.changes;

    if (c.amount !== undefined && !decEq(cost.amountPlanned, dec(c.amount))) {
      changedFields.push("amount");
      data.amountPlanned = dec(c.amount);
    }
    if (c.category !== undefined && c.category !== cost.category) {
      changedFields.push("category");
      data.category = c.category;
    }
    if (c.description !== undefined && (c.description ?? null) !== cost.description) {
      changedFields.push("description");
      data.description = c.description ?? null;
    }
    if (c.quantity !== undefined) {
      const next = c.quantity != null ? dec(c.quantity) : null;
      if (!decEq(cost.quantity, next)) {
        changedFields.push("quantity");
        data.quantity = next;
      }
    }
    if (c.unit !== undefined && (c.unit ?? null) !== cost.unit) {
      changedFields.push("unit");
      data.unit = c.unit ?? null;
    }
    if (c.unitRate !== undefined) {
      const next = c.unitRate != null ? dec(c.unitRate) : null;
      if (!decEq(cost.unitRate, next)) {
        changedFields.push("unitRate");
        data.unitRate = next;
      }
    }
    if (c.currency !== undefined && c.currency !== cost.currency) {
      changedFields.push("currency");
      data.currency = c.currency;
    }
    if (c.supplierId !== undefined && (c.supplierId ?? null) !== cost.supplierId) {
      changedFields.push("supplierId");
      data.supplierId = c.supplierId ?? null;
    }
    if (
      c.incurredAt !== undefined &&
      c.incurredAt.getTime() !== cost.incurredAt.getTime()
    ) {
      changedFields.push("incurredAt");
      data.incurredAt = c.incurredAt;
    }

    if (changedFields.length === 0) {
      return { cost, revised: false as const };
    }

    const nextRevision = cost.revisionCount + 1;
    const updated = await tx.projectCost.update({
      where: { id: cost.id },
      data: { ...data, revisionCount: nextRevision },
    });

    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "cost.revised",
      eventKey: costRevisionEventKey(cost.id, nextRevision),
      occurredAt: new Date(),
      actor: input.actor,
      title: `计划成本修订 #${nextRevision}`,
      payload: {
        schemaVersion: 1,
        costId: cost.id,
        revisionCount: nextRevision,
        changedFields,
        previousAmount: cost.amountPlanned?.toString() ?? null,
        newAmount: updated.amountPlanned?.toString() ?? null,
        previousCategory: cost.category,
        newCategory: updated.category,
      },
      refs: { costId: cost.id },
      relatedCostId: cost.id,
    });

    return { cost: updated, revised: true as const };
  });
}

export interface CostTransitionInput {
  tx?: Tx;
  orgId: string;
  projectId: string;
  costId: string;
  actor: LedgerActor;
  /** 缺省沿用上一阶段金额（列填充不覆盖） */
  amount?: DecimalInput;
}

/** PLANNED → COMMITTED */
export async function commitProjectCost(input: CostTransitionInput) {
  return inTx(input.tx, async (tx) => {
    const cost = await loadOwnedCost(tx, input.orgId, input.projectId, input.costId);
    if (cost.costStatus !== "PLANNED") {
      throw new CostLifecycleError(
        `仅 PLANNED 可提交为 COMMITTED；当前 ${cost.costStatus}`,
      );
    }
    const amount =
      input.amount !== undefined ? dec(input.amount) : cost.amountPlanned;
    if (amount === null) {
      throw new CostLifecycleError("COMMITTED 金额缺失", 400);
    }
    const updated = await tx.projectCost.update({
      where: { id: cost.id },
      data: { costStatus: "COMMITTED", amountCommitted: amount },
    });
    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "cost.committed",
      eventKey: costStatusEventKey(cost.id, "COMMITTED"),
      occurredAt: new Date(),
      actor: input.actor,
      title: `成本已承诺：${cost.category}`,
      payload: {
        schemaVersion: 1,
        costId: cost.id,
        amount: amount.toString(),
        currency: cost.currency,
      },
      refs: { costId: cost.id },
      relatedCostId: cost.id,
    });
    return updated;
  });
}

/** COMMITTED → ACTUAL */
export async function actualizeProjectCost(input: CostTransitionInput) {
  return inTx(input.tx, async (tx) => {
    const cost = await loadOwnedCost(tx, input.orgId, input.projectId, input.costId);
    if (cost.costStatus !== "COMMITTED") {
      throw new CostLifecycleError(
        `仅 COMMITTED 可落实为 ACTUAL；当前 ${cost.costStatus}`,
      );
    }
    const amount =
      input.amount !== undefined ? dec(input.amount) : cost.amountCommitted;
    if (amount === null) {
      throw new CostLifecycleError("ACTUAL 金额缺失", 400);
    }
    const updated = await tx.projectCost.update({
      where: { id: cost.id },
      data: { costStatus: "ACTUAL", amountActual: amount },
    });
    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "cost.actualized",
      eventKey: costStatusEventKey(cost.id, "ACTUAL"),
      occurredAt: new Date(),
      actor: input.actor,
      title: `成本已落实：${cost.category}`,
      payload: {
        schemaVersion: 1,
        costId: cost.id,
        amount: amount.toString(),
        currency: cost.currency,
      },
      refs: { costId: cost.id },
      relatedCostId: cost.id,
    });
    return updated;
  });
}

export interface VoidProjectCostInput {
  tx?: Tx;
  orgId: string;
  projectId: string;
  costId: string;
  actor: LedgerActor;
  reason: string;
  /** ACTUAL 修正路径：void 旧行 + 同事务创建 correction 新行 */
  correction?: Omit<
    CreateProjectCostInput,
    "tx" | "orgId" | "projectId" | "actor" | "correctionOfCostId"
  >;
}

export async function voidProjectCost(input: VoidProjectCostInput) {
  if (!input.reason?.trim()) {
    throw new CostLifecycleError("void 必须提供 reason", 400);
  }
  return inTx(input.tx, async (tx) => {
    const cost = await loadOwnedCost(tx, input.orgId, input.projectId, input.costId);
    if (cost.costStatus === "VOIDED") {
      throw new CostLifecycleError("成本已作废，不可重复 void");
    }
    const voided = await tx.projectCost.update({
      where: { id: cost.id },
      data: {
        costStatus: "VOIDED",
        voidedAt: new Date(),
        voidReason: input.reason.trim(),
      },
    });
    await appendProjectEvent({
      tx,
      orgId: input.orgId,
      projectId: input.projectId,
      eventType: "cost.voided",
      eventKey: costStatusEventKey(cost.id, "VOIDED"),
      occurredAt: new Date(),
      actor: input.actor,
      title: `成本作废：${cost.category}`,
      result: "voided",
      payload: {
        schemaVersion: 1,
        costId: cost.id,
        previousStatus: cost.costStatus,
        reason: input.reason.trim(),
      },
      refs: { costId: cost.id },
      relatedCostId: cost.id,
    });

    let correction = null;
    if (input.correction) {
      correction = await createProjectCost({
        ...input.correction,
        tx,
        orgId: input.orgId,
        projectId: input.projectId,
        actor: input.actor,
        correctionOfCostId: cost.id,
      });
    }
    return { voided, correction };
  });
}
