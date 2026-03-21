import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { snoozeNotification } from "@/lib/notifications/service";

const PRESETS: Record<string, () => Date> = {
  later_today: () => {
    const d = new Date();
    d.setHours(d.getHours() + 3);
    return d;
  },
  tomorrow_morning: () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  },
  next_week: () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return d;
  },
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  let until: Date;
  if (body.snoozeUntil) {
    until = new Date(body.snoozeUntil);
    if (isNaN(until.getTime())) {
      return NextResponse.json({ error: "无效的时间" }, { status: 400 });
    }
  } else if (body.preset && PRESETS[body.preset]) {
    until = PRESETS[body.preset]();
  } else {
    until = PRESETS.later_today();
  }

  const ok = await snoozeNotification(id, auth.user.id, until);
  if (!ok) return NextResponse.json({ error: "通知不存在" }, { status: 404 });

  return NextResponse.json({ ok: true, snoozeUntil: until.toISOString() });
}
