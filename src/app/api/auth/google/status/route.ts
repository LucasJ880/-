import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ connected: false });
  }

  const provider = await db.calendarProvider.findFirst({
    where: { userId: user.id, type: "google", enabled: true },
  });

  if (!provider || !provider.accessToken) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    email: provider.accountEmail,
  });
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  await db.calendarProvider.deleteMany({
    where: { userId: user.id, type: "google" },
  });

  return NextResponse.json({ success: true });
}
