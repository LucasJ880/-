import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { canonicalReminderKey } from "@/lib/reminders/canonical-key";

/**
 * POST /api/reminders/read
 * body: { sourceKey: string }
 *
 * 标记一条提醒为已读（写入 canonical sourceKey，兼容旧 today/overdue key）。
 * - followup 类型：更新已有 Reminder 记录
 * - deadline / event 类型：创建一条 status=read 的标记记录
 */
export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => null);
  const rawKey =
    body && typeof body === "object" && typeof (body as { sourceKey?: unknown }).sourceKey === "string"
      ? (body as { sourceKey: string }).sourceKey
      : null;
  if (!rawKey) {
    return NextResponse.json({ error: "sourceKey 必填" }, { status: 400 });
  }

  const sourceKey = canonicalReminderKey(rawKey);
  const now = new Date();

  const existing = await db.reminder.findUnique({
    where: { sourceKey },
  });

  if (existing) {
    if (existing.userId !== user.id) {
      return NextResponse.json({ error: "无权操作" }, { status: 403 });
    }
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

  // 清理同实体的旧相对日 key，避免残留
  if (sourceKey.startsWith("deadline:") || sourceKey.startsWith("event:")) {
    const legacyPrefixes = sourceKey.startsWith("deadline:")
      ? [
          `deadline:today:${sourceKey.slice("deadline:".length)}`,
          `deadline:tomorrow:${sourceKey.slice("deadline:".length)}`,
          `deadline:overdue:${sourceKey.slice("deadline:".length)}`,
        ]
      : [`event:today:${sourceKey.slice("event:".length)}`];

    await db.reminder.updateMany({
      where: {
        userId: user.id,
        sourceKey: { in: legacyPrefixes },
        status: { not: "read" },
      },
      data: { status: "read", readAt: now },
    });
  }

  return NextResponse.json({ ok: true, sourceKey });
});
