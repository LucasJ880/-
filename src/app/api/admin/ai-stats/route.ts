import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { getAiStats } from "@/lib/ai/monitor";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const windowMinutes = Number(request.nextUrl.searchParams.get("window")) || 60;
  const stats = getAiStats(windowMinutes);

  return NextResponse.json(stats);
}
