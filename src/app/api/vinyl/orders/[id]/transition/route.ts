import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTenantContext } from "@/lib/tenancy";
import { canTransition, timestampField } from "@/lib/vinyl/order-state-machine";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    toStatus?: string;
    note?: string;
    cancelReason?: string;
  };
  const toStatus = String(body.toStatus ?? "");

  const order = await db.vinylOrder.findFirst({
    where: { id, orgId: tenant.orgId },
    select: { id: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });

  if (!canTransition(order.status, toStatus)) {
    return NextResponse.json(
      { error: `不能从 ${order.status} 转到 ${toStatus}` },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = { status: toStatus };
  const ts = timestampField(toStatus);
  if (ts) data[ts] = new Date();
  if (toStatus === "cancelled" && body.cancelReason) data.cancelReason = body.cancelReason;

  const [updated] = await db.$transaction([
    db.vinylOrder.update({ where: { id }, data }),
    db.vinylOrderStatusLog.create({
      data: {
        orderId: id,
        fromStatus: order.status,
        toStatus,
        note: body.note || body.cancelReason || null,
        operatorId: tenant.userId,
      },
    }),
  ]);

  return NextResponse.json({ order: updated });
}
