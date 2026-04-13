import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  syncAppointmentToGoogle,
  unsyncAppointmentFromGoogle,
} from "@/lib/sales/appointment-gcal-sync";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const appointment = await db.appointment.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true, address: true } },
      opportunity: { select: { id: true, title: true, stage: true } },
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (!appointment) {
    return NextResponse.json({ error: "预约不存在" }, { status: 404 });
  }

  return NextResponse.json({ appointment });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
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
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;

  // 先从 Google Calendar 删除事件
  await unsyncAppointmentFromGoogle(id, user.id).catch(
    (err) => console.error("Google Calendar unsync error:", err),
  );

  await db.appointment.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
