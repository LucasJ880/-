import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncAppointmentToGoogle } from "@/lib/sales/appointment-gcal-sync";
import { onMeasureBooked } from "@/lib/sales/opportunity-lifecycle";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");

  const isAdmin = user.role === "admin" || user.role === "super_admin";

  const where: Record<string, unknown> = {};
  if (!isAdmin) {
    where.OR = [{ assignedToId: user.id }, { createdById: user.id }];
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
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
  };

  if (!customerId || !title || !startAt || !endAt) {
    return NextResponse.json({ error: "客户、标题、时间不能为空" }, { status: 400 });
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

  // 异步同步到 Google Calendar（不阻塞响应）
  const syncUserId = assignedToId || user.id;
  syncAppointmentToGoogle(appointment.id, syncUserId).catch((err) =>
    console.error("Google Calendar sync error:", err),
  );

  return NextResponse.json({ appointment }, { status: 201 });
}
