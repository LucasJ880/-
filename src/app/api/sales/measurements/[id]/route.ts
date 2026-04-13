import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const record = await db.measurementRecord.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
      windows: {
        orderBy: { sortOrder: "asc" },
        include: { photos: true },
      },
    },
  });

  if (!record) return NextResponse.json({ error: "不存在" }, { status: 404 });
  return NextResponse.json({ record });
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
  if (body.status) updateData.status = body.status;
  if (body.overallNotes !== undefined) updateData.overallNotes = body.overallNotes;

  const record = await db.measurementRecord.update({
    where: { id },
    data: updateData,
    include: {
      customer: { select: { id: true, name: true } },
      windows: { orderBy: { sortOrder: "asc" } },
    },
  });

  return NextResponse.json({ record });
}
