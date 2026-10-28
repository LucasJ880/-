/**
 * INSTALL-1：安装任务服务端读取（数据库侧，供 /api/install/* 共用）
 *
 * 任务 = Appointment(type=install)；工艺单 = BlindsOrder(appointmentId)；收口记录 = AuditLog。
 * INSTALL-2a：收口单元 = Blinds 行 + 最新工艺参数四段（buildCloseoutUnits），列表 / 详情 / 上传 / 完成共用。
 * INSTALL-2d：收口日志同时读问题记录（install.window.issue）；列表 / 详情带有问题数与单元问题；
 * 因维修单完成的任务详情带维修单摘要。
 * 这里只做读取与序列化，不返回金额 / 成本 / 原始存储 URL。
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { authorize, humanPrincipal } from "@/lib/authorization";
import type { AuthorizeResult } from "@/lib/authorization/types";
import {
  AUDIT_ACTION_SPEC,
  AUDIT_TARGET_ORDER,
  sanitizeSpec,
  type ProcessSpec,
} from "@/lib/sunny-process/process-spec";
import {
  aggregateCloseout,
  buildCloseoutUnits,
  INSTALL_TARGET_ITEM,
  INSTALL_TARGET_UNIT,
  INSTALL_WINDOW_COMPLETED,
  type CloseoutLog,
  type CloseoutSummary,
  type CloseoutUnit,
  type WindowItem,
} from "./closeout";
import { INSTALL_WINDOW_ISSUE } from "./repair";
import { installScopeFromDecision, type InstallScope } from "./scope";

export const INSTALL_TASK_SELECT = {
  id: true,
  type: true,
  title: true,
  startAt: true,
  endAt: true,
  allDay: true,
  address: true,
  contactPhone: true,
  status: true,
  notes: true,
  completedAt: true,
  assignedToId: true,
  createdById: true,
  customer: { select: { id: true, orgId: true, name: true, address: true } },
  assignedTo: { select: { id: true, name: true } },
} as const;

export type InstallTaskRow = {
  id: string;
  type: string;
  title: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  address: string | null;
  contactPhone: string | null;
  status: string;
  notes: string | null;
  completedAt: Date | null;
  assignedToId: string;
  createdById: string;
  customer: { id: string; orgId: string; name: string; address: string | null };
  assignedTo: { id: string; name: string };
};

export const INSTALL_ORDER_SELECT = {
  id: true,
  code: true,
  status: true,
  customerName: true,
  address: true,
  remarks: true,
  appointmentId: true,
  items: {
    orderBy: { itemNumber: "asc" as const },
    select: {
      id: true,
      itemNumber: true,
      location: true,
      width: true,
      height: true,
      productType: true,
      fabricSku: true,
      controlType: true,
      controlSide: true,
      mountType: true,
      itemRemark: true,
    },
  },
} as const;

export type InstallOrderRow = {
  id: string;
  code: string;
  status: string;
  customerName: string;
  address: string | null;
  remarks: string | null;
  appointmentId: string | null;
  items: Array<
    WindowItem & {
      controlType: string;
      controlSide: string;
      mountType: string;
      itemRemark: string | null;
    }
  >;
};

/** authorize(install.task.read) → 范围 */
export async function resolveInstallScope(
  user: AuthUser,
  orgId: string,
  permission = "install.task.read",
): Promise<{ scope: InstallScope; decision: AuthorizeResult }> {
  const decision = await authorize({
    principal: humanPrincipal(user, orgId),
    orgId,
    permission,
  });
  return { scope: installScopeFromDecision(decision), decision };
}

/** 对某条任务做资源级判定（ASSIGNED ↔ assignedToId） */
export async function authorizeInstallTask(
  user: AuthUser,
  task: Pick<InstallTaskRow, "id" | "assignedToId"> & { customer: { orgId: string } },
  permission: string,
): Promise<AuthorizeResult> {
  return authorize({
    principal: humanPrincipal(user, task.customer.orgId),
    orgId: task.customer.orgId,
    permission,
    resource: {
      type: "appointment",
      id: task.id,
      assignedToId: task.assignedToId,
      orgId: task.customer.orgId,
    },
  });
}

export async function loadInstallTask(id: string): Promise<InstallTaskRow | null> {
  const row = await db.appointment.findUnique({ where: { id }, select: INSTALL_TASK_SELECT });
  if (!row || row.type !== "install") return null;
  return row as InstallTaskRow;
}

export async function loadOrderForTask(appointmentId: string): Promise<InstallOrderRow | null> {
  const row = await db.blindsOrder.findFirst({
    where: { appointmentId },
    select: INSTALL_ORDER_SELECT,
  });
  return (row as InstallOrderRow | null) ?? null;
}

/** 每张工艺单最新的工艺参数（process_order.spec 审计行，取最新一条）；没有的单不在结果里 */
export async function loadLatestSpecs(orderIds: string[]): Promise<Map<string, ProcessSpec>> {
  const out = new Map<string, ProcessSpec>();
  if (orderIds.length === 0) return out;
  const rows = await db.auditLog.findMany({
    where: { targetType: AUDIT_TARGET_ORDER, action: AUDIT_ACTION_SPEC, targetId: { in: orderIds } },
    orderBy: { createdAt: "desc" },
    distinct: ["targetId"],
    select: { targetId: true, afterData: true },
  });
  for (const r of rows) {
    if (!r.targetId || out.has(r.targetId) || !r.afterData) continue;
    try {
      out.set(r.targetId, sanitizeSpec(JSON.parse(r.afterData)));
    } catch {
      // 坏 JSON：按无工艺参数处理（只剩 Blinds 行）
    }
  }
  return out;
}

/** 两类目标：Blinds 行（blinds_order_item）与工艺参数单元（blinds_order_unit）；两种记录：收口与问题（INSTALL-2d） */
export async function loadCloseoutLogs(units: Array<Pick<CloseoutUnit, "section" | "logTargetId">>): Promise<CloseoutLog[]> {
  const itemIds = units.filter((u) => u.section === "blinds").map((u) => u.logTargetId);
  const unitTargets = units.filter((u) => u.section !== "blinds").map((u) => u.logTargetId);
  const or = [
    ...(itemIds.length ? [{ targetType: INSTALL_TARGET_ITEM, targetId: { in: itemIds } }] : []),
    ...(unitTargets.length ? [{ targetType: INSTALL_TARGET_UNIT, targetId: { in: unitTargets } }] : []),
  ];
  if (or.length === 0) return [];
  const rows = await db.auditLog.findMany({
    where: { action: { in: [INSTALL_WINDOW_COMPLETED, INSTALL_WINDOW_ISSUE] }, OR: or },
    select: { targetId: true, createdAt: true, userId: true, afterData: true, action: true },
    orderBy: { createdAt: "desc" },
  });
  return rows;
}

export function unitsForOrder(order: InstallOrderRow, spec: ProcessSpec | null | undefined): CloseoutUnit[] {
  return buildCloseoutUnits(order.id, order.items, spec ?? null);
}

export type OrderCloseout = { units: CloseoutUnit[]; summary: CloseoutSummary };

/** 一张或多张工艺单的收口单元与聚合（列表批量；详情 / 上传 / 完成传单张） */
export async function loadOrdersCloseout(orders: InstallOrderRow[]): Promise<Map<string, OrderCloseout>> {
  const specs = await loadLatestSpecs(orders.map((o) => o.id));
  const unitsByOrder = new Map(orders.map((o) => [o.id, unitsForOrder(o, specs.get(o.id))]));
  const logs = await loadCloseoutLogs([...unitsByOrder.values()].flat());
  const out = new Map<string, OrderCloseout>();
  for (const o of orders) {
    const units = unitsByOrder.get(o.id) ?? [];
    const targets = new Set(units.map((u) => u.logTargetId));
    out.set(o.id, { units, summary: aggregateCloseout(units, logs.filter((l) => l.targetId && targets.has(l.targetId))) });
  }
  return out;
}

/** 只要单元（上传前判定单元是否属于该单），不读收口记录 */
export async function loadOrderUnits(order: InstallOrderRow): Promise<CloseoutUnit[]> {
  const specs = await loadLatestSpecs([order.id]);
  return unitsForOrder(order, specs.get(order.id));
}

export async function loadCloseoutSummary(order: InstallOrderRow): Promise<OrderCloseout> {
  const map = await loadOrdersCloseout([order]);
  return map.get(order.id) ?? { units: [], summary: aggregateCloseout([], []) };
}

/** 列表项：预约 + 工艺单摘要 + 收口计数（不含金额） */
export function serializeTaskSummary(
  task: InstallTaskRow,
  order: InstallOrderRow | null,
  summary: CloseoutSummary | null,
) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    startAt: task.startAt.toISOString(),
    endAt: task.endAt.toISOString(),
    allDay: task.allDay,
    address: task.address ?? order?.address ?? task.customer.address ?? null,
    contactPhone: task.contactPhone,
    completedAt: task.completedAt?.toISOString() ?? null,
    customer: { id: task.customer.id, name: task.customer.name },
    assignedTo: task.assignedTo,
    order: order
      ? {
          id: order.id,
          code: order.code,
          status: order.status,
          windowCount: summary?.total ?? 0,
          completedCount: summary?.completed ?? 0,
          issueCount: summary?.issueCount ?? 0,
          allCompleted: summary?.allCompleted ?? false,
        }
      : null,
  };
}

/** INSTALL-2d：因提交维修单而完成的任务，详情里带的维修单摘要 */
export type TaskRepairSummary = { id: string; repairNo: string; targetDate: string; rowCount: number };

/** 详情：摘要 + 每个收口单元 + 每单元收口 / 问题 */
export function serializeTaskDetail(
  task: InstallTaskRow,
  order: InstallOrderRow,
  closeout: OrderCloseout,
  repair: TaskRepairSummary | null = null,
) {
  const { units, summary } = closeout;
  const byUnit = new Map(summary.windows.map((w) => [w.itemId, w]));
  return {
    ...serializeTaskSummary(task, order, summary),
    notes: task.notes,
    remarks: order.remarks,
    windows: units.map((u) => {
      const c = byUnit.get(u.id);
      return {
        itemId: u.id,
        itemNumber: u.itemNumber,
        section: u.section,
        sectionLabel: u.sectionLabel,
        location: u.location,
        width: u.width,
        height: u.height,
        productType: u.productType,
        fabricSku: u.fabricSku,
        controlType: u.controlType,
        controlSide: u.controlSide,
        mountType: u.mountType,
        itemRemark: u.itemRemark,
        photoCount: c?.photoCount ?? 0,
        latest: c?.latest ?? null,
        photos: c?.photos ?? [],
        locationChanged: c?.locationChanged ?? null,
        state: c?.state ?? "pending",
        issue: c?.issue ?? null,
      };
    }),
    closeout: { total: summary.total, completed: summary.completed, issueCount: summary.issueCount, allCompleted: summary.allCompleted },
    repair,
  };
}

export const installNotFound = () => NextResponse.json({ error: "安装任务不存在" }, { status: 404 });
export const installForbidden = () => NextResponse.json({ error: "无权访问该安装任务" }, { status: 403 });
export const installNoOrder = () =>
  NextResponse.json({ error: "该任务未关联工艺单", code: "NO_ORDER" }, { status: 409 });
