import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveReminderReadStorageKey } from "@/lib/reminders/canonical-key";

/**
 * POST /api/reminders/read
 * body: { sourceKey: string }  // 界面业务 Key，如 deadline:{taskId}
 *
 * deadline / event：写入用户级 marker `read:{userId}:{canonical}`，避免全局 @unique 冲突。
 * followup：仅更新当前用户自己的 followup 行。
 */
export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => null);
  const rawKey =
    body &&
    typeof body === "object" &&
    typeof (body as { sourceKey?: unknown }).sourceKey === "string"
      ? (body as { sourceKey: string }).sourceKey
      : null;
  if (!rawKey) {
    return NextResponse.json({ error: "sourceKey 必填" }, { status: 400 });
  }

  const { businessKey, storageKey, kind } = resolveReminderReadStorageKey(
    user.id,
    rawKey
  );
  const now = new Date();

  if (kind === "followup") {
    const existing = await db.reminder.findFirst({
      where: {
        userId: user.id,
        OR: [{ sourceKey: rawKey }, { sourceKey: businessKey }],
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "提醒不存在" }, { status: 404 });
    }
    await db.reminder.update({
      where: { id: existing.id },
      data: { status: "read", readAt: now },
    });
    return NextResponse.json({
      ok: true,
      sourceKey: businessKey,
      storageKey: existing.sourceKey,
    });
  }

  const type = businessKey.startsWith("deadline:") ? "deadline" : "event";

  const existingMarker = await db.reminder.findUnique({
    where: { sourceKey: storageKey },
  });

  if (existingMarker) {
    // marker Key 含 userId，理论上必属当前用户；防御性校验
    if (existingMarker.userId !== user.id) {
      return NextResponse.json({ error: "无权操作" }, { status: 403 });
    }
    await db.reminder.update({
      where: { sourceKey: storageKey },
      data: { status: "read", readAt: now },
    });
  } else {
    await db.reminder.create({
      data: {
        type,
        status: "read",
        sourceKey: storageKey,
        title: "",
        triggerAt: now,
        readAt: now,
        userId: user.id,
      },
    });
  }

  // 仅清理当前用户的旧相对日 / 旧全局 canonical 行
  const entityId = businessKey.includes(":")
    ? businessKey.slice(businessKey.indexOf(":") + 1)
    : "";
  const legacyKeys =
    type === "deadline"
      ? [
          businessKey,
          `deadline:today:${entityId}`,
          `deadline:tomorrow:${entityId}`,
          `deadline:overdue:${entityId}`,
        ]
      : [businessKey, `event:today:${entityId}`];

  await db.reminder.updateMany({
    where: {
      userId: user.id,
      sourceKey: { in: legacyKeys },
      status: { not: "read" },
    },
    data: { status: "read", readAt: now },
  });

  return NextResponse.json({
    ok: true,
    sourceKey: businessKey,
    storageKey,
  });
});
