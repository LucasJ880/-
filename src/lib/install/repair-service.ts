/**
 * INSTALL-2d：维修单——数据库侧（读取 / 提交 / 通知），供 /api/install/* 与工艺单状态卡共用。
 *
 * 维修单 = AuditLog(install.repair.submitted, targetType=blinds_order, targetId=工艺单 id)，id = 审计行 id（design D3）。
 * 提交：行由服务端按"有问题"单元生成（D2）；按工艺单 + 预约加锁，同一预约只一张（D5）；
 * 本次预约 → completed、写 install.task.completed（outcome needs_repair），工艺单不动（D4）。
 * 不发任何对外消息；通知只发站内（D7）。
 */

import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { CATEGORIES, CATEGORY_LABEL, updateKeyFor, type FulfillmentCategory } from "@/lib/fulfillment/category";
import { listUsersWithPermission } from "@/lib/sales/approvers";
import { todayInTimeZone } from "./balance";
import { BALANCE_PERMISSION, loadBalanceRecords, loadClosedOutAppointmentIds, notifyInstallUser } from "./balance-service";
import { INSTALL_TASK_COMPLETED, SECTION_LABEL, unhandledUnits } from "./closeout";
import {
  ENTITY_INSTALL_REPAIR,
  INSTALL_REPAIR_SUBMITTED,
  isRepairOverdue,
  ISSUE_TYPE_LABEL,
  NOTIFY_REPAIR_SUBMITTED,
  parseRepairRecord,
  REPAIR_OUTCOME,
  REPAIR_TARGET_TYPE,
  repairFactoryCategories,
  repairNumber,
  repairTargetDate,
  validateRepairHeader,
  type RepairRecord,
  type RepairRecordData,
  type RepairRow,
} from "./repair";
import { loadCloseoutSummary, type InstallOrderRow, type InstallTaskRow, type TaskRepairSummary } from "./service";
import { installStage, STAGE_LABEL, type InstallStage } from "./stage";

const REPAIR_SELECT = { id: true, afterData: true, createdAt: true, userId: true, targetId: true } as const;

/** 多张工艺单的维修单（新 → 旧） */
export async function loadRepairsForOrders(orderIds: string[]): Promise<Map<string, RepairRecord[]>> {
  const out = new Map<string, RepairRecord[]>();
  if (orderIds.length === 0) return out;
  const rows = await db.auditLog.findMany({
    where: { action: INSTALL_REPAIR_SUBMITTED, targetType: REPAIR_TARGET_TYPE, targetId: { in: orderIds } },
    orderBy: { createdAt: "desc" },
    select: REPAIR_SELECT,
  });
  for (const r of rows) {
    const rec = parseRepairRecord(r);
    if (!rec || !r.targetId) continue;
    if (!out.has(r.targetId)) out.set(r.targetId, []);
    out.get(r.targetId)!.push(rec);
  }
  return out;
}

/** 某次安装预约提交的维修单（一个预约至多一张） */
export async function loadRepairForAppointment(orderId: string, appointmentId: string): Promise<RepairRecord | null> {
  const list = (await loadRepairsForOrders([orderId])).get(orderId) ?? [];
  return list.find((r) => r.appointmentId === appointmentId) ?? null;
}

export function repairSummaryOf(rec: RepairRecord): TaskRepairSummary {
  return { id: rec.id, repairNo: rec.repairNo, targetDate: rec.targetDate, rowCount: rec.rows.length };
}

// ─────────────────────────── 安装阶段（与 2b 会计列表同一规则，design D8） ───────────────────────────

export type OrderStageInfo = { stage: InstallStage; balanceConfirmed: boolean; openRepair: RepairRecord | null };

/** 多张工艺单的安装阶段；2d 内最新一张维修单视为未关闭（2e 补出单 / 排返修 / 关闭） */
export async function loadOrderStages(
  orders: Array<{ id: string; status: string; appointmentId: string | null }>,
): Promise<Map<string, OrderStageInfo>> {
  const ids = orders.map((o) => o.id);
  const [records, closedOut, repairs] = await Promise.all([
    loadBalanceRecords(ids),
    loadClosedOutAppointmentIds(orders.map((o) => o.appointmentId)),
    loadRepairsForOrders(ids),
  ]);
  const out = new Map<string, OrderStageInfo>();
  for (const o of orders) {
    const openRepair = repairs.get(o.id)?.[0] ?? null;
    const balanceConfirmed = records.has(o.id);
    const stage = installStage({
      orderStatus: o.status,
      balanceConfirmed,
      closedOut: !!o.appointmentId && closedOut.has(o.appointmentId),
      openRepair: openRepair ? { needsFactory: openRepair.rows.some((r) => r.needsFactory) } : null,
    });
    out.set(o.id, { stage, balanceConfirmed, openRepair });
  }
  return out;
}

// ─────────────────────────── 序列化（不出金额；照片只给代理地址） ───────────────────────────

function factorySummary(rows: RepairRow[]): { any: boolean; unknown: boolean; categories: Array<{ key: FulfillmentCategory; label: string }> } {
  const f = repairFactoryCategories(rows);
  return { any: f.any, unknown: f.unknown, categories: f.categories.map((c) => ({ key: c, label: CATEGORY_LABEL[c] })) };
}

export function serializeRepairListItem(
  rec: RepairRecord,
  ctx: { orderCode: string; stage: InstallStage; takenByName: string | null; today: string },
) {
  return {
    id: rec.id,
    repairNo: rec.repairNo,
    orderId: rec.orderId,
    orderCode: ctx.orderCode,
    customerName: rec.header.customerName,
    takenBy: { id: rec.header.takenById, name: ctx.takenByName },
    fillDate: rec.fillDate,
    targetDate: rec.targetDate,
    overdue: isRepairOverdue(rec.targetDate, ctx.today),
    rowCount: rec.rows.length,
    factory: factorySummary(rec.rows),
    customerConfirmed: rec.customerConfirmed,
    stage: ctx.stage,
    stageLabel: STAGE_LABEL[ctx.stage],
  };
}

export function serializeRepairDetail(
  rec: RepairRecord,
  ctx: { orderCode: string; stage: InstallStage; takenByName: string | null; today: string; company: { name: string; address: string } },
) {
  return {
    ...serializeRepairListItem(rec, ctx),
    phone: rec.header.phone,
    notes: rec.header.notes,
    customerPreferredDate: rec.customerPreferredDate,
    submittedAt: rec.submittedAt,
    appointmentId: rec.appointmentId,
    company: ctx.company,
    rows: rec.rows.map((r) => ({
      n: r.n,
      unitId: r.unitId,
      itemNumber: r.itemNumber,
      section: r.section,
      sectionLabel: SECTION_LABEL[r.section] ?? r.section,
      location: r.location,
      description: r.description,
      issueType: r.issueType,
      issueTypeLabel: ISSUE_TYPE_LABEL[r.issueType],
      needsFactory: r.needsFactory,
      category: r.category,
      categoryLabel: r.category ? CATEGORY_LABEL[r.category] : null,
      photos: r.photos.map((p) => ({ proxyUrl: p.proxyUrl, at: p.at })),
    })),
  };
}

/** 用户 id → 姓名 */
export async function userNameMap(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(rows.map((u) => [u.id, u.name]));
}

// ─────────────────────────── 提交 ───────────────────────────

export type SubmitRepairResult =
  | { status: 200; body: { ok: true; idempotent: boolean; repair: TaskRepairSummary } }
  | { status: 400 | 409; body: { error: string; code: string; missing?: Array<{ itemNumber: number; location: string }> } };

/** 同一预约的维修单在事务里按 afterData 里的预约 id 找（与写入同一事务，读得到刚写的行） */
async function findRepairRow(tx: Prisma.TransactionClient, orderId: string, appointmentId: string) {
  return tx.auditLog.findFirst({
    where: {
      action: INSTALL_REPAIR_SUBMITTED,
      targetType: REPAIR_TARGET_TYPE,
      targetId: orderId,
      afterData: { contains: `"appointmentId":"${appointmentId}"` },
    },
    orderBy: { createdAt: "desc" },
    select: REPAIR_SELECT,
  });
}

/** spec「提交维修单的条件」「维修单内容」「提交维修单的效果」 */
export async function submitRepair(input: {
  userId: string;
  task: InstallTaskRow;
  order: InstallOrderRow;
  body: unknown;
  request?: NextRequest;
}): Promise<SubmitRepairResult> {
  const { task, order, userId } = input;
  const orgId = task.customer.orgId;

  if (task.status === "cancelled") {
    return { status: 409, body: { error: "任务已取消", code: "BAD_STATUS" } };
  }
  if (task.status === "completed") {
    const existing = await loadRepairForAppointment(order.id, task.id);
    if (existing) return { status: 200, body: { ok: true, idempotent: true, repair: repairSummaryOf(existing) } };
    return { status: 409, body: { error: "任务已完成收口，不能再提交维修单", code: "ALREADY_CLOSED" } };
  }

  const { units, summary } = await loadCloseoutSummary(order);
  const unhandled = unhandledUnits(summary);
  if (unhandled.length > 0) {
    return { status: 409, body: { error: `还有 ${unhandled.length} 项没有处理（拍完工照或标记问题）`, code: "UNITS_UNHANDLED", missing: unhandled } };
  }
  if (summary.issueCount === 0) {
    return { status: 409, body: { error: "没有有问题的项，请直接完成收口", code: "NO_ISSUES" } };
  }

  const today = todayInTimeZone(await loadOrgTimezone(orgId));
  const header = validateRepairHeader(input.body, { today });
  if (!header.ok) return { status: 400, body: { error: header.error, code: "INVALID" } };

  // 行：服务端按"有问题"单元生成（design D2）
  const unitById = new Map(units.map((u) => [u.id, u]));
  const rows: RepairRow[] = summary.windows
    .filter((w) => w.state === "issue" && w.issue)
    .map((w, i) => {
      const u = unitById.get(w.itemId);
      return {
        n: i + 1,
        unitId: w.itemId,
        itemNumber: w.itemNumber,
        section: u?.section ?? "blinds",
        location: w.location,
        description: w.issue!.description,
        issueType: w.issue!.issueType,
        needsFactory: w.issue!.needsFactory,
        category: u?.category ?? null,
        photos: w.issue!.photos.map((p) => ({ proxyUrl: p.proxyUrl, at: p.at })),
      };
    });

  const now = new Date();
  const outcome = await db.$transaction(async (tx) => {
    // 先按工艺单（单号序号）再按预约（同一预约只一张）加锁（design D5）
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`install-repair-order:${order.id}`}))) AS l`;
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`install-repair:${task.id}`}))) AS l`;
    const fresh = await tx.appointment.findUnique({ where: { id: task.id }, select: { status: true } });
    if (fresh?.status === "completed" || fresh?.status === "cancelled") {
      const existing = await findRepairRow(tx, order.id, task.id);
      return existing ? { kind: "existing" as const, row: existing } : { kind: "closed" as const };
    }
    const count = await tx.auditLog.count({
      where: { action: INSTALL_REPAIR_SUBMITTED, targetType: REPAIR_TARGET_TYPE, targetId: order.id },
    });
    const seq = count + 1;
    const data: RepairRecordData = {
      repairNo: repairNumber(order.code, seq),
      seq,
      orderId: order.id,
      orderCode: order.code,
      appointmentId: task.id,
      header: { customerName: header.value.customerName, phone: header.value.phone, notes: header.value.notes, takenById: userId },
      rows,
      fillDate: today,
      customerPreferredDate: header.value.customerPreferredDate,
      targetDate: repairTargetDate(today, header.value.customerPreferredDate),
      customerConfirmed: header.value.customerConfirmed,
    };
    await writeAuditLog(tx, {
      userId,
      orgId,
      action: INSTALL_REPAIR_SUBMITTED,
      targetType: REPAIR_TARGET_TYPE,
      targetId: order.id,
      afterData: data,
      request: input.request,
    });
    const row = await findRepairRow(tx, order.id, task.id);
    if (!row) throw new Error("维修单写入后读不到");
    await tx.appointment.update({ where: { id: task.id }, data: { status: "completed", completedAt: now } });
    await writeAuditLog(tx, {
      userId,
      orgId,
      action: INSTALL_TASK_COMPLETED,
      targetType: "appointment",
      targetId: task.id,
      beforeData: { appointmentStatus: task.status, orderStatus: order.status },
      afterData: {
        appointmentStatus: "completed",
        orderId: order.id,
        orderStatus: order.status,
        outcome: REPAIR_OUTCOME,
        repairId: row.id,
        repairNo: data.repairNo,
        windows: summary.total,
        issueCount: rows.length,
      },
      request: input.request,
    });
    return { kind: "created" as const, row };
  });

  if (outcome.kind === "closed") {
    return { status: 409, body: { error: "任务已完成收口，不能再提交维修单", code: "ALREADY_CLOSED" } };
  }
  const rec = parseRepairRecord(outcome.row);
  if (!rec) throw new Error("维修单记录解析失败");
  if (outcome.kind === "created") {
    await notifyRepairSubmitted(orgId, order.id, rec, userId);
  }
  return { status: 200, body: { ok: true, idempotent: outcome.kind === "existing", repair: repairSummaryOf(rec) } };
}

// ─────────────────────────── 通知（design D7；失败不影响提交） ───────────────────────────

/** 收件人：需工厂行品类的出单岗（品类推不出 → 三个品类岗）∪ 排安装 ∪ 确认尾款，去掉提交人；销售另发 */
export async function repairRecipients(orgId: string, rec: Pick<RepairRecord, "rows">, actorId: string): Promise<string[]> {
  const factory = repairFactoryCategories(rec.rows);
  const keys = ["install.task.assign", BALANCE_PERMISSION];
  if (factory.any) {
    const cats = factory.unknown ? [...CATEGORIES] : factory.categories;
    keys.push(...cats.map(updateKeyFor));
  }
  const holders = await Promise.all(keys.map((k) => listUsersWithPermission(orgId, k)));
  return [...new Set(holders.flat())].filter((uid) => uid !== actorId);
}

export async function notifyRepairSubmitted(orgId: string, orderId: string, rec: RepairRecord, actorId: string): Promise<void> {
  try {
    const order = await db.blindsOrder.findUnique({ where: { id: orderId }, select: { code: true, customerName: true, creatorId: true } });
    if (!order) return;
    const factory = repairFactoryCategories(rec.rows);
    const factoryText = !factory.any
      ? "无需工厂，直接排返修"
      : `需工厂出单：${factory.unknown ? "品类待确认" : factory.categories.map((c) => CATEGORY_LABEL[c]).join("、")}`;
    const title = `返修单 ${rec.repairNo}：${order.customerName}（${order.code}）`;
    const recipients = await repairRecipients(orgId, rec, actorId);
    for (const uid of recipients) {
      await notifyInstallUser(uid, {
        type: NOTIFY_REPAIR_SUBMITTED,
        orgId,
        orderId,
        entityType: ENTITY_INSTALL_REPAIR,
        entityId: rec.id,
        title,
        summary: `${rec.rows.length} 项有问题；目标 ${rec.targetDate}；${factoryText}`,
      });
    }
    if (!recipients.includes(order.creatorId) && order.creatorId !== actorId) {
      await notifyInstallUser(order.creatorId, {
        type: NOTIFY_REPAIR_SUBMITTED,
        orgId,
        orderId,
        entityType: "blinds_order",
        dedupeKey: rec.id,
        title: `返修中：${order.customerName}（${order.code}）`,
        summary: `${rec.rows.length} 项待返修，目标 ${rec.targetDate}`,
      });
    }
  } catch (err) {
    console.error(`[install/repair] 通知失败 ${rec.repairNo}`, err);
  }
}
