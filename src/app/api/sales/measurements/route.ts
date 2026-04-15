import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

export const GET = withAuth(async (request, _ctx, user) => {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");

  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const where: Record<string, unknown> = {};
  if (!isAdmin) where.measuredById = user.id;
  if (customerId) where.customerId = customerId;

  const records = await db.measurementRecord.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
      windows: {
        orderBy: { sortOrder: "asc" },
        include: { photos: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ records });
});

interface WindowInput {
  roomName: string;
  windowLabel?: string;
  widthIn: number;
  heightIn: number;
  measureType?: string;
  product?: string;
  fabric?: string;
  cordless?: boolean;
  notes?: string;
}

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const { customerId, opportunityId, appointmentId, overallNotes, windows } = body as {
    customerId: string;
    opportunityId?: string;
    appointmentId?: string;
    overallNotes?: string;
    windows: WindowInput[];
  };

  if (!customerId || !windows?.length) {
    return NextResponse.json({ error: "客户和窗位不能为空" }, { status: 400 });
  }

  const record = await db.measurementRecord.create({
    data: {
      customerId,
      opportunityId: opportunityId || null,
      appointmentId: appointmentId || null,
      overallNotes: overallNotes || null,
      measuredById: user.id,
      windows: {
        create: windows.map((w, idx) => ({
          roomName: w.roomName,
          windowLabel: w.windowLabel || null,
          widthIn: w.widthIn,
          heightIn: w.heightIn,
          measureType: w.measureType || "IN",
          product: w.product || null,
          fabric: w.fabric || null,
          cordless: w.cordless || false,
          notes: w.notes || null,
          sortOrder: idx,
        })),
      },
    },
    include: {
      customer: { select: { id: true, name: true } },
      windows: { orderBy: { sortOrder: "asc" } },
    },
  });

  return NextResponse.json({ record }, { status: 201 });
});
