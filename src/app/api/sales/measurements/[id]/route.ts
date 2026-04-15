import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

export const GET = withAuth(async (_request, ctx) => {
  const { id } = await ctx.params;
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
});

export const PATCH = withAuth(async (request, ctx) => {
  const { id } = await ctx.params;
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
});
