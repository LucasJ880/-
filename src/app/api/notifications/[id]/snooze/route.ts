import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { snoozeNotification } from "@/lib/notifications/service";
import { startOfDayToronto } from "@/lib/time";

const PRESETS: Record<string, () => Date> = {
  later_today: () => new Date(Date.now() + 3 * 3600_000),
  tomorrow_morning: () => {
    const tomorrowStart = startOfDayToronto(new Date(Date.now() + 86_400_000));
    return new Date(tomorrowStart.getTime() + 9 * 3600_000);
  },
  next_week: () => {
    const nextWeekStart = startOfDayToronto(new Date(Date.now() + 7 * 86_400_000));
    return new Date(nextWeekStart.getTime() + 9 * 3600_000);
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
