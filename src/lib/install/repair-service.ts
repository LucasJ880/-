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
import type { AuthUser } from "@/lib/auth";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit/logger";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { CATEGORIES, CATEGORY_LABEL, FULFILLMENT_UMBRELLA_KEY, updateKeyFor, type FulfillmentCategory } from "@/lib/fulfillment/category";
import { listUsersWithPermission } from "@/lib/sales/approvers";
import { todayInTimeZone } from "./balance";
import {
  BALANCE_PERMISSION,
  loadBalanceRecords,
  loadClosedOutAppointmentIds,
  notifyInstallCompleted,
  notifyInstallUser,
} from "./balance-service";
import { INSTALL_TASK_COMPLETED, SECTION_LABEL, unhandledUnits } from "./closeout";
import {
  ENTITY_INSTALL_REPAIR,
  ENTITY_INSTALL_TASK,
  FACTORY_CATEGORY_LABEL,
  INSTALL_REPAIR_COMPLETED,
  INSTALL_REPAIR_FACTORY_ISSUED,
  INSTALL_REPAIR_SCHEDULED,
  INSTALL_REPAIR_SUBMITTED,
  issueDecision,
  isRepairOverdue,
  ISSUE_TYPE_LABEL,
  NOTIFY_REPAIR_FACTORY_ISSUED,
  NOTIFY_REPAIR_SCHEDULED,
  NOTIFY_REPAIR_SUBMITTED,
  parseRepairEvent,
  parseRepairRecord,
  REPAIR_EVENT_ACTIONS,
  REPAIR_OUTCOME,
  RETURN_OUTCOME,
  returnRepairFor,
  scheduleWarnings,
  validateFactoryIssue,
  validateRepairSchedule,
  REPAIR_TARGET_TYPE,
  repairActions,
  repairFactoryCategories,
  repairProgress,
  repairNumber,
  repairTargetDate,
  validateRepairHeader,
  type FactoryCategory,
  type RepairEvent,
  type RepairHolder,
  type RepairProgress,
  type RepairRecord,
  type RepairRecordData,
  type RepairRow,
} from "./repair";
import { loadCloseoutSummary, scopeCloseout, type InstallOrderRow, type InstallTaskRow, type TaskRepairSummary } from "./service";
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

/** 多张工艺单的维修单事件（出单登记 / 排期 / 关闭；按时间升序） */
export async function loadRepairEvents(orderIds: string[]): Promise<Map<string, RepairEvent[]>> {
  const out = new Map<string, RepairEvent[]>();
  if (orderIds.length === 0) return out;
  const rows = await db.auditLog.findMany({
    where: { action: { in: [...REPAIR_EVENT_ACTIONS] }, targetType: REPAIR_TARGET_TYPE, targetId: { in: orderIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, action: true, afterData: true, createdAt: true, userId: true, targetId: true },
  });
  for (const r of rows) {
    const e = parseRepairEvent(r);
    if (!e || !r.targetId) continue;
    if (!out.has(r.targetId)) out.set(r.targetId, []);
    out.get(r.targetId)!.push(e);
  }
  return out;
}

/** 任务的收口范围（design D4）：返修预约 → 该维修单与其行对应的单元；普通预约 → repair 为 null */
export async function loadTaskRepairScope(orderId: string, appointmentId: string): Promise<RepairRecord | null> {
  const [repairs, events] = await Promise.all([loadRepairsForOrders([orderId]), loadRepairEvents([orderId])]);
  return returnRepairFor(appointmentId, repairs.get(orderId) ?? [], events.get(orderId) ?? []);
}

export function repairSummaryOf(rec: RepairRecord): TaskRepairSummary {
  return { id: rec.id, repairNo: rec.repairNo, targetDate: rec.targetDate, rowCount: rec.rows.length };
}

// ─────────────────────────── 安装阶段（与 2b 会计列表同一规则，design D8） ───────────────────────────

export type OrderStageInfo = {
  stage: InstallStage;
  balanceConfirmed: boolean;
  /** 最新一张未关闭的维修单与其进度 */
  openRepair: RepairRecord | null;
  progress: RepairProgress | null;
};

/** 最新一张未关闭的维修单（INSTALL-2e：有 install.repair.completed 的视为关闭） */
export function latestOpenRepair(repairs: RepairRecord[], events: RepairEvent[]): { rec: RepairRecord; progress: RepairProgress } | null {
  for (const rec of repairs) {
    const progress = repairProgress(rec, events);
    if (!progress.closed) return { rec, progress };
  }
  return null;
}

/** 多张工艺单的安装阶段（与 2b 会计列表同一"待收尾款"规则，design D8） */
export async function loadOrderStages(
  orders: Array<{ id: string; status: string; appointmentId: string | null }>,
): Promise<Map<string, OrderStageInfo>> {
  const ids = orders.map((o) => o.id);
  const [records, closedOut, repairs, events] = await Promise.all([
    loadBalanceRecords(ids),
    loadClosedOutAppointmentIds(orders.map((o) => o.appointmentId)),
    loadRepairsForOrders(ids),
    loadRepairEvents(ids),
  ]);
  const out = new Map<string, OrderStageInfo>();
  for (const o of orders) {
    const open = latestOpenRepair(repairs.get(o.id) ?? [], events.get(o.id) ?? []);
    const balanceConfirmed = records.has(o.id);
    const stage = installStage({
      orderStatus: o.status,
      balanceConfirmed,
      closedOut: !!o.appointmentId && closedOut.has(o.appointmentId),
      openRepair: open ? { pendingFactory: open.progress.pendingCategories.length > 0, scheduled: !!open.progress.schedule } : null,
    });
    out.set(o.id, { stage, balanceConfirmed, openRepair: open?.rec ?? null, progress: open?.progress ?? null });
  }
  return out;
}

// ─────────────────────────── 序列化（不出金额；照片只给代理地址） ───────────────────────────

function factorySummary(rows: RepairRow[]): { any: boolean; unknown: boolean; categories: Array<{ key: FulfillmentCategory; label: string }> } {
  const f = repairFactoryCategories(rows);
  return { any: f.any, unknown: f.unknown, categories: f.categories.map((c) => ({ key: c, label: CATEGORY_LABEL[c] })) };
}

const factoryLabels = (cats: FactoryCategory[]) => cats.map((c) => ({ key: c, label: FACTORY_CATEGORY_LABEL[c] }));

export function serializeRepairListItem(
  rec: RepairRecord,
  ctx: { orderCode: string; stage: InstallStage; takenByName: string | null; today: string; progress: RepairProgress },
) {
  const p = ctx.progress;
  return {
    id: rec.id,
    repairNo: rec.repairNo,
    orderId: rec.orderId,
    orderCode: ctx.orderCode,
    customerName: rec.header.customerName,
    takenBy: { id: rec.header.takenById, name: ctx.takenByName },
    fillDate: rec.fillDate,
    targetDate: rec.targetDate,
    overdue: !p.closed && isRepairOverdue(rec.targetDate, ctx.today),
    rowCount: rec.rows.length,
    factory: factorySummary(rec.rows),
    customerConfirmed: rec.customerConfirmed,
    stage: ctx.stage,
    stageLabel: STAGE_LABEL[ctx.stage],
    // INSTALL-2e：进度摘要
    pendingFactory: factoryLabels(p.pendingCategories),
    scheduledAt: p.closed ? null : (p.schedule?.installAt ?? null),
    closed: p.closed ? { reason: p.closed.reason, supersededBy: p.closed.supersededBy } : null,
  };
}

export function serializeRepairDetail(
  rec: RepairRecord,
  ctx: {
    orderCode: string;
    stage: InstallStage;
    takenByName: string | null;
    today: string;
    company: { name: string; address: string };
    progress: RepairProgress;
    names: Map<string, string>;
    scheduleCompleted: boolean;
    actions: { issueCategories: FactoryCategory[]; canSchedule: boolean };
  },
) {
  const p = ctx.progress;
  const who = (id: string) => ({ id, name: ctx.names.get(id) ?? null });
  return {
    ...serializeRepairListItem(rec, ctx),
    progress: {
      factoryCategories: factoryLabels(p.factoryCategories),
      issued: p.issued.map((i) => ({ key: i.category, label: FACTORY_CATEGORY_LABEL[i.category], readyDate: i.readyDate, note: i.note, by: who(i.byUserId), at: i.at })),
      pending: factoryLabels(p.pendingCategories),
      readyDate: p.readyDate,
      schedule: p.schedule
        ? { appointmentId: p.schedule.appointmentId, installAt: p.schedule.installAt, assignedTo: who(p.schedule.assignedToId), completed: ctx.scheduleCompleted }
        : null,
      closed: p.closed ? { reason: p.closed.reason, supersededBy: p.closed.supersededBy, at: p.closed.at } : null,
    },
    actions: { issueCategories: factoryLabels(ctx.actions.issueCategories), canSchedule: ctx.actions.canSchedule },
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

  // INSTALL-2e：返修预约上提交 → 只看返修范围；原维修单在同一事务里以"转入新单"关闭（design D6）
  const [closeoutAll, ret] = await Promise.all([loadCloseoutSummary(order), loadTaskRepairScope(order.id, task.id)]);
  const { units, summary } = scopeCloseout(closeoutAll, ret);
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
    if (ret && !repairProgress(ret, await eventsInTx(tx, order.id)).closed) {
      await writeAuditLog(tx, {
        userId,
        orgId,
        action: INSTALL_REPAIR_COMPLETED,
        targetType: REPAIR_TARGET_TYPE,
        targetId: order.id,
        afterData: { repairId: ret.id, repairNo: ret.repairNo, reason: "superseded", supersededBy: data.repairNo, appointmentId: task.id },
        request: input.request,
      });
    }
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

// ─────────────────────────── INSTALL-2e：出单登记 / 安排返修（design D2 / D3 / D10） ───────────────────────────

const REPAIR_ORDER_LOCK = (orderId: string) => `install-repair-order:${orderId}`;

/** 维修单（限本企业）；不存在 / 他企业 → null */
export async function loadRepairInOrg(id: string, orgId: string): Promise<RepairRecord | null> {
  const row = await db.auditLog.findUnique({
    where: { id },
    select: { id: true, afterData: true, createdAt: true, userId: true, orgId: true, action: true, targetType: true },
  });
  if (!row || row.action !== INSTALL_REPAIR_SUBMITTED || row.targetType !== REPAIR_TARGET_TYPE || row.orgId !== orgId) return null;
  return parseRepairRecord(row);
}

/** 当前用户在本企业的出单 / 排安装键（可执行操作的输入） */
export async function loadRepairHolder(user: AuthUser, orgId: string): Promise<RepairHolder> {
  const principal = humanPrincipal(user, orgId);
  const has = async (permission: string) => {
    const d = await authorize({ principal, orgId, permission });
    return d.allowed && d.scopes.includes("ORG");
  };
  const [umbrella, canAssign, ...cats] = await Promise.all([
    has(FULFILLMENT_UMBRELLA_KEY),
    has("install.task.assign"),
    ...CATEGORIES.map((c) => has(updateKeyFor(c))),
  ]);
  return { umbrella, canAssign, categoryKeys: CATEGORIES.filter((_, i) => cats[i]) };
}

async function lockOrder(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${REPAIR_ORDER_LOCK(orderId)}))) AS l`;
}

async function eventsInTx(tx: Prisma.TransactionClient, orderId: string): Promise<RepairEvent[]> {
  const rows = await tx.auditLog.findMany({
    where: { action: { in: [...REPAIR_EVENT_ACTIONS] }, targetType: REPAIR_TARGET_TYPE, targetId: orderId },
    orderBy: { createdAt: "asc" },
    select: { id: true, action: true, afterData: true, createdAt: true, userId: true },
  });
  return rows.map(parseRepairEvent).filter((e): e is RepairEvent => !!e);
}

/** 刚写入的事件行 id（同一事务内按动作 + 维修单读回最新一条） */
async function lastEventId(tx: Prisma.TransactionClient, orderId: string, action: string, repairId: string): Promise<string> {
  const row = await tx.auditLog.findFirst({
    where: { action, targetType: REPAIR_TARGET_TYPE, targetId: orderId, afterData: { contains: `"repairId":"${repairId}"` } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!row) throw new Error("维修单事件写入后读不到");
  return row.id;
}

type ApiResult<T> = { status: 200; body: T } | { status: 400 | 403 | 404 | 409; body: { error: string; code: string } };

/** 出单确认（spec「出单确认按品类登记」） */
export async function issueFactory(input: {
  user: AuthUser;
  orgId: string;
  repairId: string;
  body: unknown;
  request?: NextRequest;
}): Promise<ApiResult<{ ok: true; categories: FactoryCategory[]; pendingCategories: FactoryCategory[]; readyDate: string | null }>> {
  const rec = await loadRepairInOrg(input.repairId, input.orgId);
  if (!rec) return { status: 404, body: { error: "维修单不存在", code: "NOT_FOUND" } };
  const holder = await loadRepairHolder(input.user, input.orgId);
  const pre = issueDecision(repairProgress(rec, (await loadRepairEvents([rec.orderId])).get(rec.orderId) ?? []), holder);
  if (!pre.ok) return { status: pre.status, body: { error: pre.error, code: pre.code } };
  const v = validateFactoryIssue(input.body, { fillDate: rec.fillDate });
  if (!v.ok) return { status: 400, body: { error: v.error, code: "INVALID" } };

  const out = await db.$transaction(async (tx) => {
    await lockOrder(tx, rec.orderId);
    const progress = repairProgress(rec, await eventsInTx(tx, rec.orderId));
    const d = issueDecision(progress, holder);
    if (!d.ok) return { kind: "denied" as const, d };
    await writeAuditLog(tx, {
      userId: input.user.id,
      orgId: input.orgId,
      action: INSTALL_REPAIR_FACTORY_ISSUED,
      targetType: REPAIR_TARGET_TYPE,
      targetId: rec.orderId,
      afterData: { repairId: rec.id, repairNo: rec.repairNo, categories: d.categories, readyDate: v.value.readyDate, note: v.value.note },
      request: input.request,
    });
    const eventId = await lastEventId(tx, rec.orderId, INSTALL_REPAIR_FACTORY_ISSUED, rec.id);
    const after = repairProgress(rec, await eventsInTx(tx, rec.orderId));
    return { kind: "ok" as const, categories: d.categories, eventId, after };
  });
  if (out.kind === "denied") return { status: out.d.status, body: { error: out.d.error, code: out.d.code } };

  await notifyFactoryIssued(input.orgId, rec, { categories: out.categories, readyDate: v.value.readyDate, eventId: out.eventId, actorId: input.user.id });
  return {
    status: 200,
    body: { ok: true, categories: out.categories, pendingCategories: out.after.pendingCategories, readyDate: out.after.readyDate },
  };
}

/** 安排返修 / 改期（spec「安排返修」） */
export async function scheduleRepair(input: {
  user: AuthUser;
  orgId: string;
  repairId: string;
  body: unknown;
  request?: NextRequest;
}): Promise<ApiResult<{ ok: true; appointmentId: string; rescheduled: boolean; warnings: string[] }>> {
  const rec = await loadRepairInOrg(input.repairId, input.orgId);
  if (!rec) return { status: 404, body: { error: "维修单不存在", code: "NOT_FOUND" } };
  const holder = await loadRepairHolder(input.user, input.orgId);
  if (!holder.canAssign) return { status: 403, body: { error: "只有运营 / 会计 / 老板岗位可以安排返修", code: "FORBIDDEN" } };
  const v = validateRepairSchedule(input.body);
  if (!v.ok) return { status: 400, body: { error: v.error, code: v.code } };
  const assigneeCanRead = await authorize({
    principal: { type: "HUMAN", id: v.value.assignedToId, orgId: input.orgId },
    orgId: input.orgId,
    permission: "install.task.read",
  });
  if (!assigneeCanRead.allowed) {
    return { status: 400, body: { error: "必须选择安装岗位的人（所选用户不持安装任务权限）", code: "NOT_INSTALLER" } };
  }
  const tz = await loadOrgTimezone(input.orgId);
  const installDate = todayInTimeZone(tz, v.value.installAt);
  const endAt = new Date(v.value.installAt.getTime() + 2 * 60 * 60 * 1000);

  const out = await db.$transaction(async (tx) => {
    await lockOrder(tx, rec.orderId);
    const progress = repairProgress(rec, await eventsInTx(tx, rec.orderId));
    if (!repairActions(progress, holder).canSchedule) {
      return { kind: "denied" as const, status: 409 as const, code: "CLOSED", error: "维修单已关闭" };
    }
    const order = await tx.blindsOrder.findUnique({
      where: { id: rec.orderId },
      select: { id: true, code: true, status: true, customerName: true, customerId: true, opportunityId: true, address: true, phone: true },
    });
    if (!order || order.status !== "scheduled" || !order.customerId) {
      return { kind: "denied" as const, status: 409 as const, code: "ORDER_STATUS", error: `工艺单状态 ${order?.status ?? "—"} 不能安排返修` };
    }
    // 已有未完成的返修预约 → 改期（同一条预约），否则新建
    const current = progress.schedule
      ? await tx.appointment.findUnique({ where: { id: progress.schedule.appointmentId }, select: { id: true, status: true } })
      : null;
    const reuse = current && current.status !== "completed" && current.status !== "cancelled" ? current : null;
    const appt = reuse
      ? await tx.appointment.update({
          where: { id: reuse.id },
          data: { startAt: v.value.installAt, endAt, assignedToId: v.value.assignedToId },
          select: { id: true },
        })
      : await tx.appointment.create({
          data: {
            customerId: order.customerId,
            opportunityId: order.opportunityId || null,
            type: "install",
            title: `返修 — ${order.customerName} (${order.code}) ${rec.repairNo}`,
            description: `维修单 ${rec.repairNo} 返修`,
            startAt: v.value.installAt,
            endAt,
            address: order.address || null,
            contactPhone: order.phone || null,
            status: "scheduled",
            assignedToId: v.value.assignedToId,
            createdById: input.user.id,
          },
          select: { id: true },
        });
    await tx.blindsOrder.update({
      where: { id: order.id },
      data: { appointmentId: appt.id, expectedInstallDate: v.value.installAt, installDate },
    });
    await writeAuditLog(tx, {
      userId: input.user.id,
      orgId: input.orgId,
      action: INSTALL_REPAIR_SCHEDULED,
      targetType: REPAIR_TARGET_TYPE,
      targetId: order.id,
      afterData: {
        repairId: rec.id,
        repairNo: rec.repairNo,
        appointmentId: appt.id,
        installAt: v.value.installAt.toISOString(),
        assignedToId: v.value.assignedToId,
        rescheduled: !!reuse,
      },
      request: input.request,
    });
    const eventId = await lastEventId(tx, order.id, INSTALL_REPAIR_SCHEDULED, rec.id);
    return { kind: "ok" as const, appointmentId: appt.id, rescheduled: !!reuse, eventId, progress, order };
  });
  if (out.kind === "denied") return { status: out.status, body: { error: out.error, code: out.code } };

  await notifyRepairScheduled(input.orgId, rec, {
    appointmentId: out.appointmentId,
    installDate,
    assignedToId: v.value.assignedToId,
    eventId: out.eventId,
    actorId: input.user.id,
    customerName: out.order.customerName,
    orderCode: out.order.code,
  });
  return { status: 200, body: { ok: true, appointmentId: out.appointmentId, rescheduled: out.rescheduled, warnings: scheduleWarnings(out.progress, installDate) } };
}

async function orderBrief(orderId: string) {
  return db.blindsOrder.findUnique({ where: { id: orderId }, select: { code: true, customerName: true, creatorId: true } });
}

/** 出单登记 → 排安装的人（维修单详情）+ 工艺单创建人（工艺单详情） */
async function notifyFactoryIssued(
  orgId: string,
  rec: RepairRecord,
  ev: { categories: FactoryCategory[]; readyDate: string; eventId: string; actorId: string },
): Promise<void> {
  try {
    const order = await orderBrief(rec.orderId);
    if (!order) return;
    const cats = ev.categories.map((c) => FACTORY_CATEGORY_LABEL[c]).join("、");
    const title = `返修件已出单：${order.customerName}（${rec.repairNo}）`;
    const summary = `${cats} 预计 ${ev.readyDate} 备好`;
    const assigners = (await listUsersWithPermission(orgId, "install.task.assign")).filter((u) => u !== ev.actorId);
    for (const uid of assigners) {
      await notifyInstallUser(uid, {
        type: NOTIFY_REPAIR_FACTORY_ISSUED, orgId, orderId: rec.orderId, entityType: ENTITY_INSTALL_REPAIR, entityId: rec.id, dedupeKey: ev.eventId, title, summary,
      });
    }
    if (!assigners.includes(order.creatorId) && order.creatorId !== ev.actorId) {
      await notifyInstallUser(order.creatorId, {
        type: NOTIFY_REPAIR_FACTORY_ISSUED, orgId, orderId: rec.orderId, entityType: "blinds_order", dedupeKey: ev.eventId, title, summary,
      });
    }
  } catch (err) {
    console.error(`[install/repair] 出单通知失败 ${rec.repairNo}`, err);
  }
}

/** 安排返修 → 安装工（任务页）+ 工艺单创建人（工艺单详情）+ 确认尾款的人（维修单详情） */
async function notifyRepairScheduled(
  orgId: string,
  rec: RepairRecord,
  ev: { appointmentId: string; installDate: string; assignedToId: string; eventId: string; actorId: string; customerName: string; orderCode: string },
): Promise<void> {
  try {
    const order = await orderBrief(rec.orderId);
    if (!order) return;
    const sent = new Set<string>([ev.actorId]);
    const base = { type: NOTIFY_REPAIR_SCHEDULED, orgId, orderId: rec.orderId, dedupeKey: ev.eventId } as const;
    if (!sent.has(ev.assignedToId)) {
      sent.add(ev.assignedToId);
      await notifyInstallUser(ev.assignedToId, {
        ...base,
        entityType: ENTITY_INSTALL_TASK,
        entityId: ev.appointmentId,
        title: `返修任务：${ev.customerName}（${ev.orderCode}）${ev.installDate}`,
        summary: `${rec.repairNo}：${rec.rows.length} 项待返修`,
      });
    }
    if (!sent.has(order.creatorId)) {
      sent.add(order.creatorId);
      await notifyInstallUser(order.creatorId, {
        ...base,
        entityType: "blinds_order",
        title: `已排返修：${ev.customerName}（${ev.orderCode}）`,
        summary: `${ev.installDate} 再去返修（${rec.repairNo}）`,
      });
    }
    for (const uid of await listUsersWithPermission(orgId, BALANCE_PERMISSION)) {
      if (sent.has(uid)) continue;
      sent.add(uid);
      await notifyInstallUser(uid, {
        ...base,
        entityType: ENTITY_INSTALL_REPAIR,
        entityId: rec.id,
        title: `已排返修：${ev.customerName}（${rec.repairNo}）`,
        summary: `${ev.installDate} 返修，完成后进入待收尾款`,
      });
    }
  } catch (err) {
    console.error(`[install/repair] 排期通知失败 ${rec.repairNo}`, err);
  }
}

// ─────────────────────────── INSTALL-2e：返修完成（design D5） ───────────────────────────

/**
 * 返修预约全部收口后：预约 completed；install.task.completed（repair_completed）+ install.repair.completed（completed）；
 * 没有其他未关闭维修单时工艺单 scheduled → installed（状态日志"返修完成"），事务后发 2b 的完工通知。
 */
export async function completeReturnVisit(input: {
  userId: string;
  orgId: string;
  task: Pick<InstallTaskRow, "id" | "status">;
  order: Pick<InstallOrderRow, "id">;
  repair: RepairRecord;
  windows: number;
  photoCount: number;
  request?: NextRequest;
}): Promise<{ status: 200 | 409; body: Record<string, unknown> }> {
  const { order, repair, task } = input;
  const others = ((await loadRepairsForOrders([order.id])).get(order.id) ?? []).filter((r) => r.id !== repair.id);
  const now = new Date();
  const out = await db.$transaction(async (tx) => {
    await lockOrder(tx, order.id);
    const appt = await tx.appointment.findUnique({ where: { id: task.id }, select: { status: true } });
    if (appt?.status === "completed") return { kind: "idempotent" as const };
    const fresh = await tx.blindsOrder.findUnique({ where: { id: order.id }, select: { status: true } });
    if (!fresh || (fresh.status !== "scheduled" && fresh.status !== "installed" && fresh.status !== "completed")) {
      return { kind: "bad_status" as const, status: fresh?.status ?? "—" };
    }
    const events = await eventsInTx(tx, order.id);
    const otherOpen = others.some((r) => !repairProgress(r, events).closed);
    const advance = !otherOpen && fresh.status === "scheduled";
    await tx.appointment.update({ where: { id: task.id }, data: { status: "completed", completedAt: now } });
    if (advance) {
      await tx.blindsOrder.update({ where: { id: order.id }, data: { status: "installed", installedAt: now } });
      await tx.orderStatusLog.create({
        data: { orderId: order.id, fromStatus: "scheduled", toStatus: "installed", note: `返修完成（${repair.repairNo}）`, operatorId: input.userId },
      });
    }
    await writeAuditLog(tx, {
      userId: input.userId,
      orgId: input.orgId,
      action: INSTALL_TASK_COMPLETED,
      targetType: "appointment",
      targetId: task.id,
      beforeData: { appointmentStatus: task.status, orderStatus: fresh.status },
      afterData: {
        appointmentStatus: "completed",
        orderId: order.id,
        orderStatus: advance ? "installed" : fresh.status,
        outcome: RETURN_OUTCOME,
        repairId: repair.id,
        repairNo: repair.repairNo,
        windows: input.windows,
        photoCount: input.photoCount,
      },
      request: input.request,
    });
    await writeAuditLog(tx, {
      userId: input.userId,
      orgId: input.orgId,
      action: INSTALL_REPAIR_COMPLETED,
      targetType: REPAIR_TARGET_TYPE,
      targetId: order.id,
      afterData: { repairId: repair.id, repairNo: repair.repairNo, reason: "completed", appointmentId: task.id },
      request: input.request,
    });
    return { kind: "done" as const, advance, orderStatus: advance ? "installed" : fresh.status };
  });
  if (out.kind === "idempotent") return { status: 200, body: { ok: true, idempotent: true, status: "completed" } };
  if (out.kind === "bad_status") return { status: 409, body: { error: `工艺单状态 ${out.status} 不允许返修收口`, code: "ORDER_STATUS" } };
  // 2b：返修完成 = 该单第一次完工 → 会计"待收尾款" + 销售"已装完"
  if (out.advance) await notifyInstallCompleted(input.orgId, order.id);
  return {
    status: 200,
    body: { ok: true, status: "completed", order: { id: order.id, status: out.orderStatus }, repair: { id: repair.id, repairNo: repair.repairNo, closed: true } },
  };
}

/** 工艺单的全部安装预约：当前预约 + 各维修单提交时的预约 + 各次返修预约（照片代理放行用，design D7） */
export async function installAppointmentIdsForOrder(orderId: string): Promise<string[]> {
  const [order, repairs, events] = await Promise.all([
    db.blindsOrder.findUnique({ where: { id: orderId }, select: { appointmentId: true } }),
    loadRepairsForOrders([orderId]),
    loadRepairEvents([orderId]),
  ]);
  const ids = new Set<string>();
  if (order?.appointmentId) ids.add(order.appointmentId);
  for (const r of repairs.get(orderId) ?? []) if (r.appointmentId) ids.add(r.appointmentId);
  for (const e of events.get(orderId) ?? []) {
    if (e.action === INSTALL_REPAIR_SCHEDULED && typeof e.data.appointmentId === "string") ids.add(e.data.appointmentId);
  }
  return [...ids];
}
