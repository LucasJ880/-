/**
 * GET /api/install/repairs/[id]?orgId
 * INSTALL-2d：维修单详情（与打印版同一数据；spec installation/repairs「维修单列表与详情」「维修单打印版」）。
 * - 只对持 install.task.read（ORG）开放，其他人 403；他企业的维修单 404
 * - 含表头、全部行（问题照只给 /api/files/ 代理地址）、当前安装阶段、打印抬头（质保设置的公司名与地址）
 * - 不出金额
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { todayInTimeZone } from "@/lib/install/balance";
import { INSTALL_REPAIR_SUBMITTED, parseRepairRecord, REPAIR_TARGET_TYPE } from "@/lib/install/repair";
import { loadOrderStages, serializeRepairDetail, userNameMap } from "@/lib/install/repair-service";
import { resolveInstallScope } from "@/lib/install/service";
import { readWarrantySettings } from "@/lib/install/warranty";

const notFound = () => NextResponse.json({ error: "维修单不存在" }, { status: 404 });

export const GET = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;
  const { scope } = await resolveInstallScope(user, orgId);
  if (scope !== "org") return NextResponse.json({ error: "无权查看维修单" }, { status: 403 });

  const row = await db.auditLog.findUnique({
    where: { id },
    select: { id: true, afterData: true, createdAt: true, userId: true, orgId: true, action: true, targetType: true },
  });
  if (!row || row.action !== INSTALL_REPAIR_SUBMITTED || row.targetType !== REPAIR_TARGET_TYPE || row.orgId !== orgId) return notFound();
  const rec = parseRepairRecord(row);
  if (!rec) return notFound();
  const order = await db.blindsOrder.findFirst({
    where: { id: rec.orderId, customer: { orgId } },
    select: { id: true, code: true, status: true, appointmentId: true },
  });
  if (!order) return notFound();

  const [stages, names, tz, org] = await Promise.all([
    loadOrderStages([order]),
    userNameMap([rec.header.takenById]),
    loadOrgTimezone(orgId),
    db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }),
  ]);
  const { contact } = readWarrantySettings(org?.settingsJson ?? null).settings;
  return NextResponse.json({
    repair: serializeRepairDetail(rec, {
      orderCode: order.code,
      stage: stages.get(order.id)?.stage ?? "not_scheduled",
      takenByName: names.get(rec.header.takenById) ?? null,
      today: todayInTimeZone(tz),
      company: { name: contact.companyName, address: contact.address },
    }),
  });
});
