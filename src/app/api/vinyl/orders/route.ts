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

export async function GET(request: NextRequest) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  const status = new URL(request.url).searchParams.get("status");
  const orders = await db.vinylOrder.findMany({
    where: { orgId: tenant.orgId, ...(status ? { status } : {}) },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(orders);
}

export async function POST(request: NextRequest) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body?.code || !body?.customerName) {
    return NextResponse.json({ error: "订单号和客户名称为必填项" }, { status: 400 });
  }

  const code = String(body.code);
  if (await db.vinylOrder.findUnique({ where: { code }, select: { id: true } })) {
    return NextResponse.json({ error: `订单号 ${code} 已存在` }, { status: 400 });
  }

  const louverSize = normalizeLouverSize(body.louverSize);
  const ctx = await buildOrderContext(tenant.orgId, louverSize);
  const inputs = ((body.items as Record<string, unknown>[]) ?? []).map(coerceItemInput);

  const order = await db.vinylOrder.create({
    data: {
      orgId: tenant.orgId,
      code,
      customerName: String(body.customerName),
      phone: body.phone ? String(body.phone) : null,
      address: body.address ? String(body.address) : null,
      installDate: body.installDate ? String(body.installDate) : null,
      remarks: body.remarks ? String(body.remarks) : null,
      louverSize,
      color: body.color ? String(body.color) : "白色",
      ruleVersion: VINYL_RULE_VERSION,
      creatorId: tenant.userId,
      projectId: body.projectId ? String(body.projectId) : null,
      customerId: body.customerId ? String(body.customerId) : null,
      opportunityId: body.opportunityId ? String(body.opportunityId) : null,
      quoteId: body.quoteId ? String(body.quoteId) : null,
      items: { create: buildItemRows(inputs, ctx) },
    },
    include: { items: { orderBy: { itemNumber: "asc" } } },
  });

  return NextResponse.json(order, { status: 201 });
}
