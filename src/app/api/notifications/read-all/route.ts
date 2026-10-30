import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { markAllRead } from "@/lib/notifications/service";

/** 本人全部未读标为已读；用户只认登录身份，不读请求体 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const count = await markAllRead(auth.user.id);
  return NextResponse.json({ ok: true, count });
}
