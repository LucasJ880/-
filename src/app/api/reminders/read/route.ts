import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/reminders/read
 * body: { sourceKey: string }
 *
 * 标记一条提醒为已读。
 * - followup 类型：更新已有 Reminder 记录
 * - deadline / event 类型：创建一条 status=read 的标记记录
 */
export async function POST(request: NextRequest) {
  const { sourceKey } = await request.json();
  if (!sourceKey || typeof sourceKey !== "string") {
    return NextResponse.json({ error: "sourceKey 必填" }, { status: 400 });
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const now = new Date();

  const existing = await db.reminder.findUnique({
    where: { sourceKey },
  });

  if (existing) {
    await db.reminder.update({
      where: { sourceKey },
      data: { status: "read", readAt: now },
    });
  } else {
    const type = sourceKey.startsWith("deadline:")
      ? "deadline"
      : sourceKey.startsWith("event:")
        ? "event"
        : "followup";

    await db.reminder.create({
      data: {
        type,
        status: "read",
        sourceKey,
        title: "",
        triggerAt: now,
        readAt: now,
        userId: user.id,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
