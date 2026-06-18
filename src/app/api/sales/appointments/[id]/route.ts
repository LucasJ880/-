import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  syncAppointmentToGoogle,
  unsyncAppointmentFromGoogle,
} from "@/lib/sales/appointment-gcal-sync";
import {
  resolveSalesOrgIdForRequest,
  resolveSalesScope,
  loadAppointmentForOrg,
  isAppointmentOwn,
} from "@/lib/sales/org-context";

export const GET = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const appointment = await db.appointment.findFirst({
    where: { id, customer: { orgId: orgRes.orgId } },
    include: {
      customer: {
        select: {
          id: true, name: true, phone: true, email: true, address: true,
          createdById: true,
        },
      },
      opportunity: { select: { id: true, title: true, stage: true } },
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (!appointment) {
    return NextResponse.json({ error: "预约不存在" }, { status: 404 });
  }

  const { ownOnly } = await resolveSalesScope(user, orgRes.orgId);
  if (
    ownOnly &&
    !isAppointmentOwn(
      {
        assignedToId: appointment.assignedToId,
        createdById: appointment.createdById,
        customer: { createdById: appointment.customer.createdById },
      },
      user.id,
    )
  ) {
    return NextResponse.json({ error: "无权访问该预约" }, { status: 403 });
  }

  return NextResponse.json({ appointment });
});

export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const existing = await loadAppointmentForOrg(id, orgRes.orgId);
  if (!existing) {
    return NextResponse.json({ error: "预约不存在" }, { status: 404 });
  }
  const { ownOnly } = await resolveSalesScope(user, orgRes.orgId);
  if (ownOnly && !isAppointmentOwn(existing, user.id)) {
    return NextResponse.json({ error: "无权修改该预约" }, { status: 403 });
  }

  const body = await request.json();

  const updateData: Record<string, unknown> = {};
  const allowedFields = [
    "title", "description", "startAt", "endAt", "address",
    "contactPhone", "status", "cancelReason", "notes", "assignedToId", "type",
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field === "startAt" || field === "endAt") {
        updateData[field] = new Date(body[field]);
      } else {
        updateData[field] = body[field];
      }
    }
  }

  if (body.status === "completed") {
    updateData.completedAt = new Date();
  }

  const appointment = await db.appointment.update({
    where: { id },
    data: updateData,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  if (body.status === "cancelled") {
    unsyncAppointmentFromGoogle(id, appointment.assignedTo?.id || user.id).catch(
      (err) => console.error("Google Calendar unsync error:", err),
    );
  } else {
    syncAppointmentToGoogle(id, appointment.assignedTo?.id || user.id).catch(
      (err) => console.error("Google Calendar sync error:", err),
    );
  }

  return NextResponse.json({ appointment });
});

export const DELETE = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const existing = await loadAppointmentForOrg(id, orgRes.orgId);
  if (!existing) {
    return NextResponse.json({ error: "预约不存在" }, { status: 404 });
  }
  const { ownOnly } = await resolveSalesScope(user, orgRes.orgId);
  if (ownOnly && !isAppointmentOwn(existing, user.id)) {
    return NextResponse.json({ error: "无权删除该预约" }, { status: 403 });
  }

  await unsyncAppointmentFromGoogle(id, user.id).catch(
    (err) => console.error("Google Calendar unsync error:", err),
  );

  await db.appointment.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
