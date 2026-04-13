import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { syncAppointmentToGoogle, hasGoogleCalendar } from "@/lib/sales/appointment-gcal-sync";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;

  const connected = await hasGoogleCalendar(user.id);
  if (!connected) {
    return NextResponse.json(
      { error: "请先在设置中连接 Google Calendar", connected: false },
      { status: 400 },
    );
  }

  const result = await syncAppointmentToGoogle(id, user.id);

  return NextResponse.json({
    synced: result.synced,
    googleEventId: result.googleEventId ?? null,
  });
}
