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
import { mapQuoteFormToProcessOrder, type BlindsItemDraft } from "./quote-mapping";

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
  blindsOrder: { findUnique(args: any): Promise<any>; create(args: any): Promise<any> };
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

export function itemCreateData(it: BlindsItemDraft | Record<string, unknown>, index: number) {
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

async function findLinkedOrder(db: Pick<ProcessOrderDb, "auditLog" | "blindsOrder">, quoteId: string) {
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

    const mapped = mapQuoteFormToProcessOrder(quote.formDataJson);
    if (!mapped.producible) return { created: false, reason: "NO_PRODUCIBLE_LINES" };

    const form = parseJson(quote.formDataJson) ?? {};
    const customerName = String(quote.customer?.name || form.customerName || "未命名客户");
    const baseCode = String(quote.orderNumber || form.orderNumber || `Q-${quoteId}`).slice(0, 120);
    const taken = await db.blindsOrder.findUnique({ where: { code: baseCode }, select: { id: true } });
    const code = taken ? `${baseCode}-Q${quoteId.slice(-6)}` : baseCode;

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
      order = await db.$transaction(async (tx) => {
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
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await findLinkedOrder(db, quoteId);
        if (again) return { created: false, reason: "ALREADY_GENERATED", id: again.id, code: again.code };
      }
      throw err;
    }

    const issues = computeIssues(mapped.blindsItems as never, spec, order.code);
    const blockingCount = blockingIssues(issues).length;
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
          sourceKey: `${NOTIFICATION_TYPE}:${quoteId}`,
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

export async function saveProcessSpec(
  db: Pick<ProcessOrderDb, "auditLog" | "blindsOrder">,
  orderId: string,
  payload: unknown,
  actor: { userId: string; orgId: string | null },
): Promise<SaveSpecResult> {
  const order = await db.blindsOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
  if (!order) return { ok: false, status: 404, error: "工艺单不存在" };
  if (order.status !== "draft") return { ok: false, status: 409, error: "只有草稿状态的工艺单可以修改工艺参数" };
  const current = await loadProcessSpec(db, orderId);
  const next = sanitizeSpec(payload, current);
  next.version = current.version + 1;
  await db.auditLog.create({
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
}

export function orderIssues(order: { code: string; items: unknown[] }, spec: ProcessSpec): ProcessIssue[] {
  return computeIssues(order.items as never, spec, order.code);
}
