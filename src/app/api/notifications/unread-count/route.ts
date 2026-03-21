import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { syncNotifications, getUnreadCount } from "@/lib/notifications/service";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  await syncNotifications(auth.user.id);
  const count = await getUnreadCount(auth.user.id);

  return NextResponse.json({ count });
}
