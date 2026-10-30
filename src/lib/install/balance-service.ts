/**
 * INSTALL-2b：装完待收尾款——数据库侧（列表 / 确认 / 通知），供 /api/accounting/balance* 与 /complete 共用。
 *
 * - 报价 ↔ 工艺单：AuditLog(process_order.generated, targetType=sales_quote, afterData={orderId}) 反查（design D4）
 * - 尾款确认：AuditLog(install.balance.confirmed, targetType=blinds_order)；"已确认"只看记录（design D1 / D2）
 * - 确认：pg_advisory_xact_lock + 事务内写审计 + 仅 installed 时推进 completed（design D7）；通知在事务后（design D8）
 * 不返回成本 / 毛利 / 提成 / 客户联系方式 / 报价备注与表单原文。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { applyOrderTransition } from "@/lib/fulfillment/order-access";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { createNotification } from "@/lib/notifications/create";
import { shouldDeliverInApp } from "@/lib/notifications/delivery-gate";
import { listUsersWithPermission } from "@/lib/sales/approvers";
import { AUDIT_ACTION_GENERATED, AUDIT_TARGET_QUOTE } from "@/lib/sunny-process/process-spec";
import {
  BALANCE_TARGET_TYPE,
  ENTITY_INSTALL_BALANCE,
  INSTALL_BALANCE_CONFIRMED,
  isAwaitingBalance,
  NOTIFY_BALANCE_CONFIRMED,
  NOTIFY_INSTALL_COMPLETED,
  parseBalanceRecord,
  quoteBalanceDue,
  todayInTimeZone,
  validateBalanceConfirm,
  type BalanceRecord,
  type QuoteMoney,
} from "./balance";
import { INSTALL_TASK_COMPLETED } from "./closeout";
import { ENTITY_INSTALL_REPAIR, ENTITY_INSTALL_TASK, REPAIR_OUTCOME } from "./repair";
import { INSTALL_ORDER_SELECT, loadOrdersCloseout, type InstallOrderRow } from "./service";

export const BALANCE_PERMISSION = "install.balance.confirm";
const INSTALLED_STATUSES = ["installed", "completed"];
const PENDING_LIMIT = 200;
const RECENT_LIMIT = 30;

const BALANCE_ORDER_SELECT = {
  ...INSTALL_ORDER_SELECT,
  installedAt: true,
  creatorId: true,
  creator: { select: { name: true } },
  customer: { select: { orgId: true } },
} as const;

type BalanceOrderRow = InstallOrderRow & {
  installedAt: Date | null;
  creatorId: string;
  creator: { name: string } | null;
  customer: { orgId: string } | null;
};

// ─────────────────────────── 读取 ───────────────────────────

/** 工艺单 → 签字自动生成它的报价（取最新一条生成审计） */
export async function loadLinkedQuotes(orderIds: string[]): Promise<Map<string, QuoteMoney & { id: string }>> {
  const out = new Map<string, QuoteMoney & { id: string }>();
  if (orderIds.length === 0) return out;
  const links = await db.auditLog.findMany({
    where: {
      action: AUDIT_ACTION_GENERATED,
      targetType: AUDIT_TARGET_QUOTE,
      OR: orderIds.map((id) => ({ afterData: { contains: `"orderId":"${id}"` } })),
    },
    orderBy: { createdAt: "desc" },
    select: { targetId: true, afterData: true },
  });
  const quoteByOrder = new Map<string, string>();
  for (const l of links) {
    if (!l.targetId || !l.afterData) continue;
    try {
      const orderId = (JSON.parse(l.afterData) as { orderId?: unknown }).orderId;
      if (typeof orderId === "string" && orderIds.includes(orderId) && !quoteByOrder.has(orderId)) {
        quoteByOrder.set(orderId, l.targetId);
      }
    } catch {
      // 坏 JSON：视为无关联
    }
  }
  const quotes = await db.salesQuote.findMany({
    where: { id: { in: [...new Set(quoteByOrder.values())] } },
    select: { id: true, grandTotal: true, agreedBalanceAmount: true, depositAmount: true },
  });
  const byId = new Map(quotes.map((q) => [q.id, q]));
  for (const [orderId, quoteId] of quoteByOrder) {
    const q = byId.get(quoteId);
    if (q) out.set(orderId, q);
  }
  return out;
}

/** 尾款确认记录（每单最早一条为准；正常情况下只有一条） */
export async function loadBalanceRecords(orderIds: string[]): Promise<Map<string, BalanceRecord>> {
  const out = new Map<string, BalanceRecord>();
  if (orderIds.length === 0) return out;
  const rows = await db.auditLog.findMany({
    where: { action: INSTALL_BALANCE_CONFIRMED, targetType: BALANCE_TARGET_TYPE, targetId: { in: orderIds } },
    orderBy: { createdAt: "asc" },
    select: { targetId: true, afterData: true, createdAt: true, userId: true },
  });
  for (const r of rows) {
    if (!r.targetId || out.has(r.targetId)) continue;
    const rec = parseBalanceRecord(r);
    if (rec) out.set(r.targetId, rec);
  }
  return out;
}

/** 报价 → 其生成的工艺单已有尾款确认记录（销售首页"待收尾款"剔除用，spec「销售首页待收尾款」） */
export async function loadConfirmedQuoteIds(quoteIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (quoteIds.length === 0) return out;
  const links = await db.auditLog.findMany({
    where: { action: AUDIT_ACTION_GENERATED, targetType: AUDIT_TARGET_QUOTE, targetId: { in: quoteIds } },
    select: { targetId: true, afterData: true },
  });
  const quoteByOrder = new Map<string, string>();
  for (const l of links) {
    try {
      const orderId = (JSON.parse(l.afterData ?? "{}") as { orderId?: unknown }).orderId;
      if (typeof orderId === "string" && l.targetId) quoteByOrder.set(orderId, l.targetId);
    } catch {
      // 坏 JSON：视为无关联
    }
  }
  const records = await loadBalanceRecords([...quoteByOrder.keys()]);
  for (const orderId of records.keys()) {
    const q = quoteByOrder.get(orderId);
    if (q) out.add(q);
  }
  return out;
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export type BalancePendingRow = {
  orderId: string;
  code: string;
  status: string;
  customerName: string;
  salesName: string | null;
  installedAt: string | null;
  appointmentId: string | null;
  closeout: { total: number; completed: number };
  quoteId: string | null;
  expectedBalance: number | null;
};

export type BalanceConfirmedRow = {
  orderId: string;
  code: string;
  customerName: string;
  received: number;
  expected: number | null;
  method: string;
  receivedAt: string;
  note: string;
  confirmedByName: string | null;
  confirmedAt: string;
};

/** 有完成收口记录（install.task.completed，结果不是 INSTALL-2d 的 needs_repair）的安装预约 id */
export async function loadClosedOutAppointmentIds(appointmentIds: Array<string | null>): Promise<Set<string>> {
  const ids = [...new Set(appointmentIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return new Set();
  const rows = await db.auditLog.findMany({
    where: {
      action: INSTALL_TASK_COMPLETED,
      targetType: "appointment",
      targetId: { in: ids },
      NOT: { afterData: { contains: `"outcome":"${REPAIR_OUTCOME}"` } },
    },
    select: { targetId: true },
  });
  return new Set(rows.map((r) => r.targetId).filter((x): x is string => !!x));
}

/** 待收尾款列表（spec「待收尾款列表」） */
export async function listBalance(orgId: string): Promise<{ pending: BalancePendingRow[]; recentConfirmed: BalanceConfirmedRow[] }> {
  // 先只取 id 剔除已确认，再取明细：已完成的单会越积越多，不能先截断再剔除（否则老的未确认单会掉出列表）
  const candidates = await db.blindsOrder.findMany({
    where: { status: { in: INSTALLED_STATUSES }, customer: { orgId } },
    select: { id: true, status: true, appointmentId: true },
  });
  const [records, closedOut] = await Promise.all([
    loadBalanceRecords(candidates.map((o) => o.id)),
    loadClosedOutAppointmentIds(candidates.filter((o) => o.status === "completed").map((o) => o.appointmentId)),
  ]);
  const pendingIds = candidates
    .filter((o) => isAwaitingBalance(o, { confirmed: records.has(o.id), closedOutAppointmentIds: closedOut }))
    .map((o) => o.id);
  const pendingOrders = (await db.blindsOrder.findMany({
    where: { id: { in: pendingIds } },
    orderBy: [{ installedAt: "desc" }, { updatedAt: "desc" }],
    take: PENDING_LIMIT,
    select: BALANCE_ORDER_SELECT,
  })) as unknown as BalanceOrderRow[];
  const [quotes, closeouts] = await Promise.all([
    loadLinkedQuotes(pendingOrders.map((o) => o.id)),
    loadOrdersCloseout(pendingOrders),
  ]);
  const pending: BalancePendingRow[] = pendingOrders.map((o) => {
    const q = quotes.get(o.id) ?? null;
    const c = closeouts.get(o.id)?.summary;
    return {
      orderId: o.id,
      code: o.code,
      status: o.status,
      customerName: o.customerName,
      salesName: o.creator?.name ?? null,
      installedAt: o.installedAt?.toISOString() ?? null,
      appointmentId: o.appointmentId,
      closeout: { total: c?.total ?? 0, completed: c?.completed ?? 0 },
      quoteId: q?.id ?? null,
      expectedBalance: quoteBalanceDue(q),
    };
  });

  const recentRows = await db.auditLog.findMany({
    where: { action: INSTALL_BALANCE_CONFIRMED, targetType: BALANCE_TARGET_TYPE, orgId },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: { targetId: true, afterData: true, createdAt: true, userId: true },
  });
  const recentOrderIds = recentRows.map((r) => r.targetId).filter((x): x is string => !!x);
  const recentOrders = await db.blindsOrder.findMany({
    where: { id: { in: recentOrderIds } },
    select: { id: true, code: true, customerName: true },
  });
  const orderById = new Map(recentOrders.map((o) => [o.id, o]));
  const parsed = recentRows.map((r) => ({ orderId: r.targetId ?? "", rec: parseBalanceRecord(r) }));
  const names = await userNames(parsed.map((p) => p.rec?.byUserId ?? "").filter(Boolean));
  const recentConfirmed: BalanceConfirmedRow[] = parsed
    .filter((p) => p.rec && orderById.has(p.orderId))
    .map(({ orderId, rec }) => {
      const o = orderById.get(orderId)!;
      const r = rec!;
      return {
        orderId,
        code: o.code,
        customerName: o.customerName,
        received: r.received,
        expected: r.expected,
        method: r.method,
        receivedAt: r.receivedAt,
        note: r.note,
        confirmedByName: names.get(r.byUserId) ?? null,
        confirmedAt: r.confirmedAt,
      };
    });
  return { pending, recentConfirmed };
}

// ─────────────────────────── 通知（design D8：失败不影响主动作） ───────────────────────────

export type InstallNotice = {
  type: string;
  title: string;
  summary: string;
  orgId: string;
  orderId: string;
  entityType: typeof ENTITY_INSTALL_BALANCE | typeof ENTITY_INSTALL_REPAIR | typeof ENTITY_INSTALL_TASK | "blinds_order";
  /** 通知实体 id；缺省 = orderId（INSTALL-2d 维修单通知传维修单 id） */
  entityId?: string;
  /** 去重粒度细到"每次尝试"时传（如审批 id）；不传 = 同一单同一人同一类型只发一次 */
  dedupeKey?: string;
};

/** 单人站内通知：尊重通知偏好；同一单同一人同一类型只发一次（除非带 dedupeKey）；失败只记日志（INSTALL-2c 执行器也用） */
export async function notifyInstallUser(userId: string, n: InstallNotice): Promise<void> {
  try {
    if (!(await shouldDeliverInApp(userId, { type: n.type, priority: "medium" }))) return;
    await createNotification({
      userId,
      type: n.type,
      category: "update",
      title: n.title,
      summary: n.summary,
      orgId: n.orgId,
      entityType: n.entityType,
      entityId: n.entityId ?? n.orderId,
      priority: "medium",
      // 同一单同一人只发一次（spec「完工通知」「尾款确认通知」）；带 dedupeKey 时每次尝试一条
      sourceKey: `${n.type}:${n.entityId ?? n.orderId}:${userId}${n.dedupeKey ? `:${n.dedupeKey}` : ""}`,
    });
  } catch (err) {
    console.error(`[install/balance] 通知失败 ${n.type} ${n.orderId} → ${userId}`, err);
  }
}

/** 完成收口首次成功后：持 install.balance.confirm 者 → 会计页签；工艺单创建人（销售）→ 工艺单详情。不含金额。 */
export async function notifyInstallCompleted(orgId: string, orderId: string): Promise<void> {
  try {
    const order = await db.blindsOrder.findUnique({ where: { id: orderId }, select: { code: true, customerName: true, creatorId: true } });
    if (!order) return;
    const holders = await listUsersWithPermission(orgId, BALANCE_PERMISSION);
    const base = { type: NOTIFY_INSTALL_COMPLETED, orgId, orderId } as const;
    for (const uid of holders) {
      await notifyInstallUser(uid, {
        ...base,
        entityType: ENTITY_INSTALL_BALANCE,
        title: `待收尾款：${order.customerName}（${order.code}）`,
        summary: "已完成安装收口，核对收口照片后确认尾款",
      });
    }
    if (!holders.includes(order.creatorId)) {
      await notifyInstallUser(order.creatorId, {
        ...base,
        entityType: "blinds_order",
        title: `已装完：${order.customerName}（${order.code}）`,
        summary: "安装已完成收口，可以跟进客户收尾款",
      });
    }
  } catch (err) {
    console.error(`[install/balance] 完工通知失败 ${orderId}`, err);
  }
}

async function notifyBalanceConfirmed(orgId: string, order: { id: string; code: string; customerName: string; creatorId: string }) {
  await notifyInstallUser(order.creatorId, {
    type: NOTIFY_BALANCE_CONFIRMED,
    orgId,
    orderId: order.id,
    entityType: "blinds_order",
    title: `尾款已确认：${order.customerName}（${order.code}）`,
    summary: "会计已确认收到尾款，订单已完成",
  });
}

// ─────────────────────────── 确认 ───────────────────────────

export type ConfirmResult =
  | { status: 200; body: { ok: true; idempotent: boolean; record: BalanceRecord; orderStatus: string } }
  | { status: 400 | 404 | 409; body: { error: string; code: string } };

/** 确认收到尾款（spec「确认收到尾款」「差额必须说明」「尾款只确认一次」）；调用方已判定 ORG 范围的 install.balance.confirm */
export async function confirmBalance(input: { orgId: string; userId: string; orderId: string; body: unknown }): Promise<ConfirmResult> {
  const order = (await db.blindsOrder.findUnique({
    where: { id: input.orderId },
    select: { id: true, code: true, status: true, customerName: true, creatorId: true, customer: { select: { orgId: true } } },
  })) as { id: string; code: string; status: string; customerName: string; creatorId: string; customer: { orgId: string } | null } | null;
  if (!order || order.customer?.orgId !== input.orgId) {
    return { status: 404, body: { error: "工艺单不存在", code: "NOT_FOUND" } };
  }
  const existing = (await loadBalanceRecords([order.id])).get(order.id);
  if (existing) {
    return { status: 200, body: { ok: true, idempotent: true, record: existing, orderStatus: order.status } };
  }
  if (!INSTALLED_STATUSES.includes(order.status)) {
    return { status: 409, body: { error: "工艺单还没有完成安装，不能确认尾款", code: "NOT_INSTALLED" } };
  }
  const quote = (await loadLinkedQuotes([order.id])).get(order.id) ?? null;
  const expected = quoteBalanceDue(quote);
  const today = todayInTimeZone(await loadOrgTimezone(input.orgId));
  const check = validateBalanceConfirm(input.body, { expected, today });
  if (!check.ok) return { status: 400, body: { error: check.error, code: check.code } };

  const afterData = {
    quoteId: quote?.id ?? null,
    expected,
    received: check.value.amount,
    method: check.value.method,
    receivedAt: check.value.receivedAt,
    note: check.value.note,
    byUserId: input.userId,
  };
  const outcome = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`install-balance:${order.id}`}))) AS l`;
    const again = await tx.auditLog.findFirst({
      where: { action: INSTALL_BALANCE_CONFIRMED, targetType: BALANCE_TARGET_TYPE, targetId: order.id },
      orderBy: { createdAt: "asc" },
      select: { afterData: true, createdAt: true, userId: true },
    });
    if (again) return { idempotent: true as const, row: again, status: order.status };
    const fresh = await tx.blindsOrder.findUnique({ where: { id: order.id }, select: { id: true, status: true } });
    if (!fresh || !INSTALLED_STATUSES.includes(fresh.status)) return { notInstalled: true as const };
    await writeAuditLog(tx as Prisma.TransactionClient, {
      userId: input.userId,
      orgId: input.orgId,
      action: INSTALL_BALANCE_CONFIRMED,
      targetType: BALANCE_TARGET_TYPE,
      targetId: order.id,
      beforeData: { orderStatus: fresh.status },
      afterData,
    });
    let status = fresh.status;
    if (fresh.status === "installed") {
      await applyOrderTransition(tx, fresh, "completed", input.userId, "尾款确认");
      status = "completed";
    }
    const row = await tx.auditLog.findFirst({
      where: { action: INSTALL_BALANCE_CONFIRMED, targetType: BALANCE_TARGET_TYPE, targetId: order.id },
      orderBy: { createdAt: "asc" },
      select: { afterData: true, createdAt: true, userId: true },
    });
    return { idempotent: false as const, row, status };
  });

  if ("notInstalled" in outcome) {
    return { status: 409, body: { error: "工艺单还没有完成安装，不能确认尾款", code: "NOT_INSTALLED" } };
  }
  const record = outcome.row ? parseBalanceRecord(outcome.row) : null;
  const finalRecord: BalanceRecord = record ?? { ...afterData, confirmedAt: new Date().toISOString() };
  if (!outcome.idempotent) await notifyBalanceConfirmed(input.orgId, order);
  return { status: 200, body: { ok: true, idempotent: outcome.idempotent, record: finalRecord, orderStatus: outcome.status } };
}
