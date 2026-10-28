/**
 * GET /api/blinds-orders/[id]/install-status
 * INSTALL-2d：工艺单安装状态卡（spec installation/install-stage「安装状态接口」「安装状态不输出的内容」）。
 * - 读权同工艺单详情（blindsOrderAccess.canRead：含创建人、出单读权、同企业成员可读无项目归属的单），否则 404
 * - 阶段 / 阶段名 / 销售文案 / 最近一次安装预约时间；返修中另含单号、目标日、已和客户确认、各行位置与问题类型名、是否需工厂
 * - 不出问题照片、描述、维修单表头电话与备注、任何金额
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { blindsOrderAccess } from "@/lib/sunny-process/server";
import { todayInTimeZone } from "@/lib/install/balance";
import { ISSUE_TYPE_LABEL } from "@/lib/install/repair";
import { loadOrderStages } from "@/lib/install/repair-service";
import { salesStageText, STAGE_LABEL, type WarrantyBrief } from "@/lib/install/stage";
import { loadWarrantyStatuses } from "@/lib/install/warranty-service";

const notFound = () => NextResponse.json({ error: "工艺单不存在" }, { status: 404 });

export const GET = withAuth<{ id: string }>(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const access = await blindsOrderAccess(id, user);
  if (!access?.canRead) return notFound();

  const order = await db.blindsOrder.findUnique({
    where: { id },
    select: { id: true, status: true, appointmentId: true, customer: { select: { orgId: true } } },
  });
  const orgId = order?.customer?.orgId;
  if (!order || !orgId) return notFound();

  const [stages, tz, appt] = await Promise.all([
    loadOrderStages([order]),
    loadOrgTimezone(orgId),
    order.appointmentId ? db.appointment.findUnique({ where: { id: order.appointmentId }, select: { startAt: true } }) : Promise.resolve(null),
  ]);
  const info = stages.get(order.id);
  if (!info) return notFound();
  const { stage, balanceConfirmed, openRepair } = info;

  let warranty: WarrantyBrief | null = null;
  if (stage === "closed" && balanceConfirmed) {
    const w = (await loadWarrantyStatuses(orgId, [order.id])).get(order.id);
    warranty = w?.status === "sent" ? "sent" : w?.status === "pending_approval" ? "pending_approval" : "not_sent";
  }
  const inRepair = stage === "repair_open" || stage === "repair_ready_to_schedule";
  const installDate = appt ? todayInTimeZone(tz, appt.startAt) : null;

  return NextResponse.json({
    stage,
    stageLabel: STAGE_LABEL[stage],
    salesText: salesStageText(stage, { installDate, targetDate: openRepair?.targetDate ?? null, balanceConfirmed, warranty }),
    installAt: appt?.startAt.toISOString() ?? null,
    repair:
      inRepair && openRepair
        ? {
            repairNo: openRepair.repairNo,
            targetDate: openRepair.targetDate,
            customerConfirmed: openRepair.customerConfirmed,
            rows: openRepair.rows.map((r) => ({
              n: r.n,
              location: r.location,
              issueTypeLabel: ISSUE_TYPE_LABEL[r.issueType],
              needsFactory: r.needsFactory,
            })),
          }
        : null,
  });
});
