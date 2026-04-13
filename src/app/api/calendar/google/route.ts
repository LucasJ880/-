import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { fetchGoogleEvents, fetchGoogleEventsRange } from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get("date") || undefined;
  const timeMin = searchParams.get("timeMin") || undefined;
  const timeMax = searchParams.get("timeMax") || undefined;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json([]);

  if (timeMin && timeMax) {
    const events = await fetchGoogleEventsRange(user.id, { timeMin, timeMax });
    return NextResponse.json(events);
  }

  const events = await fetchGoogleEvents(user.id, dateStr);
  return NextResponse.json(events);
}
