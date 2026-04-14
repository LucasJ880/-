import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { fetchGoogleEvents, fetchGoogleEventsRange } from "@/lib/google-calendar";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get("date") || undefined;
  const timeMin = searchParams.get("timeMin") || undefined;
  const timeMax = searchParams.get("timeMax") || undefined;

  if (timeMin && timeMax) {
    const events = await fetchGoogleEventsRange(user.id, { timeMin, timeMax });
    return NextResponse.json(events);
  }

  const events = await fetchGoogleEvents(user.id, dateStr);
  return NextResponse.json(events);
});
