/**
 * 已签字报价 → 草稿工艺单（自动生成）+ 工艺参数版本化读写。
 *
 * - 触发：mark-signed / 公开 sign 两个路由在报价写成 signed 之后同步调用（design D4），不经过队列
 * - 幂等：AuditLog(targetType=sales_quote, targetId=quoteId, action=process_order.generated) 记录关联；
 *         并发时第二个事务因 BlindsOrder.code 唯一约束失败，捕获后按关联返回既有单（design D3）
 * - 零 schema：非 Blinds 工艺参数写 AuditLog(targetType=blinds_order, action=process_order.spec) 的 afterData（design D2）
 * - 从不抛出：任何错误返回 { created:false, reason:"GENERATION_FAILED" }，不影响签字（design D5）
 * - 不对外发送：只写站内通知
 *
 * db 以参数注入（生产传 @/lib/db 的 prisma client），便于用内存假体测试。
 */

import { calculateItem } from "@/lib/blinds/calculation-engine";
import { RULE_VERSION } from "@/lib/blinds/deduction-rules";
import { blockingIssues, computeIssues, type ProcessIssue } from "./issues";
import {
  AUDIT_ACTION_GENERATED,
  AUDIT_ACTION_SPEC,
  AUDIT_TARGET_ORDER,
  AUDIT_TARGET_QUOTE,
  emptySpec,
  sanitizeSpec,
  type ProcessSpec,
} from "./process-spec";
import { planLineMove, type MovableItem, type MoveRequest, type ReturnedItem } from "./line-moves";
import { mapQuoteFormToProcessOrder, type BlindsItemDraft } from "./quote-mapping";
import { readZebraRatios, type ZebraRatioEntry } from "./zebra-ratios";

export const NOTIFICATION_TYPE = "process_order_generated";

export type GenerationReason =
  | "NOT_FOUND"
  | "NOT_SIGNED"
  | "NO_PRODUCIBLE_LINES"
  | "ALREADY_GENERATED"
  | "GENERATION_FAILED";

export interface GenerationResult {
  created: boolean;
  id?: string;
  code?: string;
  reason?: GenerationReason;
  blockingCount?: number;
}

// ── 注入的数据访问（prisma client 的结构子集）──

interface AuditRow {
  id?: string;
  afterData: string | null;
  createdAt?: Date;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ProcessOrderDb {
  salesQuote: { findUnique(args: any): Promise<any> };
  /** 读斑马帘布纱比对照表（settingsJson）；缺省 = 用原件种子 */
  organization?: { findUnique(args: any): Promise<any> };
  blindsOrder: { findUnique(args: any): Promise<any>; create(args: any): Promise<any>; update?(args: any): Promise<any> };
  blindsOrderItem?: { deleteMany(args: any): Promise<unknown> };
  auditLog: { findFirst(args: any): Promise<AuditRow | null>; create(args: any): Promise<unknown> };
  $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface NotifyFn {
  (input: {
    userId: string;
    type: string;
    title: string;
    summary?: string;
    orgId?: string | null;
    entityType?: string;
    entityId?: string;
    priority?: string;
    sourceKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
}

export function itemCreateData(it: BlindsItemDraft | MovableItem | ReturnedItem | Record<string, unknown>, index: number) {
  const src = it as Record<string, unknown>;
  const input = {
    width: Number(src.width),
    height: Number(src.height),
    productType: String(src.productType),
    measureType: String(src.measureType),
    controlType: String(src.controlType),
    headrailType: String(src.headrailType),
    fabricRatio: src.fabricRatio != null ? Number(src.fabricRatio) : null,
    silkRatio: src.silkRatio != null ? Number(src.silkRatio) : null,
    bottomBarWidth: src.bottomBarWidth != null ? Number(src.bottomBarWidth) : null,
  };
  const calc = calculateItem(input);
  return {
    itemNumber: index + 1,
    location: String(src.location || ""),
    width: input.width,
    height: input.height,
    fabricSku: String(src.fabricSku || ""),
    productType: input.productType,
    measureType: input.measureType,
    controlType: input.controlType,
    controlSide: String(src.controlSide || "R"),
    headrailType: input.headrailType,
    mountType: String(src.mountType || "顶装"),
    fabricRatio: input.fabricRatio,
    silkRatio: input.silkRatio,
    bottomBarWidth: input.bottomBarWidth,
    itemRemark: src.itemRemark ? String(src.itemRemark) : null,
    cutHeadrail: calc.cutHeadrail,
    cutTube38: calc.cutTube38,
    cutRollerBar: calc.cutRollerBar,
    cutZebraBar: calc.cutZebraBar,
    cutCoreRod: calc.cutCoreRod,
    cutShangrilaBar: calc.cutShangrilaBar,
    cutFabricWidth: calc.cutFabricWidth,
    cutFabricLength: calc.cutFabricLength,
    insertSize: calc.insertSize,
    cordLength: calc.cordLength,
    cordSleeveLen: calc.cordSleeveLen,
    squareFeet: calc.squareFeet,
    sortOrder: calc.sortOrder,
  };
}

function parseJson(s: string | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function findLinkedOrder(db: Pick<ProcessOrderDb, "auditLog" | "blindsOrder">, quoteId: string): Promise<{ id: string; code: string } | null> {
  const link = await db.auditLog.findFirst({
    where: { targetType: AUDIT_TARGET_QUOTE, targetId: quoteId, action: AUDIT_ACTION_GENERATED },
    orderBy: { createdAt: "desc" },
  });
  const orderId = parseJson(link?.afterData)?.orderId;
  if (typeof orderId !== "string") return null;
  return db.blindsOrder.findUnique({ where: { id: orderId }, select: { id: true, code: true } });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export async function generateProcessOrderForSignedQuote(
  quoteId: string,
  deps: { db: ProcessOrderDb; notify?: NotifyFn },
): Promise<GenerationResult> {
  const { db } = deps;
  try {
    const quote = await db.salesQuote.findUnique({
      where: { id: quoteId },
      select: {
        id: true, orgId: true, status: true, signedAt: true, orderNumber: true, formDataJson: true,
        customerId: true, opportunityId: true, createdById: true,
        customer: { select: { name: true, phone: true, address: true } },
      },
    });
    if (!quote) return { created: false, reason: "NOT_FOUND" };
    if (quote.status !== "signed") return { created: false, reason: "NOT_SIGNED" };

    const existing = await findLinkedOrder(db, quoteId);
    if (existing) return { created: false, reason: "ALREADY_GENERATED", id: existing.id, code: existing.code };

    const org = quote.orgId && db.organization
      ? await db.organization.findUnique({ where: { id: quote.orgId }, select: { settingsJson: true } })
      : null;
    const mapped = mapQuoteFormToProcessOrder(quote.formDataJson, { zebraRatios: readZebraRatios(org?.settingsJson ?? null).entries });
    if (!mapped.producible) return { created: false, reason: "NO_PRODUCIBLE_LINES" };

    const form = parseJson(quote.formDataJson) ?? {};
    const customerName = String(quote.customer?.name || form.customerName || "未命名客户");
    const baseCode = String(quote.orderNumber || form.orderNumber || `Q-${quoteId}`).slice(0, 120);

    const spec: ProcessSpec = {
      ...mapped.spec,
      version: 1,
      source: {
        quoteId,
        orderNumber: quote.orderNumber ?? null,
        signedAt: quote.signedAt ? new Date(quote.signedAt).toISOString() : null,
        customerName,
      },
    };

    let order: { id: string; code: string };
    try {
      const outcome = await db.$transaction(async (tx) => {
        // 同一报价的生成串行化：事务级 advisory lock，锁内再查一次关联与编号占用
        // （否则两个并发请求都没查到关联、后到者把先到者的单当成"编号被占用"改用后缀，会生成两张单）
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`sunny-process-order:${quoteId}`}))) AS l`;
        const linked = await findLinkedOrder(tx, quoteId);
        if (linked) return { kind: "existing" as const, order: linked };
        const taken = await tx.blindsOrder.findUnique({ where: { code: baseCode }, select: { id: true } });
        const code = taken ? `${baseCode}-Q${quoteId.slice(-6)}` : baseCode;
        const created = await tx.blindsOrder.create({
          data: {
            code,
            status: "draft",
            ruleVersion: RULE_VERSION,
            customerName,
            phone: (quote.customer?.phone as string | null) || (form.customerPhone as string) || null,
            address: (quote.customer?.address as string | null) || (form.customerAddress as string) || null,
            remarks: `由报价 ${quote.orderNumber || quoteId} 签字后自动生成（草稿，待工厂核对）`,
            creatorId: quote.createdById,
            customerId: quote.customerId,
            opportunityId: quote.opportunityId ?? null,
            items: { create: mapped.blindsItems.map((it, i) => itemCreateData(it, i)) },
          },
          select: { id: true, code: true },
        });
        await tx.auditLog.create({
          data: {
            userId: quote.createdById,
            orgId: quote.orgId,
            action: AUDIT_ACTION_SPEC,
            targetType: AUDIT_TARGET_ORDER,
            targetId: created.id,
            afterData: JSON.stringify(spec),
          },
        });
        await tx.auditLog.create({
          data: {
            userId: quote.createdById,
            orgId: quote.orgId,
            action: AUDIT_ACTION_GENERATED,
            targetType: AUDIT_TARGET_QUOTE,
            targetId: quoteId,
            afterData: JSON.stringify({ orderId: created.id, code: created.code }),
          },
        });
        return { kind: "created" as const, order: created as { id: string; code: string } };
      });
      if (outcome.kind === "existing") {
        return { created: false, reason: "ALREADY_GENERATED", id: outcome.order.id, code: outcome.order.code };
      }
      order = outcome.order;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await findLinkedOrder(db, quoteId);
        if (again) return { created: false, reason: "ALREADY_GENERATED", id: again.id, code: again.code };
      }
      throw err;
    }

    // 工艺单已落库：之后的任何异常都不能再报 GENERATION_FAILED
    let blockingCount = 0;
    try {
      blockingCount = blockingIssues(computeIssues(mapped.blindsItems as never, spec, order.code)).length;
    } catch (err) {
      console.error(`[process-order] issue check failed order=${order.id}:`, err);
    }
    if (deps.notify) {
      await deps
        .notify({
          userId: quote.createdById,
          type: NOTIFICATION_TYPE,
          title: `工艺单草稿已生成 — ${customerName}`,
          summary: `${order.code} · ${blockingCount > 0 ? `${blockingCount} 项阻断待补` : "无阻断项"}，请工厂核对后确认`,
          orgId: quote.orgId,
          entityType: "blinds_order",
          entityId: order.id,
          priority: blockingCount > 0 ? "high" : "medium",
          sourceKey: `${NOTIFICATION_TYPE}:${order.id}`,
          metadata: { href: `/blinds-orders/${order.id}`, quoteId, blockingCount },
        })
        .catch((err) => console.error("[process-order] notify failed:", err));
    }
    return { created: true, id: order.id, code: order.code, blockingCount };
  } catch (err) {
    console.error(`[process-order] generation failed quote=${quoteId}:`, err);
    return { created: false, reason: "GENERATION_FAILED" };
  }
}

// ── 工艺参数读写 ──

export async function loadProcessSpec(db: Pick<ProcessOrderDb, "auditLog">, orderId: string): Promise<ProcessSpec> {
  const row = await db.auditLog.findFirst({
    where: { targetType: AUDIT_TARGET_ORDER, targetId: orderId, action: AUDIT_ACTION_SPEC },
    orderBy: { createdAt: "desc" },
  });
  const raw = parseJson(row?.afterData);
  return raw ? sanitizeSpec(raw) : emptySpec();
}

export type SaveSpecResult =
  | { ok: true; spec: ProcessSpec }
  | { ok: false; status: 404 | 409; error: string };

/** 同一工艺单的参数写入串行化（保存参数 / 挪行），锁内再做版本校验 */
export async function lockOrderSpec(tx: { $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> }, orderId: string) {
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`sunny-process-spec:${orderId}`}))) AS l`;
}

export async function saveProcessSpec(
  db: Pick<ProcessOrderDb, "auditLog" | "blindsOrder" | "$transaction">,
  orderId: string,
  payload: unknown,
  actor: { userId: string; orgId: string | null },
  opts: { baseVersion?: number | null } = {},
): Promise<SaveSpecResult> {
  return db.$transaction(async (tx): Promise<SaveSpecResult> => {
    await lockOrderSpec(tx, orderId);
    const order = await tx.blindsOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
    if (!order) return { ok: false, status: 404, error: "工艺单不存在" };
    if (order.status !== "draft") return { ok: false, status: 409, error: "只有草稿状态的工艺单可以修改工艺参数" };
    const current = await loadProcessSpec(tx, orderId);
    // 乐观锁：编辑基于的版本已不是最新 → 拒绝，防止两人同时改时后保存的人悄悄覆盖
    if (typeof opts.baseVersion === "number" && opts.baseVersion !== current.version) {
      return { ok: false, status: 409, error: `工艺参数已被他人更新到 v${current.version}，请刷新后再改` };
    }
    const next = sanitizeSpec(payload, current);
    next.version = current.version + 1;
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        orgId: actor.orgId,
        action: AUDIT_ACTION_SPEC,
        targetType: AUDIT_TARGET_ORDER,
        targetId: orderId,
        afterData: JSON.stringify(next),
      },
    });
    return { ok: true, spec: next };
  });
}

export type MoveLinesResult =
  | { ok: true; spec: ProcessSpec; moved: number }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * 发给国内（自产行 → 国内下单表）/ 退回自产（国内下单表 → 自产行），草稿内一次事务完成：
 * 重写 BlindsOrderItem（与 PUT 工艺单同一写法）+ 追加一版工艺参数。不对外发送任何东西。
 */
export async function moveProcessOrderLines(
  db: ProcessOrderDb,
  orderId: string,
  req: MoveRequest,
  actor: { userId: string; orgId: string | null },
  opts: { baseVersion?: number | null; zebraRatios?: readonly ZebraRatioEntry[] } = {},
): Promise<MoveLinesResult> {
  return db.$transaction(async (tx): Promise<MoveLinesResult> => {
    await lockOrderSpec(tx, orderId);
    const order = await tx.blindsOrder.findUnique({ where: { id: orderId }, include: { items: { orderBy: { itemNumber: "asc" } } } });
    if (!order) return { ok: false, status: 404, error: "工艺单不存在" };
    if (order.status !== "draft") return { ok: false, status: 409, error: "只有草稿状态的工艺单可以挪行" };
    const current = await loadProcessSpec(tx, orderId);
    if (typeof opts.baseVersion === "number" && opts.baseVersion !== current.version) {
      return { ok: false, status: 409, error: `工艺参数已被他人更新到 v${current.version}，请刷新后再操作` };
    }
    const plan = planLineMove(order.items as MovableItem[], current, req, opts.zebraRatios);
    if (plan.moved === 0) {
      return { ok: false, status: 400, error: req.to === "domestic" ? "没有选中可发给国内的自产行" : "没有选中可退回自产的行（仅卷帘 / 斑马帘 / 香格里拉）" };
    }
    await tx.blindsOrderItem.deleteMany({ where: { orderId } });
    await tx.blindsOrder.update({
      where: { id: orderId },
      data: { ruleVersion: RULE_VERSION, items: { create: plan.items.map((it, i) => itemCreateData(it, i)) } },
    });
    const next: ProcessSpec = { ...plan.spec, version: current.version + 1 };
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        orgId: actor.orgId,
        action: AUDIT_ACTION_SPEC,
        targetType: AUDIT_TARGET_ORDER,
        targetId: orderId,
        afterData: JSON.stringify(next),
      },
    });
    return { ok: true, spec: next, moved: plan.moved };
  });
}

export function orderIssues(order: { code: string; items: unknown[] }, spec: ProcessSpec): ProcessIssue[] {
  return computeIssues(order.items as never, spec, order.code);
}
