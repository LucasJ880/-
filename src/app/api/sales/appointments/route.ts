import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { syncAppointmentToGoogle } from "@/lib/sales/appointment-gcal-sync";
import { onMeasureBooked } from "@/lib/sales/opportunity-lifecycle";
import {
  assertSalesCustomerInOrgForMutation,
  resolveSalesOrgIdForRequest,
  resolveSalesScope,
} from "@/lib/sales/org-context";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const { ownOnly } = await resolveSalesScope(user, orgRes.orgId);

  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");

  // Appointment 表无 orgId，通过 customer.orgId 关系限定当前组织
  const where: Record<string, unknown> = {
    customer: { orgId: orgRes.orgId },
  };
  if (ownOnly) {
    where.OR = [
      { assignedToId: user.id },
      { createdById: user.id },
      { customer: { createdById: user.id } },
    ];
  }
  if (start && end) {
    where.startAt = { gte: new Date(start), lte: new Date(end) };
  }
  if (type) where.type = type;
  if (status) where.status = status;

  const appointments = await db.appointment.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
      opportunity: { select: { id: true, title: true, stage: true } },
      assignedTo: { select: { id: true, name: true } },
    },
    orderBy: { startAt: "asc" },
    take: 200,
  });

  return NextResponse.json({ appointments });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const {
    customerId,
    opportunityId,
    type,
    title,
    description,
    startAt,
    endAt,
    address,
    contactPhone,
    assignedToId,
  } = body as {
    customerId: string;
    opportunityId?: string;
    type?: string;
    title: string;
    description?: string;
    startAt: string;
    endAt: string;
    address?: string;
    contactPhone?: string;
    assignedToId?: string;
    orgId?: string;
  };

  if (!customerId || !title || !startAt || !endAt) {
    return NextResponse.json({ error: "客户、标题、时间不能为空" }, { status: 400 });
  }

  const orgRes = await resolveSalesOrgIdForRequest(request, user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const customer = await db.salesCustomer.findFirst({
    where: { id: customerId, archivedAt: null },
    select: { id: true, orgId: true, createdById: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "客户不存在" }, { status: 404 });
  }
  const denied = await assertSalesCustomerInOrgForMutation(customer, orgRes.orgId, {
    user,
    permission: "sales.customer.read",
  });
  if (denied) return denied;

  if (opportunityId) {
    const opp = await db.salesOpportunity.findFirst({
      where: { id: opportunityId, customerId },
      select: { id: true },
    });
    if (!opp) {
      return NextResponse.json({ error: "商机不存在或不属于该客户" }, { status: 400 });
    }
  }

  const appointment = await db.appointment.create({
    data: {
      customerId,
      opportunityId: opportunityId || null,
      type: type || "measure",
      title,
      description: description || null,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      address: address || null,
      contactPhone: contactPhone || null,
      assignedToId: assignedToId || user.id,
      createdById: user.id,
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  if (opportunityId && type === "measure") {
    onMeasureBooked(opportunityId, new Date(startAt)).catch((err) =>
      console.error("Measure booked lifecycle error:", err),
    );
  }

  const syncUserId = assignedToId || user.id;
  syncAppointmentToGoogle(appointment.id, syncUserId).catch((err) =>
    console.error("Google Calendar sync error:", err),
  );

  return NextResponse.json({ appointment }, { status: 201 });
});
