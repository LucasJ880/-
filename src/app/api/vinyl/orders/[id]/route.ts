import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTenantContext } from "@/lib/tenancy";
import {
  buildItemRows,
  buildOrderContext,
  coerceItemInput,
  normalizeLouverSize,
} from "@/lib/vinyl/order-service";
import { VINYL_RULE_VERSION } from "@/lib/vinyl/frame-rules";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const order = await db.vinylOrder.findFirst({
    where: { id, orgId: tenant.orgId },
    include: {
      items: { orderBy: { itemNumber: "asc" } },
      statusLogs: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const existing = await db.vinylOrder.findFirst({
    where: { id, orgId: tenant.orgId },
    select: { id: true, code: true, louverSize: true },
  });
  if (!existing) return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  if (body.code && String(body.code) !== existing.code) {
    const dup = await db.vinylOrder.findUnique({
      where: { code: String(body.code) },
      select: { id: true },
    });
    if (dup) {
      return NextResponse.json({ error: `订单号 ${body.code} 已被占用` }, { status: 400 });
    }
  }

  const louverSize =
    body.louverSize !== undefined ? normalizeLouverSize(body.louverSize) : existing.louverSize;

  // 只有真的重新提交了明细才重算 + 升规则版本；改电话地址不该动历史尺寸
  let itemsData: ReturnType<typeof buildItemRows> | null = null;
  if (Array.isArray(body.items)) {
    const orderCtx = await buildOrderContext(tenant.orgId, louverSize);
    itemsData = buildItemRows(
      (body.items as Record<string, unknown>[]).map(coerceItemInput),
      orderCtx,
    );
    await db.vinylOrderItem.deleteMany({ where: { orderId: id } });
  }

  const updated = await db.vinylOrder.update({
    where: { id },
    data: {
      ...(body.code !== undefined && { code: String(body.code) }),
      ...(body.customerName !== undefined && { customerName: String(body.customerName) }),
      ...(body.phone !== undefined && { phone: body.phone ? String(body.phone) : null }),
      ...(body.address !== undefined && { address: body.address ? String(body.address) : null }),
      ...(body.installDate !== undefined && {
        installDate: body.installDate ? String(body.installDate) : null,
      }),
      ...(body.remarks !== undefined && { remarks: body.remarks ? String(body.remarks) : null }),
      ...(body.color !== undefined && { color: String(body.color) }),
      ...(body.louverSize !== undefined && { louverSize }),
      ...(itemsData
        ? { ruleVersion: VINYL_RULE_VERSION, items: { create: itemsData } }
        : {}),
    },
    include: { items: { orderBy: { itemNumber: "asc" } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const existing = await db.vinylOrder.findFirst({
    where: { id, orgId: tenant.orgId },
    select: { id: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  if (existing.status !== "draft") {
    return NextResponse.json(
      { error: "只有草稿状态的工艺单可以删除；已确认的请走取消流程" },
      { status: 409 },
    );
  }

  await db.vinylOrder.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
