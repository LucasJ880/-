import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { markDone } from "@/lib/notifications/service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const ok = await markDone(id, auth.user.id);
  if (!ok) return NextResponse.json({ error: "通知不存在" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
