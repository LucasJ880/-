/**
 * GET /api/install/repairs?orgId
 * INSTALL-2d：维修单列表（spec installation/repairs「维修单列表与详情」）。
 * - 只对持 install.task.read（ORG）开放，其他人 403（安装工只有 ASSIGNED）
 * - 每条：单号 / 工艺单号 / 客户名 / 提交人 / 填写日 / 目标日 / 是否逾期 / 行数 / 需工厂品类 / 已和客户确认 / 安装阶段；按目标日升序
 * - INSTALL-2e：另含待登记出单品类、返修时间、关闭情况；已关闭的不算逾期
 * - INSTALL-2f：关闭情况带原因中文名（已作废 / 关闭不返修 等）
 * - INSTALL-2i：?tab=open|archived&page&pageSize&q——关闭即归档；不设条数上限；先轻量全量分栏 / 搜索 / 排序 / 分页，
 *   只对当前页读阶段、姓名与全部事件（design D2）；已归档项带原因说明、关闭时间、关闭人
 * - 不出金额；不出照片
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { todayInTimeZone } from "@/lib/install/balance";
import {
  INSTALL_REPAIR_COMPLETED,
  INSTALL_REPAIR_SUBMITTED,
  parseRepairEvent,
  parseRepairListQuery,
  parseRepairRecord,
  REPAIR_TARGET_TYPE,
  repairListPage,
  repairProgress,
} from "@/lib/install/repair";
import { loadOrderStages, loadRepairEvents, serializeRepairListItem, userNameMap } from "@/lib/install/repair-service";
import { resolveInstallScope } from "@/lib/install/service";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;
  const { scope } = await resolveInstallScope(user, orgId);
  if (scope !== "org") return NextResponse.json({ error: "无权查看维修单" }, { status: 403 });
  const query = parseRepairListQuery(request.nextUrl.searchParams);

  // ① 全部提交记录（轻量列）② 工艺单归属与单号 ③ 关闭事件（只取 completed）——分栏、搜索只需要这些
  const rows = await db.auditLog.findMany({
    where: { action: INSTALL_REPAIR_SUBMITTED, targetType: REPAIR_TARGET_TYPE, orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, afterData: true, createdAt: true, userId: true },
  });
  const recs = rows.map(parseRepairRecord).filter((r): r is NonNullable<typeof r> => !!r);
  const orderIds = [...new Set(recs.map((r) => r.orderId))];
  const [orders, closeRows] = await Promise.all([
    db.blindsOrder.findMany({
      where: { id: { in: orderIds }, customer: { orgId } },
      select: { id: true, code: true, status: true, appointmentId: true },
    }),
    db.auditLog.findMany({
      where: { action: INSTALL_REPAIR_COMPLETED, targetType: REPAIR_TARGET_TYPE, targetId: { in: orderIds } },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, afterData: true, createdAt: true, userId: true },
    }),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  // 与 repairProgress 一致：同一维修单以第一条关闭事件为准
  const closedAt = new Map<string, string>();
  for (const row of closeRows) {
    const e = parseRepairEvent(row);
    if (e && !closedAt.has(e.repairId)) closedAt.set(e.repairId, e.at);
  }
  const entries = recs
    .filter((r) => orderById.has(r.orderId))
    .map((rec) => ({
      id: rec.id,
      repairNo: rec.repairNo,
      orderCode: orderById.get(rec.orderId)!.code || rec.orderCode,
      customerName: rec.header.customerName,
      targetDate: rec.targetDate,
      closedAt: closedAt.get(rec.id) ?? null,
      rec,
    }));
  const pageRes = repairListPage(entries, query);

  // ④ 只对当前页做完整计算
  const pageOrders = [...new Set(pageRes.items.map((e) => e.rec.orderId))].map((id) => orderById.get(id)!);
  const [stages, tz, events] = await Promise.all([
    loadOrderStages(pageOrders),
    loadOrgTimezone(orgId),
    loadRepairEvents(pageOrders.map((o) => o.id)),
  ]);
  const progress = new Map(pageRes.items.map((e) => [e.id, repairProgress(e.rec, events.get(e.rec.orderId) ?? [])]));
  const names = await userNameMap([
    ...pageRes.items.map((e) => e.rec.header.takenById),
    ...[...progress.values()].map((p) => p.closed?.byUserId ?? ""),
  ]);
  const today = todayInTimeZone(tz);
  const repairs = pageRes.items.map((e) => {
    const p = progress.get(e.id)!;
    return serializeRepairListItem(e.rec, {
      orderCode: e.orderCode,
      stage: stages.get(e.rec.orderId)?.stage ?? "not_scheduled",
      takenByName: names.get(e.rec.header.takenById) ?? null,
      today,
      progress: p,
      closedByName: p.closed ? (names.get(p.closed.byUserId) ?? null) : null,
    });
  });
  return NextResponse.json({
    repairs,
    today,
    tab: query.tab,
    q: query.q,
    page: query.page,
    pageSize: query.pageSize,
    total: pageRes.total,
    counts: pageRes.counts,
  });
});
