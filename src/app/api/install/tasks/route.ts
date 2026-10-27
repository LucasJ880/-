/**
 * GET /api/install/tasks?start&end&orgId
 * INSTALL-1：安装任务列表（范围判定 → 预约 + 工艺单摘要 + 收口计数）
 *
 * - 持 install.task.read ASSIGNED：只看分配给本人的；ORG：全企业；都不持有 → 403
 * - 响应不含金额 / 成本 / 原始存储 URL
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { installTaskWhere } from "@/lib/install/scope";
import { aggregateCloseout } from "@/lib/install/closeout";
import {
  INSTALL_ORDER_SELECT,
  INSTALL_TASK_SELECT,
  installForbidden,
  loadCloseoutLogs,
  resolveInstallScope,
  serializeTaskSummary,
  type InstallOrderRow,
  type InstallTaskRow,
} from "@/lib/install/service";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;

  const { scope } = await resolveInstallScope(user, orgId);
  const where = installTaskWhere({
    orgId,
    userId: user.id,
    scope,
    start: request.nextUrl.searchParams.get("start"),
    end: request.nextUrl.searchParams.get("end"),
  });
  if (!where) return installForbidden();

  const tasks = (await db.appointment.findMany({
    where,
    select: INSTALL_TASK_SELECT,
    orderBy: { startAt: "asc" },
    take: 300,
  })) as InstallTaskRow[];

  const orders = (await db.blindsOrder.findMany({
    where: { appointmentId: { in: tasks.map((t) => t.id) } },
    select: INSTALL_ORDER_SELECT,
  })) as InstallOrderRow[];
  const orderByAppt = new Map(orders.map((o) => [o.appointmentId as string, o]));

  const logs = await loadCloseoutLogs(orders.flatMap((o) => o.items.map((i) => i.id)));

  const items = tasks.map((t) => {
    const order = orderByAppt.get(t.id) ?? null;
    const summary = order
      ? aggregateCloseout(
          order.items,
          logs.filter((l) => order.items.some((i) => i.id === l.targetId)),
        )
      : null;
    return serializeTaskSummary(t, order, summary);
  });

  return NextResponse.json({ scope, tasks: items });
});
