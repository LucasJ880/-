import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { batchAction } from "@/lib/notifications/service";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const { ids, action, snoozeUntil } = body as {
    ids?: string[];
    action?: string;
    snoozeUntil?: string;
  };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids 不能为空" }, { status: 400 });
  }

  if (!action || !["mark_read", "mark_done", "snooze"].includes(action)) {
    return NextResponse.json({ error: "action 无效" }, { status: 400 });
  }

  const until = snoozeUntil ? new Date(snoozeUntil) : undefined;
  const count = await batchAction(
    auth.user.id,
    ids,
    action as "mark_read" | "mark_done" | "snooze",
    until
  );

  return NextResponse.json({ ok: true, count });
}
