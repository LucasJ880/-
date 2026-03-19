import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { fetchGoogleEvents } from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get("date") || undefined;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json([]);

  const events = await fetchGoogleEvents(user.id, dateStr);
  return NextResponse.json(events);
}
