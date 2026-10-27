/**
 * INSTALL-1：安装任务范围判定（纯函数）
 *
 * 安装任务 = Appointment(type=install)。ASSIGNED 范围 ↔ Appointment.assignedToId。
 */

import type { AuthorizeResult } from "@/lib/authorization/types";

export type InstallScope = "org" | "assigned" | "none";

/** 由 authorize(install.task.read)（无 resource）的结果推导范围 */
export function installScopeFromDecision(decision: Pick<AuthorizeResult, "allowed" | "scopes">): InstallScope {
  if (!decision.allowed) return "none";
  if (decision.scopes.includes("ORG")) return "org";
  if (decision.scopes.includes("ASSIGNED") || decision.scopes.includes("PRINCIPAL")) return "assigned";
  return "none";
}

/** Prisma where：企业内 install 预约；assigned 范围只看分配给本人的 */
export function installTaskWhere(input: {
  orgId: string;
  userId: string;
  scope: InstallScope;
  start?: string | null;
  end?: string | null;
}): Record<string, unknown> | null {
  if (input.scope === "none") return null;
  const where: Record<string, unknown> = {
    type: "install",
    customer: { orgId: input.orgId },
  };
  if (input.scope === "assigned") where.assignedToId = input.userId;
  if (input.start && input.end) {
    const s = new Date(input.start);
    const e = new Date(input.end);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      where.startAt = { gte: s, lte: e };
    }
  }
  return where;
}

/** 单条任务可见性：ORG 全可见；assigned 只看本人 */
export function canSeeInstallTask(input: {
  scope: InstallScope;
  userId: string;
  assignedToId: string;
}): boolean {
  if (input.scope === "org") return true;
  if (input.scope === "assigned") return input.assignedToId === input.userId;
  return false;
}

/** 安装工页面在周视图里按天分组（本地日期键 YYYY-MM-DD） */
export function groupByDay<T extends { startAt: string | Date }>(items: T[]): Array<{ day: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const d = new Date(it.startAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({ day, items: list.sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)) }));
}
