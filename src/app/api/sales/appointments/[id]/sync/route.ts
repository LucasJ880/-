import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { syncAppointmentToGoogle, hasGoogleCalendar } from "@/lib/sales/appointment-gcal-sync";

export const POST = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;

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
});
