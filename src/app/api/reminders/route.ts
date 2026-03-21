import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { generateReminderLayers } from "@/lib/reminders/generator";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json(
      { immediate: [], today: [], upcoming: [], unreadCount: 0 }
    );
  }

  const layers = await generateReminderLayers(user.id);
  return NextResponse.json(layers);
}
