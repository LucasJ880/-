/**
 * GET /api/install/tasks?start&end&orgId
 * INSTALL-1：安装任务列表（范围判定 → 预约 + 工艺单摘要 + 收口计数）
 * INSTALL-2a：收口计数按收口单元（含工艺参数行）
 * INSTALL-2e：返修预约只计维修单各行对应的单元并标返修单号；排返修后之前的预约经维修单记录找回工艺单
 *
 * - 持 install.task.read ASSIGNED：只看分配给本人的；ORG：全企业；都不持有 → 403
 * - 响应不含金额 / 成本 / 原始存储 URL
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { installTaskWhere } from "@/lib/install/scope";
import {
  INSTALL_TASK_SELECT,
  installForbidden,
  loadOrdersCloseout,
  resolveInstallScope,
  loadOrdersForTasks,
  scopeCloseout,
  serializeTaskSummary,
  type InstallTaskRow,
} from "@/lib/install/service";
import { returnRepairFor } from "@/lib/install/repair";
import { loadRepairEvents, loadRepairsForOrders } from "@/lib/install/repair-service";

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

  const orderByAppt = await loadOrdersForTasks(tasks.map((t) => t.id));
  const orders = [...new Map([...orderByAppt.values()].map((o) => [o.id, o])).values()];

  // INSTALL-2a：收口单元 = Blinds 行 + 工艺参数四段；与详情 / 完成收口同一函数
  const [closeouts, repairs, events] = await Promise.all([
    loadOrdersCloseout(orders),
    loadRepairsForOrders(orders.map((o) => o.id)),
    loadRepairEvents(orders.map((o) => o.id)),
  ]);

  const items = tasks.map((t) => {
    const order = orderByAppt.get(t.id) ?? null;
    const closeout = order ? closeouts.get(order.id) : undefined;
    // INSTALL-2e：返修预约只计维修行
    const ret = order ? returnRepairFor(t.id, repairs.get(order.id) ?? [], events.get(order.id) ?? []) : null;
    const summary = closeout ? scopeCloseout(closeout, ret).summary : null;
    return serializeTaskSummary(t, order, summary, ret ? { id: ret.id, repairNo: ret.repairNo } : null);
  });

  return NextResponse.json({ scope, tasks: items });
});
