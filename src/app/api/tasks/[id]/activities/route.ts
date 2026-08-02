import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTaskAccess } from "@/lib/tasks/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireTaskAccess(request, id);
  if (access instanceof NextResponse) return access;

  const activities = await db.taskActivity.findMany({
    where: { taskId: id },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(activities);
}
