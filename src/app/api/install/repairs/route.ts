/**
 * GET /api/install/repairs?orgId
 * INSTALL-2d：维修单列表（spec installation/repairs「维修单列表与详情」）。
 * - 只对持 install.task.read（ORG）开放，其他人 403（安装工只有 ASSIGNED）
 * - 每条：单号 / 工艺单号 / 客户名 / 提交人 / 填写日 / 目标日 / 是否逾期 / 行数 / 需工厂品类 / 已和客户确认 / 安装阶段；按目标日升序
 * - INSTALL-2e：另含待登记出单品类、返修时间、关闭情况；已关闭的不算逾期
 * - INSTALL-2f：关闭情况带原因中文名（已作废 / 关闭不返修 等）
 * - 不出金额；不出照片
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { todayInTimeZone } from "@/lib/install/balance";
import { INSTALL_REPAIR_SUBMITTED, parseRepairRecord, REPAIR_TARGET_TYPE, repairProgress } from "@/lib/install/repair";
import { loadOrderStages, loadRepairEvents, serializeRepairListItem, userNameMap } from "@/lib/install/repair-service";
import { resolveInstallScope } from "@/lib/install/service";

const LIST_LIMIT = 200;

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;
  const { scope } = await resolveInstallScope(user, orgId);
  if (scope !== "org") return NextResponse.json({ error: "无权查看维修单" }, { status: 403 });

  const rows = await db.auditLog.findMany({
    where: { action: INSTALL_REPAIR_SUBMITTED, targetType: REPAIR_TARGET_TYPE, orgId },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: { id: true, afterData: true, createdAt: true, userId: true },
  });
  const recs = rows.map(parseRepairRecord).filter((r): r is NonNullable<typeof r> => !!r);
  const orders = await db.blindsOrder.findMany({
    where: { id: { in: [...new Set(recs.map((r) => r.orderId))] }, customer: { orgId } },
    select: { id: true, code: true, status: true, appointmentId: true },
  });
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const [stages, names, tz, events] = await Promise.all([
    loadOrderStages(orders),
    userNameMap(recs.map((r) => r.header.takenById)),
    loadOrgTimezone(orgId),
    loadRepairEvents(orders.map((o) => o.id)),
  ]);
  const today = todayInTimeZone(tz);
  const repairs = recs
    .filter((r) => orderById.has(r.orderId))
    .map((r) =>
      serializeRepairListItem(r, {
        orderCode: orderById.get(r.orderId)!.code,
        stage: stages.get(r.orderId)?.stage ?? "not_scheduled",
        takenByName: names.get(r.header.takenById) ?? null,
        today,
        progress: repairProgress(r, events.get(r.orderId) ?? []),
      }),
    )
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.repairNo.localeCompare(b.repairNo));
  return NextResponse.json({ repairs, today });
});
