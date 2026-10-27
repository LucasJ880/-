/**
 * INSTALL-1：安装任务服务端读取（数据库侧，供 /api/install/* 共用）
 *
 * 任务 = Appointment(type=install)；工艺单 = BlindsOrder(appointmentId)；收口记录 = AuditLog。
 * 这里只做读取与序列化，不返回金额 / 成本 / 原始存储 URL。
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { authorize, humanPrincipal } from "@/lib/authorization";
import type { AuthorizeResult } from "@/lib/authorization/types";
import {
  aggregateCloseout,
  INSTALL_WINDOW_COMPLETED,
  type CloseoutLog,
  type CloseoutSummary,
  type WindowItem,
} from "./closeout";
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

export async function loadCloseoutLogs(itemIds: string[]): Promise<CloseoutLog[]> {
  if (itemIds.length === 0) return [];
  const rows = await db.auditLog.findMany({
    where: {
      action: INSTALL_WINDOW_COMPLETED,
      targetType: "blinds_order_item",
      targetId: { in: itemIds },
    },
    select: { targetId: true, createdAt: true, userId: true, afterData: true },
    orderBy: { createdAt: "desc" },
  });
  return rows;
}

export async function loadCloseoutSummary(order: InstallOrderRow): Promise<CloseoutSummary> {
  const logs = await loadCloseoutLogs(order.items.map((i) => i.id));
  return aggregateCloseout(order.items, logs);
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
          windowCount: summary?.total ?? order.items.length,
          completedCount: summary?.completed ?? 0,
          allCompleted: summary?.allCompleted ?? false,
        }
      : null,
  };
}

/** 详情：摘要 + 每扇窗 + 每窗收口 */
export function serializeTaskDetail(
  task: InstallTaskRow,
  order: InstallOrderRow,
  summary: CloseoutSummary,
) {
  const byItem = new Map(summary.windows.map((w) => [w.itemId, w]));
  return {
    ...serializeTaskSummary(task, order, summary),
    notes: task.notes,
    remarks: order.remarks,
    windows: order.items.map((it) => {
      const c = byItem.get(it.id);
      return {
        itemId: it.id,
        itemNumber: it.itemNumber,
        location: it.location,
        width: it.width,
        height: it.height,
        productType: it.productType,
        fabricSku: it.fabricSku,
        controlType: it.controlType,
        controlSide: it.controlSide,
        mountType: it.mountType,
        itemRemark: it.itemRemark,
        photoCount: c?.photoCount ?? 0,
        latest: c?.latest ?? null,
        photos: c?.photos ?? [],
      };
    }),
    closeout: { total: summary.total, completed: summary.completed, allCompleted: summary.allCompleted },
  };
}

export const installNotFound = () => NextResponse.json({ error: "安装任务不存在" }, { status: 404 });
export const installForbidden = () => NextResponse.json({ error: "无权访问该安装任务" }, { status: 403 });
export const installNoOrder = () =>
  NextResponse.json({ error: "该任务未关联工艺单", code: "NO_ORDER" }, { status: 409 });
