import { NextRequest, NextResponse } from "next/server";
import { isPreviewReadonly } from "@/lib/preview/server";
import { requireAuth } from "@/lib/auth/guards";
import { syncNotifications, getUnreadCount } from "@/lib/notifications/service";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // VIS-1e：以岗位预览期间不同步（同步会建 / 改通知）
  if (!(await isPreviewReadonly(auth.user.id))) await syncNotifications(auth.user.id);
  const count = await getUnreadCount(auth.user.id);

  return NextResponse.json({ count });
}
