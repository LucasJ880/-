import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";

export const POST = withAuth(async (request, _ctx, _user) => {
  const body = await request.json();
  const { ids, action, value } = body as {
    ids: string[];
    action: "status" | "priority" | "delete";
    value?: string;
  };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
  }

  if (ids.length > 100) {
    return NextResponse.json({ error: "一次最多操作 100 条" }, { status: 400 });
  }

  if (action === "delete") {
    await db.task.deleteMany({ where: { id: { in: ids } } });
    return NextResponse.json({ deleted: ids.length });
  }

  if (action === "status" && value) {
    await db.task.updateMany({
      where: { id: { in: ids } },
      data: { status: value },
    });
    return NextResponse.json({ updated: ids.length, status: value });
  }

  if (action === "priority" && value) {
    await db.task.updateMany({
      where: { id: { in: ids } },
      data: { priority: value },
    });
    return NextResponse.json({ updated: ids.length, priority: value });
  }

  return NextResponse.json({ error: "无效操作" }, { status: 400 });
});
